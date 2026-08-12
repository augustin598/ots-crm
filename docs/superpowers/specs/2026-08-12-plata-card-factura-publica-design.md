# Plată cu cardul pe pagina publică de factură

**Dată:** 2026-08-12
**Branch:** `feat/public-invoice-card-payment`
**Status:** aprobat de user

## Problema

Pagina publică de factură (`/invoice/{tenant}/{token}`) — cea din emailurile de factură și de
reminder — afișează factura, oferă PDF-ul și datele de IBAN, dar nu permite plata cu cardul.
Clientul care vrea să plătească pe loc trebuie să facă transfer bancar manual.

Plata cu cardul pentru o factură DEJA emisă există deja, dar doar în portalul clientului
(`/client/{tenant}/hosting/accounts/{id}/renew`), deci cere autentificare prin magic link.

## Ce construim

Un card „Plată cu cardul" pe pagina publică, cu Stripe PaymentElement embedded, plus butonul
corespunzător în emailuri.

## Ce NU construim (decizii explicite)

- **Nu atingem webhook-ul, Keez sau provisioning-ul DirectAdmin.** Toată logica de reconciliere
  există: `handleStripeInvoicePayment` marchează factura plătită și emite hook-urile; ambele
  branch-uri de webhook (`payment_intent.succeeded`, `checkout.session.completed`) ascultă deja pe
  `metadata.crmPurpose === 'invoice_payment'`. Refolosim exact acest contract.
- **Facturi `partially_paid`** rămân doar pe transfer bancar. Webhook-ul marchează factura integral
  plătită; plata parțială a restului ar cere logică de sold pe care n-o avem.
- **Nu scurtăm durata tokenului.** Același token servește și vizualizarea, și PDF-ul; schimbarea ar
  rupe linkurile din facturile deja trimise.
- **Nu adăugăm handler de refund.** `handleChargeRefunded` (webhook-handlers.ts:877) există și
  găsește factura după `stripePaymentIntentId`, câmp pe care fluxul nostru îl stampilează.

## Model de securitate

Tokenul din URL (32 de octeți aleatori, stocat SHA-256 hashed, valabil 90 de zile) este singura
autorizare — exact ca la vizualizarea facturii și la descărcarea PDF-ului. Nu există sesiune,
cookie sau legătură cu magic link-ul portalului.

**Consecință acceptată de user:** oricine are linkul poate plăti factura. Riscul e mic — suma vine
din DB (niciodată din request), tokenul nu se poate ghici, iar frauda de card e acoperită de Stripe
prin 3DS. Expunerea de date comerciale există deja azi prin butonul „Vezi factura online".

## Arhitectură

```
Email (factură / reminder)
  └─ buton „Plătește cu cardul" → /invoice/{slug}/{token}?pay=1
                                     │
Pagina publică (+page.server.ts)     │  load() calculează canPayByCard
  └─ card „Plată cu cardul" ─────────┘
       └─ createPublicInvoicePaymentIntent({ tenantSlug, token })   [remote command, public]
            ├─ rateLimit IP + rateLimit invoiceId
            ├─ validateInvoiceViewToken  ← AUTORIZAREA
            ├─ guard status / Stripe activ / sumă minimă
            ├─ reuse PaymentIntent deschis, altfel creează
            └─ metadata { crmPurpose:'invoice_payment', crmTenantId, crmInvoiceId }
                 │
       PaymentElement (client) → Stripe → webhook payment_intent.succeeded
                                            └─ handleStripeInvoicePayment (EXISTENT)
                                                 ├─ guard sumă (NOU)
                                                 ├─ invoice.status = 'paid'
                                                 └─ hooks → DA onInvoicePaid
```

## Componente

### 1. `src/lib/remotes/public-invoice.remote.ts` (nou)

Un singur export: `createPublicInvoicePaymentIntent` (remote `command`).

Input: `{ tenantSlug: string, token: string }`.

Pași, în ordine:

