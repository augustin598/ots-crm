# Keez Sync Consolidation + Transient-Failure Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `syncInvoicesFromKeez` manual remote command reuse `syncKeezInvoicesForTenant` and add per-tenant transient-failure retry with a `degraded` state.

**Architecture:** One canonical sync function. Scheduler daily task and manual remote both go through it. Failure handling (classification + retry-or-degraded decision) is a shared helper called from both the daily cron task and a new single-tenant retry task. Retry uses BullMQ delayed jobs with `jobId: keez-invoice-sync-retry:{tenantId}` for per-tenant dedup.

**Tech Stack:** SvelteKit 5, Bun, TypeScript, Drizzle ORM on Turso (libSQL/SQLite dialect), BullMQ + Redis, existing `src/lib/server/logger.ts` structured logger.

**Spec:** [2026-04-21-keez-sync-consolidation-and-retry-design.md](../specs/2026-04-21-keez-sync-consolidation-and-retry-design.md)

---

## File Structure

New files:
- `app/drizzle/0134_keez_integration_last_failure_at.sql`
- `app/drizzle/0135_keez_integration_last_failure_reason.sql`
- `app/drizzle/0136_keez_integration_consecutive_failures.sql`
- `app/drizzle/0137_keez_integration_is_degraded.sql`
- `app/src/lib/server/plugins/keez/error-classification.ts`
- `app/src/lib/server/plugins/keez/failure-handler.ts`
- `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts`
- `app/scripts/test-keez-error-classification.ts`
- `app/scripts/test-keez-failure-handler.ts`

Modified files:
- `app/src/lib/server/db/schema.ts` — +4 columns on `keezIntegration`
- `app/drizzle/meta/_journal.json` — 4 new entries
- `app/src/lib/server/plugins/keez/sync.ts` — reset failure columns on success
- `app/src/lib/server/scheduler/tasks/keez-invoice-sync.ts` — call `handleKeezSyncFailure`
- `app/src/lib/server/scheduler/index.ts` — register `keez_invoice_sync_retry` handler
- `app/src/lib/remotes/keez.remote.ts` — gut `syncInvoicesFromKeez` → thin wrapper; update `getKeezStatus` to return `isDegraded` + `lastFailureReason`
- `app/src/routes/[tenant]/settings/keez/+page.svelte` — degraded badge

---

## Task 1: Schema — add 4 failure-tracking columns

**Files:**
- Create: `app/drizzle/0134_keez_integration_last_failure_at.sql`
- Create: `app/drizzle/0135_keez_integration_last_failure_reason.sql`
- Create: `app/drizzle/0136_keez_integration_consecutive_failures.sql`
- Create: `app/drizzle/0137_keez_integration_is_degraded.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/server/db/schema.ts:730-749`

Follow Turso single-statement rule (memory: `feedback_turso_single_statement.md`). One ALTER per file.

- [ ] **Step 1: Create migration 0134**

File: `app/drizzle/0134_keez_integration_last_failure_at.sql`

```sql
ALTER TABLE keez_integration ADD COLUMN last_failure_at timestamp;
```

- [ ] **Step 2: Create migration 0135**

File: `app/drizzle/0135_keez_integration_last_failure_reason.sql`

```sql
ALTER TABLE keez_integration ADD COLUMN last_failure_reason text;
```

- [ ] **Step 3: Create migration 0136**

File: `app/drizzle/0136_keez_integration_consecutive_failures.sql`

```sql
ALTER TABLE keez_integration ADD COLUMN consecutive_failures integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 4: Create migration 0137**

File: `app/drizzle/0137_keez_integration_is_degraded.sql`

```sql
ALTER TABLE keez_integration ADD COLUMN is_degraded integer DEFAULT 0 NOT NULL;
```

(SQLite has no `boolean`; Drizzle `boolean()` stores as `integer` 0/1.)

- [ ] **Step 5: Append 4 entries to `_journal.json`**

Open `app/drizzle/meta/_journal.json`, locate the last entry (currently `idx: 133`), and append:

```json
    {
      "idx": 134,
      "version": "6",
      "when": 1777363200000,
      "tag": "0134_keez_integration_last_failure_at",
      "breakpoints": true
    },
    {
      "idx": 135,
      "version": "6",
      "when": 1777363201000,
      "tag": "0135_keez_integration_last_failure_reason",
      "breakpoints": true
    },
    {
      "idx": 136,
      "version": "6",
      "when": 1777363202000,
      "tag": "0136_keez_integration_consecutive_failures",
      "breakpoints": true
    },
    {
      "idx": 137,
      "version": "6",
      "when": 1777363203000,
      "tag": "0137_keez_integration_is_degraded",
      "breakpoints": true
    }
