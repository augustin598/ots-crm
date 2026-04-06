# Deep Scheduler Admin Page Audit Report

**Date:** 2026-04-05  
**Component:** SvelteKit Scheduler Admin (3 files)  
**Auditor:** Gemini + Manual Review

---

## Executive Summary

The scheduler admin page has **5 CRITICAL/HIGH severity issues** that should be fixed immediately:

1. **CRITICAL:** 60+ unnecessary queries per stats fetch (N+1 problem)
2. **HIGH:** Race condition in job update can lose scheduled jobs
3. **HIGH:** Weak validation allows deletion of critical system jobs
4. **MEDIUM:** Stats cards show inconsistent data (truncated vs full)
5. **MEDIUM:** No rate limiting on manual job triggers

---

## A. PERFORMANCE ISSUES

### A1. CRITICAL: 60+ Query N+1 Problem in `getJobStats`

**Files:** `/Users/augustin598/Projects/CRM/app/src/lib/remotes/scheduler.remote.ts`  
**Lines:** 82-137  
**Severity:** CRITICAL

**The Problem:**
```typescript
// Lines 86: Loop through handler types
const handlerTypes = Object.keys(JOB_LABELS);  // ~21 types

for (const ht of handlerTypes) {
    // Line 91-99: Query 1 — count successes
    const [successResult] = await db.select({ cnt: count() })...
    
    // Line 102-109: Query 2 — count failures
    const [failResult] = await db.select({ cnt: count() })...
    
    // Line 112-126: Query 3 — get last execution
    const [lastLog] = await db.select(...)...
}
```

This executes **21 × 3 = 63 queries** every time the page loads or refreshes. With Turso/libSQL, each query has network latency, making the admin page slow and degrading database performance.

**Root Cause:** Sequential queries in a loop instead of a single batched aggregation.

**Fix Suggestion:**
Use a single query with `GROUP BY` and `UNION ALL` subqueries to fetch all stats in one round-trip:

```typescript
export const getJobStats = query(async () => {
	requireAdmin();

	const handlerTypes = Object.keys(JOB_LABELS);
	
	// Single query with GROUP BY to get all stats at once
	const results = await db
		.select({
			handlerType: sql<string>`
				CASE 
					WHEN ${table.debugLog.message} LIKE 'Job completed: %' 
					THEN SUBSTRING(${table.debugLog.message}, 16)
					WHEN ${table.debugLog.message} LIKE 'Job failed: %'
					THEN SUBSTRING(${table.debugLog.message}, 12)
				END
			`,
			successCount: count(
				sql`CASE WHEN ${table.debugLog.level} = 'info' THEN 1 END`
			),
			failCount: count(
				sql`CASE WHEN ${table.debugLog.level} = 'error' THEN 1 END`
			),
			lastRun: sql<string | null>`MAX(${table.debugLog.createdAt})`,
			lastStatus: sql<'success' | 'error' | null>`
				CASE 
					WHEN MAX(CASE WHEN ${table.debugLog.level} = 'error' THEN 1 END) IS NOT NULL 
					THEN 'error'
					WHEN MAX(CASE WHEN ${table.debugLog.level} = 'info' THEN 1 END) IS NOT NULL
					THEN 'success'
					ELSE NULL
				END
			`
		})
		.from(table.debugLog)
		.where(eq(table.debugLog.source, 'scheduler'))
		.groupBy(sql`handlerType`);

	const stats: Record<string, any> = {};
	for (const ht of handlerTypes) {
		const result = results.find(r => r.handlerType === ht);
		stats[ht] = result || {
			successCount: 0,
			failCount: 0,
			lastRun: null,
			lastStatus: null
		};
	}
	return stats;
});
```

**Impact:** Reduces 63 queries → 1 query. Page load time should improve by 50-80% (depending on network latency).

---

### A2. MEDIUM: Stats Card Data Inconsistency

**Files:** 
- `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte` (lines 73-76)
- `/Users/augustin598/Projects/CRM/app/src/lib/remotes/scheduler.remote.ts` (lines 45-63)

**Lines:** Component 73-76; Remote 45-63  
**Severity:** MEDIUM

**The Problem:**

The `history` query (remote.ts line 60) is capped at **1000 items**:
```typescript
.limit(1000);  // Line 60
```

