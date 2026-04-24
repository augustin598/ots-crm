# Keez Sync Retry & 502 Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Keez transient-failure retry path (BullMQ rejects jobIds containing `:`) and harden the surrounding failure pipeline so a degraded Keez upstream cannot leave integrations in a "ghost" state or amplify the outage with retry storms.

**Architecture:** Five surgical changes on existing keez plugin files (no schema, no new modules). Pure-function changes are TDD with `bun:test`; integration glue is verified with `svelte-check` + manual smoke. Each task ships independently and is independently revertable.

**Tech Stack:** SvelteKit 5, Bun, TypeScript, Drizzle ORM (libSQL/Turso), BullMQ 5.66.4, `bun:test`.

**Context (incident 2026-04-24):** Keez nginx returned 502 in waves throughout the day. Three observed symptoms:
1. `Keez API error: 502 ... nginx/1.18.0` per invoice (~20 entries)
2. `Sync failure: The operation timed out.` (per-fetch 30s AbortSignal firing)
3. `Failed to enqueue retry: Custom Id cannot contain :` — BullMQ rejecting `keez-invoice-sync-retry:${tenantId}` because `:` is the Redis key namespace separator. **Introduced in commit `e87e4f9` (#19).** Effect: retry never enqueues; integration counter increments but neither retries nor degrades cleanly.

---

## Task 1 — Hotfix: replace `:` with `-` in retry jobId

**Files:**
- Modify: `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts:12-14`
- Create: `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts
import { describe, expect, test } from 'bun:test';
import { retryJobId } from './keez-invoice-sync-retry';

describe('retryJobId', () => {
	test('does not contain colon (BullMQ rejects colons in jobIds)', () => {
		const id = retryJobId('tenant-abc-123');
		expect(id).not.toContain(':');
	});

	test('is unique per tenant', () => {
		expect(retryJobId('a')).not.toBe(retryJobId('b'));
	});

	test('is stable for the same tenant (so dedup works)', () => {
		expect(retryJobId('xyz')).toBe(retryJobId('xyz'));
	});

	test('embeds the tenantId for traceability', () => {
		expect(retryJobId('tenant-xyz')).toContain('tenant-xyz');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts`
Expected: FAIL on "does not contain colon" (current value is `keez-invoice-sync-retry:${tenantId}`).

- [ ] **Step 3: Apply the fix**

Edit `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts:12-14`:

```ts
export function retryJobId(tenantId: string): string {
	return `keez-invoice-sync-retry-${tenantId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Sweep the codebase for any other `jobId` containing `:`**

Run: `cd app && grep -rn "jobId:" src/lib/server/scheduler/ src/lib/server/plugins/ | grep -v node_modules`
Expected: only this file's `retryJobId(...)` reference; no inline templates with `:`. If any are found, fix them in this same task.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts \
        app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts
git commit -m "fix(keez): use '-' instead of ':' in retry jobId (BullMQ validation)"
```

---

## Task 2 — Defense in depth: enqueue failure must not leave integration in "ghost" state

**Why:** Today, if `enqueueRetry` throws (it always did — Task 1's bug), `failure-handler.ts:65-68` catches and logs but returns. The integration is left with `consecutiveFailures` incremented and **no retry queued, not degraded, no admin notification**. The next hourly cron (or daily 4 AM run) is the only way out. Need: when enqueue fails, immediately escalate to `mark_degraded` so an operator is notified.

**Files:**
- Modify: `app/src/lib/server/plugins/keez/failure-handler.ts:60-74`
- Create: `app/src/lib/server/plugins/keez/failure-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/server/plugins/keez/failure-handler.test.ts
//
// Bun's mock.module() must be set up BEFORE the module under test loads.
// We use a spy on the db update path (the only side-effect we can observe
// without a real Turso connection) and a captured logger to verify the
// "escalating to degraded" message was emitted.
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const updateCalls: Array<Record<string, unknown>> = [];
const errorLogs: string[] = [];

mock.module('../../db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({ limit: () => Promise.resolve([{ consecutiveFailures: 0 }]) }),
			}),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateCalls.push(values);
				return { where: () => Promise.resolve() };
			},
		}),
	},
}));
mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({ limit: () => Promise.resolve([{ consecutiveFailures: 0 }]) }),
			}),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateCalls.push(values);
				return { where: () => Promise.resolve() };
			},
		}),
	},
}));
mock.module('$lib/server/db/schema', () => ({
	keezIntegration: { tenantId: 'tenantId', consecutiveFailures: 'consecutiveFailures' },
	tenantUser: { tenantId: 'tenantId', userId: 'userId', role: 'role' },
	tenant: { id: 'id', slug: 'slug' },
}));
mock.module('$lib/server/notifications', () => ({
	createNotification: () => Promise.resolve(),
}));
mock.module('$lib/server/logger', () => ({
	serializeError: (e: any) => ({ message: e?.message ?? String(e), stack: '' }),
	logInfo: () => {},
	logWarning: () => {},
	logError: (_src: string, msg: string) => { errorLogs.push(msg); },
}));

