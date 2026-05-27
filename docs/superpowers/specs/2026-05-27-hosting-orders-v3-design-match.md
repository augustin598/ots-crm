# Hosting Orders v3 — pixel-parity with canonical design

**Source design:** `/tmp/design-target/create-campaign-ads/project/Hosting Orders.html` (Anthropic-hosted artifact archive, 1140 lines, downloaded from `api.anthropic.com/v1/design/h/WtlDmrGcg0NZDuuCkaVASw`).

**Goal:** Bring `/[tenant]/hosting/inquiries` into exact visual + functional parity with the canonical design. Replace the home-grown `--hod-*` token system from v1 with the project's existing `hst-*` design language (already in use on `/hosting/products`, `/hosting/servers`). Add the missing data points the design surfaces (card last-4, decline reason, plan color, processing state) so the UI reflects real persisted facts.

## What changes

### Visual system — replace `--hod-*` with shared `hst-*`

- Drop all `--hod-*` tokens. Adopt the `hst-*` class set from the design archive's `hosting-styles.css`, embedded page-scoped in `+page.svelte` (matching how `/hosting/products` and `/hosting/servers` carry their copy of the styles).
- Add order-specific extras inline: `ord-pay-badge`, `ord-acc-badge`, `ord-method-tile`, `ord-source-pill`, `ord-detail-timeline`, `ord-totals`, `ord-mo-*` (manual order modal), `ord-confirm-*` (confirm payment panel), `ord-date-pop-*` (date filter popover).
- Drawer width 640px (was 580px), header icon takes the plan color as gradient (`linear-gradient(135deg, var(--planColor), var(--planColor)cc)`).

### Schema additions (4 columns, 1 new value-set entry)

1. `hosting_product.color TEXT` — hex color (`#1877F2` default for new rows, backfill existing rows with the design map: Standard `#64748b`, Pro `#1877F2`, Premium `#0d5cc7`, Extreme `#7c3aed`).
2. `hosting_inquiry.card_last4 TEXT` — populated at webhook time from `charge.payment_method_details.card.last4`.
3. `hosting_inquiry.payment_error_code TEXT` — Stripe `last_payment_error.code` or `.decline_code`.
4. `hosting_inquiry.payment_error_message TEXT` — humanized Romanian message via lookup table; falls back to raw Stripe `error.message`.
5. `payment_status` keeps its TEXT column (no schema change), but adds `'processing'` to the application-level enum. Existing rows untouched.

All migrations are one-statement files (Turso constraint). Journal append.

### Backend changes

#### `db/schema.ts`
- 4 new columns added to `hostingProduct` (`color`) and `hostingInquiry` (`card_last4`, `payment_error_code`, `payment_error_message`).

#### Webhook handlers (`server/stripe/webhook-handlers.ts`)
- `handlePaymentIntentSucceeded`: extract `charge.payment_method_details.card.last4` (when card payment) and set `card_last4`.
- `handlePaymentIntentFailed` and `handlePaymentFailed`: read `last_payment_error.code` (+ `.decline_code` if present) and `.message`, set `payment_error_code` and `payment_error_message`. Translate via `lib/server/stripe/decline-codes.ts` (new) to Romanian for the most common codes; fall back to raw English message otherwise.

#### New utility: `lib/server/stripe/decline-codes.ts`
- Exports `translateDeclineCode(code, fallbackMessage): string`. Covers ~15 most common codes (`insufficient_funds`, `card_declined`, `expired_card`, `incorrect_cvc`, `processing_error`, `authentication_required`, `card_velocity_exceeded`, `do_not_honor`, etc.).

#### `hosting-inquiries.remote.ts`
- Add `HostingOrderRow.cardLast4 / paymentErrorCode / paymentErrorMessage / productColor / productId` and select them in `getHostingOrders`.
- Add `createManualHostingOrder` command (admin-tenant-scoped, requires `admin.hosting.manage`). Reuses a shared private helper `insertHostingOrder(tenantId, params)` extracted from `public-hosting.remote.ts` (so both paths write identical row shapes — same `order_number` subquery, same items insert).

#### `public-hosting.remote.ts`
- Extract the insert flow (inquiry row + items) into a new private helper `insertHostingOrder(tenantId, params)` exported from a new module `lib/server/hosting/insert-order.ts`. Both `submitHostingOrder` and `createManualHostingOrder` call it.

