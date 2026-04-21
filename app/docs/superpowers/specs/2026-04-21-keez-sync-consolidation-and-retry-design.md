# Keez Sync — Consolidation + Transient-Failure Retry

**Status:** Design approved by user and Gemini, pending spec review.
**Date:** 2026-04-21
**Owner:** Augustin

## Problem

Two incidents on 2026-04-21 exposed three bugs in the Keez invoice sync:

1. Scheduler at 04:00:24 hit Keez 502 Bad Gateway (nginx upstream outage). Client retried 3× within ~100s, all failed, sync aborted. Next auto-attempt was 24h later at 04:00 the following day.
2. User hit "Sync Invoices from Keez" at ~09:14 (Keez had recovered), sync completed successfully, but the red error notification stayed because the manual path never clears it.
3. The "Ultima sincronizare" timestamp in Settings → Keez briefly appeared stale because the manual sync lives in a parallel ~400-LoC implementation that has drifted from the scheduler's shared function.

Root cause of all three: `syncInvoicesFromKeez` in `app/src/lib/remotes/keez.remote.ts` duplicates the full mapping/upsert logic instead of calling the shared `syncKeezInvoicesForTenant` in `app/src/lib/server/plugins/keez/sync.ts`. The scheduler path has the right behaviors (`clearNotificationsByType`, in-memory sync lock, structured logger, `lastSyncAt` update); the manual path is missing some of them.

A secondary issue: the scheduler has no within-day recovery path for transient provider outages.

## Goals

- One canonical sync function. Manual button and scheduler both go through it.
- Same success/failure side effects regardless of entry point: notification creation, notification cleanup, sync lock, `lastSyncAt` update, structured logging.
- Automatic recovery from transient Keez outages within the same day, without manual intervention.
- Clear separation between transient failures (retry) and permanent failures (surface to user immediately).
- No behavior regression for the daily 04:00 scheduled run.

## Non-goals

- Multi-container / horizontal scaling concerns. Current deployment is single-container; in-memory sync lock is acceptable. Flagged as a follow-up if OTS CRM ever scales out.
- Refactoring the Keez client's in-request retry policy. The 3-attempt / 30s-timeout / exponential-backoff-plus-jitter policy stays as-is.
- Redesigning the Keez error taxonomy. Current `KeezClientError` + generic `Error` shape is enough for the classification we need here.
- Changing the UI of Settings → Keez beyond surfacing the new `degraded` state.

## Design

### Part A — Consolidate sync logic

**Change:** `syncInvoicesFromKeez` in `keez.remote.ts` becomes a thin wrapper:

```ts
// Pseudocode
export const syncInvoicesFromKeez = command(schema, async (filters) => {
  const event = getRequestEvent();
  assertAuthenticated(event);
  assertRole(event, ['owner', 'admin', 'member']); // viewer blocked
  cancelPendingRetryJob(event.locals.tenant.id); // see Part B
  const result = await syncKeezInvoicesForTenant(event.locals.tenant.id, {
    offset: filters.offset,
    count: filters.count ?? 100, // keep manual default at 100 for UX responsiveness
    filter: filters.filter,
  });
  return { success: true, ...result };
});
```

**Deleted:** ~400 LoC of duplicate parsing/mapping/upsert logic in the remote command (roughly lines 813–1256 of `keez.remote.ts`).

**Retained from remote:** auth check, permission check, validation schema, invalidation targets for `.updates(invoicesQuery, keezStatusQuery)`.

**Consequence:** manual path now automatically gets `clearNotificationsByType`, in-memory `activeSyncs` lock, structured `logInfo`/`logWarning`/`logError`, and consistent `lastSyncAt` update. The `count:500` vs `count:100` difference is preserved (manual stays at 100 for faster UI feedback, scheduler stays at 500).

**Idempotency check:** verified. `syncKeezInvoicesForTenant` upserts keyed by `invoice.keezExternalId` (see `sync.ts:137–141`). Re-running after a partial failure updates existing rows, never duplicates. Line items are deleted-then-inserted inside the row update (`sync.ts:320–329`), which is idempotent per invoice.

### Part B — Transient-failure retry + degraded state

**Schema changes** (new migration, one `ALTER TABLE`):

```sql
ALTER TABLE keez_integration ADD COLUMN last_failure_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE keez_integration ADD COLUMN last_failure_reason TEXT;
ALTER TABLE keez_integration ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE keez_integration ADD COLUMN is_degraded BOOLEAN NOT NULL DEFAULT false;
```

Turso constraint: one statement per file, so this will be split into four migration files per `feedback_turso_single_statement.md`.

**Error classification** (new helper in `app/src/lib/server/plugins/keez/error-classification.ts`):