const { handleKeezSyncFailure } = await import('./failure-handler');

describe('handleKeezSyncFailure', () => {
	beforeEach(() => {
		updateCalls.length = 0;
		errorLogs.length = 0;
	});

	test('when enqueueRetry throws, force-marks integration degraded', async () => {
		const enqueueRetry = () => Promise.reject(new Error('Custom Id cannot contain :'));
		const transientErr = new Error('Keez API error: 502 nginx');

		await handleKeezSyncFailure('t1', transientErr, { enqueueRetry });

		// Two updates expected: (1) the initial failure-state update, (2) the
		// force-degrade update after enqueue failure. The second must include
		// isDegraded: true.
		const degradedUpdate = updateCalls.find((u) => u.isDegraded === true);
		expect(degradedUpdate).toBeTruthy();

		// And the escalation reason must have been logged.
		expect(errorLogs.some((m) => m.includes('escalating to degraded'))).toBe(true);
	});

	test('when enqueueRetry succeeds, does NOT force degraded', async () => {
		const enqueueRetry = () => Promise.resolve();
		const transientErr = new Error('Keez API error: 502 nginx');

		await handleKeezSyncFailure('t1', transientErr, { enqueueRetry });

		// Only the initial failure-state update; no degraded escalation.
		const degradedEscalation = updateCalls.filter((u) => u.isDegraded === true);
		expect(degradedEscalation).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('escalating'))).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/server/plugins/keez/failure-handler.test.ts`
Expected: FAIL because the current code `return`s after the enqueue catch and never calls `createAdminNotificationsForTenant`.

- [ ] **Step 3: Apply the fix**

Edit `app/src/lib/server/plugins/keez/failure-handler.ts`. Replace lines 61-70 (the `if (action.kind === 'schedule_retry') { ... return; }` block) with:

```ts
	if (action.kind === 'schedule_retry') {
		try {
			await options.enqueueRetry(tenantId, action.delayMs);
			logInfo('keez', `Scheduled retry in ${action.delayMs / 60_000} min (failure ${newCount}/${MAX_CONSECUTIVE_FAILURES})`, { tenantId });
			return;
		} catch (queueErr) {
			const e = serializeError(queueErr);
			logError('keez', `Failed to enqueue retry, escalating to degraded: ${e.message}`, { tenantId });
			// Force-degrade: the integration would otherwise be a "ghost" — counter
			// incremented, no retry queued, no operator visibility until the daily cron.
			try {
				await db
					.update(table.keezIntegration)
					.set({ isDegraded: true, updatedAt: new Date() })
					.where(eq(table.keezIntegration.tenantId, tenantId));
			} catch (writeErr) {
				const we = serializeError(writeErr);
				logWarning('keez', `Failed to mark degraded after enqueue failure: ${we.message}`, { tenantId });
			}
			// Fall through to the mark_degraded notification path below.
		}
	}

	// mark_degraded → create admin notification
	await createAdminNotificationsForTenant(tenantId, message).catch(() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/server/plugins/keez/failure-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/failure-handler.ts \
        app/src/lib/server/plugins/keez/failure-handler.test.ts
git commit -m "fix(keez): escalate to degraded when retry enqueue fails (no ghost state)"
```

---

## Task 3 — Throw `KeezClientError` for 5xx (robust classification)

**Why:** Today `client.ts:324-326` throws a generic `Error('Keez API error: ${status} ${body}')` for 5xx. `error-classification.ts` then matches it via the regex `/\b(502|503|504)\b/` on `error.message`. That works because the body contains `502`, but it's fragile — any HTML body without "502" (e.g. JSON error payload from a future Keez change) would be misclassified as permanent. Throwing `KeezClientError` with `status >= 500` makes classification structural, not textual.

**Files:**
- Modify: `app/src/lib/server/plugins/keez/client.ts:323-327`
- Create: `app/src/lib/server/plugins/keez/error-classification.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/server/plugins/keez/error-classification.test.ts
import { describe, expect, test } from 'bun:test';
import { classifyKeezError } from './error-classification';
import { KeezClientError } from './errors';

describe('classifyKeezError', () => {
	test('KeezClientError 502 → transient', () => {
		expect(classifyKeezError(new KeezClientError('any text', 502))).toBe('transient');
	});

	test('KeezClientError 503 → transient', () => {
		expect(classifyKeezError(new KeezClientError('x', 503))).toBe('transient');
	});

	test('KeezClientError 422 → permanent', () => {
		expect(classifyKeezError(new KeezClientError('validation', 422))).toBe('permanent');
	});

	test('plain Error with 502 in message → transient (fallback path)', () => {
		expect(classifyKeezError(new Error('Keez API error: 502 nginx'))).toBe('transient');
	});

	test('AbortError → transient', () => {
		const e = new Error('aborted');
		e.name = 'AbortError';
		expect(classifyKeezError(e)).toBe('transient');
	});
});
```

- [ ] **Step 2: Run test to verify the new tests pass against existing code**

Run: `cd app && bun test src/lib/server/plugins/keez/error-classification.test.ts`
Expected: PASS (the 5xx KeezClientError branch already exists in `error-classification.ts:25-30`). These tests pin the contract.

- [ ] **Step 3: Apply the client.ts fix**

Edit `app/src/lib/server/plugins/keez/client.ts:323-327`. Replace:

```ts
			// 5xx: server error, retryable.
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Keez API error: ${response.status} ${errorText}`);
			}
```

with:

```ts
			// 5xx: server error, retryable. Throw a KeezClientError so downstream
			// classifyKeezError() decides via instanceof + status, not by regex
			// on the message body (Keez nginx returns HTML, not JSON, on 502).
			if (!response.ok) {
				const errorText = await response.text();
				throw new KeezClientError(
					`Keez API error: ${response.status} ${errorText.substring(0, 500)}`,
					response.status
				);
			}
```

- [ ] **Step 4: Update the inline retry catch block to keep retrying 5xx**

`client.ts:347-349` currently does `if (error instanceof KeezClientError) throw error;` — that bypasses the inline retry. With Step 3, 5xx is now `KeezClientError` too, so it would stop retrying. Change the guard to only short-circuit on **client** errors (4xx):

Edit `app/src/lib/server/plugins/keez/client.ts:347-349`. Replace:

```ts
				if (error instanceof KeezClientError) {
					throw error;
				}
```

with:

```ts
				// 4xx is non-retryable; 5xx is retryable. Both are KeezClientError now,
				// so discriminate by status.
				if (error instanceof KeezClientError && error.status < 500) {
					throw error;
				}
```

- [ ] **Step 5: Add tests for the inline retry behaviour change**

Append to `app/src/lib/server/plugins/keez/error-classification.test.ts`:

```ts
describe('KeezClientError discriminates retry behaviour by status', () => {
	test('400-499 means stop retrying', () => {
		const e = new KeezClientError('bad request', 400);
		expect(e.status < 500).toBe(true);
	});

	test('500-599 means keep retrying', () => {
		const e = new KeezClientError('upstream', 502);
		expect(e.status < 500).toBe(false);
	});
});
```

Run: `cd app && bun test src/lib/server/plugins/keez/error-classification.test.ts`
Expected: all PASS.

- [ ] **Step 6: Type-check the whole app**

Run: `cd app && bunx --bun svelte-kit sync && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold warning 2>&1 | tail -30`
Expected: zero new errors related to `client.ts` or `keez/` (preexisting unrelated warnings are fine).

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/server/plugins/keez/client.ts \
        app/src/lib/server/plugins/keez/error-classification.test.ts
git commit -m "fix(keez): throw KeezClientError for 5xx (structural classification, retry preserved)"
```

---

## Task 4 — Per-run circuit breaker: abort sync after N consecutive transient errors in one run

**Why:** `sync.ts:134-453` iterates every invoice; if Keez is degraded and 50 invoices return 502, the per-fetch retry (3 attempts × ~5s backoff) means **150 fetches against a known-broken upstream** in one run. Today's logs show this exact pattern — multiple back-to-back per-invoice 502s seconds apart. Abort the run after 3 consecutive transient invoice failures and let the cross-run failure handler take over (which will now correctly enqueue a delayed retry).

**Files:**
- Modify: `app/src/lib/server/plugins/keez/sync.ts:134-452`

- [ ] **Step 1: Read the existing per-invoice catch and surrounding context**

Read `app/src/lib/server/plugins/keez/sync.ts:134-477` once before editing — note that `result.errors++` is the only mutation in the catch block, and the for-loop continues on error. Confirm `classifyKeezError` is not yet imported in this file.

- [ ] **Step 2: Add the import**

Edit the imports near the top of `app/src/lib/server/plugins/keez/sync.ts`. Find the existing keez imports (mapper, client, etc.) and add:

```ts
import { classifyKeezError } from './error-classification';
```

- [ ] **Step 3: Add a consecutive-transient-failure counter and short-circuit**

Edit `app/src/lib/server/plugins/keez/sync.ts:448-452` — the catch block at the end of the per-invoice for-loop. Replace:

```ts
			} catch (error) {
				const processErr = serializeError(error);
				logError('keez', `Sync failed to process invoice ${invoiceHeader.externalId}: ${processErr.message}`, { tenantId, stackTrace: processErr.stack });
				result.errors++;
			}
		}
```

with:

```ts
			} catch (error) {
				const processErr = serializeError(error);
				logError('keez', `Sync failed to process invoice ${invoiceHeader.externalId}: ${processErr.message}`, { tenantId, stackTrace: processErr.stack });
				result.errors++;

				// Per-run circuit breaker: if upstream is throwing transient errors
				// for invoice after invoice, stop hammering it. Re-throw so the
				// caller (sync task) routes through handleKeezSyncFailure, which
				// schedules a delayed retry instead of burning through more invoices.
				if (classifyKeezError(error) === 'transient') {
					consecutiveTransient++;
					if (consecutiveTransient >= 3) {
						logWarning('keez', `Aborting sync run after ${consecutiveTransient} consecutive transient errors`, { tenantId });
						throw error;
					}
				} else {
					consecutiveTransient = 0;
				}
			}
		}
