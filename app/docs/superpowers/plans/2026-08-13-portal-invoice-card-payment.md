# Plată cu cardul în portalul clientului (/client/[tenant]/invoices) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Butonul „Plătește {sumă}" pe cardurile de factură din portalul clientului, cu același modal Stripe ca pagina publică de factură; pe localhost plățile folosesc cheile Stripe de TEST din `.env`, pe producție rămân cheile live din DB.

**Architecture:** Logica de PaymentIntent (reuse anti-dublă-încasare + creare + salvare pe factură) se extrage din `public-invoice.remote.ts` într-un helper server partajat, apelat de un nou command scoped pe clientul din portal (`locals.isClientUser` + `locals.client` + `isClientUserPrimary`, exact ca `getInvoices`). UI-ul modalului se extrage într-o componentă partajată folosită de pagina publică ȘI de portal. Eligibilitatea rămâne `checkCardPaymentEligibility` (sursă unică), expusă pe rândurile din `getInvoices` ca `canPayByCard`.

**Tech Stack:** SvelteKit 5 remote functions (command/query), Stripe PaymentIntent + PaymentElement, Drizzle/libSQL, bun run test.

**Context critic (verificat):**
- Producția (tenant `ots`) are chei LIVE în DB (`stripe_integration`, `is_active=1`). `.env` local are DEJA chei de TEST (`sk_test_…`, `pk_test_…`) folosite doar de fallback-ul env — care azi NU se aplică pentru că există rândul din DB.
- `client.stripe_customer_id` e din contul LIVE → în modul dev-test NU avem voie nici să-l trimitem la Stripe (test mode nu-l cunoaște), nici să-l suprascriem prin `getOrCreateStripeCustomer` (ar strica checkout-ul live). În dev-test se sare complet peste customer.
- Testul public existent (`public-invoice.remote.test.ts`) mock-uiește `$lib/server/plugins/stripe/factory` — mock-ul trebuie extins cu noul export `isStripeDevTestMode`.
- Webhook-ul (`/api/stripe/webhook`) verifică semnătura cu secretul tenantului din DB, cu fallback env — în dev-test secretul din env (setat de `stripe listen`) trebuie să câștige.

---

### Task 1: Chei de TEST pe localhost (factory)

**Files:**
- Modify: `app/src/lib/server/plugins/stripe/factory.ts`

- [ ] **Step 1:** Import `dev` din `$app/environment`; adaugă și exportă:

```ts
/**
 * Pe localhost (vite dev) plățile nu ating NICIODATĂ Stripe live: dacă `.env`
 * are cheie de TEST, ea câștigă în fața integrării din DB (care pe `ots` e
 * live). Pe build-ul de producție `dev` e false → comportament neschimbat.
 */
export function isStripeDevTestMode(): boolean {
	if (!dev) return false;
	const k = env.STRIPE_SECRET_KEY;
	return !!k && (k.startsWith('sk_test_') || k.startsWith('rk_test_'));
}
```

- [ ] **Step 2:** În `resolveStripeSecret`, PRIMA ramură: `if (isStripeDevTestMode()) return { secret: env.STRIPE_SECRET_KEY!, cacheKey: `${tenantId}:dev-test` };`
- [ ] **Step 3:** În `getPublishableKeyForTenant`, prima ramură: dev-test && `env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')` → returnează env.
- [ ] **Step 4:** În `getWebhookSecretForTenant`, prima ramură: dev-test && `env.STRIPE_WEBHOOK_SECRET` → returnează env (permite `stripe listen` local).
- [ ] **Step 5:** `clearStripeCache` șterge și `${tenantId}:dev-test`.

### Task 2: Helper partajat PaymentIntent

**Files:**
- Create: `app/src/lib/server/stripe/payment-intent.ts`
- Modify: `app/src/lib/remotes/public-invoice.remote.ts` (folosește helperul)
- Modify: `app/src/lib/remotes/__tests__/public-invoice.remote.test.ts` (mock factory += `isStripeDevTestMode: () => false`)

- [ ] **Step 1:** Mută în helper: `REUSABLE_PI_STATUSES`, retrieve+validate PI existent (status reutilizabil + amount + currency + client_secret), skip/creare customer (`getOrCreateStripeCustomer` DOAR când `!isStripeDevTestMode()` și `client?.email`), creare PI cu `metadata { crmPurpose:'invoice_payment', crmTenantId, crmInvoiceId }`, update `invoice.stripePaymentIntentId`. Semnătură:

```ts
export async function getOrCreateInvoicePaymentIntent(opts: {
	tenantId: string;
	invoice: { id: string; totalAmount: number; currency: string | null; stripePaymentIntentId: string | null };
	client: Parameters<typeof getOrCreateStripeCustomer>[0] | null;
	invoiceLabel: string;
	logScope: 'invoice-view' | 'client-portal';
}): Promise<{ clientSecret: string; publishableKey: string }>
```

- [ ] **Step 2:** Refactor remote-ul public să apeleze helperul; păstrează identic: rate limits, validare token, eligibilitate, shape-ul răspunsului.
- [ ] **Step 3:** `bun run test public-invoice` → toate verzi (fără modificat asserțiile).

### Task 3: Command portal (TDD)

**Files:**
- Create: `app/src/lib/remotes/__tests__/portal-invoice-payment.remote.test.ts` (ÎNTÂI)
- Create: `app/src/lib/remotes/portal-invoice-payment.remote.ts`

