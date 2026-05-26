# Hosting Orders — UI redesign + structural backing (May 2026 v2)

**Goal:** Replace the visual layer of `/[tenant]/hosting/inquiries` with the new "Comenzi hosting" design from the 4 reference screenshots, AND back it with three structural data improvements so the design reflects real persisted facts (not derived/synthetic ones).

**Scope (boundaries):**
- Visual layer: replace `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` template + styles.
- Backend additions (small, focused):
  1. **`hosting_inquiry.order_number`** — sequential per-tenant counter; display as `OTS-XXXXX` everywhere.
  2. **`hosting_inquiry_item` table** — real line items (hosting + optional domain + future addons), populated at public-submit time. Replaces today's TVA-from-total derivation with proper per-item breakdown.
  3. **`getHostingOrders` returns items** — new `items: HostingOrderItemRow[]` field on `HostingOrderRow`.
- Public submit (`public-hosting.remote.ts`) writes one item per cart line at order time (hosting product line + optional domain line with snapshotted `tldPrice` and `domainMode`).
- Backfill: one-shot Node script (`scripts/backfill-hosting-order-numbers-and-items.ts`) — number existing inquiries by `created_at`, synthesize one "hosting" item per existing inquiry from `productPrice`.

**Out of scope (explicit non-goals):**
- Stripe refund flow. Refund button is a toast placeholder. The existing `handleChargeRefunded` webhook (server/stripe/webhook-handlers.ts:520) keeps doing its job independently — UI just renders `paymentStatus === 'refunded'` as a pill if Stripe sets it.
- Mapping `order_number` to invoice number. Per Gemini review: legal invoice numbers (Keez sequential) MUST stay independent. `order_number` is internal tracking only.
- Audit/status_history table for inquiry lifecycle changes. Useful but separate work; flagged for future iteration.
- `Pachet`/`Metodă` filter popovers (V1 uses simple `<select>`); `Perioadă`/`Data` are visible-but-disabled placeholders.
- Sequential numbering for OP/cash payment refunds (no flow yet).

---

## Reference (from screenshots)

The new design has 5 anchor states:

1. **List view** (Comenzi hosting): hero + KPI strip + tabs (Toate / În așteptare / Eșuate / Refundate) + filter chips + table with order id column + drawer-on-click.
2. **Drawer — ACHITAT, provisioning în curs** (OTS-48217): green pill, sections CLIENT / DETALII COMANDĂ / PLATĂ / ISTORIC, line items box, footer actions [Factură fiscală] [Refund] [Email client] [⚡ Forțează provisionare].
3. **Drawer — IN AȘTEPTARE + confirm-payment subform** (OTS-48216): yellow pill, inline form with method tabs (Card POS / Transfer bancar / Cash), sumă, ID tranzacție, notă, provisioning checkbox, footer [Marchează plătit] [Email client].
4. **Drawer — EȘUAT** (OTS-48213): red pill, red alert bar at top with retry, all sections present, footer only [Email client].
5. **Drawer — ACHITAT cu cont DA activ** (OTS-48214): footer adds [Vezi cont].

---

## Data layer changes

### 1. `hosting_inquiry.order_number`

Sequential per-tenant counter. Stored as integer; displayed as zero-padded `OTS-XXXXX`.

**Schema diff (`schema.ts`):**
```ts
orderNumber: integer('order_number'), // tenant-scoped sequential; NOT a legal invoice number
```

**Migration (one per Turso file):**

`app/drizzle/0371_hosting_inquiry_order_number.sql`:
```sql
ALTER TABLE hosting_inquiry ADD COLUMN order_number INTEGER;
```

`app/drizzle/0372_hosting_inquiry_order_number_unique.sql`:
```sql
CREATE UNIQUE INDEX hosting_inquiry_tenant_order_idx
  ON hosting_inquiry(tenant_id, order_number);
```

**Atomic increment pattern (libSQL single-writer is the safety; UNIQUE constraint is the guard):**

