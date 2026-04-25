# Invoice Delete vs Cancel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox tracking.

**Goal:** Stop offering raw "Delete" on validated invoices, surface "Anulează" instead, and make `deleteInvoice` survive FK refs from WHMCS sync rows and bank transactions.

**Architecture:** All work happens in three files: `invoices.remote.ts` (`deleteInvoice` hardening), `keez.remote.ts` (extend `cancelInvoiceInKeez` to local-only invoices), `[tenant]/invoices/+page.svelte` (status-aware buttons). The schema FK migration is intentionally NOT in scope — SQLite/libSQL FK changes require table rebuild (5+ migrations) for marginal gain. Code-level FK cleanup in `deleteInvoice` matches the existing `_debug-keez-invoice` hardDelete pattern.

**Tech Stack:** SvelteKit 5 remote functions, Drizzle ORM, libSQL (Turso), bun:test.

---

### Task 1: `deleteInvoice` — refuse non-draft, FK cleanup on draft

**Files:**
- Modify: `app/src/lib/remotes/invoices.remote.ts:742-771`
- Test: `app/src/lib/remotes/invoices.remote.test.ts` (new file if missing)

**Behavior:**
- Status `draft` → detach `bank_transaction.matched_invoice_id`, delete `whmcs_invoice_sync` rows, then DELETE invoice (cascades cover line items, payments, keezInvoiceSync, transactionInvoiceMatch)
- Status non-draft → throw user-facing RO error: `"Facturile validate nu pot fi șterse — folosiți Anulare. Status curent: <status>"`
- All mutations in a single `db.transaction`
- Hook `invoice.deleted` continues to fire (keeps Keez DELETE path for drafts)

### Task 2: `cancelInvoiceInKeez` — handle local-only invoices

**Files:**
- Modify: `app/src/lib/remotes/keez.remote.ts:1105-1160`

**Behavior:**
- Pre-existing path (invoice has `keezExternalId` + active integration) unchanged — calls Keez `POST /invoices/canceled` then UPDATEs CRM status.
- New local-only path (`keezExternalId === null`) — UPDATE `status='cancelled'` only, skip Keez call. Used when invoice was never synced.
- Rename remote to just `cancelInvoice` is out of scope — the existing name is fine; just relax the precondition.

### Task 3: UI — status-aware buttons in invoices list

**Files:**
- Modify: `app/src/routes/[tenant]/invoices/+page.svelte:925-967`

**Behavior:**
- `invoice.status === 'draft'` → render "Șterge" `DropdownMenuItem` (red destructive style), calls `handleDeleteInvoice`
- `invoice.status !== 'draft'` → render "Anulează" `DropdownMenuItem` (red destructive style), calls a new `handleCancelInvoice` that wraps `cancelInvoiceInKeez` with confirmation
- Remove the standalone "Anulează în Keez" item (its behavior is now the unified "Anulează")
- Keep "Storno în Keez" as separate (it's a different fiscal action)

### Task 4: Tests

**Files:**
- Create: `app/src/lib/remotes/invoices.remote.test.ts` (FK cleanup behavior, refuse non-draft)
- Modify: `app/src/lib/remotes/keez.remote.test.ts` (if exists, add local-only cancel)

**Coverage:**
- `deleteInvoice` on draft with WHMCS sync row → succeeds, sync row deleted
- `deleteInvoice` on draft with bank_transaction match → succeeds, transaction detached
- `deleteInvoice` on `sent`/`paid` → throws RO error
- `cancelInvoiceInKeez` on local-only invoice → UPDATE status only, no Keez call

### Task 5: Type-check + commit + PR + merge

**Steps:**
- `npx tsc --noEmit -p tsconfig.json` filtered to changed files
- Run `bun test` on the new tests
- Single commit per logical change
- Open PR, merge to main with `--squash --delete-branch`