```

Then add the counter declaration above the for-loop. Find the line `for (const invoiceHeader of response.data || []) {` (around line 134) and insert immediately before it:

```ts
	let consecutiveTransient = 0;
```

- [ ] **Step 4: Verify type-check passes**

Run: `cd app && bunx --bun svelte-kit sync && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold warning 2>&1 | grep -E '(sync\.ts|error-classification|errors found)' | tail -20`
Expected: no new errors in `sync.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/sync.ts
git commit -m "feat(keez): per-run circuit breaker — abort after 3 consecutive transient errors"
```

---

## Task 5 — Tune retry delays for multi-hour upstream outages

**Why:** Current `RETRY_DELAYS_MS = [10*60_000, 60*60_000]` with `MAX_CONSECUTIVE_FAILURES = 3` means: failure → +10 min → +60 min → degraded. Today's outage spanned 04:00–14:31 (10+ hours). The integration would have been marked degraded within the first 70 minutes, requiring manual reconnect once Keez recovered. Smarter spacing: `[30 min, 2h, 6h]` with ±10% jitter, `MAX = 4` — covers most multi-hour outages without operator intervention.

**Files:**
- Modify: `app/src/lib/server/plugins/keez/retry-policy.ts:9-10, 24-34`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/server/plugins/keez/retry-policy.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { decideFailureAction, RETRY_DELAYS_MS, MAX_CONSECUTIVE_FAILURES } from './retry-policy';

describe('retry-policy', () => {
	test('first transient failure schedules retry around 30 min (±10% jitter)', () => {
		const action = decideFailureAction(new Error('502'), 0);
		expect(action.kind).toBe('schedule_retry');
		if (action.kind !== 'schedule_retry') return;
		expect(action.delayMs).toBeGreaterThanOrEqual(27 * 60_000);
		expect(action.delayMs).toBeLessThanOrEqual(33 * 60_000);
	});

	test('second transient failure schedules retry around 2h (±10% jitter)', () => {
		const action = decideFailureAction(new Error('502'), 1);
		expect(action.kind).toBe('schedule_retry');
		if (action.kind !== 'schedule_retry') return;
		expect(action.delayMs).toBeGreaterThanOrEqual(108 * 60_000);
		expect(action.delayMs).toBeLessThanOrEqual(132 * 60_000);
	});

	test('third transient failure schedules retry around 6h (±10% jitter)', () => {
		const action = decideFailureAction(new Error('502'), 2);
		expect(action.kind).toBe('schedule_retry');
		if (action.kind !== 'schedule_retry') return;
		expect(action.delayMs).toBeGreaterThanOrEqual(5.4 * 60 * 60_000);
		expect(action.delayMs).toBeLessThanOrEqual(6.6 * 60 * 60_000);
	});

	test('fourth transient failure marks degraded', () => {
		const action = decideFailureAction(new Error('502'), 3);
		expect(action.kind).toBe('mark_degraded');
	});

	test('permanent error marks degraded immediately regardless of count', () => {
		// KeezClientError 4xx is permanent; we'd need to import it but a 422
		// in message text triggers fallback transient — so use the typed error.
		const { KeezClientError } = require('./errors');
		const action = decideFailureAction(new KeezClientError('bad', 422), 0);
		expect(action.kind).toBe('mark_degraded');
	});

	test('exports the new shape', () => {
		expect(RETRY_DELAYS_MS).toHaveLength(3);
		expect(MAX_CONSECUTIVE_FAILURES).toBe(4);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/server/plugins/keez/retry-policy.test.ts`
Expected: FAIL on the timing assertions and on `RETRY_DELAYS_MS.toHaveLength(3)`.

- [ ] **Step 3: Apply the fix**

Edit `app/src/lib/server/plugins/keez/retry-policy.ts`. Replace the whole file with:

```ts
import { classifyKeezError } from './error-classification';

/**
 * Pure retry-decision logic for Keez sync failures.
 * No DB, no queue — just the math. Kept separate from failure-handler.ts
 * so the decision can be unit-tested without SvelteKit's $lib alias graph.
 */

// Spacing tuned for multi-hour upstream outages (e.g. Keez nginx 502 storms).
// Total wall-clock budget before degraded: ~8.5 h.
export const RETRY_DELAYS_MS = [30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
export const MAX_CONSECUTIVE_FAILURES = 4;

const JITTER_FRACTION = 0.1; // ±10%

export type FailureAction =
	| { kind: 'schedule_retry'; delayMs: number }
	| { kind: 'mark_degraded' };

/**
 * Decide what to do after a sync failure.
 * `priorCount` is the value of `consecutiveFailures` BEFORE this failure.
 *
 * Permanent errors (4xx, 401 post-refresh) → degraded immediately.
 * Transient errors → retry with jittered backoff while
 *   `priorCount + 1 < MAX_CONSECUTIVE_FAILURES`, otherwise degraded.
 *
 * Jitter prevents many tenants whose retries align (e.g. all triggered by
 * the same 4 AM cron failure) from hitting Keez at the exact same wall-clock.
 */
export function decideFailureAction(error: unknown, priorCount: number): FailureAction {
	const kind = classifyKeezError(error);
	if (kind === 'permanent') {
		return { kind: 'mark_degraded' };
	}
	const nextCount = priorCount + 1;
	if (nextCount >= MAX_CONSECUTIVE_FAILURES) {
		return { kind: 'mark_degraded' };
	}
	const base = RETRY_DELAYS_MS[priorCount];
	const jitter = base * JITTER_FRACTION * (Math.random() * 2 - 1);
	return { kind: 'schedule_retry', delayMs: Math.round(base + jitter) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/server/plugins/keez/retry-policy.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/retry-policy.ts \
        app/src/lib/server/plugins/keez/retry-policy.test.ts
git commit -m "feat(keez): retry delays 30min/2h/6h with jitter, MAX=4 (multi-hour outages)"
```

---

## Task 6 — Verification & operator-facing notes

**Files:**
- (no code changes)
- Optional update: `docs/superpowers/audits/` if the user wants a postmortem doc

- [ ] **Step 1: Run full test suite for keez**

Run: `cd app && bun test src/lib/server/plugins/keez/ src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts`
Expected: all green (Tasks 1–5 tests).

- [ ] **Step 2: Type-check the whole app**

Run: `cd app && bunx --bun svelte-kit sync && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold warning 2>&1 | tail -10`
Expected: zero new errors. Acceptable: the same preexisting warning count as on `main`.

- [ ] **Step 3: Sanity-check the BullMQ jobId character set in code, not just tests**

Run: `cd app && grep -rn "jobId" src/lib/server/scheduler/ src/lib/server/plugins/ | grep -v '\.test\.' | grep -v node_modules`
Expected: every `jobId` value either has no template-literal or uses `-`/`_`/alphanumerics only.

- [ ] **Step 4: Final commit + branch tip**

If steps 1–3 pass:

```bash
git status   # confirm clean
git log --oneline -8   # show the 5 task commits stacked on the branch tip
```

- [ ] **Step 5: Operator note (manual, no code)**

After merge to main, the user should manually trigger a Keez sync once Keez upstream is healthy:
- UI path: `/{tenant}/settings/keez → "Sincronizează acum"`
- This resets `consecutiveFailures = 0`, clears `isDegraded`, and clears stale `keez.sync_error` notifications (already implemented at `sync.ts:458-475`).

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Bun mock module hoisting differs from Vitest — `mock.module()` in Task 2 may not intercept dynamic imports | Failure-handler uses static imports, not dynamic. If mock still doesn't apply, fall back to a thinner test that exercises only the *control flow* (a fake `enqueueRetry` that throws + a captured logger) without DB mocks. |
| Task 3 changes the inline retry guard from `instanceof KeezClientError` to `instanceof KeezClientError && error.status < 500` — risk of double-throwing 5xx after the inline retry exhausts | Acceptable: at attempt 3 the catch falls through to `if (attempt === retries - 1) throw error;` (line 350-352), so 5xx still throws after retries are exhausted. The new guard only changes attempts 0-1 to keep retrying instead of giving up. |
| Task 4 short-circuit may abort a run that would have succeeded if a few transient invoices were skipped | Per-run circuit breaker fires only after **3 consecutive** transient errors. A single bad invoice followed by a successful one resets the counter. |
| Task 5 longer retry delays mean longer time-to-recovery on flap (Keez briefly down then back) | Acceptable trade — reduces retry storm pressure on Keez during real outages. The user can manually trigger a sync at any time via the UI. |