In `public-hosting.remote.ts` and any other path that INSERTs into `hosting_inquiry`:

```ts
await db.insert(table.hostingInquiry).values({
  id,
  tenantId,
  orderNumber: sql`(SELECT COALESCE(MAX(order_number), 0) + 1 FROM hosting_inquiry WHERE tenant_id = ${tenantId})`,
  // ...
});
```

The subquery is evaluated by libSQL inside the same write txn — single-writer serialization guarantees no two concurrent inserts produce the same value. The UNIQUE `(tenant_id, order_number)` index is the last-line guard (if it ever trips, the second INSERT errors and the caller retries).

Display helper (single source of truth):
```ts
// app/src/lib/utils/hosting-order-id.ts
export function displayOrderId(orderNumber: number | null, fallbackId: string): string {
  if (orderNumber == null) return 'OTS-' + fallbackId.slice(0, 5).toUpperCase();
  return 'OTS-' + String(orderNumber).padStart(5, '0');
}
```

The fallback path handles edge cases where backfill hasn't run yet (defensive — should never appear in production after backfill).

**Reserved namespace:** `order_number` is for INTERNAL tracking only. Keez legal invoice numbers (RON-2026-NNNNNN, monotonic, no gaps) stay independent. Spec must be loud about this.

### 2. `hosting_inquiry_item` table

Replaces synthesized TVA breakdown with real per-line items. Order one-shot for now (hosting + optional domain), but the table is the right shape for future SSL/backup addons.

**Schema (new table in `schema.ts`):**
```ts
export const hostingInquiryItem = sqliteTable(
  'hosting_inquiry_item',
  {
    id: text('id').primaryKey(),
    inquiryId: text('inquiry_id').notNull().references(() => hostingInquiry.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().references(() => tenant.id),
    kind: text('kind').notNull(), // 'hosting' | 'domain' | 'ssl' | 'backup' (future)
    label: text('label').notNull(), // 'Hosting Pro (anual)', 'Domeniu andreimarinescu.ro'
    // Reference to source object (nullable — domain is an arbitrary string today).
    hostingProductId: text('hosting_product_id').references(() => hostingProduct.id, { onDelete: 'set null' }),
    // Pricing snapshot (TTC at order time — immune to future product/TLD price changes).
    unitPriceCents: integer('unit_price_cents').notNull(), // TTC
    quantity: integer('quantity').notNull().default(1),
    vatRate: integer('vat_rate').notNull().default(19), // percent; 19 for RO standard
    // Domain-specific (nullable for non-domain items).
    domainName: text('domain_name'),
    domainMode: text('domain_mode'), // 'buy' | 'have' | 'transfer'
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`)
  },
  (t) => [
    index('hosting_inquiry_item_inquiry_idx').on(t.inquiryId),
    index('hosting_inquiry_item_tenant_idx').on(t.tenantId)
  ]
);
```

**Migration (one ALTER per file — Turso rule):**
- `app/drizzle/0373_hosting_inquiry_item_create.sql` — `CREATE TABLE hosting_inquiry_item (...)`
- `app/drizzle/0374_hosting_inquiry_item_inquiry_idx.sql` — index on `inquiry_id`
- `app/drizzle/0375_hosting_inquiry_item_tenant_idx.sql` — index on `tenant_id`

**Write path** — `public-hosting.remote.ts`:

After the existing `db.insert(table.hostingInquiry)`, in the same flow:

```ts
const items: typeof table.hostingInquiryItem.$inferInsert[] = [];

// 1. Hosting product line (always present)
if (data.hostingProductId && product) {
  items.push({
    id: generateId(),
    inquiryId: id,
    tenantId,
    kind: 'hosting',
    label: `${product.name} (${product.billingCycle === 'yearly' ? 'anual' : 'lunar'})`,
    hostingProductId: product.id,
    unitPriceCents: product.price,
    quantity: 1,
    vatRate: 19
  });
}

