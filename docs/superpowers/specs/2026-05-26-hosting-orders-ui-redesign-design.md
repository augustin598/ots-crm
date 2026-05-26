# Hosting Orders — UI redesign (May 2026 v2)

**Goal:** Replace the visual layer of `/[tenant]/hosting/inquiries` with the new "Comenzi hosting" design from the 4 reference screenshots. Data wiring, remote functions, schema, and payment/provisioning flow remain unchanged.

**Scope (boundaries):**
- Modify ONLY `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` (template + `<style>` + minor `<script>` derivations).
- No schema changes. No new migrations. No new remote functions.
- No backend behavior change. `acceptHostingOrderPayment`, `provisionFromInquiry`, `updateHostingInquiryStatus`, `deleteHostingInquiry` stay as-is.
- "Refund" is a placeholder button (toast — not implemented; out of scope).
- "Factură fiscală" links to `/[tenant]/invoices?clientEmail=<email>` (no direct inquiry→invoice join yet).
- Order display ID is `OTS-` + `id.slice(0, 5).toUpperCase()` (derived, not persisted).

---

## Reference (from screenshots)

The new design has 4 anchor states:

1. **List view** (Comenzi hosting): hero + KPI strip + tabs (Toate / În așteptare / Eșuate / Refundate) + filter chips + table with order id column + drawer-on-click.
2. **Drawer — ACHITAT, provisioning în curs** (OTS-48217): green pill, sections CLIENT / DETALII COMANDĂ / PLATĂ / ISTORIC, line items box, footer actions [Factură fiscală] [Refund] [Email client] [⚡ Forțează provisionare].
3. **Drawer — IN AȘTEPTARE + confirm-payment subform** (OTS-48216): yellow pill, inline form with method tabs (Card POS / Transfer bancar / Cash), sumă, ID tranzacție, notă, provisioning checkbox, footer [Marchează plătit] [Email client].
4. **Drawer — EȘUAT** (OTS-48213): red pill, red alert bar at top with retry, all sections present, footer only [Email client].
5. **Drawer — ACHITAT cu cont DA activ** (OTS-48214): footer adds [Vezi cont].

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

Helper in `<script>`:

```ts
function displayOrderId(id: string): string {
  return 'OTS-' + id.slice(0, 5).toUpperCase();
}
```

Used everywhere the ID is shown (list row, drawer header).

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
| OTS-XXXXX | `displayOrderId(o.id)` |
| Header date | `fmtRelative(o.createdAt)` + `, ` + `fmtTime(o.createdAt)` |
| Header source | `'/' + o.source` |
| CLIENT > NUME | `o.contactName` |
| CLIENT > EMAIL | `o.contactEmail` |
| CLIENT > TIP | `o.companyName ? 'Persoană juridică' : 'Persoană fizică'` |
| CLIENT > CUI | `o.vatNumber` (hidden if persoana fizică) |
| PACHET | `o.productName` |
| FACTURARE | derived from `o.productBillingCycle` (Lunar / Anual) |
| DOMENIU | `o.requestedDomain` |
| MOD DOMENIU | `'Cumpărat nou'` (V1 default — no schema for this yet, hardcoded label until column added in future iteration) |
| SERVER | `daServerName` from `getDAServer(o.productDaServerId)` lookup if provisioned else `'Auto-alocare în curs'` if paid else `'—'`. Falls back to `'da-fra01'`-style label by using the server's `name` column. |
| STATUS CONT | derived: `hostingAccountId` → `Activ`; `paymentStatus === 'paid' && !hostingAccountId` → `Se creează`; `paymentStatus === 'failed'` → `Anulat`; else `Așteaptă plată` |
| METODĂ | `methodLabel(o.paymentMethod)`. Card last-4 NOT shown (not persisted — Stripe sends only `pi_id` in `paymentReference`, no card metadata). Mockups show `Card ••••4218` but our V1 shows just `Card`. |
| STATUS | `paymentLabel(o.paymentStatus)` |
| Line: pachet | `o.productName + ' (' + period + ')'` and `productPrice / 1.19` |
| Line: TVA | `productPrice - productPrice / 1.19` |
| Line: Total | `paidAmountCents ?? productPrice` |
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

UI-only — manual verification on `bun run dev`:

1. List renders all orders with new columns and table layout.
2. Tabs filter correctly (Toate / Activitate / În așteptare / Eșuate / Refundate counts match).
3. Click row → drawer opens with correct state shape (paid/pending/failed × with/without DA).
4. Drawer ISTORIC entries match each state.
5. Footer action bar shows correct buttons per state.
6. Accept-payment subform opens with method tabs, submits successfully, drawer refreshes.
7. "Forțează provisionare" scrolls to existing provisioning form.
8. "Email client" mailto link composes properly.
9. "Factură fiscală" navigates to invoices filtered by email.
10. Red banner appears only on failed payments.
11. Empty state still renders.
12. CSV export still works.
13. Mobile (375px width): drawer becomes full-screen sheet, two-column field grid stacks to single column.
14. `bunx svelte-check --threshold warning` → no new errors.

## Out of scope (deferred to future iterations)

- Real refund flow (Stripe API + Keez credit note).
- `domain_mode` column for "Cumpărat nou" vs "Transfer" vs "Existent" (currently hardcoded "Cumpărat nou").
- Direct inquiry ↔ invoice link (currently uses email search).
- Failed-payment error code persistence (currently generic "Card refuzat" copy).
- Sequential human-readable order number (`order_number` column).
- Filter popovers for `Pachet` and `Metodă` (V1 uses simple selects).
- `Perioadă` and `Data` filters (V1 disabled placeholders).