```ts
type FailureKind = 'transient' | 'permanent';

function classifyKeezError(error: unknown): FailureKind {
  if (error instanceof KeezCredentialsCorruptError) return 'transient'; // already retried inside scheduler
  if (error instanceof KeezClientError) {
    if (error.status === 401) return 'permanent'; // token refresh already failed inside client
    if (error.status >= 400 && error.status < 500) return 'permanent';
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/\b(502|503|504)\b/.test(msg)) return 'transient';
  if (/timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed/i.test(msg)) return 'transient';
  return 'transient'; // default: assume transient, be optimistic
}
```

**Retry schedule** — when the scheduler catches a transient error:

| Failure number | What happens | Delay to next attempt |
|---|---|---|
| 1st (initial cron run) | `consecutiveFailures = 1`, schedule retry | +10 min |
| 2nd (1st retry failed) | `consecutiveFailures = 2`, schedule retry | +1 h |
| 3rd (2nd retry failed) | `consecutiveFailures = 3`, **mark degraded**, admin notif, no more retries | — |
| 4th+ | not reached — next attempt is the following day's 04:00 cron | — |

Each retry enqueues one job `keez-invoice-sync-retry:{tenantId}` with `delay: N ms`, `attempts: 1` (the retry is its own attempt), and `jobId` deduplicated per tenant so duplicate retries can't stack up.

Rationale: 3 consecutive failures within the same day is a strong signal that Keez is more than transiently broken. Two retries give us two recovery windows (~10 min and ~1 h) without hammering an already-sick upstream.

**Permanent failures** — skip retry scheduling. Create the admin notification (as today), mark `isDegraded: true`, set `lastFailureReason`. Surface in Settings → Keez UI.

**Shared failure helper** (`handleKeezSyncFailure(tenantId, error)` in `app/src/lib/server/plugins/keez/failure-handler.ts`) is called from both the daily cron task and the retry task. It does: classify error → update failure columns atomically → decide retry/degraded → enqueue retry job or create notification. Extracting this keeps the two task files thin and ensures both paths behave identically.

**Success path** — reset `consecutiveFailures = 0`, `isDegraded = false`, `lastFailureAt = null`, `lastFailureReason = null`. This runs inside `syncKeezInvoicesForTenant` alongside the existing `lastSyncAt` update and `clearNotificationsByType` call.

**Degraded state semantics:**
- `isDegraded = true` does NOT disable the integration. Daily 04:00 cron still runs.
- Set `isDegraded = true` when `consecutiveFailures` reaches 3 (i.e., the initial run plus both retries all failed with transient errors).
- Permanent errors (4xx, 401 after refresh) set `isDegraded = true` immediately on first failure — no point retrying.
- Settings → Keez adds one line: `<span class="text-amber-600">Integrare degradată — ultima sincronizare a eșuat. Detalii: {lastFailureReason}</span>`. No other UI changes.
- First successful sync clears `isDegraded` (and all failure columns).

### Part C — Manual sync cancels pending retry

When user clicks "Sync Invoices from Keez":

1. Remote command calls `cancelPendingKeezRetry(tenantId)` which does `schedulerQueue.remove('keez-invoice-sync-retry:{tenantId}')` (BullMQ no-op if no such job). Swallow errors — a stale pending retry job is an inconvenience, not a blocker.
2. Then runs the shared sync function.
3. If manual sync succeeds, no retries needed. If it fails, scheduler's retry logic kicks in again (same `classifyKeezError` + reschedule flow).

This prevents duplicate work when user manually triggers a sync while a retry is queued.

### Component map

| File | Change |
|---|---|
| `app/src/lib/server/db/schema.ts` | +4 columns on `keezIntegration` |
| `app/src/lib/server/db/migrations/00XX_*.sql` | 4 new migration files (one ALTER each) |
| `app/src/lib/server/plugins/keez/error-classification.ts` | **new** — `classifyKeezError`, `FailureKind` |
| `app/src/lib/server/plugins/keez/failure-handler.ts` | **new** — `handleKeezSyncFailure`, `cancelPendingKeezRetry` |
| `app/src/lib/server/plugins/keez/sync.ts` | Reset failure columns on success (alongside `lastSyncAt`) |
| `app/src/lib/server/scheduler/tasks/keez-invoice-sync.ts` | Daily cron handler; extracts failure-handling into shared helper |
| `app/src/lib/server/scheduler/tasks/keez-invoice-sync-retry.ts` | **new** — single-tenant retry handler, reuses same failure helper |
| `app/src/lib/server/scheduler/index.ts` | Register `keez_invoice_sync_retry` task handler (existing handler pattern) |
| `app/src/lib/remotes/keez.remote.ts` | Gut `syncInvoicesFromKeez` → thin wrapper; call `cancelPendingKeezRetry` |
| `app/src/routes/[tenant]/settings/keez/+page.svelte` | Show degraded badge when `isDegraded` |

### Data flow