```

Insert inside the `entries` array, after idx 133, before the closing `]`.

- [ ] **Step 6: Update `schema.ts` keezIntegration**

In `app/src/lib/server/db/schema.ts`, find the `keezIntegration` definition (line 730) and add 4 columns before the closing `});`:

Replace:

```ts
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
```

With:

```ts
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),
	lastFailureAt: timestamp('last_failure_at', { withTimezone: true, mode: 'date' }),
	lastFailureReason: text('last_failure_reason'),
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	isDegraded: boolean('is_degraded').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
```

- [ ] **Step 7: Run migrations and verify**

```bash
cd app && bun run db:migrate
```

Then verify on Turso (per memory `feedback_migration_flow.md`):

```bash
bunx drizzle-kit studio &  # or use SQL console
# Then run: PRAGMA table_info(keez_integration);
```

Expected: 4 new columns present: `last_failure_at`, `last_failure_reason`, `consecutive_failures`, `is_degraded`.

- [ ] **Step 8: Commit**

```bash
git add app/drizzle/0134_keez_integration_last_failure_at.sql \
        app/drizzle/0135_keez_integration_last_failure_reason.sql \
        app/drizzle/0136_keez_integration_consecutive_failures.sql \
        app/drizzle/0137_keez_integration_is_degraded.sql \
        app/drizzle/meta/_journal.json \
        app/src/lib/server/db/schema.ts
git commit -m "feat(keez): add failure-tracking columns to keez_integration

Adds last_failure_at, last_failure_reason, consecutive_failures, and
is_degraded columns to support transient-failure retry and degraded
state tracking per the keez-sync-consolidation-and-retry design."
```

---

## Task 2: Error classification helper

**Files:**
- Create: `app/src/lib/server/plugins/keez/error-classification.ts`
- Create: `app/scripts/test-keez-error-classification.ts`

- [ ] **Step 1: Write the failing test script**

File: `app/scripts/test-keez-error-classification.ts`

```ts
/**
 * Test: classifyKeezError returns correct FailureKind.
 * Run with: bun run scripts/test-keez-error-classification.ts
 */
import { classifyKeezError } from '../src/lib/server/plugins/keez/error-classification';
import { KeezClientError } from '../src/lib/server/plugins/keez/client';
import { KeezCredentialsCorruptError } from '../src/lib/server/plugins/keez/factory';

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(name: string, actual: string, expected: string) {
	if (actual === expected) {
		passed++;
		results.push(`  ✅ ${name}`);
	} else {
		failed++;
		results.push(`  ❌ ${name} — got "${actual}", expected "${expected}"`);
	}
}

// Transient: 5xx HTTP messages
assert('502 string in message', classifyKeezError(new Error('Keez API error: 502 <html>...')), 'transient');
assert('503 string in message', classifyKeezError(new Error('Keez API error: 503 Service Unavailable')), 'transient');
assert('504 string in message', classifyKeezError(new Error('504 Gateway Timeout')), 'transient');

// Transient: network errors
assert('timeout message', classifyKeezError(new Error('Request timed out')), 'transient');
assert('AbortError timeout', classifyKeezError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), 'transient');
assert('ECONNRESET', classifyKeezError(new Error('fetch failed: ECONNRESET')), 'transient');
assert('ENOTFOUND DNS', classifyKeezError(new Error('getaddrinfo ENOTFOUND app.keez.ro')), 'transient');
assert('generic fetch failed', classifyKeezError(new Error('fetch failed')), 'transient');

// Transient: KeezCredentialsCorruptError (can clear on re-read)
assert('KeezCredentialsCorruptError', classifyKeezError(new KeezCredentialsCorruptError('t1')), 'transient');

// Transient: KeezClientError 500 (5xx handled in client retries, but classify as transient)
assert('KeezClientError 500', classifyKeezError(new KeezClientError('boom', 500)), 'transient');

// Permanent: 4xx client errors (not 401 — 401 is handled by client, if escapes → permanent)
assert('KeezClientError 400', classifyKeezError(new KeezClientError('bad request', 400)), 'permanent');
assert('KeezClientError 401', classifyKeezError(new KeezClientError('unauthorized', 401)), 'permanent');
assert('KeezClientError 403', classifyKeezError(new KeezClientError('forbidden', 403)), 'permanent');
assert('KeezClientError 404', classifyKeezError(new KeezClientError('not found', 404)), 'permanent');
assert('KeezClientError 409', classifyKeezError(new KeezClientError('conflict', 409)), 'permanent');
assert('KeezClientError 422', classifyKeezError(new KeezClientError('unprocessable', 422)), 'permanent');

// Default: optimistic — unknown errors are transient
assert('unknown Error', classifyKeezError(new Error('something weird happened')), 'transient');
assert('non-Error value', classifyKeezError('a string'), 'transient');
assert('null', classifyKeezError(null), 'transient');

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test, verify it fails (module missing)**

```bash
cd app && bun run scripts/test-keez-error-classification.ts
```

Expected: Fails with "Cannot find module './src/lib/server/plugins/keez/error-classification'".

- [ ] **Step 3: Implement `error-classification.ts`**

File: `app/src/lib/server/plugins/keez/error-classification.ts`