But the stats cards compute their counts from this truncated history:
```typescript
// Component line 74-76
const completedLogs = $derived(history.filter((l) => l.level === 'info' && l.message.startsWith('Job completed:')));
const failedLogs = $derived(history.filter((l) => l.level === 'error' && l.message.startsWith('Job failed:')));
const warningLogs = $derived(history.filter((l) => l.level === 'warning'));
```

Meanwhile, `getSchedulerStats` (remote.ts lines 65-79) queries the **full database** with no limit:
```typescript
.from(table.debugLog)
.where(eq(table.debugLog.source, 'scheduler'));
// No limit!
```

**Real-World Scenario:**
- Database has 50,000 total error logs
- Only 10 errors in the latest 1000 logs
- "Esuate" card shows **10** instead of **50,000**
- Admin thinks the system is healthy when it's actually degraded

**Why This Matters:** The dashboard metrics are fundamentally misleading.

**Fix Suggestion:**

Use the `stats` variable from `getSchedulerStats` (which already exists!) for the card counts:

```typescript
// Component line 56-57: stats is already fetched
const statsQuery = getSchedulerStats();
const stats = $derived(statsQuery.current || { total: 0, info: 0, warning: 0, error: 0 });

// Update the cards (currently lines 293-335) to use stats instead:
```

Change card 2:
```svelte
<!-- OLD (line 307): completedLogs.length → NEW: stats.info -->
<span class="text-2xl font-bold text-green-600">{stats.info}</span>
```

Change card 3:
```svelte
<!-- OLD (line 318): warningLogs.length → NEW: stats.warning -->
<span class="text-2xl font-bold text-amber-600">{stats.warning}</span>
```

Change card 4:
```svelte
<!-- OLD (line 329): failedLogs.length → NEW: stats.error -->
<span class="text-2xl font-bold text-red-600">{stats.error}</span>
```

**Impact:** Cards now show accurate counts even if the history buffer is exceeded.

---

### A3. No Other Obvious N+1 Issues
The other remote handlers use single queries or necessary loops (e.g., `getSchedulerJobs` fetches from BullMQ which is correct).

---

## B. DATA CORRECTNESS & SAFETY

### B1. HIGH: Job Update Race Condition (Data Loss Risk)

**File:** `/Users/augustin598/Projects/CRM/app/src/lib/remotes/scheduler.remote.ts`  
**Lines:** 139-176  
**Severity:** HIGH

**The Problem:**

```typescript
async ({ jobId, name, pattern, tz }) => {
    // Line 152: Remove old job
    await queue.removeRepeatableByKey(jobId);

    // Lines 159-172: Try to add new job
    await queue.add(
        name,
        { type: handlerType, params },
        { repeat: { pattern, tz }, jobId: name }
    );
    // ^^^ If this fails, old job is GONE, new job never created
}
```

**Failure Scenario:**
1. Admin updates the "Sync Facturi Gmail" schedule from `0 5 * * *` to `0 6 * * *`
2. Old job is removed successfully
3. Network glitch/Redis connection fails at moment of `queue.add()`
4. Error is thrown, request fails
5. Job is **permanently lost** — not scheduled anymore
6. No invoices sync that day
7. Admin has no way to recover except re-adding through UI

**Why This Is Bad:**
- **Data loss:** Scheduled tasks vanish
- **Silent failure:** No error recovery mechanism
- **Unattended infrastructure:** If the admin isn't watching the toast notification, they won't know

**Fix Suggestion:**

Option 1 (Validate Before Remove):
```typescript
export const updateJobSchedule = command(
    v.object({ jobId: v.string(), name: v.string(), pattern: v.pipe(...) }),
    async ({ jobId, name, pattern, tz }) => {
        requireAdmin();
        const queue = getSchedulerQueue();

        // Validate cron pattern FIRST (before modifying state)
        try {
            // Use a cron parser to validate; e.g., npm install cron-parser
            new CronParser(pattern);
        } catch (e) {
            throw new Error(`Invalid cron pattern: ${pattern}`);
        }

        const typeKey = name.replace(/-/g, '_');
        const handlerType = JOB_HANDLER_TYPES[typeKey] || typeKey;
        const params = JOB_PARAMS[typeKey] || {};

        // Add new job FIRST with temporary ID to verify it works
        await queue.add(
            `${name}-temp`,
            { type: handlerType, params },
            { repeat: { pattern, tz }, jobId: `${name}-temp` }
        );

        // Only remove old job if new one is confirmed
        try {
            await queue.removeRepeatableByKey(jobId);
            // Rename temp job to final
            await queue.removeRepeatableByKey(`${name}-temp`);
            await queue.add(
                name,
                { type: handlerType, params },
                { repeat: { pattern, tz }, jobId: name }
            );
        } catch (e) {
            // Cleanup temp job if rename fails
            await queue.removeRepeatableByKey(`${name}-temp`).catch(() => {});
            throw e;
        }

        return { success: true };
    }
);
```

