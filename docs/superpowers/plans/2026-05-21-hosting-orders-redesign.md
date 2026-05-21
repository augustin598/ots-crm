# Hosting Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans — checklist tracked inline; this is being implemented in the current session.

**Goal:** Replace `/[tenant]/hosting/inquiries` with a proper "Comenzi hosting" admin page that surfaces every `pachete-hosting` order, exposes payment status (Stripe + Ordin de plată), lets staff manually accept OP payments, and re-triggers DirectAdmin provisioning when needed.

**Architecture:**
- Extend `hosting_inquiry` with explicit payment columns (`payment_method`, `payment_status`, `paid_at`, `paid_amount_cents`, `payment_reference`, `accepted_by_user_id`, `accepted_at`, `hosting_account_id`) — separates payment lifecycle from funnel status so an OP order can be "new" + "paid" simultaneously.
- Public `submitHostingOrder` writes `payment_method` directly (no more parsing notes). Stripe webhooks set `payment_status='paid'` + `paid_at` + `paid_amount_cents` + `payment_reference` (PI id) when the post-payment pipeline succeeds.
- New tenant remote functions for staff: `getHostingOrdersWithDetails`, `acceptHostingOrderPayment` (OP manual accept), `retryDaProvisioning` (re-runs `provisionDirectAdminAccount`).
- UI uses the established `hst-*` design language (`/hosting/servers`, `/hosting/products`) — hero + KPI strip + toolbar + grid/table + detail drawer.

**Tech Stack:** SvelteKit 5 runes, Drizzle ORM (Turso/libSQL), TypeScript, Stripe SDK, DirectAdmin client wrapper, existing `provisionDirectAdminAccount` + audit helpers.

---

### Task 1: Schema migration — new payment columns on hosting_inquiry

**Files:**
- Modify: `app/src/lib/server/db/schema.ts` (extend `hostingInquiry`)
- Create: `app/drizzle/0363_hosting_inquiry_payment.sql` (one ALTER per file is the Turso rule)
- Create: `app/drizzle/0364_hosting_inquiry_payment_status.sql`
- Create: `app/drizzle/0365_hosting_inquiry_paid_at.sql`
- Create: `app/drizzle/0366_hosting_inquiry_paid_amount.sql`
- Create: `app/drizzle/0367_hosting_inquiry_payment_reference.sql`
- Create: `app/drizzle/0368_hosting_inquiry_accepted_by.sql`
- Create: `app/drizzle/0369_hosting_inquiry_accepted_at.sql`
- Create: `app/drizzle/0370_hosting_inquiry_hosting_account.sql`
- Modify: `app/drizzle/meta/_journal.json` (append 8 entries)

**Schema diff (hostingInquiry):**
```ts
paymentMethod: text('payment_method'),                         // 'card' | 'op' | 'paypal' | 'revolut' | null
paymentStatus: text('payment_status').notNull().default('pending'), // 'pending' | 'paid' | 'failed' | 'refunded'
paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
paidAmountCents: integer('paid_amount_cents'),
paymentReference: text('payment_reference'),                   // PI id, bank ref, etc.
acceptedByUserId: text('accepted_by_user_id').references(() => user.id),
acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
hostingAccountId: text('hosting_account_id').references(() => hostingAccount.id, { onDelete: 'set null' }),
```

Steps:
- [ ] Add the 8 columns to `hostingInquiry` in `schema.ts`.
- [ ] Create 8 single-statement SQL migrations (`ALTER TABLE hosting_inquiry ADD COLUMN ...`). One file per column (Turso constraint).
- [ ] Append 8 entries to `_journal.json` with sequential `idx` from 363 to 370.
- [ ] Run `cd app && bun run db:migrate` and confirm `PRAGMA table_info(hosting_inquiry)` shows new columns.

### Task 2: Public submit captures payment_method explicitly

**Files:**
- Modify: `app/src/lib/remotes/public-hosting.remote.ts`

Add to `OrderSchema`:
```ts
paymentMethod: v.optional(v.picklist(['card', 'op', 'paypal', 'revolut']), 'card'),
```

When inserting `hosting_inquiry`, write `paymentMethod` and `paymentStatus` ('pending'). The existing `paymentMode` (`'checkout_redirect'|'payment_intent'`) stays — it controls the Stripe surface.

Steps:
- [ ] Extend OrderSchema with `paymentMethod`.
- [ ] Persist `paymentMethod` + `paymentStatus: 'pending'` in the inquiry insert.
- [ ] In the checkout-modal (`app/src/lib/components/hosting-checkout-modal.svelte`) submit call, pass `paymentMethod` alongside `paymentMode`.

### Task 3: Stripe webhooks set payment_status='paid'

