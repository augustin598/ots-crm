# Hosting Accounts — Grouped by Client (1:1 implementation of HOST design pack)

**Date:** 2026-05-19  
**Source:** `new_design/HOST/Create campaign ADS/exports/` (README, `migration.sql`, `hosting.types.ts`, `columns.config.json`, `ColumnManager.tsx`)  
**Target page:** `/[tenant]/hosting/accounts`  
**Goal:** Redesign the existing accounts list so the **client relationship health** (LTV, tier, vechime, MRR/ARR, next renewal, overdue alerts) is the primary unit of information, and the per-account table becomes a configurable secondary surface.

---

## 1. Why we adapt instead of paste

The HOST pack ships React+TSX + MySQL. Our CRM stack is **SvelteKit 5 + Drizzle ORM + Turso (libSQL)**. The design intent, layout, columns, group header, semaphore semantics, and column manager UX are implemented **1:1**. The technology bindings are translated:

| Pack assumes                   | Our stack uses                                  | Decision                                                                                                           |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| MySQL `ENUM`, `BOOLEAN`        | Turso text + integer (0/1)                      | Drizzle `text(...)` with check semantics in app code; `integer({mode:'boolean'})` for `auto_renew`                  |
| `billing` ENUM(`monthly`,`yearly`) | `billing_cycle` text (monthly..triennially..one_time) | **Keep existing `billing_cycle`** — more expressive. Map to the design's 2-bucket label as `/lună` vs `/an+`.        |
| `addon_domains` 1:N table      | `hosting_account.additional_domains` JSON array | **Keep JSON** — already populated by DA sync; zero-cost migration. Inline chip + expand details, as in pack.       |
| `account_invoices` table       | Existing `invoice` table with `hosting_account_id` text marker | **Join existing `invoice`** — no new table; the join the pack draws already exists.                                |
| MySQL `CREATE VIEW`            | Drizzle query function (groupedQuery)           | View becomes a server-side aggregation function; same shape, returned via remote.                                  |
| React TSX `ColumnManager`      | Svelte 5 component `<ColumnManager>`            | Identical UX (drag-reorder + toggle + required pin + NEW badge). Pure UI, parent owns state.                       |
| React hook `usePersistedColumnConfig` | Svelte 5 helper `createPersistedColumnConfig` using `$state` + localStorage | localStorage v1 (per pack). Promote to `tenant_user_preferences` later if needed.                                  |
| MySQL `DECIMAL(12,2)`          | Integer cents (OTS CRM convention)              | `ltv_cents` integer; UI formats RON.                                                                                |
| Computed `status='expiring'`   | Derive client-side from `nextDueDate ≤ today+30d` | Existing status enum has `pending` not `expiring`. Compute "expiring" at render time, do **not** mutate the column.|

Everything else (badges, edge colors, header zones, columns, quick actions) is implemented **as drawn in the pack**.

---

## 2. Architecture (data flow)

```
                        ┌─────────────────────────────────────────────┐
                        │  /[tenant]/hosting/accounts  (page.svelte)  │
                        │  ─────────────────────────────────────────  │
                        │  • $state for filters, search, group toggle │
                        │  • column config from localStorage          │
                        │  • renders <ColumnManager> drawer +         │
                        │    <ClientGroupCard> per group              │
                        └────────────────────┬────────────────────────┘
                                             │ remote call
                                             ▼
                ┌────────────────────────────────────────────────┐
                │  hosting-accounts.remote.ts                    │
                │  ────────────────────────────                  │
                │  getHostingAccountsGrouped({ filters })        │
                │    → ClientGroup[]                             │
                │      ├─ client (incl. tier, since, ltv_cents)  │
                │      ├─ accounts (with addons, last_invoice)   │
                │      └─ totals (mrr, arr, by_status,           │
                │                 overdue_count, next_expiry,    │
                │                 oldest_overdue)                │
                └────────────────────┬───────────────────────────┘
                                     │ Drizzle (tenant-scoped)
                                     ▼
              ┌──────────────────────────────────────────────────┐
              │  Turso (libSQL)                                  │
              │  ─────────────                                   │
              │  client            (+ client_since, tier, ltv_cents)
              │  hosting_account   (+ auto_renew)                │
              │  invoice           (joined via hosting_account_id)
              └──────────────────────────────────────────────────┘
```