// 2. Domain line (only if buy/transfer with a price)
if (data.domainName && data.domainMode === 'buy' && data.domainCostCents != null) {
  items.push({
    id: generateId(),
    inquiryId: id,
    tenantId,
    kind: 'domain',
    label: `Domeniu ${data.domainName}`,
    unitPriceCents: data.domainCostCents,
    quantity: 1,
    vatRate: 19,
    domainName: data.domainName,
    domainMode: data.domainMode
  });
} else if (data.domainName && (data.domainMode === 'have' || data.domainMode === 'transfer')) {
  // Record the domain mode for audit but with 0 price.
  items.push({
    id: generateId(),
    inquiryId: id,
    tenantId,
    kind: 'domain',
    label: `Domeniu ${data.domainName} (${data.domainMode === 'have' ? 'existent' : 'transfer'})`,
    unitPriceCents: 0,
    quantity: 1,
    vatRate: 19,
    domainName: data.domainName,
    domainMode: data.domainMode
  });
}

if (items.length) await db.insert(table.hostingInquiryItem).values(items);
```

**`OrderSchema` additions in `public-hosting.remote.ts`:**
```ts
domainName: v.optional(v.pipe(v.string(), v.maxLength(253))),
domainMode: v.optional(v.picklist(['buy', 'have', 'transfer'])),
domainCostCents: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
```

**`hosting-checkout-modal.svelte` submit payload** — pass through what the modal already has (`domainName + domainTld`, `domainMode`, `tldPrice`):
```ts
domainName: domainName + domainTld,
domainMode,
domainCostCents: domainMode === 'buy' ? tldPrice * 100 : 0,
```

### 3. `getHostingOrders` query — return items

Add a parallel `hostingInquiryItem` fetch grouped by `inquiryId`, attach as `items` to each `HostingOrderRow`.

```ts
export type HostingOrderItemRow = {
  id: string;
  kind: string;
  label: string;
  unitPriceCents: number;
  quantity: number;
  vatRate: number;
  domainName: string | null;
  domainMode: string | null;
};

export type HostingOrderRow = {
  // ... existing fields ...
  orderNumber: number | null;
  items: HostingOrderItemRow[];
};
```

Implementation: after the main `select(...).from(hostingInquiry)...`, do:
```ts
const inquiryIds = rows.map((r) => r.id);
const items = inquiryIds.length
  ? await db.select({...}).from(table.hostingInquiryItem)
      .where(and(eq(table.hostingInquiryItem.tenantId, tenantId), inArray(table.hostingInquiryItem.inquiryId, inquiryIds)))
  : [];
const byInquiry = new Map<string, HostingOrderItemRow[]>();
for (const it of items) {
  const arr = byInquiry.get(it.inquiryId) ?? [];
  arr.push({ id: it.id, kind: it.kind, label: it.label, unitPriceCents: it.unitPriceCents, quantity: it.quantity, vatRate: it.vatRate, domainName: it.domainName, domainMode: it.domainMode });
  byInquiry.set(it.inquiryId, arr);
}
return rows.map((r) => ({ ...r, items: byInquiry.get(r.id) ?? [] }));
```

### 4. Backfill — `scripts/backfill-hosting-order-numbers-and-items.ts`

Why a script, not a SQL migration: per Gemini review — explicit per-tenant grouping, tie-breaking on `created_at`, transaction wrap, verifiable.

```ts
// scripts/backfill-hosting-order-numbers-and-items.ts
// Run via: bun run scripts/backfill-hosting-order-numbers-and-items.ts
// Idempotent: skips rows that already have order_number / items.