Option 2 (Soft Update — Use a Status Field):
If BullMQ supports job data updates, add an `active: boolean` field instead of removing/re-adding.

**Impact:** Prevents silent job deletion; provides rollback capability.

---

### B2. LOW: Job Filter False Positives

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Lines:** 99-104  
**Severity:** LOW

**The Problem:**

```typescript
const filteredHistory = $derived(
    history.filter((l) => {
        if (historyFilter !== 'all') {
            if (!l.message.includes(historyFilter)) return false;  // Line 103
        }
        // ...
    })
);
```

When `historyFilter = 'token_refresh'`, the filter matches both:
- `Job completed: token_refresh` ✓ (correct)
- `Job completed: token_refresh_frequent` ✓ (false positive!)
- `Job completed: token_refresh_daily` ✓ (false positive!)

**Why This Matters:** User expects to see only `token_refresh` logs but gets 3 different jobs' logs mixed together.

**Fix Suggestion:**

Use exact message matching:

```typescript
const filteredHistory = $derived(
    history.filter((l) => {
        if (historyFilter !== 'all') {
            // Extract handler type from message exactly
            const messageType = l.message.match(/^Job (?:completed|failed): (\w+)/)?.[1];
            if (messageType !== historyFilter) return false;
        }
        // ...
    })
);
```

Or store handler type in metadata during logging (better approach).

---

### B3. LOW: `cronToHuman` Unhandled Patterns

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Lines:** 240-268  
**Severity:** LOW

**The Problem:**

Patterns like:
- `0 0 * * 0` (weekly) → returns raw `"0 0 * * 0"`
- `0 0 1,15 * *` (twice monthly) → returns raw pattern
- `*/15 * * * *` (every 15 minutes) → returns raw pattern

UI shows un-translated cron:
```svelte
{cronToHuman(job.pattern || '')}
```

**Why This Matters:** Admin sees cryptic cron syntax instead of human text. Not a bug, but poor UX.

**Fix Suggestion:**

Use `cronstrue` library:

```typescript
import { toString } from 'cronstrue';

function cronToHuman(pattern: string): string {
    try {
        return toString(pattern, { locale: 'ro' });  // Romanian locale
    } catch {
        return pattern;  // Fallback to raw if invalid
    }
}
```

---

## C. UI/UX ISSUES

### C1. LOW: Inconsistent "Job-uri Active" Stats Card

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Lines:** 293-301  
**Severity:** LOW

**The Problem:**

Card 1 (Job-uri Active):
```svelte
<Card
    class="cursor-pointer transition-colors {historyLevelFilter === '' && !hasActiveFilters ? '' : ''}"
>
    <CardContent class="pt-6">
        <div class="text-2xl font-bold">{jobs.length}</div>
        <p class="text-xs text-muted-foreground">Job-uri Active</p>
    </CardContent>
</Card>
```

vs. Cards 2-4:
```svelte
<button type="button" class="text-left" onclick={() => toggleStatFilter('info')}>
    <Card class="cursor-pointer transition-colors hover:border-green-500/50 ...">
        <!-- content -->
    </Card>
</button>
```

**Issues:**
- Card 1 has `cursor-pointer` but no `onclick` → misleading hover style
- Empty conditional class: `{... ? '' : ''}` does nothing
- Not consistent with other cards

**Fix Suggestion:**