Tenant scoping enforced at the remote layer (per **multi-tenant** skill conventions): every query passes `tenantId = locals.tenant.id` and joins are validated against `client.tenant_id`.

---

## 3. Database changes (migrations)

### 3.1 New columns on `client` table

| Column           | Drizzle type                                                | Notes                                                                                              |
| ---------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `client_since`   | `text('client_since')` (YYYY-MM-DD)                         | Optional. Falls back to `created_at` if NULL. Editable from client edit form (out of scope; nullable). |
| `tier`           | `text('tier').default('standard')`                          | One of `vip | standard | watch`. Enforced in app code (no DB CHECK to keep migrations 1-statement). |
| `ltv_cents`      | `integer('ltv_cents').notNull().default(0)`                 | Cents. Refreshed by `recalcClientLTV(clientId)` on invoice paid/refund events.                     |

### 3.2 New column on `hosting_account` table

| Column        | Drizzle type                                              | Notes                                                                                          |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `auto_renew`  | `integer('auto_renew', {mode:'boolean'}).notNull().default(true)` | Drives the toggle in "Ciclu + Auto-renew" column. Editable in account detail (future-proof). |

### 3.3 Migration files (Turso = one statement per file)

Per `feedback_turso_single_statement` memory:

```
0343_client_client_since.sql           ALTER TABLE client ADD COLUMN client_since TEXT;
0344_client_tier.sql                   ALTER TABLE client ADD COLUMN tier TEXT DEFAULT 'standard';
0345_client_ltv_cents.sql              ALTER TABLE client ADD COLUMN ltv_cents INTEGER NOT NULL DEFAULT 0;
0346_hosting_account_auto_renew.sql    ALTER TABLE hosting_account ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 1;
```

`_journal.json` updated in lockstep; verified via `PRAGMA table_info(...)` on remote post-migrate (per `feedback_migration_flow` memory).

**No new tables, no views, no destructive changes.** Pack's `account_invoices` is satisfied by existing `invoice` table (uses `hosting_account_id` text marker already). Pack's `addon_domains` table is satisfied by existing `hosting_account.additional_domains` JSON array.

---

## 4. Server: grouped query

### 4.1 Remote function

`src/lib/remotes/hosting-accounts.remote.ts` — new function:

```ts
export const getHostingAccountsGrouped = query(filterSchema, async (filters) => {
  const ctx = await requireTenantContext(); // existing helper

  // 1. Load accounts + client + server + package (existing pattern)
  const accounts = await getHostingAccounts({ ... });

  // 2. Load last invoice per account (one query, grouped by hosting_account_id)
  const lastInvoices = await loadLastInvoicePerAccount(ctx.tenantId, accountIds);

  // 3. Load overdue counts per client (one query)
  const overdueByClient = await loadOverdueCountByClient(ctx.tenantId, clientIds);

  // 4. Group in JS (~150 accounts max per tenant — JS grouping is fine)
  return groupByClient(accounts, lastInvoices, overdueByClient);
});
```

Where `groupByClient` returns:

```ts
type ClientGroup = {
  client: { id, name, businessName, cui, email, phone, tier, clientSince, ltvCents, ... };
  accounts: HostingAccountWithLastInvoice[];
  totals: {
    count: number;
    mrrCents: number;          // normalized monthly
    arrCents: number;          // mrr × 12
    addonCount: number;
    byStatus: Record<AccountStatus, number>;
    overdueCount: number;
    nextExpiry: { date: string; days: number } | null;
    oldestOverdue: { date: string; daysOverdue: number } | null;
  };
};
```

