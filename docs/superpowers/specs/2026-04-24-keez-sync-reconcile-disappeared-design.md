# Keez Sync: Pagination + Reconcile Disappeared Invoices — Design

**Status:** approved (user delegated decisions on 2026-04-24, "ruleaza tu tot ce e nevoie")
**Author:** Claude (Opus 4.7)
**Branch:** `claude/keez-reconcile-disappeared`

## Problem

Today the Keez invoice sync:
1. Fetches **one page** per call (`count: 100` from manual sync, `500` from cron) — for tenants with > 500 invoices, the tail is silently invisible.
2. Never reconciles **deletions** — invoices removed on Keez stay in CRM forever as zombie records.

Real-world example (2026-04-24): tenant `ots` has 555 invoices on Keez; manual sync fetches `[0-99]` and the operator sees `OTS 542` (deleted on Keez upstream) still in CRM with `status='draft'`.

Plus: Keez does NOT return 404 for missing invoices — it returns **400 + `VALIDATION_ERROR` + `"Factura (xxx) nu exista!"`**. Any naive 404-check would miss the actual signal. (See `memory/project_keez_400_for_missing_invoice.md`.)

## Goals

- Fetch all pages, not just the first.
- After sync, automatically detect CRM invoices whose Keez counterpart no longer exists, and mark them `cancelled` with safe semantics.
- Never false-cancel an invoice that's actually fine on Keez (a paginated fetch failing midway should NOT cause cancellations).
- Preserve audit trail (no hard delete).

## Non-goals

- Two-phase staged deletion (`pendingDelete` flag → cancel-on-second-miss). Rejected because per-invoice verification gives unambiguous proof in a single pass.
- Schema migration. The existing `invoice.status` column already has `'cancelled'`; reuse it.
- Webhook-driven sync. Out of scope; we remain pull-based per `api-integrations` skill notes.
- Reconciliation for SmartBill, Gmail-import, or other adapters. Keez-only this PR.

## Design

### Approach: pagination + per-invoice verify

Two independent additions in `syncKeezInvoicesForTenant`:

#### 1. Pagination loop

Replace the single fetch with an offset-driven loop until we've consumed `recordsCount`:

```ts
let offset = options?.offset ?? 0;
const pageSize = options?.count ?? 500;
const seen = new Set<string>();   // externalIds observed in this run
let totalRecords: number | null = null;

while (true) {
  const page = await keezClient.getInvoices({ offset, count: pageSize, filter: options?.filter });
  totalRecords = page.recordsCount;
  if (!page.data || page.data.length === 0) break;

  for (const invoiceHeader of page.data) {
    seen.add(invoiceHeader.externalId);
    // ... existing per-invoice processing (unchanged) ...
  }

  offset += page.data.length;
  if (totalRecords !== null && offset >= totalRecords) break;
  if (page.data.length < pageSize) break; // defensive: short page = end
}
```

Pagination is the prerequisite for reconciliation — without it, the seen-set would only cover one page and we'd false-cancel the rest.

#### 2. Reconcile pass (after pagination loop)

```ts
// Build set of CRM invoices for this tenant that have a keezExternalId.
const crmKeezBacked = await db
  .select({ id: table.invoice.id, externalId: table.invoice.keezExternalId, status: table.invoice.status })
  .from(table.invoice)
  .where(and(eq(table.invoice.tenantId, tenantId), isNotNull(table.invoice.keezExternalId)));

const candidates = crmKeezBacked.filter((r) => r.externalId && !seen.has(r.externalId) && r.status !== 'cancelled');

for (const c of candidates) {
  try {
    await keezClient.getInvoice(c.externalId!);
    // 200 → still exists upstream; race or filter mismatch — leave alone.
    logInfo('keez', `reconcile: invoice still exists on Keez, no-op`, { tenantId, metadata: { invoiceId: c.id } });
  } catch (err) {
    if (isMissingOnKeez(err)) {
      await db.update(table.invoice)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(table.invoice.id, c.id));
      result.reconciledCancelled = (result.reconciledCancelled ?? 0) + 1;
      logWarning('keez', `reconcile: marked invoice cancelled (no longer on Keez)`, {
        tenantId, metadata: { invoiceId: c.id, keezExternalId: c.externalId },
      });
    } else {
      // Transient or unknown error → leave alone, retry next sync.
      logWarning('keez', `reconcile: cannot verify invoice, leaving alone`, {
        tenantId, metadata: { invoiceId: c.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
```

`isMissingOnKeez` is the same helper extracted from the debug endpoint — it recognises both 404 (`Error('Not found')`) and Keez's actual 400+`VALIDATION_ERROR`+`"nu exista"` shape. It moves to `app/src/lib/server/plugins/keez/error-classification.ts` so both the debug endpoint and the reconciler share one canonical detector.

### Data flow

```
                 ┌────────────────────────────────────┐
                 │ syncKeezInvoicesForTenant(tenantId)│
                 └────────────────┬───────────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                │ phase 1: pagination loop           │
                │   while not done:                  │
                │     fetch page                     │
                │     for each: upsert + add to seen │
                └─────────────────┬─────────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                │ phase 2: reconcile                 │
                │   list CRM invoices w/ externalId  │
                │   for each not-in-seen:            │
                │     verify via getInvoice          │
                │     if 400+VALIDATION/404:         │
                │        status = 'cancelled'        │
                │     else: leave alone              │
                └─────────────────┬─────────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                │ phase 3 (existing):               │
                │   reset failure columns           │
                │   clear keez.sync_error notifs    │
                └────────────────────────────────────┘
```