Option A (Make it clickable):
```svelte
<button type="button" class="text-left" onclick={() => { /* filter by active jobs */ }}>
    <Card class="cursor-pointer transition-colors hover:border-blue-500/50 {historyLevelFilter === 'active' ? 'border-blue-500' : ''}">
        <CardContent class="pt-6">
            <div class="text-2xl font-bold">{jobs.length}</div>
            <p class="text-xs text-muted-foreground">Job-uri Active</p>
        </CardContent>
    </Card>
</button>
```

Option B (Remove clickable styling):
```svelte
<Card>
    <CardContent class="pt-6">
        <div class="text-2xl font-bold">{jobs.length}</div>
        <p class="text-xs text-muted-foreground">Job-uri Active</p>
    </CardContent>
</Card>
```

---

### C2. LOW: Unused `stats` Variable

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Lines:** 56-57  
**Severity:** LOW

**The Problem:**

```typescript
const statsQuery = getSchedulerStats();
const stats = $derived(statsQuery.current || { total: 0, info: 0, warning: 0, error: 0 });
```

This variable is **never used** in the template. Instead, the cards use:
```typescript
{completedLogs.length}  // From truncated history
{warningLogs.length}    // From truncated history
{failedLogs.length}     // From truncated history
```

**Why This Matters:**
- Wastes bandwidth fetching unused data
- Contributes to the inconsistency issue (B2)

**Fix Suggestion:**

Update the cards to use `stats` (fixes issue A2):

```svelte
<span class="text-2xl font-bold text-green-600">{stats.info}</span>
<!-- vs old: completedLogs.length -->
```

---

### C3. ACCESSIBILITY: Missing ARIA Labels

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Severity:** LOW

**Issues:**
- Collapsible history items (lines 530-565) have no `aria-expanded` attribute
- Icon-only buttons (lines 412, 419, 422) lack `aria-label` attributes
- Stats cards lack semantic structure (should use `<section>` or `aria-label`)

**Example Fix:**

```svelte
<!-- Line 412 trigger button -->
<Button 
    variant="ghost" 
    size="icon" 
    title="Ruleaza acum" 
    aria-label="Ruleaza job-ul {job.label} acum"
    onclick={() => handleTriggerNow(job)} 
    disabled={isTriggering}
>
    {#if isTriggering}
        <RefreshCwIcon class="size-3.5 animate-spin" />
    {:else}
        <PlayIcon class="size-3.5" />
    {/if}
</Button>
```

---

## D. SECURITY ISSUES

### D1. HIGH: Weak `removeSchedulerJob` Validation

**File:** `/Users/augustin598/Projects/CRM/app/src/lib/remotes/scheduler.remote.ts`  
**Lines:** 178-188  
**Severity:** HIGH

**The Problem:**

```typescript
export const removeSchedulerJob = command(
    v.pipe(v.string(), v.minLength(1)),  // Only checks length!
    async (jobKey) => {
        requireAdmin();
        const queue = getSchedulerQueue();
        await queue.removeRepeatableByKey(jobKey);
        return { success: true };
    }
);
```

An admin could accidentally (or maliciously) delete **critical system jobs**:

```
removeSchedulerJob("recurring-invoices")        // ❌ Daily invoice generation stops
removeSchedulerJob("token-refresh-frequent")    // ❌ Gmail/Google Ads tokens expire
removeSchedulerJob("db-write-health-check")     // ❌ Silent DB failures not detected
removeSchedulerJob("invoice-overdue-reminders") // ❌ Dunning stops
```

Without a UI way to restore jobs, the system is broken until a developer redeploys.

**Fix Suggestion:**

Add a whitelist of "user-deletable" jobs:

```typescript
// Define protected jobs
const PROTECTED_JOBS = new Set([
    'recurring-invoices',
    'token-refresh-frequent',
    'token-refresh-daily',
    'db-write-health-check',
    'debug-log-cleanup',
    'contract-lifecycle',
    'invoice-overdue-reminders'
    // ... other critical jobs
]);

export const removeSchedulerJob = command(
    v.pipe(v.string(), v.minLength(1)),
    async (jobKey) => {
        requireAdmin();
        
        // Prevent deletion of protected jobs
        if (PROTECTED_JOBS.has(jobKey)) {
            throw new Error(`Cannot delete protected job: ${jobKey}. Contact support to re-enable.`);
        }
        
        const queue = getSchedulerQueue();
        await queue.removeRepeatableByKey(jobKey);
        logWarning('scheduler', `Job deleted by admin`, { metadata: { jobKey, userId: event.locals.user?.id } });
        
        return { success: true };
    }
);
```