### 4.2 "Last invoice" join

```sql
-- conceptual (Drizzle equivalent):
SELECT i.* FROM invoice i
WHERE i.tenant_id = ?
  AND i.hosting_account_id IN (?, ?, ...)
ORDER BY i.issued_at DESC
-- then pick first per hosting_account_id in JS (or use window function)
```

`LastInvoice` shape matches pack types:
```ts
type LastInvoice = {
  status: 'paid' | 'pending' | 'overdue' | 'n/a';
  date: string;          // ISO
  amountCents: number;
  daysOverdue?: number;  // only when status === 'overdue'
};
```

`'n/a'` returned for accounts with zero invoices yet.

### 4.3 LTV refresh hook

New helper `recalcClientLTV(tenantId, clientId)`:

```ts
const sum = await db
  .select({ s: sql<number>`COALESCE(SUM(${invoice.totalCents}), 0)` })
  .from(invoice)
  .where(and(
    eq(invoice.tenantId, tenantId),
    eq(invoice.clientId, clientId),
    eq(invoice.status, 'paid'),
  ));
await db.update(client).set({ ltvCents: sum[0].s }).where(...);
```

Called from:
1. Existing `markInvoicePaid` flow
2. Existing `refundInvoice` flow
3. One-off backfill script `bun run scripts/backfill-client-ltv.ts`

---

## 5. UI components

### 5.1 `ColumnManager.svelte` (port of pack's TSX)

Pure UI Svelte 5 component, dropped at `src/lib/components/hosting/column-manager.svelte`:

- Props: `columns: ColumnDef[]`, `value: ColumnConfig` (`$bindable`), `class?: string`
- Internal state: `draggedKey`, `dragOverKey` via `$state`
- Drag-and-drop via native HTML5 drag events (matches pack — zero deps)
- Required columns: cannot drag/hide, shows `REQUIRED` chip
- `isNew` columns: show a `NEW` badge
- Toggle: visual switch (blue when ON, gray when OFF), preserves accessibility (`aria-pressed`, `aria-label`)

Helper `createPersistedColumnConfig(storageKey, defaultConfig)`:
- Returns a `$state` rune-backed object
- Hydrates from `localStorage` on mount
- Writes through on every change

Helper `visibleColumnsInOrder(columns, config)`:
- Returns ordered+visible columns array (mirrors pack)

### 5.2 `ClientGroupCard.svelte`

The group header block from the pack (one per client). Sections:

1. **Edge** (4px left border, semaphore color):
   - 🔴 if `overdueCount > 0` OR any account `status='suspended'`
   - 🟡 if any `nextExpiry.days <= 30` OR `tier='vip'`
   - 🟢 otherwise
2. **Identity:** `client.name` (link to client page), `businessName`, `CUI`, `email`
3. **Tier badge:** `VIP` / `LA RISC` / nothing (standard)
4. **Vechime:** `client_since` → "client din 2021 · 4 ani" (relative)
5. **LTV:** total spend `formatRON(ltvCents)` — tooltip explains it
6. **Count:** "8 conturi · +3 addons"
7. **Status mix bar:** horizontal stacked bar — green/amber/orange/slate proportions
8. **MRR / ARR:** normalized monthly + annual
9. **Next expiry countdown:** `nextExpiry.date` + "în 12 zile"
10. **Overdue alert:** if `overdueCount > 0` — red chip with count + oldest overdue date
11. **Quick actions:** dropdown menu — "Email client", "Factură nouă", "Renew toate" (links to existing flows)

### 5.3 `HostingAccountRow.svelte`

One row per account. Cells driven by `visibleColumns` array. Cell renderers per column key:

| Column key  | Render                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `user`      | `<span class="font-mono">{daUsername}</span>`                                                           |
| `domain`    | Link to account detail + expandable `+ N domenii adiționale` chip (already implemented — reused)        |
| `addons`    | (Alternative compact mode) inline chip when domain column is too narrow                                 |
| `pachet`    | Existing tiered package pill (`packageClasses`) + small PHP version sub-text                            |
| `server`    | Server name (link to server detail, if present)                                                         |
| `ciclu`     | Cycle pill (`/lună`, `/an`, etc) + small auto-renew chip (✓ ON / ✗ OFF — color-coded)                   |
| `start`     | `formatDate(startDate)`                                                                                 |
| `scadenta`  | `formatDate(nextDueDate)` + countdown sub-text ("în 12 zile" / "expirat acum 3 zile")                   |
| `plata`     | Last invoice chip: green (paid), amber (pending), red (overdue +N zile), slate ("n/a")                  |
| `status`    | Existing status chip                                                                                    |
| `suma`      | `formatRON(recurringAmount, currency)` + `CYCLE_LABEL[billingCycle]`                                    |

### 5.4 Page layout (`+page.svelte`)

```
┌──────────────────────────────────────────────────────────────────┐
│ Header (title + Sync / Cont nou buttons)         (existing kept) │
├──────────────────────────────────────────────────────────────────┤
│ KPI tiles: Clienți · Conturi · Active · Neasignate · MRR · ARR  │
│             (existing — kept, two new tiles: VIP count · Overdue)│
├──────────────────────────────────────────────────────────────────┤
│ Filter bar: search · status select · group toggle · 🔧 Coloane  │
│ (🔧 opens drawer on the right with <ColumnManager>)              │
├──────────────────────────────────────────────────────────────────┤
│ <ClientGroupCard> #1  (edge: green/amber/red)                    │
│   header block (zones 1–11)                                      │
│   table of accounts (visibleColumns)                             │
├──────────────────────────────────────────────────────────────────┤
│ <ClientGroupCard> #2 …                                           │
└──────────────────────────────────────────────────────────────────┘
```

Layout already pads `p-6` (per `feedback_layout_already_pads` memory) — page wraps with `<div class="space-y-6">` only.

---

## 6. Defaults (column config)

From `columns.config.json` — copied verbatim into `src/lib/components/hosting/columns.default.ts`:

```ts
export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'user',     label: 'DA User',                field: 'da_username',         required: true },
  { key: 'domain',   label: 'Domeniu',                field: 'domain',              required: true },
  { key: 'addons',   label: '+ Domenii adiționale',   field: 'additional_domains',  isNew: true },
  { key: 'pachet',   label: 'Pachet + PHP',           field: 'da_package_name' },
  { key: 'server',   label: 'Server',                 field: 'server' },
  { key: 'ciclu',    label: 'Ciclu + Auto-renew',     field: 'billing_cycle',       isNew: true },
  { key: 'start',    label: 'Data start',             field: 'start_date' },
  { key: 'scadenta', label: 'Scadență + countdown',   field: 'next_due_date' },
  { key: 'plata',    label: 'Ultima plată',           field: 'last_invoice',        isNew: true },
  { key: 'status',   label: 'Status cont',            field: 'status' },
  { key: 'suma',     label: 'Sumă + perioadă',        field: 'recurring_amount',    required: true },
];
```

Persisted in `localStorage` under `hosting.accounts.columns.v1`.

---

## 7. Error handling, perf, security

- **Tenant scoping:** every query MUST filter `tenant_id = locals.tenant.id`. Verified in tests (per `multi-tenant` skill).
- **Decryption / fetch errors:** existing patterns reused (no new external API).
- **Pagination:** existing `limit:500` retained. The grouped query is one round-trip + ≤2 helpers; ~150 accounts × 11 columns renders well under the 16ms frame budget.
- **localStorage failure:** `try/catch` around getItem/setItem; on failure, fall back to DEFAULT_COLUMNS in memory (no error toast — silent).
- **Permission:** route already guarded by tenant admin layout. No change.
- **Audit log:** none required (read-only redesign + cosmetic columns).
- **Backwards compat:** the page route stays the same — no client-side links break. Old saved bookmarks work.