**Files:**
- Modify: `app/src/lib/server/stripe/webhook-handlers.ts`
- Modify: `app/src/lib/server/stripe/post-payment/dispatcher.ts` (link hostingAccountId back on inquiry)

In `handleCheckoutSessionCompleted` and `handlePaymentIntentSucceeded`, when marking inquiry `status='converted'`, also set:
```ts
paymentStatus: 'paid',
paidAt: new Date(),
paidAmountCents: amount,
paymentReference: intent.id || session.id,
```
For PaymentIntent we already have `intent.amount`; for Checkout Session use `session.amount_total ?? null` (subscription mode may be null — leave null).

In `runPostPaymentSteps`, after `da_provision` succeeds with `payload.hostingAccountId`, update the inquiry row's `hostingAccountId` (idempotent — won't overwrite if already set).

In `handlePaymentFailed` and `handlePaymentIntentFailed`, when we already log error, also set `paymentStatus: 'failed'`.

Steps:
- [ ] Extend `handleCheckoutSessionCompleted` to set payment columns.
- [ ] Extend `handlePaymentIntentSucceeded` to set payment columns.
- [ ] Extend `handlePaymentFailed`/`handlePaymentIntentFailed` to set `payment_status='failed'`.
- [ ] After `da_provision` step success in dispatcher, UPDATE `hosting_inquiry.hosting_account_id`.

### Task 4: Admin remote functions for orders

**Files:**
- Modify: `app/src/lib/remotes/hosting-inquiries.remote.ts`

Add three new exports and extend `getHostingInquiries` → `getHostingOrders` (alias the old name for backwards compat or just add the new one; the page imports the new one):

```ts
export const getHostingOrders = query(async () => {
  // joined with hostingProduct, client, hostingAccount, post_payment_step rows
});

export const acceptHostingOrderPayment = command(
  v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    paymentMethod: v.picklist(['op', 'card', 'paypal', 'revolut', 'other']),
    paidAmountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
    paymentReference: v.optional(v.pipe(v.string(), v.maxLength(200))),
    note: v.optional(v.pipe(v.string(), v.maxLength(500))),
    triggerProvisioning: v.optional(v.boolean(), true)
  }),
  async (params) => {
    // 1. assertCan(actor, 'admin.hosting.manage')
    // 2. UPDATE hosting_inquiry SET payment_status='paid', paid_at=now, paid_amount_cents, payment_method, payment_reference, accepted_by_user_id, accepted_at, status='converted'
    // 3. UPDATE client status='active', onboardingStatus='active' (mirrors Stripe path)
    // 4. If triggerProvisioning && !hosting_account_id → call provisionDirectAdminAccount({ ... sessionId: `manual_${inquiryId}` })
    // 5. Return { provisioned, hostingAccountId, daUsername, domain } or { provisioned: false, reason }
  }
);

export const retryDaProvisioning = command(IdSchema, async (id) => {
  // 1. assertCan(actor, 'admin.hosting.manage')
  // 2. Load inquiry (tenant-scoped), assert payment_status==='paid'
  // 3. provisionDirectAdminAccount({ tenantId, clientId, productId, sessionId: paymentReference ?? `manual_${id}`, stripeSubscriptionId: null }) — already idempotent
  // 4. UPDATE hosting_inquiry.hosting_account_id
  // 5. Return result
});
```

Steps:
- [ ] Write `getHostingOrders` query joining inquiry × product × client × hostingAccount × postPaymentStep (grouped).
- [ ] Write `acceptHostingOrderPayment` command — payment accept + optional provisioning trigger.
- [ ] Write `retryDaProvisioning` command — admin-triggered re-provisioning for paid orders missing DA accounts.
- [ ] Keep the legacy `getHostingInquiries`/`updateHostingInquiryStatus`/`deleteHostingInquiry` exports (old callers).

### Task 5: Redesign /[tenant]/hosting/inquiries +page.svelte

**Files:**
- Modify: `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` (replace entirely)
- Reuse: `app/src/lib/actions/focus-trap.ts` (existing)

UI structure (hst-* design language):
- **Hero:** `<h1>Comenzi hosting</h1>` + subtitle counting active states + actions (Refresh, Export CSV).
- **KPI strip (6 tiles):** `Total comenzi`, `În așteptare plată`, `Plătite azi`, `Venit luna asta`, `Plăți eșuate`, `DA nereușite`.
- **Toolbar:** search (name/email/domain), funnel-status chips (`Toate`, `Plată în așteptare`, `Plătite`, `Convertite`, `Respinse`), payment-method chips (`Card`, `OP`, `Altă`), view toggle (cards/table).
- **Cards grid (`hst-server-grid` analog → `hst-order-grid`):** each card shows
  - status pill + payment status pill
  - contact name + product name + date
  - amount + currency
  - mini "pipeline" indicator: ●Plată ●Cont DA ●Email portal
  - actions: open drawer, mark paid (if pending OP), retry DA (if paid but unprovisioned)