#### Backfill script: `scripts/backfill-product-colors-and-card-last4.ts`
- Fills `hosting_product.color` for existing rows using a name→color map (Standard, Pro, Premium, Extreme; fall back to `#1877F2` for unknown names).
- For each paid inquiry with `paymentReference` (Stripe Pi id) and `cardLast4 IS NULL`, hit `stripe.paymentIntents.retrieve(pi_id, { expand: ['latest_charge'] })`, read `latest_charge.payment_method_details.card.last4`, persist.
- Idempotent (skip rows that already have the column set). Run order: schema migrations → backfill → deploy frontend.

### UI changes (single file `+page.svelte`)

**Hero:**
- Three buttons: `[Sync plăți]` (secondary, RefreshCw icon) · `[Export CSV]` (secondary) · `[+ Comandă manuală]` (primary blue, Plus icon).
- Sync plăți action: re-runs `getHostingOrders.refresh()` for now (placeholder for a future Stripe-sync — same as current Refresh).

**KPI strip (6 tiles, `dash-kpi` shape):**
| # | Label | Value | Sub | Delta |
|---|---|---|---|---|
| 1 | Comenzi total | `orders.length` | `N azi · N ieri` | `+N` (today vs prev period) |
| 2 | Revenue achitat | `paidThisMonth / 1000`k RON | `din N comenzi` | `+X.X%` (vs prev month) |
| 3 | Plăți în așteptare | `pending+processing amount` | `N comenzi pending` | — |
| 4 | Plăți eșuate | `failedAmount` | `N comenzi de recuperat` | — |
| 5 | Conversie plată | `paid/total %` | `paid / total` | `+Npp` (vs prev period) |
| 6 | Domenii noi | `count(items.kind='domain' && mode='buy')` | `cumpărate prin checkout` | — |

`dash-kpi` styles come from the design archive's `dashboard-styles.css` — copy the rule block page-scoped.

**Tabs (5):** `Toate · Achitate · În așteptare · Eșuate · Refundate`. "În așteptare" tab includes both `pending` and `processing`. Each has a count pill.

**Filter chips (with X close icon when active):**
- `Search` input (id/client/email/domain)
- `Pachet` chip → opens select-like dropdown (placeholder behavior: cycles top-3 plans per click for V3, simple)
- `Metodă` chip → same pattern (card / op / paypal / revolut / cash)
- `Perioadă` chip → toggles yearly/monthly/all
- `Data` chip with popover: Tot intervalul / Azi / Ieri / Ultimele 7 zile / Ultimele 30 zile (each row shows count)

**Table — 8 columns:**
1. `Comandă` — `OTS-XXXXX` mono bold + relative date + globe-icon source pill `/source`
2. `Client` — name bold + email + CUI (mono, if `type=company`)
3. `Pachet · Domeniu` — color dot (from `productColor`) + plan name + period; domain mono on next line; subtitle "+ N RON domeniu nou" / "transfer gratuit" / "domeniu existent" per item.mode
4. `Metodă` — `MethodChip`: icon + label + last-4 (only when `card` and `cardLast4` present)
5. `Sumă` (num right) — total + "incl. TVA N"
6. `Status plată` — `ord-pay-badge` with dot; below: red error excerpt for failed (`failReason.slice(0,40)…`) OR mono proforma `invoiceNo` for pending
7. `Status cont` — `ord-acc-badge` (active / provisioning / awaiting-payment / cancelled)
8. Actions (right, 120px) — icon buttons stop-propagation; mix by status:
   - `pending` → [Detalii] [Marchează plătit] [Email]
   - `failed` → [Detalii] [Retry plată] [Email]
   - `paid` → [Detalii] [Factură (Download)] [Email]
   - `refunded` → [Detalii] [Email]
   - `processing` → [Detalii] [Email]

**Drawer (640px):**
- Header: plan-colored icon + `OTS-XXXXX` mono + relative date + `/source` (blue link) + `PayBadge` pill + close.
- Body sections:
  - If `payment === 'failed'`: red banner `⚠ Plata a eșuat · <failReason>` + Retry button (red).
  - If `payment === 'pending'` && `!confirmOpen`: yellow banner `⏱ Așteptăm plata prin <method>` · `Factură proforma <invoiceNo> · contul se activează după confirmarea încasării` + [Re-trimite] + [Confirmă încasarea] (primary).
  - If `payment === 'pending'` && `confirmOpen`: `ConfirmPaymentPanel` (3-method grid: Card POS / Transfer / Cash · amount RON · tx-id · note · provisioning checkbox · Anulează | Confirmă).
  - `Client` section (Nume / Email / Tip / CUI?) — `hst-kv-grid`.
  - `Detalii comandă` (Pachet plan-colored / Facturare / Domeniu mono / Mod domeniu / Server mono / Status cont).
  - `Plată` (Metodă MethodChip + Status PayBadge + Factură proforma) + `ord-totals` box (line per item, TVA 19%, Total albastru mare).
  - `Istoric` — `ord-detail-timeline` with colored dots; entries depend on state (placed → paid/failed/processing/refunded → provisioning → active).