- [ ] **Step 1:** Teste (mock-uri ca în testul public + `getRequestEvent` cu `locals`): refuz fără user/tenant; refuz non-client (staff); refuz secundar (`isClientUserPrimary=false`); refuz factura altui client (select → []); `paid` → `{alreadyPaid:true}`; `partially_paid`/`cancelled`/sub prag → refuz; Stripe neconfigurat → refuz; suma+moneda din DB; metadata contract; reuse PI deschis; rate limit `invoice-pay-inv` cu cheia `${tenantId}:${invoiceId}`; rate limit depășit → refuz fără Stripe.
- [ ] **Step 2:** Implementare `createClientInvoicePaymentIntent = command(v.object({ invoiceId }), …)`:
  - guard: `locals.user && locals.tenant && locals.isClientUser && locals.client`, apoi `locals.isClientUserPrimary` (secundarii nu văd facturi → nici nu plătesc);
  - rate limit per factură — ACEEAȘI cheie/kind ca fluxul public (buget comun);
  - select factură scoped `and(id, tenantId, clientId)` → 404 dacă lipsește;
  - `checkCardPaymentEligibility` (alreadyPaid scurtcircuit), `isStripeConfiguredForTenant`;
  - `invoiceSettings` pentru `formatInvoiceNumberDisplay`;
  - helperul din Task 2; răspuns identic ca remote-ul public.
- [ ] **Step 3:** `bun run test portal-invoice` → verde; `bun run test` complet → 0 fail.

### Task 4: `canPayByCard` pe rândurile din portal

**Files:**
- Modify: `app/src/lib/remotes/invoices.remote.ts` (`getInvoices`)

- [ ] **Step 1:** La final, în loc de return direct: pentru client user — `const stripeReady = await isStripeConfiguredForTenant(tenantId)` (o dată) și map `canPayByCard: stripeReady && checkCardPaymentEligibility(inv).eligible`; pentru staff — `canPayByCard: false`. Import static `checkCardPaymentEligibility` (pur); factory import static (verifică `bun run test` să nu polueze).

### Task 5: Componentă partajată modal + refactor pagina publică

**Files:**
- Create: `app/src/lib/components/invoice-pay-modal.svelte`
- Modify: `app/src/routes/invoice/[tenant]/[token]/+page.svelte`

- [ ] **Step 1:** Componenta primește `{ invoiceLabel, totalAmount, currency, createIntent, returnUrl, onClose, onOutcome }`; deține state machine (`loadingIntent|card|confirming|paid|alreadyPaid`), erori, `loadStripe`, scroll-lock pe body, `CheckoutModalShell` cu `canClose = stage !== 'confirming'`; pornește `createIntent` la mount. `onOutcome('paid'|'alreadyPaid')` anunță pagina.
- [ ] **Step 2:** Pagina publică: șterge state machine-ul inline; păstrează `showPayModal`, `pageOutcome` (din `?paid=1` sau `onOutcome`), auto-start `?pay=1`. FIX inclus: închiderea modalului la stadiul `card` re-activează butonul din pagină (azi rămâne disabled).
- [ ] **Step 3:** svelte-autofixer pe ambele fișiere.

### Task 6: Butonul în portal

**Files:**
- Modify: `app/src/routes/client/[tenant]/(app)/invoices/+page.svelte`

- [ ] **Step 1:** Pe cardurile cu `invoice.canPayByCard`: buton primar `Plătește {formatAmount(...)}` (icon CreditCard) în rândul de acțiuni, înaintea „Vizualizare".
- [ ] **Step 2:** `payingInvoice` state → montează `invoice-pay-modal` cu `createIntent: () => createClientInvoicePaymentIntent({ invoiceId })`, `returnUrl: /client/{slug}/invoices?paid=1`; la `onClose` după outcome → `invoicesQuery.refresh()`; banner verde „Plata a fost înregistrată…" din `?paid=1` sau outcome local; butonul dispare local după plată (set local).
- [ ] **Step 3:** svelte-autofixer.

### Task 7: Verificare + E2E cu plată (localhost, chei TEST)

- [ ] `bun run test` — 0 fail; `/build-check` — baseline 16 err/56 warn nedepășit.
- [ ] `stripe listen --api-key <sk_test din .env> --forward-to localhost:5173/api/stripe/webhook` (background) → whsec; pornește dev serverul cu `STRIPE_WEBHOOK_SECRET=<whsec>`.
- [ ] Script scratchpad: creează factură sintetică pt clientul MADDIE SYSTEMS (10 RON, `status='sent'`, număr `TEST-E2E-…`) + magic link (insert direct `magic_link_token`, hash identic cu `client-auth`).
- [ ] Browser (testermcp; fallback chrome-devtools — cerut implicit de testul cu plată): verify URL → portal → Invoices → butonul „Plătește 10,00 lei" → modal → card `4242 4242 4242 4242`, exp `12/34`, CVC `123` → „Confirmă plata" → succes → webhook → refresh → badge „Achitata" + „Data platii". Screenshot la fiecare pas cheie.
- [ ] Regresie pagina publică: modal se deschide, se închide, butonul se re-activează (bugfix), NU se confirmă plata.
- [ ] Cleanup: șterge factura sintetică + tokenul; oprește stripe listen.
- [ ] Audit design (design-auditor + web-design-guidelines) pe componentele modificate; fix Critical/High.

### Task 8: Review + finish

- [ ] Workflow review multi-lens (corectitudine, securitate F8, Svelte 5, regresie public flow) + fix findings → re-run teste.
- [ ] Commit-uri incrementale pe `portal-invoice-card-payment`; propune deploy, așteaptă „go".