- **Detail drawer (`hst-drawer`):** three sections
  1. **Date contact + firmă** (read-only)
  2. **Plată** — if Stripe → PI/session id + Stripe link; if OP/pending → "Confirmă plată" form (amount, reference, note, button)
  3. **Provisioning** — DA account info (username, domain, server) if provisioned; else "Provisioning failed" details + retry button.
  4. **Activitate** — post-payment steps + audit (read-only)

Reuse CSS from `/hosting/servers/+page.svelte` — copy the `hst-*` rules to keep visual coherence (the page-scoped styles need to be self-contained).

Steps:
- [ ] Write the script section with state + remote-function bindings.
- [ ] Write the markup (hero, KPI, toolbar, grid, drawer).
- [ ] Write `<style>` with hst-* rules.
- [ ] Hook up `acceptHostingOrderPayment` and `retryDaProvisioning` actions to refresh data afterwards via `getHostingOrders.refresh()` or `await refresh()`.
- [ ] Pass through svelte-autofixer.

### Task 6: Sidebar label (Comenzi instead of Cereri)

**Files:**
- Modify: `app/src/lib/components/ots-sidebar/OtsSidebar.svelte` (if the link label is hardcoded there) OR the sidebar config that lists `inquiries`.

Rename the link from "Cereri" to "Comenzi" in the hosting group. Keep the URL — `/hosting/inquiries` (changing the route is out of scope and would orphan deep links).

Steps:
- [ ] Find the inquiries sidebar entry: `grep -rn "/hosting/inquiries" app/src/lib/components/ots-sidebar/`
- [ ] Update label.

### Task 7: Verification

Steps:
- [ ] `cd app && bunx svelte-check --threshold warning 2>&1 | tail -30` — expect 0 new errors in the redesigned files.
- [ ] svelte-autofixer MCP on the new `+page.svelte`.
- [ ] Visual: open `http://localhost:5173/ots/hosting/inquiries` (after `bun run dev`) and confirm:
  - All orders render
  - Mark OP order as paid → DA account provisioned + appears in /hosting/accounts
  - Retry DA on a previously failed provision works
  - Empty state renders when no orders
- [ ] Run existing tests: `bun run test 2>&1 | tail -30` — expect no regressions.

### Task 8: Commit

```bash
cd /Users/augustin598/Projects/CRM
git add app/src/lib/server/db/schema.ts app/drizzle/0363_*.sql app/drizzle/0364_*.sql \
        app/drizzle/0365_*.sql app/drizzle/0366_*.sql app/drizzle/0367_*.sql \
        app/drizzle/0368_*.sql app/drizzle/0369_*.sql app/drizzle/0370_*.sql \
        app/drizzle/meta/_journal.json \
        app/src/lib/remotes/public-hosting.remote.ts \
        app/src/lib/remotes/hosting-inquiries.remote.ts \
        app/src/lib/server/stripe/webhook-handlers.ts \
        app/src/lib/server/stripe/post-payment/dispatcher.ts \
        app/src/lib/components/hosting-checkout-modal.svelte \
        app/src/routes/[tenant]/hosting/inquiries/+page.svelte \
        docs/superpowers/plans/2026-05-21-hosting-orders-redesign.md
git commit -m "feat(hosting-orders): redesign inquiries → orders + OP manual accept + DA retrigger"
git push
```

---

## Notes for the implementer

- **DON'T** invent a new provisioning path. `provisionDirectAdminAccount` in `provision-da.ts` is already idempotent (it checks `hostingAccount` by tenant+client+subscription). Just call it with `sessionId: \`manual_\${inquiryId}\`` for OP orders.
- **DO** keep `processed_stripe_event` + `post_payment_step` untouched. Our new manual flow writes ONLY to `hosting_inquiry`, `client`, `hosting_account` (via the existing helper).
- **DON'T** allow non-admin staff to call `acceptHostingOrderPayment` — gate it via `assertCan(actor, 'admin.hosting.manage')`.
- **DON'T** double-count revenue: the KPI tiles read off `hosting_inquiry.paid_amount_cents` which is now set by both Stripe webhooks AND manual accepts.
- **Currency:** `paid_amount_cents` is in the smallest currency unit. The product carries `currency` (RON default). Display `formatMoney(amountCents / 100, currency)`.

## Open scope decisions (already made)

- Page URL stays `/hosting/inquiries` (Romanian users may have bookmarks; sidebar label changes only).
- OP "accept" goes through the SAME `provisionDirectAdminAccount` as Stripe — no second code path.
- Failed Stripe payments stay reachable via the same UI — admin can retry DA provisioning after the customer settles externally.
- DM funnel status (`new`, `contacted`, `converted`, `discarded`, `abandoned`) untouched — only payment_status is new.