- Footer: state-conditional buttons (Factură fiscală / Marchează plătit / Refund (red text) / Email client) + flex spacer + (Vezi cont primary if active, Forțează provisionare primary if provisioning).

**Manual Order Modal (`ord-mo-*`):**
- Triggered by `[+ Comandă manuală]` button.
- 720px wide modal with header (Plus icon gradient, title + sub), body sections (Client type segmented · Nume + Email + CUI? · Pachet 4-card grid colored · Facturare segmented · Domeniu name+mode · Plată method+initial status · Server select), live summary box at the bottom, footer with [Anulează] + [Creează comanda] (primary, disabled until valid).
- On submit → calls `createManualHostingOrder({...})` remote → toast → refresh list → close modal.

**Pagination:**
- Client-side, 10 rows/page.
- Footer `Afișează X din TOTAL comenzi` + prev / page 1..N / next.

**Toast system:** keep existing `svelte-sonner`. Map design's `pushToast({kind, title, body})` to `toast.success / .info / .warning(title, { description: body })`.

## Risks called out by Gemini review

1. **Provisioning idempotency** — manual confirm-payment must check for existing `hosting_account_id` before triggering DA provision. Already handled by existing `provisionDirectAdminAccount` (idempotent by tenant+client+session) — confirm in the new path too.
2. **`processing` state lock** — `Marchează plătit` button disabled for `processing` rows (PayPal/Revolut settle on their own via webhook).
3. **KPI performance** — current data set (~50 orders/tenant/month) is tiny; no index changes needed yet. Re-evaluate at >5k orders.
4. **Date filter counts** — computed client-side from already-loaded `orders` array (single pass over 5 presets). No backend call.

## Out of scope (deferred, not v3)

- Real Stripe refund flow. `Refund` stays a confirm-then-toast placeholder. Webhook still updates `payment_status='refunded'` independently.
- Editable date-range custom picker (only presets ship in v3).
- Dark mode theme tokens (the color field is hex; future themes can derive contrast at render time per Gemini suggestion).
- Persistent multi-select for Pachet/Metodă filters (V3 cycles single value per click).
- Editable column visibility / saved views.

## File touch list

**New:**
- `app/drizzle/0386_hosting_product_color.sql`
- `app/drizzle/0387_hosting_inquiry_card_last4.sql`
- `app/drizzle/0388_hosting_inquiry_payment_error_code.sql`
- `app/drizzle/0389_hosting_inquiry_payment_error_message.sql`
- `app/src/lib/server/stripe/decline-codes.ts`
- `app/src/lib/server/hosting/insert-order.ts`
- `app/scripts/backfill-product-colors-and-card-last4.ts`

**Modified:**
- `app/src/lib/server/db/schema.ts`
- `app/drizzle/meta/_journal.json`
- `app/src/lib/server/stripe/webhook-handlers.ts` (3 handlers)
- `app/src/lib/remotes/hosting-inquiries.remote.ts` (`HostingOrderRow` shape, new `createManualHostingOrder` command)
- `app/src/lib/remotes/public-hosting.remote.ts` (route inquiry+items inserts through the new shared helper)
- `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` (full rewrite — script + markup + styles)

## Verification

1. `bun run db:migrate` — 4 migrations applied.
2. `bun run scripts/backfill-product-colors-and-card-last4.ts` — colors filled (4 products), card_last4 backfilled from Stripe for paid orders that have `paymentReference` (Pi id).
3. `bun run dev` — boots clean; `/ots/hosting/inquiries` returns HTTP 200; visual matches design.
4. Submit new order via `/pachete-hosting` — appears with all new fields populated.
5. Trigger manual order via `+ Comandă manuală` — modal opens, validates, creates inquiry visible in list.
6. Click `pending` row → drawer opens with yellow banner + Confirmă încasarea button → click it → method tabs visible → submit → row moves to `paid`, provisioning starts.
7. `bunx svelte-check` → zero new errors. `mcp__plugin_svelte_svelte__svelte-autofixer` on `+page.svelte` → zero issues.
8. `bun test` → all passing (no regressions in webhook handlers or post-payment).