```
┌─────────────────┐    ┌──────────────────────────────────┐
│ Daily cron 04:00│───▶│ processKeezInvoiceSync (scheduler)│
└─────────────────┘    └────────────┬─────────────────────┘
                                    │
┌─────────────────┐                 ▼
│ "Sync" button   │    ┌──────────────────────────────────┐
│ (remote cmd)    │───▶│ syncKeezInvoicesForTenant (shared)│
└─────────────────┘    └────────────┬─────────────────────┘
                                    │
                         ┌──────────┴───────────┐
                         ▼                      ▼
                    ┌─────────┐          ┌─────────────┐
                    │ Success │          │  Failure    │
                    └────┬────┘          └──────┬──────┘
                         │                      │
                         ▼                      ▼
            • clearNotificationsByType    classifyKeezError
            • lastSyncAt = now             ┌──────┴──────┐
            • consecutiveFailures = 0      ▼             ▼
            • isDegraded = false       transient     permanent
            • cancel any pending retry    │             │
                                          ▼             ▼
                               • consecutiveFailures++  • mark degraded
                               • if counter < 3:        • create notif
                                 enqueue retry          • no retry
                                 (+10m or +1h)
                               • else (counter == 3):
                                 mark degraded,
                                 create notif, stop
```

## Error handling / edge cases

- **User clicks Sync twice fast.** First call acquires `activeSyncs` lock inside shared function. Second call sees lock, returns `{ imported: 0, updated: 0, skipped: 0, errors: 0 }`. No toast change needed — existing behavior.
- **Retry fires while user is clicking Sync manually.** Manual path calls `cancelPendingKeezRetry` before the shared function. BullMQ `remove` is atomic; worst case the retry already started, hits the same lock, no-ops.
- **401 after token refresh inside client.** Client retries once with fresh token (see `client.ts:308–315`). If still 401, throws `KeezClientError(401)`. Classifier returns `permanent`. Marked degraded, admin notified, no retries scheduled.
- **Database lock during failure path.** Write to `keezIntegration.consecutive_failures` could hit a Turso write-timeout. Wrap in try/catch; if the failure-state write fails, still enqueue the retry job — the retry job is the safety net.
- **Server restart between retries.** BullMQ persists delayed jobs in Redis, so retries survive restarts. Confirmed by existing scheduler behavior.
- **Tenant deactivates Keez integration between retries.** Retry task begins by re-reading `keezIntegration` with `isActive = true` filter (already does — `sync.ts:99–105`). If deactivated, returns empty result and exits. No error.

## Testing strategy

Follow `testing-strategy` skill:

1. **Unit** — `classifyKeezError` with: 502 string, 503 string, timeout Error, `KeezClientError(401)`, `KeezClientError(403)`, `KeezClientError(500)`, generic Error with random message, `KeezCredentialsCorruptError`. Each returns the expected `FailureKind`.
2. **Integration** — fake Keez endpoint via test fixture. Scenario: first call returns 502, second call returns 200. Verify: retry is enqueued, runs, succeeds, `consecutiveFailures` back to 0, no `isDegraded`, no leftover notification.
3. **Integration — exhaustion path** — fake endpoint returns 502 five times. Verify: 3 retries scheduled, `isDegraded = true` after 3rd failure, admin notification present, no 4th retry.
4. **Regression** — existing manual sync behavior: button click → `lastSyncAt` updated → toast shows `{imported, updated}`. Same result after consolidation.

No golden files; all scenario-based.

## Rollout

1. Migrations applied via `bun run db:migrate` on both dev and prod Turso after code merge (per `feedback_migration_flow.md`: verify column on remote with PRAGMA before declaring done).
2. Feature gate: none. Change is behavior-preserving for the happy path and strictly additive for the failure path.
3. Monitoring: watch `debugLog` table for `keez.sync_error` entries and `scheduler` info logs with `keez_invoice_sync_retry` for the first 48h.

## Known limitations (not blocking)

- In-memory `activeSyncs` lock doesn't survive multi-container deployments. Fine for current single-container OTS CRM. If the app ever scales to multiple SvelteKit containers, replace with a Redis-backed lock (redlock or `SET NX PX`). Flagged for follow-up.
- BullMQ job dedup uses `jobId: 'keez-invoice-sync-retry:{tenantId}'`, which means only one queued retry per tenant. If a retry is already running when a new failure comes in, the new retry can't be queued until the current one finishes. Acceptable — the in-flight retry will itself succeed or fail, and the failure path re-enqueues.

## Files to read first when implementing

1. `app/src/lib/server/plugins/keez/sync.ts` — target of most changes
2. `app/src/lib/server/plugins/keez/client.ts:289-372` — in-request retry policy (do not touch)
3. `app/src/lib/server/scheduler/tasks/keez-invoice-sync.ts` — wraps `syncKeezInvoicesForTenant`, needs the classify-and-reschedule block
4. `app/src/lib/server/scheduler/index.ts:58-76, 322-336` — BullMQ queue setup and daily cron registration
5. `app/src/lib/remotes/keez.remote.ts:779-1258` — current duplicate to be gutted
6. `app/src/lib/server/notifications.ts:413` — `clearNotificationsByType` signature, already correct