---

## 8. Testing

Per `testing-strategy` skill:

1. **Unit:** `groupByClient()` correctness — happy path + unassigned + overdue counting + next_expiry calculation.
2. **Unit:** `recalcClientLTV()` — paid only, ignores draft/pending/refunded.
3. **Component (smoke):** ColumnManager toggle + reorder happy path with `localStorage` mock.
4. **Integration:** remote function returns correct `ClientGroup[]` shape; tenant-scoped (negative test: client from other tenant excluded).
5. **Manual / browser preview:** open `/ots/hosting/accounts`, verify rendering matches design pack (edge colors, badges, status mix bar widths).

---

## 9. Out of scope (deliberate)

- Editing tier / client_since from the UI — schema-only for this pass. Backfill script + admin debug endpoint to set tier/since.
- Surfacing `auto_renew` toggle in account-create form — adds default `true`; out of scope to add toggle UI.
- Cron job for `nextExpiry` notifications (already exists in another worker).
- Server-side cursor pagination for grouped query (re-evaluate when tenants pass 500 accounts).

---

## 10. Files touched (final inventory)

**New:**
- `app/drizzle/0343_client_client_since.sql`
- `app/drizzle/0344_client_tier.sql`
- `app/drizzle/0345_client_ltv_cents.sql`
- `app/drizzle/0346_hosting_account_auto_renew.sql`
- `app/src/lib/components/hosting/column-manager.svelte`
- `app/src/lib/components/hosting/column-manager.ts` (`ColumnDef`, `ColumnConfig`, helpers)
- `app/src/lib/components/hosting/columns.default.ts`
- `app/src/lib/components/hosting/client-group-card.svelte`
- `app/src/lib/components/hosting/hosting-account-row.svelte`
- `app/src/lib/server/hosting/ltv.ts` (`recalcClientLTV`)
- `app/scripts/backfill-client-ltv.ts`
- `app/src/lib/remotes/__tests__/hosting-accounts-grouped.remote.test.ts`

**Modified:**
- `app/src/lib/server/db/schema.ts` — append 4 columns + journal
- `app/src/lib/remotes/hosting-accounts.remote.ts` — add `getHostingAccountsGrouped`
- `app/src/routes/[tenant]/hosting/accounts/+page.svelte` — full rewrite (existing logic preserved as fallback if `groupByClient=false`)
- LTV hook wired into existing invoice paid / refund flows (one-line `await recalcClientLTV(...)`)

---

## 11. Acceptance criteria

- [ ] Page renders grouped view by default. Filters + search work as today.
- [ ] Group header shows all 11 zones from the pack with semaphore edge color.
- [ ] Status mix bar widths reflect `byStatus` proportions.
- [ ] Next expiry countdown shows `<days> zile` or "expirat acum X zile".
- [ ] Overdue chip appears only when `overdueCount > 0` and links to filtered invoices view.
- [ ] Column manager: drag-reorder + toggle work; persists across reloads (localStorage).
- [ ] Required columns cannot be hidden/reordered (DA user, Domeniu, Sumă).
- [ ] `auto_renew` defaults to `true` on existing accounts; visible in the "Ciclu" column.
- [ ] `client.tier` defaults to `'standard'`; only `vip` / `watch` render a badge.
- [ ] `client.ltv_cents` populated by backfill script; updates when an invoice is marked paid.
- [ ] svelte-check passes (threshold `warning`).
- [ ] svelte-autofixer reports no remaining issues on touched components.
- [ ] All existing tests still pass; new unit tests pass.
- [ ] Local browser preview matches pack screenshots in spirit (zones present, semaphore correct, badges legible).