```ts
import { KeezClientError } from './client';
import { KeezCredentialsCorruptError } from './factory';

export type FailureKind = 'transient' | 'permanent';

const TRANSIENT_STATUS_PATTERN = /\b(502|503|504)\b/;
const TRANSIENT_NETWORK_PATTERN = /timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed|AbortError|aborted/i;

export function classifyKeezError(error: unknown): FailureKind {
	if (error instanceof KeezCredentialsCorruptError) {
		return 'transient';
	}

	if (error instanceof KeezClientError) {
		if (error.status >= 400 && error.status < 500) {
			return 'permanent';
		}
		return 'transient';
	}

	if (error instanceof Error) {
		if (error.name === 'AbortError') return 'transient';
		const msg = error.message || '';
		if (TRANSIENT_STATUS_PATTERN.test(msg)) return 'transient';
		if (TRANSIENT_NETWORK_PATTERN.test(msg)) return 'transient';
	}

	return 'transient';
}
```

- [ ] **Step 4: Run test, verify all pass**

```bash
cd app && bun run scripts/test-keez-error-classification.ts
```

Expected: `Result: N passed, 0 failed` (~20 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/error-classification.ts \
        app/scripts/test-keez-error-classification.ts
git commit -m "feat(keez): add error classification helper

Classifies Keez errors as transient (retry) or permanent (skip).
Used by failure handler to decide between retry scheduling and
immediate degraded-state marking."
```

---

## Task 3: Failure handler helper

**Files:**
- Create: `app/src/lib/server/plugins/keez/failure-handler.ts`
- Create: `app/scripts/test-keez-failure-handler.ts`

This helper is called from both daily cron and retry tasks. It atomically updates failure columns, decides next action (retry vs degraded), and either enqueues a retry job or creates an admin notification.

- [ ] **Step 1: Write test script**

File: `app/scripts/test-keez-failure-handler.ts`

```ts
/**
 * Test: handleKeezSyncFailure behavior for transient vs permanent errors.
 * Uses a fake tenant row in a scratch context.
 * Run with: bun run scripts/test-keez-failure-handler.ts
 *
 * Note: This is a light integration test that exercises the DECISION logic
 * via mock seams. Full DB/BullMQ integration is exercised manually during rollout.
 */
import { decideFailureAction } from '../src/lib/server/plugins/keez/failure-handler';
import { KeezClientError } from '../src/lib/server/plugins/keez/client';

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(name: string, cond: boolean, detail = '') {
	if (cond) { passed++; results.push(`  ✅ ${name}`); }
	else { failed++; results.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// Transient, first failure → retry at +10min
let action = decideFailureAction(new Error('502 Bad Gateway'), 0);
assert('1st transient failure → schedule retry', action.kind === 'schedule_retry' && action.delayMs === 10 * 60_000);

// Transient, second failure (counter was 1) → retry at +1h
action = decideFailureAction(new Error('503'), 1);
assert('2nd transient failure → retry at +1h', action.kind === 'schedule_retry' && action.delayMs === 60 * 60_000);

// Transient, third failure (counter was 2) → degraded
action = decideFailureAction(new Error('504 Gateway Timeout'), 2);
assert('3rd transient failure → mark degraded', action.kind === 'mark_degraded');

// Permanent on first failure → degraded immediately
action = decideFailureAction(new KeezClientError('forbidden', 403), 0);
assert('Permanent 403 first failure → degraded', action.kind === 'mark_degraded');

// Permanent on later failure → still degraded (no retry)
action = decideFailureAction(new KeezClientError('bad request', 400), 1);
assert('Permanent 400 on 2nd failure → degraded', action.kind === 'mark_degraded');

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test, verify it fails (module missing)**

```bash
cd app && bun run scripts/test-keez-failure-handler.ts
```

Expected: Fails with "Cannot find module".

- [ ] **Step 3: Implement `failure-handler.ts`**

File: `app/src/lib/server/plugins/keez/failure-handler.ts`

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { classifyKeezError } from './error-classification';
import { serializeError, logInfo, logWarning, logError } from '$lib/server/logger';
import { createNotification } from '$lib/server/notifications';

const RETRY_DELAYS_MS = [10 * 60_000, 60 * 60_000]; // +10min, +1h
const MAX_CONSECUTIVE_FAILURES = 3;

export type FailureAction =
	| { kind: 'schedule_retry'; delayMs: number }
	| { kind: 'mark_degraded' };

/**
 * Pure decision function — no DB / queue side effects. Exposed for testability.
 * `priorCount` is the value of consecutiveFailures BEFORE this failure.
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
	// priorCount 0 → RETRY_DELAYS_MS[0], priorCount 1 → RETRY_DELAYS_MS[1]
	return { kind: 'schedule_retry', delayMs: RETRY_DELAYS_MS[priorCount] };
}

/**
 * Handle a Keez sync failure for a single tenant:
 * - classify error
 * - atomically update failure columns
 * - enqueue retry job OR create admin notification
 *
 * Called from daily cron task and retry task. Never throws.
 */
export async function handleKeezSyncFailure(
	tenantId: string,
	error: unknown,
	options: { enqueueRetry: (tenantId: string, delayMs: number) => Promise<void> }
): Promise<void> {
	const { message, stack } = serializeError(error);
	logError('keez', `Sync failure: ${message}`, { tenantId, stackTrace: stack });

	let priorCount = 0;
	try {
		const [row] = await db
			.select({ consecutiveFailures: table.keezIntegration.consecutiveFailures })
			.from(table.keezIntegration)
			.where(eq(table.keezIntegration.tenantId, tenantId))
			.limit(1);
		priorCount = row?.consecutiveFailures ?? 0;
	} catch (readErr) {
		const e = serializeError(readErr);
		logWarning('keez', `Failed to read consecutiveFailures, assuming 0: ${e.message}`, { tenantId });
	}

	const action = decideFailureAction(error, priorCount);
	const newCount = priorCount + 1;

	try {
		await db
			.update(table.keezIntegration)
			.set({
				consecutiveFailures: newCount,
				lastFailureAt: new Date(),
				lastFailureReason: message.substring(0, 500),
				isDegraded: action.kind === 'mark_degraded',
				updatedAt: new Date()
			})
			.where(eq(table.keezIntegration.tenantId, tenantId));
	} catch (writeErr) {
		const e = serializeError(writeErr);
		logWarning('keez', `Failed to persist failure state: ${e.message}`, { tenantId });
		// Don't abort — still try to enqueue retry / notify below.
	}

	if (action.kind === 'schedule_retry') {
		try {
			await options.enqueueRetry(tenantId, action.delayMs);
			logInfo('keez', `Scheduled retry in ${action.delayMs / 60_000} minutes (attempt ${newCount}/${MAX_CONSECUTIVE_FAILURES - 1})`, { tenantId });
		} catch (queueErr) {
			const e = serializeError(queueErr);
			logError('keez', `Failed to enqueue retry: ${e.message}`, { tenantId });
		}
		return;
	}

	// mark_degraded → create admin notification
	await createAdminNotificationsForTenant(tenantId, message).catch(() => {});
}

async function createAdminNotificationsForTenant(tenantId: string, reason: string): Promise<void> {
	const admins = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(
			eq(table.tenantUser.tenantId, tenantId),
			or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
		));

	const [tenantRow] = await db
		.select({ slug: table.tenant.slug })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	for (const admin of admins) {
		await createNotification({
			tenantId,
			userId: admin.userId,
			type: 'keez.sync_error',
			title: 'Eroare sincronizare Keez',
			message: `Sincronizarea facturilor Keez a eșuat: ${reason.substring(0, 100)}`,
			link: tenantRow ? `/${tenantRow.slug}/settings/keez` : undefined,
			priority: 'high'
		}).catch(() => {});
	}
}
```

- [ ] **Step 4: Run test, verify all pass**

```bash
cd app && bun run scripts/test-keez-failure-handler.ts
```

Expected: `Result: 5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/failure-handler.ts \
        app/scripts/test-keez-failure-handler.ts
git commit -m "feat(keez): add shared sync-failure handler

Centralizes failure handling for the daily cron and the new retry task:
classifies the error, persists consecutive-failure count, and either
enqueues a retry job or creates an admin notification and marks the
integration as degraded."
```

---

## Task 4: Success path resets failure columns

**Files:**
- Modify: `app/src/lib/server/plugins/keez/sync.ts:455-468`

- [ ] **Step 1: Update the success branch**

In `app/src/lib/server/plugins/keez/sync.ts`, find the block that currently reads:

```ts
	// Update integration last sync time only if at least one invoice was processed successfully
	if (result.imported > 0 || result.updated > 0 || result.skipped > 0) {
		await db
			.update(table.keezIntegration)
			.set({ lastSyncAt: new Date(), updatedAt: new Date() })
			.where(eq(table.keezIntegration.tenantId, tenantId));
	}

	// Clear stale Keez sync error notifications after successful sync
	try {
		await clearNotificationsByType(tenantId, 'keez.sync_error');
	} catch {
		// Don't break sync for notification cleanup errors
	}
```

Replace with:

```ts
	// Update integration last sync time AND reset failure columns (idempotent, always runs on
	// successful completion, even for zero-invoice responses). Clearing failure columns here
	// ensures a healthy sync clears a prior degraded state.
	await db
		.update(table.keezIntegration)
		.set({
			lastSyncAt: new Date(),
			lastFailureAt: null,
			lastFailureReason: null,
			consecutiveFailures: 0,
			isDegraded: false,
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.tenantId, tenantId));

	// Clear stale Keez sync error notifications after successful sync
	try {
		await clearNotificationsByType(tenantId, 'keez.sync_error');
	} catch {
		// Don't break sync for notification cleanup errors
	}
```

Rationale: the old `if` guard prevented `lastSyncAt` from updating on empty responses. This meant users saw stale timestamps. Now the update always runs on successful completion (no exception thrown), which also resets the failure state.

- [ ] **Step 2: Verify sync.ts still compiles**

```bash
cd app && bunx svelte-check --threshold warning src/lib/server/plugins/keez/sync.ts 2>&1 | tail -20
```

Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/plugins/keez/sync.ts
git commit -m "fix(keez): reset failure state on successful sync

Previously lastSyncAt only updated if the sync returned at least one
invoice. Now it always runs on successful completion and also clears
consecutiveFailures, isDegraded, lastFailureAt, and lastFailureReason.
This is what lets a manual sync recover from a degraded state."
```

---

## Task 5: Daily cron task uses `handleKeezSyncFailure`

**Files:**
- Modify: `app/src/lib/server/scheduler/tasks/keez-invoice-sync.ts`

Replace the hand-rolled failure branch (lines ~54–127) with a call to the shared helper. Keeps the top-level try/catch and the `KeezCredentialsCorruptError` retry behavior but removes the inline notification creation.

- [ ] **Step 1: Rewrite the task handler**

Overwrite `app/src/lib/server/scheduler/tasks/keez-invoice-sync.ts` with:

```ts
import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { KeezCredentialsCorruptError } from '../../plugins/keez/factory';
import { handleKeezSyncFailure } from '../../plugins/keez/failure-handler';
import { enqueueKeezRetry } from './keez-invoice-sync-retry';
import { logInfo, logWarning } from '$lib/server/logger';

/**
 * Daily Keez invoice sync. Finds every tenant with an active integration
 * and calls the shared sync for each. On per-tenant failure, delegates to
 * handleKeezSyncFailure which decides retry vs degraded.
 */
export async function processKeezInvoiceSync(_params: Record<string, any> = {}) {
	const integrations = await db
		.select({ tenantId: table.keezIntegration.tenantId })
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.isActive, true));

	if (integrations.length === 0) {
		logInfo('scheduler', 'Keez invoice sync: no active integrations, skipping', { metadata: { activeIntegrations: 0 } });
		return { success: true, tenantsProcessed: 0, totalImported: 0, totalUpdated: 0, totalSkipped: 0, totalErrors: 0 };
	}

	let tenantsProcessed = 0;
	let totalImported = 0;
	let totalUpdated = 0;
	let totalSkipped = 0;
	let totalErrors = 0;

	for (const integration of integrations) {
		try {
			logInfo('scheduler', `Keez invoice sync: starting`, { tenantId: integration.tenantId });
			const result = await syncKeezInvoicesForTenant(integration.tenantId);
			tenantsProcessed++;
			totalImported += result.imported;
			totalUpdated += result.updated;
			totalSkipped += result.skipped;
			totalErrors += result.errors;
			logInfo('scheduler', `Keez invoice sync: tenant completed`, {
				tenantId: integration.tenantId,
				metadata: { imported: result.imported, updated: result.updated, skipped: result.skipped, errors: result.errors }
			});
		} catch (error) {
			// Special case: transient decrypt failure — retry once with fresh DB read.
			if (error instanceof KeezCredentialsCorruptError) {
				logWarning('scheduler', `Keez sync: decrypt failed, retrying once with fresh DB read`, {
					tenantId: integration.tenantId, metadata: { action: 'decrypt_retry' }
				});
				await new Promise(r => setTimeout(r, 2000));
				try {
					const retryResult = await syncKeezInvoicesForTenant(integration.tenantId);
					tenantsProcessed++;
					totalImported += retryResult.imported;
					totalUpdated += retryResult.updated;
					totalSkipped += retryResult.skipped;
					totalErrors += retryResult.errors;
					continue;
				} catch (retryError) {
					await handleKeezSyncFailure(integration.tenantId, retryError, { enqueueRetry: enqueueKeezRetry });
					continue;
				}
			}

			await handleKeezSyncFailure(integration.tenantId, error, { enqueueRetry: enqueueKeezRetry });
		}
	}

	logInfo('scheduler', `Keez invoice sync completed`, {
		metadata: { tenantsProcessed, totalImported, totalUpdated, totalSkipped, totalErrors }
	});

	return { success: true, tenantsProcessed, totalImported, totalUpdated, totalSkipped, totalErrors };
}
```

- [ ] **Step 2: Compile-check**

```bash
cd app && bunx svelte-check --threshold warning src/lib/server/scheduler/tasks/keez-invoice-sync.ts 2>&1 | tail -10
```

Expected: "Cannot find module './keez-invoice-sync-retry'" — fine, next task creates it.

- [ ] **Step 3: Commit after Task 6 is done**

Don't commit yet — next task introduces `keez-invoice-sync-retry.ts` and Task 5's file imports from it.

---

## Task 6: Retry task

**Files:**
- Create: `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts`

This is the handler BullMQ runs when a delayed retry job fires. It syncs a single tenant and, on failure, goes through `handleKeezSyncFailure` just like the daily task.

- [ ] **Step 1: Implement retry task + enqueue helper**

File: `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts`

```ts
import { Queue } from 'bullmq';
import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { handleKeezSyncFailure } from '../../plugins/keez/failure-handler';
import { logInfo } from '$lib/server/logger';

/**
 * BullMQ jobId format for per-tenant retry dedup.
 * Only one retry job can be queued per tenant at a time.
 */
export function retryJobId(tenantId: string): string {
	return `keez-invoice-sync-retry:${tenantId}`;
}

/**
 * Enqueue a delayed retry job for a single tenant.
 * Called from handleKeezSyncFailure with the chosen delay.
 */
export async function enqueueKeezRetry(tenantId: string, delayMs: number): Promise<void> {
	// Lazy import to avoid circular scheduler <-> task imports
	const { schedulerQueue } = await import('../index');
	await schedulerQueue.add(
		'keez-invoice-sync-retry',
		{ type: 'keez_invoice_sync_retry', params: { tenantId } },
		{ delay: delayMs, jobId: retryJobId(tenantId), attempts: 1 }
	);
}

/**
 * Cancel a pending retry job for a tenant (no-op if none queued).
 * Called from the manual remote command to avoid duplicate work.
 */
export async function cancelPendingKeezRetry(tenantId: string): Promise<void> {
	try {
		const { schedulerQueue } = await import('../index');
		await schedulerQueue.remove(retryJobId(tenantId));
	} catch {
		// No-op: stale removals are fine.
	}
}

/**
 * BullMQ handler for the delayed retry job.
 * Runs one tenant's sync. On failure, handleKeezSyncFailure re-classifies
 * and may enqueue another retry or mark the integration degraded.
 */
export async function processKeezInvoiceSyncRetry(params: Record<string, any> = {}) {
	const tenantId = String(params.tenantId || '');
	if (!tenantId) {
		return { success: false, error: 'missing tenantId' };
	}

	// Only run if integration is still active
	const [integration] = await db
		.select({ isActive: table.keezIntegration.isActive })
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		logInfo('scheduler', `Keez retry: integration no longer active, skipping`, { tenantId });
		return { success: true, skipped: true };
	}

	try {
		logInfo('scheduler', `Keez retry: starting`, { tenantId });
		const result = await syncKeezInvoicesForTenant(tenantId);
		logInfo('scheduler', `Keez retry: succeeded`, {
			tenantId,
			metadata: { imported: result.imported, updated: result.updated }
		});
		return { success: true, ...result };
	} catch (error) {
		await handleKeezSyncFailure(tenantId, error, { enqueueRetry: enqueueKeezRetry });
		return { success: false };
	}
}
```

- [ ] **Step 2: Compile-check**

```bash
cd app && bunx svelte-check --threshold warning src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts 2>&1 | tail -10
```

Expected: no errors specific to this file.

---

## Task 7: Register retry handler in scheduler index

**Files:**
- Modify: `app/src/lib/server/scheduler/index.ts:8-18, 90-114`

- [ ] **Step 1: Add import**

In `app/src/lib/server/scheduler/index.ts`, find line 8:

```ts
import { processKeezInvoiceSync } from './tasks/keez-invoice-sync';
```

Add directly after:

```ts
import { processKeezInvoiceSyncRetry } from './tasks/keez-invoice-sync-retry';
```

- [ ] **Step 2: Register in taskHandlers**

Find line 96:

```ts
	keez_invoice_sync: processKeezInvoiceSync,
```

Add directly after:

```ts
	keez_invoice_sync_retry: processKeezInvoiceSyncRetry,
```

- [ ] **Step 3: Export `schedulerQueue` if not already exported**

Find the declaration (around line 78):

```ts
const schedulerQueue =
```

Change to:

```ts
export const schedulerQueue =
```

This is required so `enqueueKeezRetry` / `cancelPendingKeezRetry` can import it via the lazy dynamic import.

Search for any other references to `schedulerQueue` elsewhere in the repo that may already import — if any file does `import { schedulerQueue }`, the export is already present, skip this step.

```bash
cd app && grep -rn "import.*schedulerQueue" src/ | head -5
```

- [ ] **Step 4: Compile-check entire scheduler module**

```bash
cd app && bunx svelte-check --threshold warning src/lib/server/scheduler/ 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 5: Commit Tasks 5 + 6 + 7 together**

```bash
git add app/src/lib/server/scheduler/tasks/keez-invoice-sync.ts \
        app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts \
        app/src/lib/server/scheduler/index.ts
git commit -m "feat(keez): transient-failure retry with degraded state

Daily cron now delegates per-tenant failure handling to
handleKeezSyncFailure. On transient Keez errors (5xx, network,
timeout), a delayed retry is queued at +10min, then +1h. After 3
consecutive transient failures, the integration is marked as
degraded and the admin is notified. Permanent failures (4xx, 401
after token refresh) mark degraded immediately without retrying."
```

---

## Task 8: Gut `syncInvoicesFromKeez` remote

**Files:**
- Modify: `app/src/lib/remotes/keez.remote.ts:779-1258`

Replace the ~480-line duplicate implementation with a thin wrapper that calls the shared sync.

- [ ] **Step 1: Add imports at top of `keez.remote.ts`**

Find the existing imports near the top (the file already imports `syncKeezInvoicesForTenant`? — check first):

```bash
cd app && grep -n "syncKeezInvoicesForTenant\|cancelPendingKeezRetry" src/lib/remotes/keez.remote.ts
```

If neither is imported, add both to the import block that pulls from `$lib/server/plugins/keez`:

```ts
import { syncKeezInvoicesForTenant } from '$lib/server/plugins/keez/sync';
import { cancelPendingKeezRetry } from '$lib/server/scheduler/tasks/keez-invoice-sync-retry';
```

- [ ] **Step 2: Replace the entire `syncInvoicesFromKeez` block**

Find the block starting at `export const syncInvoicesFromKeez = command(` (around line 779) and ending at the `});` that closes the `command(...)` call (around line 1258). Replace the whole block with:

```ts
export const syncInvoicesFromKeez = command(
	v.object({
		offset: v.optional(v.number()),
		count: v.optional(v.number()),
		filter: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		// Cancel any pending retry job so we don't do the work twice.
		await cancelPendingKeezRetry(event.locals.tenant.id);

		const result = await syncKeezInvoicesForTenant(event.locals.tenant.id, {
			offset: filters.offset,
			count: filters.count ?? 100, // manual default: 100 for UI responsiveness (scheduler uses 500)
			filter: filters.filter
		});

		return {
			success: true,
			imported: result.imported,
			updated: result.updated,
			skipped: result.skipped,
			errors: result.errors
		};
	}
);
```

- [ ] **Step 3: Verify `+page.svelte` still compiles**

The UI reads `result.imported`, `result.updated`, and `result.skipped` — all still present.

```bash
cd app && grep -n "syncInvoicesFromKeez" src/routes/[tenant]/invoices/+page.svelte
```

Review the callsite (around line 516) to confirm it uses only `imported` / `updated` / `skipped` / `errors` from the result.

- [ ] **Step 4: Full compile check**

```bash
cd app && bunx svelte-check --threshold warning 2>&1 | tail -30
```

Expected: no new type errors. Existing warnings unchanged.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/remotes/keez.remote.ts
git commit -m "refactor(keez): manual sync reuses shared syncKeezInvoicesForTenant

Removes ~480 lines of duplicate parsing/upsert logic from the manual
sync remote command. Manual button now goes through the same function
as the daily cron, gaining: in-memory sync lock, structured logger,
notification cleanup on success, and failure-state reset. Also cancels
any pending retry job before starting to avoid duplicate work."
```

---

## Task 9: Surface `isDegraded` in Settings → Keez UI

**Files:**
- Modify: `app/src/lib/remotes/keez.remote.ts:132-182` (getKeezStatus query)
- Modify: `app/src/routes/[tenant]/settings/keez/+page.svelte`

- [ ] **Step 1: Extend `getKeezStatus` query to return degraded state**

In `app/src/lib/remotes/keez.remote.ts`, find the `getKeezStatus` select block (~line 138). Add two fields to the select:

Replace:

```ts
	const [integration] = await db
		.select({
			clientEid: table.keezIntegration.clientEid,
			applicationId: table.keezIntegration.applicationId,
			isActive: table.keezIntegration.isActive,
			lastSyncAt: table.keezIntegration.lastSyncAt,
			secret: table.keezIntegration.secret
		})
```

With:

```ts
	const [integration] = await db
		.select({
			clientEid: table.keezIntegration.clientEid,
			applicationId: table.keezIntegration.applicationId,
			isActive: table.keezIntegration.isActive,
			lastSyncAt: table.keezIntegration.lastSyncAt,
			isDegraded: table.keezIntegration.isDegraded,
			lastFailureReason: table.keezIntegration.lastFailureReason,
			secret: table.keezIntegration.secret
		})
```

And update the return at the bottom of the same function (around line 174):

Replace:

```ts
	return {
		connected: true,
		isActive: integration.isActive,
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		lastSyncAt: integration.lastSyncAt,
		credentialsValid
	};
```

With:

```ts
	return {
		connected: true,
		isActive: integration.isActive,
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		lastSyncAt: integration.lastSyncAt,
		isDegraded: integration.isDegraded,
		lastFailureReason: integration.lastFailureReason,
		credentialsValid
	};
```

- [ ] **Step 2: Add degraded badge in Settings → Keez page**

In `app/src/routes/[tenant]/settings/keez/+page.svelte`, find the `Conectat` badge block (around line 268–271):

```svelte
					<Badge variant="default" class="gap-1">
						<CheckCircle2 class="h-3 w-3" />
						Conectat
					</Badge>
```

Replace with:

```svelte
					{#if status.isDegraded}
						<Badge variant="outline" class="gap-1 border-amber-500 text-amber-700 dark:text-amber-400">
							<AlertTriangle class="h-3 w-3" />
							Degradat
						</Badge>
					{:else}
						<Badge variant="default" class="gap-1">
							<CheckCircle2 class="h-3 w-3" />
							Conectat
						</Badge>
					{/if}
```

Verify `AlertTriangle` is already imported (it's used above for the "Eroare credențiale" badge — yes). No new import needed.

- [ ] **Step 3: Add degraded explanation under the badge**

Find the `CardDescription` directly after (around line 274):

```svelte
			<CardDescription>Contul Keez este conectat și activ</CardDescription>
```

Replace with:

```svelte
			<CardDescription>
				{#if status.isDegraded}
					Ultima sincronizare a eșuat. Integrarea rămâne activă, dar datele din CRM pot fi neactualizate.
					{#if status.lastFailureReason}
						<span class="mt-1 block text-xs text-amber-700 dark:text-amber-400">
							Detalii: {status.lastFailureReason}
						</span>
					{/if}
				{:else}
					Contul Keez este conectat și activ
				{/if}
			</CardDescription>
```

- [ ] **Step 4: Run svelte-autofixer on the edited file**

Per memory `feedback_svelte_mcp_check.md`:

```bash
# Use the svelte MCP autofixer on the edited component
```

Use the `mcp__svelte__svelte-autofixer` tool on `app/src/routes/[tenant]/settings/keez/+page.svelte`. Apply any suggestions.

- [ ] **Step 5: Full compile check**

```bash
cd app && bunx svelte-check --threshold warning 2>&1 | tail -20
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/remotes/keez.remote.ts \
        app/src/routes/[tenant]/settings/keez/+page.svelte
git commit -m "feat(keez): surface degraded state in Settings UI

When consecutive sync failures hit 3 (or on a permanent failure),
the integration enters a \"degraded\" state. Settings -> Keez now
shows an amber \"Degradat\" badge and the last failure reason.
State clears automatically on the next successful sync."
```

---

## Task 10: Final verification

- [ ] **Step 1: Run all test scripts**

```bash
cd app && \
	bun run scripts/test-keez-error-classification.ts && \
	bun run scripts/test-keez-failure-handler.ts
```

Expected: both exit 0 with all assertions passing.

- [ ] **Step 2: Full svelte-check**

```bash
cd app && bunx svelte-check --threshold warning 2>&1 | tail -30
```

Expected: no new errors introduced by this plan. (Pre-existing warnings are not a gate.)

- [ ] **Step 3: Run svelte-autofixer on all modified Svelte files**

Per memory `feedback_svelte_mcp_check.md`, run the autofixer on the one modified component:

```
app/src/routes/[tenant]/settings/keez/+page.svelte
```

- [ ] **Step 4: Manual smoke test on localhost**

Per memory `feedback_local_preview_needs_main.md`, merge this branch to `main` first for the user to see it on localhost.

Smoke checklist:
1. Settings → Keez shows "Conectat" (or "Degradat" if prior test failures exist).
2. Click "Sync Invoices from Keez" on the Invoices page. Succeeds with `{imported, updated, skipped}` counts. Notifications bell should clear any prior `Eroare sincronizare Keez` card.
3. "Ultima sincronizare" updates on the Settings page after the manual sync.

- [ ] **Step 5: Create PR**

```bash
gh pr create --title "feat(keez): consolidate manual+scheduler sync + transient retry" --body "$(cat <<'EOF'
## Summary
- Gut ~480-line duplicate sync logic in the manual remote; it now calls `syncKeezInvoicesForTenant()` like the scheduler
- Add transient-failure retry (+10 min / +1 h) with degraded state after 3 consecutive failures
- Add `isDegraded` badge + last failure reason to Settings → Keez
- Manual sync cancels any pending retry job before running

Spec: docs/superpowers/specs/2026-04-21-keez-sync-consolidation-and-retry-design.md
Plan: docs/superpowers/plans/2026-04-21-keez-sync-consolidation-and-retry.md

Triggered by the 2026-04-21 incident: daily 04:00 cron hit Keez 502
(real upstream outage), admin notification stayed red after the user's
successful manual sync at 09:14 because the manual path never cleared
it. Root cause was the two parallel implementations; this PR deletes
one.

## Test plan
- [x] `bun run scripts/test-keez-error-classification.ts` passes
- [x] `bun run scripts/test-keez-failure-handler.ts` passes
- [x] `svelte-check --threshold warning` clean
- [ ] Manual: click Sync → completes, clears notification, updates lastSyncAt
- [ ] Manual: Settings → Keez shows Conectat/Degradat badge correctly
- [ ] After DB migration, `PRAGMA table_info(keez_integration)` shows 4 new columns
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Part A (consolidate) → Tasks 8, 9
- Part B (retry + degraded) → Tasks 1, 2, 3, 4, 5, 6, 7
- Part C (cancel pending retry on manual) → Task 6 (`cancelPendingKeezRetry`), Task 8 (call it)
- Shared failure helper → Task 3
- Settings UI degraded badge → Task 9
- Idempotency preserved (noted in spec) → unchanged by this plan, already holds
- Tests: unit for classifier + decision function → Tasks 2, 3

**Type consistency check:**
- `FailureKind = 'transient' | 'permanent'` defined in Task 2, used in Task 3. ✓
- `FailureAction` defined in Task 3 (`decideFailureAction`), used only within Task 3. ✓
- `schedulerQueue` named consistently across Tasks 6, 7. ✓
- `retryJobId(tenantId)` format consistent across Task 6 (exported, used by `enqueueKeezRetry` and `cancelPendingKeezRetry`). ✓
- `handleKeezSyncFailure(tenantId, error, { enqueueRetry })` signature consistent between Tasks 3, 5, 6. ✓
- Schema columns `last_failure_at` / `lastFailureAt` mapping consistent between SQL (Task 1) and Drizzle schema (Task 1 Step 6). ✓

**Placeholder scan:** No TBDs, TODOs, "implement later", or hand-wavy error-handling references. Every code step shows real code. ✓

**Scope:** Single-cohesive-refactor scope, no decomposition needed. ✓

---

## Execution Handoff

**Plan complete and saved to `app/docs/superpowers/plans/2026-04-21-keez-sync-consolidation-and-retry.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