### Safety properties

| Risk | Mitigation |
|------|------------|
| Pagination fails mid-run (e.g. 502 on page 4 of 6) — seen-set is incomplete | Per-run circuit breaker (already shipped) re-throws after 3 consecutive transient errors. Reconcile pass never runs because sync exits early via the throw. Result: zero false-cancellations from broken pagination. |
| Race: invoice deleted between phase 1 and phase 2 (was in seen-set, then deleted upstream) | Already in seen-set → not a candidate → no-op. Caught next run. Acceptable. |
| Race: invoice created between phase 1 and phase 2 (not in seen-set, exists upstream now) | Verify via `getInvoice` returns 200 → no-op, log. Acceptable. |
| Operator created CRM invoice with `keezExternalId` manually (typo) → reconcile would cancel it | `getInvoice` returns 400+`VALIDATION_ERROR`+`"nu exista"` (it really doesn't exist on Keez), so cancel is correct behaviour. Document as "matches the manual-purge debug endpoint behaviour". |
| Cost: N extra `getInvoice` calls per run, where N = stale candidates | Typically 0–1 in steady state. The ONLY tenant with a known stale invoice today (`ots`) has 1 candidate. With per-fetch retry (3×) + AbortSignal(30s), worst case ~90s extra per stale invoice. Acceptable. |
| Cost amplification under outage | The reconcile pass uses the same Keez client which has the per-fetch retry; if Keez is degraded, reconcile fails-soft (logs and moves on, leaves invoice alone). |

### Cron impact

Reconcile runs at the end of `_syncKeezInvoicesForTenantInner` — every successful invocation, both daily 4 AM cron and manual user-triggered sync. Manual default count goes from 100 → 500 (matches the cron) so a single user click reconciles the full account.

For tenants with > 500 invoices, pagination handles the tail; the reconcile pass sees the full seen-set.

### Result shape

`SyncKeezInvoicesResult` gains an optional field:

```ts
interface SyncKeezInvoicesResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  reconciledCancelled?: number;  // NEW: invoices marked cancelled because missing upstream
  pagesFetched?: number;          // NEW: how many pages the pagination loop pulled
}
```

Logged into the `Keez retry: succeeded` info message and surfaced in the UI's manual-sync result toast.

## Components

| Unit | Responsibility | Inputs | Outputs |
|------|----------------|--------|---------|
| `error-classification.ts:isMissingOnKeez(err)` | Pure predicate. Detects "this invoice doesn't exist on Keez" across Keez's two HTTP shapes (404 / 400+VALIDATION_ERROR). | `unknown` (the caught error) | `boolean` |
| `sync.ts:syncKeezInvoicesForTenant` | Add pagination loop + reconcile pass. | `tenantId`, `options` | extended `SyncKeezInvoicesResult` |
| `_debug-keez-invoice/+server.ts` | Refactor to import `isMissingOnKeez` from the canonical helper. | (unchanged) | (unchanged) |
| Tests | `error-classification.test.ts` extends with `isMissingOnKeez` cases. New `sync-reconcile.test.ts` tests the pagination loop and the reconcile pass with mocked client. | — | — |

## Testing strategy

1. **Unit, pure:** `isMissingOnKeez` cases — 404, 400+VALIDATION, 400+other (must NOT match), 502 (must NOT match), generic Error with "Not found" (404 path).
2. **Unit, sync pagination:** mock `keezClient.getInvoices` to return 3 pages summing to `recordsCount=250`. Assert all 250 invoices visited and `seen` has 250 ids. Assert loop terminates (no infinite loop on `recordsCount=null`).
3. **Unit, reconcile pass:** mock client with `getInvoices` returning 1 page of `[A, B]` and `getInvoice(C)` throwing 400+VALIDATION_ERROR. Set up DB with 3 CRM invoices (A, B, C) all keez-backed. Run sync. Assert C is now `cancelled` and A/B are untouched.
4. **Unit, false-cancellation guard:** same setup but `getInvoice(C)` throws 502. Assert C stays in original status; `reconciledCancelled === 0`.
5. **Integration, circuit breaker:** mock `getInvoices` to throw 3 consecutive 502s on page 1. Assert sync re-throws via the existing per-run breaker BEFORE the reconcile pass runs (proving false-cancellation cannot happen via partial pagination).

Tests use `bun:test` with the `mock.module('$env/dynamic/private', ...)` pattern from the previous PR.

## Out of scope (deferred)

- Reconcile for permanent CRM invoices (not draft / already-paid). The current design treats them the same — if Keez says "doesn't exist", we cancel. If the user wants to protect e.g. `status='paid'` invoices from being auto-cancelled (because that would be a real data-integrity issue and Keez should never return "missing" for those), that's a follow-up. Default behaviour matches the manual-purge debug endpoint, which has no such guard.
- Telemetry: structured metric for `reconciledCancelled` count per tenant per run. Logs are sufficient for now.
- A "dry-run" toggle in the UI ("show me what would be cancelled before actually doing it"). The debug endpoint is the dry-run today.

## Open questions

None blocking. The user delegated decisions on 2026-04-24; defaults documented above.