**Better Alternative:** Require a "system-level" role (different from "admin"):

```typescript
function requireSystemAdmin() {
    const event = getRequestEvent();
    if (event.locals.tenantUser?.role !== 'system_admin') {
        throw new Error('Forbidden: System admin access required');
    }
    return event;
}

export const removeSchedulerJob = command(...) {
    requireSystemAdmin();  // Only system admins can delete
    // ...
};
```

---

### D2. MEDIUM: No Rate Limiting on `triggerJobNow`

**File:** `/Users/augustin598/Projects/CRM/app/src/lib/remotes/scheduler.remote.ts`  
**Lines:** 190-215  
**Severity:** MEDIUM

**The Problem:**

```typescript
export const triggerJobNow = command(
    v.object({ name: v.string(), typeKey: v.string(), params: v.optional(...) }),
    async ({ name, typeKey, params }) => {
        requireAdmin();
        const queue = getSchedulerQueue();
        
        // No rate limiting — can be called infinitely fast
        await queue.add(`${name}-manual`, ...);
        return { success: true };
    }
);
```

An admin could spam-click the "Play" button 100 times in 1 second:

```
triggerJobNow({ name: "gmail-invoice-sync" })
triggerJobNow({ name: "gmail-invoice-sync" })
triggerJobNow({ name: "gmail-invoice-sync" })
// ... 100x
```

**Consequences:**
- **Gmail API rate limiting:** Hits Google's quota
- **Database overload:** 100 concurrent invoice sync queries
- **External API abuse:** Spam requests to SPV, Revolut, Keez, etc.
- **Resource exhaustion:** Redis queue backs up

**Fix Suggestion:**

Add per-user debounce + cache:

```typescript
// In-memory debounce map (reset on app restart, but good enough for manual triggers)
const lastTrigger = new Map<string, number>();  // userId + jobName -> timestamp

export const triggerJobNow = command(...) {
    requireAdmin();
    const event = getRequestEvent();
    const userId = event.locals.user!.id;
    const debounceKey = `${userId}:${name}`;
    
    // Check if triggered in last 5 seconds
    const lastTime = lastTrigger.get(debounceKey) ?? 0;
    if (Date.now() - lastTime < 5000) {
        throw new Error('Job triggered too recently. Wait 5 seconds before trying again.');
    }
    
    lastTrigger.set(debounceKey, Date.now());
    
    const queue = getSchedulerQueue();
    await queue.add(`${name}-manual-${Date.now()}`, ...);
    
    return { success: true };
};
```

Or use Redis for distributed rate limiting (better):

```typescript
export const triggerJobNow = command(...) {
    requireAdmin();
    const event = getRequestEvent();
    const userId = event.locals.user!.id;
    const debounceKey = `trigger:${userId}:${name}`;
    
    const redis = getRedis();
    const exists = await redis.exists(debounceKey);
    
    if (exists) {
        throw new Error('Job triggered recently. Wait before trying again.');
    }
    
    // Set a 5-second cooldown
    await redis.setex(debounceKey, 5, '1');
    
    const queue = getSchedulerQueue();
    await queue.add(`${name}-manual-${Date.now()}`, ...);
    
    return { success: true };
};
```

---

## E. CODE QUALITY

### E1. LOW: Type Safety in `jobStats` Derivation

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Lines:** 60-61  
**Severity:** LOW

**The Problem:**

```typescript
const jobStatsQuery = getJobStats();
const jobStats = $derived(jobStatsQuery.current || {} as Record<string, { ... }>);
// ^^^ Forced type cast; if query returns unexpected shape, no validation
```

Then used as:

```typescript
{@const stat = jobStats[job.handlerType]}
{#if stat}
    <span>{stat.successCount}</span>  // ✓ OK if stat exists
{/if}
```

**Risks:**
- If `getJobStats` returns `null` or unexpected structure, `jobStats` becomes `{}`
- Accessing `jobStats[job.handlerType]` silently returns `undefined`
- No type error caught at compile-time

**Fix Suggestion:**

Add runtime validation via Valibot:

```typescript
import * as v from 'valibot';

const jobStatsSchema = v.record(v.string(), v.object({
    successCount: v.number(),
    failCount: v.number(),
    lastRun: v.nullable(v.string()),
    lastStatus: v.nullable(v.picklist(['success', 'error']))
}));

const jobStatsQuery = getJobStats();
const jobStats = $derived.by(() => {
    const raw = jobStatsQuery.current;
    try {
        return v.parse(jobStatsSchema, raw || {});
    } catch {
        return {} as Record<string, any>;
    }
});
```

---

### E2. LOW: Unused Functions Check

**File:** `/Users/augustin598/Projects/CRM/app/src/routes/[tenant]/admin/scheduler/+page.svelte`  
**Lines:** 1-10 imports  
**Severity:** LOW

**Status:** ✓ All 7 imported functions are used:
- `getSchedulerJobs` — line 48
- `getSchedulerHistory` — line 53
- `getSchedulerStats` — line 56
- `getJobStats` — line 60
- `updateJobSchedule` — line 174
- `removeSchedulerJob` — line 190
- `triggerJobNow` — line 204

**Icon imports:** All used in template. ✓

---

### E3. LOW: Error Handling in `updateJobSchedule`

**File:** `/Users/anthropic/scheduler.remote.ts`  
**Lines:** 139-176  
**Severity:** LOW

**Current Error Handling:**

```typescript
// Line 152: remove old job (no error handling)
await queue.removeRepeatableByKey(jobId);

// Lines 159-172: add new job (no error handling)
await queue.add(...);

return { success: true };
```

If `queue.removeRepeatableByKey` fails, the function throws immediately (good).  
If `queue.add` fails after removal, data loss occurs (bad — covered in B1).

---

## F. SUMMARY OF FIXES BY PRIORITY

### Critical (Fix Immediately)

| Issue | File | Lines | Fix Time | Impact |
|-------|------|-------|----------|--------|
| A1: N+1 Query Problem | remote.ts | 82-137 | 1-2h | 50-80% faster page load |
| B1: Job Update Race Condition | remote.ts | 139-176 | 2-3h | Prevent data loss |
| D1: Weak removeSchedulerJob Validation | remote.ts | 178-188 | 30min | Prevent job deletion |

### High (Fix Soon)

| Issue | File | Lines | Fix Time | Impact |
|-------|------|-------|----------|--------|
| A2: Stats Card Inconsistency | component + remote | 73-79 | 30min | Accurate metrics |
| D2: No Rate Limiting on triggerJobNow | remote.ts | 190-215 | 1h | Prevent API spam |

### Medium (Nice to Have)

| Issue | File | Lines | Fix Time | Impact |
|-------|------|-------|----------|--------|
| B2: Filter False Positives | component.svelte | 103 | 15min | Better filtering |
| C1: Inconsistent Stats Card | component.svelte | 293-301 | 10min | UI consistency |
| E1: Type Safety in jobStats | component.svelte | 60-61 | 20min | Better error handling |

### Low (Polish)

| Issue | File | Lines | Fix Time | Impact |
|-------|------|-------|----------|--------|
| B3: cronToHuman Unhandled Patterns | component.svelte | 240-268 | 1h | Better UX |
| C2: Unused stats Variable | component.svelte | 56-57 | 5min | Cleanup |
| C3: Accessibility Issues | component.svelte | 530-565 | 30min | WCAG compliance |

---

## G. TESTING RECOMMENDATIONS

After fixes:

1. **Load Testing:** Verify page load time with `getJobStats` fix
2. **Race Condition:** Mock Redis timeout during `queue.add()` to verify job isn't lost
3. **Rate Limiting:** Spam the Play button 100 times, verify queue has max 1 job per 5 seconds
4. **Stats Accuracy:** Add 10,000 logs to debugLog table; verify cards show 10,000+, not truncated counts
5. **Filter Accuracy:** Create jobs named `token_refresh`, `token_refresh_frequent`, `token_refresh_daily`; verify filter separates them correctly

---

## H. CONCLUSION

The scheduler admin has **strong functionality** but needs **critical fixes** in 3 areas:

1. **Performance:** Batch the 60 queries into 1
2. **Safety:** Prevent job loss on update failure
3. **Security:** Protect critical jobs and rate-limit triggers

All fixes are straightforward and testable. Priority: A1 → B1 → D1 → A2 → D2.

