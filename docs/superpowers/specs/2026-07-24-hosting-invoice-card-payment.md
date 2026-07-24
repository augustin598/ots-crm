# Plată cu cardul pentru facturi de hosting deja emise

**Data:** 2026-07-24
**Trigger:** Client MADDIE SYSTEMS (cont `nwj6y4tg2l3sng7tnpa5poic`, videochatgalati.ro,
factură OTSH 8 = 906,29 lei, Keez Valid) nu poate plăti cu cardul — linkul din email pică.

---

## 1. Root cause (confirmat)

1. **Ruta `/renew` nu există.** `notifyHostingRenewalReminder`
   ([notifications.ts:1226](../../../app/src/lib/server/hosting/notifications.ts#L1226))
   construiește `payUrl = https://clients.onetopsolution.ro/{slug}/hosting/accounts/{accountId}/renew`.
   Nu există nicio pagină `hosting/accounts/[accountId]/renew` → **404**.
2. **Lipsește prefixul `/client/`.** Portalul clientului e la `/client/{slug}/...`
   (ex. login `/client/{slug}/verify`, [email.ts:1274](../../../app/src/lib/server/email.ts#L1274)).
   URL-ul sare peste `/client/` → nimerește arborele staff, unde clientul n-are acces.
3. **Aceeași clasă de bug** în emailul de suspendare
   ([notifications.ts:730](../../../app/src/lib/server/hosting/notifications.ts#L730) →
   `/{slug}/invoices/{id}/pay`, rută inexistentă).
4. **Feature-gap de fond:** nu există nicio rută prin care clientul să plătească cu cardul
   o factură deja emisă. Stripe `PaymentElement` e cablat DOAR pentru comenzi noi
   (`/pachete-hosting`, `submitHostingOrder`).

## 2. De ce NU se pot refolosi handler-ele Stripe existente

`handlePaymentIntentSucceeded` / `handleCheckoutSessionCompleted`
([webhook-handlers.ts](../../../app/src/lib/server/stripe/webhook-handlers.ts)) cer
`crmHostingInquiryId` + `crmHostingProductId` și rulează pipeline-ul de **provisioning DA +
emitere Keez**. Pentru o factură deja emisă (OTSH 8 = Keez **Valid**), contul există deja →
refolosirea ar **provisiona un cont DA nou** și ar **re-emite Keez** (dublă facturare).
→ Nevoie de un flux nou, izolat, cu discriminator de metadata propriu.

## 3. Prerechizită BLOCANTĂ — Stripe live

Plata reală cu cardul e posibilă doar dacă tenant-ul `ots` are Stripe **live + activ**:
`stripe_integration.is_test_mode = 0`, `is_active = 1`, cheie `sk_live_...`, webhook live cu
`payment_intent.succeeded` + `checkout.session.completed`. Doc-ul Stripe (2026-05-13) spune
„Test mode 100% funcțional" → live poate să NU fie configurat.
**Verificare:** `/ots/settings/stripe` sau `/ots/api/_debug-stripe-health?action=webhook-config`.

## 4. Convenție metadata nouă (izolează fluxul)

```
crmPurpose:   'invoice_payment'   // discriminator — NU declanșează provisioning/Keez
crmTenantId:  <tenantId>
crmInvoiceId: <invoice.id>        // factura CRM de marcat plătită
```

## 5. Track A — Deblocare imediată (client plătește azi)

### A1. Branch webhook „invoice_payment" (nucleu comun cu Track B)
`webhook-handlers.ts`:
- `handlePaymentIntentSucceeded`: **la început**, dacă `md.crmPurpose === 'invoice_payment'`
  → `handleInvoicePaymentSucceeded(intent)` și `return` (înainte de guard-ul care cere inquiry).
- `handleCheckoutSessionCompleted`: idem, dacă `md.crmPurpose === 'invoice_payment'`
  → marchează pe `session.payment_intent`.
- `handleInvoicePaymentSucceeded(intent)`:
  - `UPDATE invoice SET status='paid', paidDate=now, stripePaymentIntentId=pi.id,
    externalTransactionId=pi.id, paymentMethod='Card', updatedAt=now
    WHERE id = md.crmInvoiceId AND tenant_id = md.crmTenantId` (tenant-scoped, idempotent).
  - **NU** provisiona DA, **NU** emite Keez (deja Valid).
  - Dacă factura are `hostingAccountId` și contul e `suspended` cu `suspendReason` de tip
    overdue → reactivare (reutilizează calea existentă de un-suspend). *Pentru MADDIE contul e
    `active` → no-op; păstrăm branch-ul minimal.*
  - Log `logInfo('directadmin', 'invoice_payment reconciled', …)`.

### A2. Endpoint admin pentru link de plată
`[tenant]/api/_debug-hosting-invoice-pay-link/+server.ts` (admin-gated, tenant-scoped,
pattern `_debug-*`):
- Input: `invoiceId`.
- Load invoice (tenant-scoped) → `totalAmount` (cents), `currency`, client, domeniu.
- `getOrCreateStripeCustomer(client)`.
- `stripe.checkout.sessions.create({ mode:'payment', customer,
  line_items:[{ price_data:{ currency, unit_amount: totalAmount,
    product_data:{ name: 'Hosting {domain} — factura {series}{number}' } }, quantity:1 }],
  metadata:{ crmTenantId, crmInvoiceId, crmPurpose:'invoice_payment' },
  client_reference_id: invoiceId, success_url, cancel_url })`.
- Return `session.url` → adminul îl trimite clientului. (TVA e deja în `totalAmount` → NU
  atașăm tax rate; suma Stripe == totalul facturii Keez.)

## 6. Track B — Pagina reală în portal

### B1. Rută nouă
`client/[tenant]/(app)/hosting/accounts/[accountId]/renew/+page.svelte`:
- Rezolvă factura deschisă (unpaid) pentru `accountId`; afișează sumar (domeniu, scadență,
  net/TVA/total) + `PaymentElement` embed (`$lib/components/Stripe/PaymentElement`).
- La succes → stare „Plată reușită". Dacă factura e deja plătită → mesaj corespunzător.

### B2. Remote function
`$lib/remotes/portal-hosting.remote.ts` — `createInvoicePaymentIntent(invoiceId)`:
- `requireClientUser` + ownership (invoice.clientId ∈ clienții userului, tenant match).
- Dacă `status==='paid'` → `{ alreadyPaid:true }`.
- Altfel `stripe.paymentIntents.create({ amount: totalAmount, currency, customer,
  automatic_payment_methods:{enabled:true},
  metadata:{ crmTenantId, crmInvoiceId, crmPurpose:'invoice_payment' } })`;
  stamp `invoice.stripePaymentIntentId`; return `{ clientSecret, publishableKey }`.
- Reconciliere: același branch webhook `payment_intent.succeeded` din A1.

### B3. Fix linkuri email
- `notifications.ts:1226` → `https://clients.onetopsolution.ro/client/{slug}/hosting/accounts/{accountId}/renew`.
- `notifications.ts:730` (suspendare) → aceeași pagină renew (sau alias `/client/{slug}/invoices/{id}/pay`).
- Actualizează testele de string (`notifications.test.ts:1046`, `suspended.test.ts:39`).

## 7. Teste
- `handleInvoicePaymentSucceeded`: marchează plătită, sare provisioning/Keez, tenant-scoped, idempotent.
- `createInvoicePaymentIntent`: guard ownership respinge alt client; `alreadyPaid` pe factură plătită.
- Email: `payUrl` conține `/client/` + rută reală.

## 8. Migrări
Niciuna — `invoice` are deja `stripePaymentIntentId` / `stripeSessionId` / `paidDate` / `status`.

## 9. Ordine de execuție
1. A1 webhook branch (nucleu). 2. A2 endpoint → **deploy** → clientul plătește azi.
3. B1+B2 pagină portal. 4. B3 fix email + teste → **deploy**.