1. `rateLimit({ kind: 'invoice-pay-ip', ip, limit: 10, windowSec: 3600 })`
2. `validateInvoiceViewToken(tenantSlug, token)` → dacă null/expired: eroare generică
   („Link invalid sau expirat"), fără a divulga care dintre ele.
3. `rateLimit({ kind: 'invoice-pay-inv', ip: invoice.id, limit: 30, windowSec: 3600 })` — a doua
   cheie, pe factură, ca un atacator distribuit pe multe IP-uri să nu poată genera PaymentIntents
   la nesfârșit pentru aceeași factură.
4. Guard status: `paid` → `{ alreadyPaid: true }`. Plătibile: `draft`, `sent`, `overdue`. Orice
   altceva (`cancelled`, `partially_paid`, `refunded`) → refuz.
5. Guard `isStripeConfiguredForTenant(tenantId)`.
6. Guard sumă: `totalAmount > 0` și `totalAmount >= MIN_CARD_AMOUNT_CENTS` pentru moneda facturii
   (RON 200 = 2 lei, EUR 50 = 0,50 €). Sub prag → refuz cu mesaj care trimite la transfer bancar.
7. Customer: dacă `client.email` există → `getOrCreateStripeCustomer(client)`; altfel PaymentIntent
   fără `customer` (`getOrCreateStripeCustomer` aruncă pe email lipsă — customer.ts:35).
8. Reuse: dacă `invoice.stripePaymentIntentId` există, îl citim din Stripe. Dacă e în
   `requires_payment_method | requires_confirmation | requires_action` ȘI are aceeași sumă și
   monedă → refolosim `client_secret`. Altfel creăm unul nou.
   *Reuse-ul e o măsură anti-dublă-încasare:* două taburi primesc același PaymentIntent, iar Stripe
   confirmă un PaymentIntent o singură dată.
9. `stripe.paymentIntents.create({ amount: totalAmount, currency, customer?,
   automatic_payment_methods: { enabled: true }, metadata: { crmPurpose:'invoice_payment',
   crmTenantId, crmInvoiceId }, description })`.
10. Persistăm `stripePaymentIntentId` pe factură.
11. Return `{ alreadyPaid: false, clientSecret, publishableKey, total, currency, invoiceLabel }`.

Toate erorile Stripe trec prin `serializeError` + `logError`; clientului îi returnăm mesajul, nu
stack-ul.

### 2. `src/routes/invoice/[tenant]/[token]/+page.server.ts`

Adaugă în payload-ul de `load`:

```ts
canPayByCard: isPayableStatus(invoice.status)
  && (invoice.totalAmount ?? 0) >= minCardAmount(invoice.currency)
  && await isStripeConfiguredForTenant(tenant.id)
```

Logica de eligibilitate stă într-un helper partajat cu remote-ul, ca pagina și serverul să nu poată
diverge.

### 3. `src/routes/invoice/[tenant]/[token]/+page.svelte`

Card nou „Plată cu cardul", plasat între cardul facturii și secțiunea „Date plata", vizibil doar
când `canPayByCard`.

Stări: `summary → loadingIntent → card → confirming → paid`, plus `alreadyPaid`.

- `?pay=1` în URL → pornește direct pe `loadingIntent` (venit din email).
- `?paid=1` în URL → stare `paid` (întoarcere din redirect 3DS).
- `confirmPayment` cu `redirect: 'if_required'`, `return_url` = URL-ul paginii cu `?paid=1`.
- Dacă Stripe întoarce eroare de tip „PaymentIntent deja confirmat" → afișăm „Factura pare deja
  plătită" în loc de eroarea brută.
- După succes: mesaj verde, explicit că statusul se actualizează în scurt timp (webhook asincron) —
  nu promitem un status instant în pagină.
- Secțiunea IBAN rămâne, ca alternativă.

Stările Loading / Empty / Error se definesc înainte de markup. Layoutul de print al paginii nu se
schimbă: cardul de plată se ascunde la print (`print:hidden`).

### 4. `src/lib/server/email.ts`

În `sendInvoiceEmail` (~L1367) și în reminderul de restanță (~L2436): dacă Stripe e activ pe tenant
și factura e plătibilă → buton primar „Plătește cu cardul" spre `${invoiceUrl}?pay=1`, iar „Vezi
factura online" devine link secundar. Aceeași informație în versiunea text a emailului.
`sendInvoicePaidEmail` rămâne neatins.

Verificarea `isStripeConfiguredForTenant` se face o singură dată per email, iar dacă aruncă, emailul
se trimite fără butonul de card (degradare grațioasă — un email fără buton e mai bun decât niciun
email).

### 5. `src/lib/server/stripe/invoice-payment.ts` — guard de sumă

`handleStripeInvoicePayment` primește deja `paidAmountCents`. Adăugăm:

- Dacă `paidAmountCents != null` și diferă de `invoice.totalAmount` → `logError` CRITIC și **nu**
  marcăm factura plătită; decide staff-ul. Cauza reală: staff-ul a editat factura cât timp clientul
  avea formularul deschis.
- Dacă factura e deja `paid` (calea idempotentă existentă) dar PaymentIntent-ul care sosește diferă
  de cel salvat → `logError` „posibilă dublă încasare, necesită refund". Transformă o pierdere
  tăcută într-o alertă.

### 6. Task de reconciliere (nou, în scheduler)

Zilnic: facturi cu `stripePaymentIntentId` setat, status ≠ `paid`, `updatedAt` mai vechi de 24h →
`stripe.paymentIntents.retrieve` → dacă `succeeded`, apelează `handleStripeInvoicePayment` ca și cum
webhook-ul ar fi sosit. Limită 100 de facturi pe rulare. Acoperă webhook-ul pierdut definitiv
(Stripe renunță după 72h): fără el, clientul a plătit și factura rămâne restantă.

## Testare

Unit (Bun test), cu `getStripeForTenant` mock-uit:

- token invalid / expirat → refuz, fără scurgere de informație
- factură `paid` → `{ alreadyPaid: true }`, fără apel la Stripe
- status `cancelled` / `partially_paid` → refuz
- Stripe neconfigurat pe tenant → refuz
- sumă sub pragul minim → refuz
- suma trimisă la Stripe == `invoice.totalAmount`, moneda == moneda facturii
- metadata conține `crmPurpose`, `crmTenantId`, `crmInvoiceId`
- client fără email → PaymentIntent creat fără `customer`
- reuse: PaymentIntent deschis cu aceeași sumă → refolosit; sumă schimbată → creat unul nou
- rate limit depășit (IP și factură) → refuz
- guard de sumă în `handleStripeInvoicePayment`: mismatch → factura NU devine plătită + log
- reconciliere: PI `succeeded` pe factură neplătită → marcată plătită

Manual: `stripe listen` + card de test pe fluxul complet, inclusiv 3DS.

## Riscuri

| Risc | Mitigare |
|---|---|
| Doi oameni plătesc simultan aceeași factură | Reuse de PaymentIntent (Stripe confirmă unul singur); dacă totuși se întâmplă, alertă de dublă încasare pentru refund manual |
| Webhook pierdut | Task zilnic de reconciliere |
| Factura editată cât timp PI e deschis | Guard de sumă în webhook: nu marcăm plătit, alertăm staff |
| Redis picat → rate limit fail-open | Acceptat: e patternul documentat al aplicației; suma vine din DB, deci abuzul produce cel mult PaymentIntents inutile |