await db.transaction(async (tx) => {
  // 1. Order numbers — group by tenant, order by created_at ASC, assign 1..N
  const tenantsWithMissing = await tx.select({ tenantId: hostingInquiry.tenantId })
    .from(hostingInquiry).where(isNull(hostingInquiry.orderNumber))
    .groupBy(hostingInquiry.tenantId);

  for (const { tenantId } of tenantsWithMissing) {
    const rows = await tx.select({ id: hostingInquiry.id })
      .from(hostingInquiry)
      .where(and(eq(hostingInquiry.tenantId, tenantId), isNull(hostingInquiry.orderNumber)))
      .orderBy(hostingInquiry.createdAt);
    // Find current MAX (in case some rows already have numbers).
    const [{ maxN }] = await tx.select({ maxN: sql<number>`COALESCE(MAX(order_number), 0)` })
      .from(hostingInquiry).where(eq(hostingInquiry.tenantId, tenantId));
    let n = maxN;
    for (const row of rows) {
      n += 1;
      await tx.update(hostingInquiry).set({ orderNumber: n }).where(eq(hostingInquiry.id, row.id));
    }
  }

  // 2. Synthesize one 'hosting' item per inquiry that has no items yet.
  const missingItems = await tx.select({
    id: hostingInquiry.id,
    tenantId: hostingInquiry.tenantId,
    productId: hostingInquiry.hostingProductId,
    productName: hostingProduct.name,
    productPrice: hostingProduct.price,
    productCycle: hostingProduct.billingCycle
  }).from(hostingInquiry)
    .leftJoin(hostingProduct, eq(hostingInquiry.hostingProductId, hostingProduct.id))
    .where(notExists(
      tx.select().from(hostingInquiryItem).where(eq(hostingInquiryItem.inquiryId, hostingInquiry.id))
    ));

  for (const r of missingItems) {
    if (!r.productPrice || !r.productName) continue; // skip orphaned inquiries
    await tx.insert(hostingInquiryItem).values({
      id: generateId(),
      inquiryId: r.id,
      tenantId: r.tenantId,
      kind: 'hosting',
      label: `${r.productName} (${r.productCycle === 'yearly' ? 'anual' : 'lunar'})`,
      hostingProductId: r.productId,
      unitPriceCents: r.productPrice,
      quantity: 1,
      vatRate: 19
    });
  }
});
```

Run order: deploy schema → run backfill script → deploy code that depends on the columns being populated.

---

## Visual system

All new tokens prefixed `--hod-*` (hosting orders design) to avoid bleeding into other `hst-*` pages.

```css
--hod-bg: #ffffff;
--hod-bg-soft: #f9fafb;
--hod-border: #e5e7eb;
--hod-border-strong: #d1d5db;
--hod-text: #111827;
--hod-text-muted: #6b7280;
--hod-text-faint: #9ca3af;
--hod-accent: #2563eb;
--hod-accent-soft: rgba(37, 99, 235, 0.08);
--hod-ok: #10b981;
--hod-warn: #f59e0b;
--hod-bad: #ef4444;
--hod-radius: 8px;
--hod-radius-sm: 6px;
```

Typography:
- Section label: 11px, uppercase, tracking 0.06em, color `--hod-text-faint`, weight 600.
- Field label inside box: 10px, uppercase, tracking 0.04em, color `--hod-text-faint`, weight 600.
- Field value: 14px, weight 500, color `--hod-text`. Monospace for `code` values (server names, IPs, references).
- Total: 22px, weight 700, color `--hod-accent`.

Inputs/values look-and-feel:
- Read-only "input box": `padding: 12px 14px 10px`, border 1px solid `--hod-border`, radius `--hod-radius-sm`, white background. Label sits inside the box at top in faint micro-caps; value below in body type.
- Two-column grid for sections: `grid-template-columns: 1fr 1fr; gap: 12px`. Single-column for full-width fields (line items, history).

---

## Components

### Order display ID

Single source of truth in `app/src/lib/utils/hosting-order-id.ts`:

```ts
export function displayOrderId(orderNumber: number | null, fallbackId: string): string {
  if (orderNumber == null) return 'OTS-' + fallbackId.slice(0, 5).toUpperCase();
  return 'OTS-' + String(orderNumber).padStart(5, '0');
}
```

Used everywhere the ID is shown (list row, drawer header, mailto subject, audit log lines). Fallback path covers the brief window between schema deploy and backfill completion.

### KPI strip

5 tiles, left vertical color stripe + icon top-right + delta optional.

```
COMENZI TOTAL · 17 · +3 azi · 3 ieri
REVENUE ACHITAT · 7.66k RON · +13.8% · vs luna trecută
PLĂȚI ÎN AȘTEPTARE · 975 RON · 3 comenzi pending
PLĂȚI EȘUATE · 545 RON · 2 comenzi de recuperat
FĂRĂ CONT DA · N · plătite, neaprovizionate
```

Delta calc: `(this_month_revenue - last_month_revenue) / last_month_revenue * 100`, computed from `orders` already loaded — no extra query.

### Tabs row

Above the table:
```
[Toate (17)] [Activitate (N)] [În așteptare (3)] [Eșuate (2)] [Refundate (1)]
```

Each tab toggles a derived filter, replacing the current `payment` chips. "Activitate" = orders touched today (createdAt today OR paidAt today OR acceptedAt today).

### Filter chips row

Below tabs, inline:
```
[🔍 search] [📦 Pachet ▾] [💳 Metodă ▾] [📅 Perioadă ▾] [📆 Data ▾]
```

`Pachet` and `Metodă` open small popovers with checkboxes. `Perioadă` and `Data` are date-range pickers. (V1: only `Pachet` and `Metodă` functional with simple `<select>`; `Perioadă`/`Data` are visible but disabled with `title="În curând"`.)

### Table

Columns: COMANDĂ · CLIENT · PACHET · COMENZI (count from same client) · METODĂ · SUMĂ · STATUS.

Row layout:
- COMANDĂ: `OTS-XXXXX` (bold) over `azi, HH:MM` (faint) over `📄 /pachete-hosting` (faint mono).
- CLIENT: contact name over email muted.
- PACHET: name + small badge (chip) Pro/Standard/Premium/Extreme + period (anual/lunar).
- METODĂ: icon + last-4 (e.g. `💳 Card ••••4218`).
- SUMĂ: amount over `incl. TVA NN` muted.
- STATUS: pill.

Whole row clickable to open drawer.

### Drawer

Width 580px max, padding 24px, scrollable body + sticky footer action bar.

Structure:

```
┌─ Drawer header ───────────────────────────────┐
│ [icon] OTS-XXXXX                  [● STATUS]  │
│        azi, HH:MM · de pe /pachete-hosting    │
│                                       [X]     │
├───────────────────────────────────────────────┤
│ [red banner — only if payment failed]         │
│  ⚠ Plata a eșuat · Card refuzat · cod 51      │
│                                  [↻ Retry]    │
├───────────────────────────────────────────────┤
│ CLIENT                                        │
│ ┌──────────────┐ ┌──────────────┐             │
│ │ NUME         │ │ EMAIL        │             │
│ │ Andrei M.    │ │ andrei@...   │             │
│ └──────────────┘ └──────────────┘             │
│ ┌──────────────┐ ┌──────────────┐             │
│ │ TIP          │ │ CUI*         │             │
│ │ Pers. fizică │ │ R...         │             │
│ └──────────────┘ └──────────────┘             │
│                                               │
│ DETALII COMANDĂ                               │
│ ┌──────────────┐ ┌──────────────┐             │
│ │ PACHET       │ │ FACTURARE    │             │
│ │ Hosting Pro  │ │ Anual        │             │
│ └──────────────┘ └──────────────┘             │
│ ┌──────────────┐ ┌──────────────┐             │
│ │ DOMENIU      │ │ MOD DOMENIU  │             │
│ │ andrei.ro    │ │ Cumpărat nou │             │
│ └──────────────┘ └──────────────┘             │
│ ┌──────────────┐ ┌──────────────┐             │
│ │ SERVER       │ │ STATUS CONT  │             │
│ │ da-fra01     │ │ [● Activ]    │             │
│ └──────────────┘ └──────────────┘             │
│                                               │
│ PLATĂ                                         │
│ ┌──────────────┐ ┌──────────────┐             │
│ │ METODĂ       │ │ STATUS       │             │
│ │ Card ••4218  │ │ [● ACHITAT]  │             │
│ └──────────────┘ └──────────────┘             │
│ ┌──── Line items ────────────────┐            │
│ │ Hosting Pro (anual)    390 RON │            │
│ │ TVA 19%                 74 RON │            │
│ │ ───────────────────────────── │            │
│ │ Total achitat         464 RON │            │
│ └────────────────────────────────┘            │
│                                               │
│ ISTORIC                                       │
│ ● Comandă plasată                             │
│   azi, 14:32 · de pe /pachete-hosting         │
│ ● Plată confirmată                            │
│   azi, 14:32 · Card ••••4218 · 464 RON        │
│ ● Cont în provisionare                        │
│   în curs · Server auto-alocat                │
│                                               │
├──── Sticky footer ────────────────────────────┤
│ [Factură] [Refund] [Email] [⚡ Provisionare]   │
└───────────────────────────────────────────────┘
```

**Field sources (data ↔ UI):**

| UI field | Source |
|---|---|
| OTS-XXXXX | `displayOrderId(o.orderNumber, o.id)` |
| Header date | `fmtRelative(o.createdAt)` + `, ` + `fmtTime(o.createdAt)` |
| Header source | `'/' + o.source` |
| CLIENT > NUME | `o.contactName` |
| CLIENT > EMAIL | `o.contactEmail` |
| CLIENT > TIP | `o.companyName ? 'Persoană juridică' : 'Persoană fizică'` |
| CLIENT > CUI | `o.vatNumber` (hidden if persoana fizică) |
| PACHET | `o.productName` (or first item with `kind === 'hosting'`) |
| FACTURARE | derived from `o.productBillingCycle` (Lunar / Anual) |
| DOMENIU | `domainItem.domainName` (`o.items.find(i => i.kind === 'domain')`) — falls back to `o.requestedDomain` for old rows |
| MOD DOMENIU | `domainItem.domainMode` mapped to Romanian: `buy → Cumpărat nou`, `transfer → Transfer`, `have → Existent` — hidden if no domain item |
| SERVER | `daServerName` from `getDAServer(o.productDaServerId)` lookup if provisioned else `'Auto-alocare în curs'` if paid else `'—'`. |
| STATUS CONT | derived: `hostingAccountId` → `Activ`; `paymentStatus === 'paid' && !hostingAccountId` → `Se creează`; `paymentStatus === 'failed'` → `Anulat`; else `Așteaptă plată` |
| METODĂ | `methodLabel(o.paymentMethod)`. Card last-4 NOT shown (not persisted — Stripe sends only `pi_id` in `paymentReference`, no card metadata). Mockups show `Card ••••4218` but our V1 shows just `Card`. |
| STATUS | `paymentLabel(o.paymentStatus)` |
| Line items | `o.items` — one row per item with `label`, `unitPriceCents * quantity`. Skip zero-price `kind === 'domain'` lines (have/transfer cases) to avoid showing `Domeniu X — 0 RON`. |
| Line: TVA | computed: `sum(items.unitPriceCents * quantity * vatRate / (100 + vatRate))` — handles mixed VAT rates correctly even though today all items are 19% |
| Line: Total | `paidAmountCents ?? sum(items.unitPriceCents * quantity)` (paid amount if Stripe-confirmed, else expected from items) |
| ISTORIC entries | computed from timestamps (see below) |

**History entries (derived, no schema work):**

```ts
function buildHistory(o: HostingOrderRow): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  out.push({ kind: 'placed', at: o.createdAt, label: 'Comandă plasată', meta: `de pe /${o.source}` });
  if (o.paymentStatus === 'paid') {
    out.push({ kind: 'paid', at: o.paidAt ?? o.acceptedAt ?? o.createdAt, label: 'Plată confirmată',
               meta: `${methodLabel(o.paymentMethod)} · ${fmtMoney(o.paidAmountCents, o.productCurrency)}` });
  }
  if (o.paymentStatus === 'failed') {
    out.push({ kind: 'failed', at: o.createdAt, label: 'Plată eșuată',
               meta: 'Card refuzat de bancă' /* no error_code in schema yet — generic copy */ });
  }
  if (o.hostingAccountId && o.daUsername) {
    out.push({ kind: 'provisioned', at: o.paidAt ?? o.createdAt, label: 'Cont DirectAdmin creat',
               meta: `Server ${daServerName} · credențiale trimise pe ${o.contactEmail}` });
  } else if (o.paymentStatus === 'paid' && !o.hostingAccountId) {
    out.push({ kind: 'provisioning', at: o.paidAt ?? o.createdAt, label: 'Cont în provisionare',
               meta: 'în curs · Server auto-alocat · credențiale în max 5 minute' });
  }
  return out;
}
```

### Footer action bar

Sticky at drawer bottom, `border-top: 1px solid --hod-border`, padding 14px 20px, flex with gap.

Buttons by state:

| State | Buttons |
|---|---|
| `paymentStatus === 'pending'` | [✓ Marchează plătit] [Email client] |
| `paymentStatus === 'failed'` | [Email client] (Retry is in the red banner above) |
| `paymentStatus === 'paid' && !hostingAccountId` | [Factură fiscală] [Refund (placeholder)] [Email client] [⚡ Forțează provisionare] |
| `paymentStatus === 'paid' && hostingAccountId` | [Factură fiscală] [Refund (placeholder)] [Email client] [↗ Vezi cont] |

Action bindings:
- **Factură fiscală** → `<a href="/{tenant}/invoices?clientEmail={o.contactEmail}">`.
- **Refund** → `onclick={() => toast.info('Refund prin Stripe — în curând')}`.
- **Email client** → `<a href="mailto:{o.contactEmail}?subject=Comanda OTS-XXXXX">`.
- **Forțează provisionare** → existing `openProvisionForm(o)` + scroll-to-form. The provisioning form (server/username/domain/password) renders below the action bar within the drawer when open.
- **Vezi cont** → `<a href="/{tenant}/hosting/accounts/{o.hostingAccountId}">`.
- **Marchează plătit** → existing `openAcceptDialog(o)`.

### Accept-payment subform (in drawer body, above sections, when triggered)

Method tabs replace `<select>`:
```
[ Card (offline / POS) ] [ Transfer bancar / OP ] [ Cash ]
```

Map to existing `acceptMethod`:
- "Card (offline / POS)" → `'card'`
- "Transfer bancar / OP" → `'op'`
- "Cash" → `'other'`

Fields below (Sumă, ID tranzacție conditional label, Notă, Provisioning checkbox) reuse existing state + submitAccept. Footer in this mode: [Anulează] [Confirmă].

### Red error banner (only when payment failed)

```
┌─ red banner ─────────────────────────────────┐
│ ⚠  Plata a eșuat                  [↻ Retry]  │
│    Card refuzat de bancă · cod 51            │
└──────────────────────────────────────────────┘
```

Background `rgba(239,68,68,0.08)`, border 1px `--hod-bad`, color `--hod-bad`, text `--hod-text`. Retry opens accept-dialog.

---

## What stays from current implementation

- All remote function calls untouched (`getHostingOrders`, `acceptHostingOrderPayment`, `provisionFromInquiry`, `updateHostingInquiryStatus`, `deleteHostingInquiry`).
- All helpers: `fmtDate`, `fmtRelative`, `fmtMoney`, `paymentLabel`, `methodLabel`, `methodIcon`, `applyFilters`, `counts`, `exportCsv`.
- Focus trap on drawer.
- Provisioning form state (`provServerId`, `provPackageId`, etc.) — reused for "Forțează provisionare" action.
- `getDAServers` / `getDAServer` lookups — already imported, used to resolve SERVER label.
- Accept dialog state (`acceptOpen`, `acceptAmount`, `acceptRef`, `acceptNote`, `acceptMethod`, `acceptProvision`) — same handlers, different shell (tabs instead of select).

## What's removed

- `hst-order-grid` card view + `view` toggle (`grid` | `table`) — design only has table view.
- `hst-pipeline` 3-step indicator on cards — replaced by ISTORIC timeline in drawer.
- KPI tile with icon-background style — replaced by left-stripe + delta KPI.
- `hst-filter-chip` row for payment statuses — replaced by tabs at top.

---

## Test plan

Schema + backfill + UI — combined verification:

**Schema/backfill (one-time, pre-deploy):**

1. Run migrations 0371–0375 on dev DB — verify `PRAGMA table_info(hosting_inquiry)` shows `order_number INTEGER`, `PRAGMA table_info(hosting_inquiry_item)` matches schema, and `PRAGMA index_list('hosting_inquiry')` includes `hosting_inquiry_tenant_order_idx UNIQUE`.
2. Run `bun run scripts/backfill-hosting-order-numbers-and-items.ts` on dev DB.
3. Confirm `SELECT COUNT(*) FROM hosting_inquiry WHERE order_number IS NULL` returns `0`.
4. Confirm `SELECT inquiry_id, COUNT(*) FROM hosting_inquiry_item GROUP BY inquiry_id` shows at least 1 row per non-orphaned inquiry.
5. Re-run backfill script — confirm zero changes (idempotent).
6. Submit a NEW order via `/pachete-hosting` — confirm new inquiry has `order_number = (max + 1)` and items rows match cart contents.

**Concurrency check (single test, not a load test):**
7. Open 3 browser tabs on `/pachete-hosting`, click "Comandă" simultaneously across them with different domains. Confirm all 3 inquiries land with distinct `order_number` values, none missing, none duplicated.

**UI — manual verification on `bun run dev`:**
8. List renders all orders with `OTS-XXXXX` column, new layout.
9. Tabs filter correctly (Toate / Activitate / În așteptare / Eșuate / Refundate counts match).
10. Click row → drawer opens with correct state shape (paid/pending/failed × with/without DA).
11. Drawer line items match `o.items` exactly (hosting + optional domain, no synthetic rows for old orders that have only a hosting item).
12. Drawer ISTORIC entries match each state.
13. Footer action bar shows correct buttons per state.
14. Accept-payment subform opens with method tabs, submits successfully, drawer refreshes.
15. "Forțează provisionare" scrolls to existing provisioning form.
16. "Email client" mailto link composes properly with `Comanda OTS-XXXXX` in subject.
17. "Factură fiscală" navigates to invoices filtered by email.
18. Red banner appears only on failed payments.
19. "Refund" toast shows "Funcție în curând" — no actual API call.
20. Empty state still renders.
21. CSV export uses new `OTS-XXXXX` ID column.
22. Mobile (375px width): drawer becomes full-screen sheet, two-column field grid stacks to single column.
23. `cd app && bunx svelte-check --threshold warning` → no new errors in modified files.
24. `cd app && bun run test 2>&1 | tail -30` → existing tests pass (no regressions in webhook handlers, post-payment dispatcher).

## Out of scope (deferred to future iterations)

- Real refund flow (Stripe API + Keez credit note). The webhook handler keeps updating `invoice.status='refunded'` independently when external refunds occur.
- Direct inquiry ↔ invoice link (currently uses email search on the "Factură fiscală" button).
- Failed-payment error code persistence (currently generic "Card refuzat" copy in history timeline).
- Filter popovers for `Pachet` and `Metodă` (V1 uses simple selects).
- `Perioadă` and `Data` filters (V1 disabled placeholders).
- `hosting_inquiry_audit` / status history table for tracking manual overrides and retry attempts (Gemini-flagged future work).
- Addons beyond hosting + domain (SSL paid, backups paid). Schema is now ready (`hostingInquiryItem.kind`), wiring is future work.
