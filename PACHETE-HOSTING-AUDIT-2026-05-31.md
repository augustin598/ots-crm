# Audit /pachete-hosting — flux complet checkout → Stripe → webhook → post-payment

**Data:** 2026-05-31
**Metodă:** workflow multi-agent (8 dimensiuni de review în paralel + verificare adversarială per finding + a doua opinie Gemini + critic de completitudine) — 55 agenți, 788 tool-uri. Plus citire manuală Claude a căii critice.
**Rezultat:** 48 findings confirmate (7 critical → **2 probleme distincte**, 10 high, 15 medium, 13 low, 3 info), 7 false-pozitive eliminate la verificare.

> **Notă de citire:** cele 7 „critical" sunt în mare aceeași problemă (TVA) văzută de pe 6 unghiuri + problema facturilor de reînnoire. Deduplicate, sunt **2 probleme critice reale**.

---

## ✅ STATUS IMPLEMENTARE (2026-06-01) — C1 + C2 REZOLVATE

**C1 (TVA) — Opțiunea A (Stripe încasează brutul):**
- Helper unic `src/lib/utils/vat.ts#computeVatBreakdown` — sursă de adevăr pentru net/TVA/total, folosit de modal + server + Keez.
- `factory.ts#getOrCreateStripeTaxRate` — Stripe Tax Rate per tenant (TVA%, inclusive:false), cache + reuse.
- `public-hosting.remote.ts`: one-time PaymentIntent `amount = grossCents`; subscription item primește `tax_rates: [taxRate]`; redirect Checkout primește `taxRateId`.
- `checkout.ts`: `tax_rates` pe line item.
- Modal: afișează total din `priceCents` real (toggle lunar/anual devine decorativ); etichetă ciclu din `plan.billingCycle` real.
- `emit-keez-invoice.ts`: net/TVA/total din același helper.
- **Test:** `app/test-hosting-checkout-vat-reconciliation.ts` — 43 aserțiuni, Stripe==Keez==afișaj. ✅

**C2 (facturi reînnoire) — emise acum:**
- `handleInvoicePaid` emite Keez pe `invoice.payment_succeeded` + `billing_reason='subscription_cycle'` (sare prima plată); `invoice.paid` = doar ack (evită dubla emisie). Idempotent pe PI-ul reînnoirii.
- Ruta webhook rezolvă `tenantId` via `customer→client` când lipsește metadata (altfel facturile renewal + refund/dispute erau aruncate silent).

**Verificat:** svelte-check baseline (16 err/56 warn, fișierele modificate curate) · 61 teste existente PASS · 43 aserțiuni VAT PASS. Doc actualizat în `app/docs/stripe-module.md`.

**Restul findings-urilor (H1–H4, mediums, lows) rămân deschise** — vezi mai jos.

---

## 🔴 CRITIC

### C1 — TVA promisă și facturată, dar NEÎNCASATĂ de Stripe (discrepanță în 3 sensuri)
*findings #1,3,4,5,6,7 + high #8,9,13,14 — confirmat pe toate cele 3 suprafețe*

Pe **toate** suprafețele clientul vede și i se promite un **TOTAL CU TVA**, dar Stripe încasează **doar netul**, iar Keez emite factura **cu TVA** marcată `paid`:

| Suprafață | Ce vede / face clientul | Ref |
|---|---|---|
| Marketing | „Toate prețurile sunt afișate fără TVA; **TVA X% se adaugă la checkout**" | [+page.svelte:498](app/src/routes/pachete-hosting/+page.svelte#L498) |
| Modal embedded | `total = subtotal + vat`; buton **„Plătește {total}"** (cu TVA) | [modal:667-669](app/src/lib/components/hosting-checkout-modal.svelte#L667), :2285 |
| Wizard /comanda | „Subtotal / TVA X% / **TOTAL** {priceWithVat}" + „Plătește online" | [comanda:314-333](app/src/routes/pachete-hosting/comanda/+page.svelte#L314) |

Dar Stripe nu adaugă TVA nicăieri:
- One-time: `paymentIntents.create({ amount: Number(product.price) })` — net curat. [public-hosting.remote.ts:1144](app/src/lib/remotes/public-hosting.remote.ts#L1144)
- Subscription / redirect: Stripe Price cu `tax_behavior:'exclusive'` ([price.ts:72](app/src/lib/server/stripe/price.ts#L72)) **fără** niciun tax_rate + `automatic_tax:{enabled:false}` ([checkout.ts:44](app/src/lib/server/stripe/checkout.ts#L44)).

Iar Keez emite la brut: `totalCents = netCents + taxCents`, invoice `status:'paid'`. [emit-keez-invoice.ts:160-163](app/src/lib/server/stripe/post-payment/emit-keez-invoice.ts#L160)

**Impact:** pe fiecare comandă publică se sub-colectează ~17–21% (valoarea TVA). Factura fiscală Keez declară TVA colectat pe bani neîncasați → **firma datorează ANAF TVA pe sume necolectate** + reconciliere ruptă (factura `paid` ≠ sumă încasată). Atinge ambele checkout-uri, card+OP, one-time+subscription.

**Fix (decizie de business necesară):**
- **Opțiunea A (recomandat fiscal):** `product.price` = NET → Stripe trebuie să încaseze **brutul**. One-time: `amount = product.price + round(product.price*vat/100)`. Subscription/redirect: atașează un Stripe Tax Rate de `vat%` sau stochează Price-ul gross. Astfel `Stripe.amount == Keez.totalCents == total afișat`.
- **Opțiunea B:** dacă intenția e să încasezi net prin Stripe, atunci UI nu mai promite TVA (scoate randul „TVA"/„TOTAL cu TVA" și butonul cu suma brută) **și** Keez emite pe net.
- Oricare: adaugă un **test de reconciliere** `amount Stripe == totalCents Keez == total buton`.

### C2 — Facturile de reînnoire abonament nu se emit NICIODATĂ
*finding #2 + high #17 + medium #21,29*

Produsele recurente creează un Stripe Subscription. La fiecare ciclu Stripe debitează cardul și trimite `invoice.payment_succeeded`, **dar**:
- `handleInvoicePaid` e STUB (doar logează, „TODO Sprint 8.2"). [webhook-handlers.ts:142-172](app/src/lib/server/stripe/webhook-handlers.ts#L142)
- Scheduler-ul CRM **sare deliberat** template-urile Stripe (`isStripeOwned → return false`).

→ Clientul e debitat recurent dar **nu primește niciodată factură fiscală RO** pentru reînnoiri (prima plată e ok). Lipsă document fiscal = încălcare legală. Latent până la primul ciclu de renewal, dar structural rupt prin design.

**Atenție la fix:** când implementezi emiterea în `handleInvoicePaid`, fluxul subscription embedded va emite **2 facturi** pentru prima plată (una din `payment_intent.succeeded`, una din `invoice.payment_succeeded`). Dedup pe `stripeInvoiceId` + skip `billing_reason==='subscription_create'`. (#17)

---

## 🟠 HIGH (distincte de TVA)

| # | Problemă | Fișier | Fix |
|---|---|---|---|
| H1 | **`isActive=false` nu dezactivează Stripe** pentru tenant `ots` — fallback env bypass-uiește toggle-ul admin; webhook-uri acceptate deși integrarea e oprită | [factory.ts:69-105](app/src/lib/server/plugins/stripe/factory.ts#L69) | `if (integration && integration.isActive===false) throw` ÎNAINTE de fallback env |
| H2 | **Coliziune email blochează comanda pe firmă** — UNIQUE (tenant,email); catch-ul race re-caută doar după CUI → 502 dacă alt client are deja emailul | [public-hosting.remote.ts:887](app/src/lib/remotes/public-hosting.remote.ts#L887) | re-caută după email **sau** CUI în branch-ul de recovery |
| H3 | **Refund/dispute NU suspendă contul DA** — `handleChargeRefunded` doar marchează factura, `handleChargeDisputeCreated` doar logează; clientul rămâne cu hosting activ după ce a recuperat banii (mai ales one-time, fără subscription) | [webhook-handlers.ts:558-614](app/src/lib/server/stripe/webhook-handlers.ts#L558) | la full-refund/dispute: rezolvă + suspendă hostingAccount-ul legat. **Vezi și #45** — charge events n-ajung la handler (ruta filtrează pe `metadata.crmTenantId` pe care Charge nu-l poartă) |
| H4 | **`da_provision` eșuează dar clientul e marcat `active`** + primește magic link + email „Plată confirmată" + factură — promisiune fără cont | [dispatcher.ts:193-271](app/src/lib/server/stripe/post-payment/dispatcher.ts#L193) | trimite emailul de succes DUPĂ `da_provision`; pe eșec → „cont în curs de activare", nu marca onboarding active |

---

## 🟡 MEDIUM (selecție)

- **M1** `paidAmountCents` (net) diverge de `totalAmount` Keez (net+TVA) → reconciliere/rapoarte greșite (compune C1). [#19,25]
- **M2** Pagina success nu tratează redirect-ul 3DS embedded (citește doar `session_id`, nu `payment_intent`/`redirect_status`). [#20]
- **M3** Pașii post-payment eșuați n-au retry automat; webhook întoarce 200 chiar dacă un pas a picat → Stripe nu redelivrează → blocat până la replay manual. [#22]
- **M4** PII (email, CUI, IP) logate în clar în multiple puncte ale fluxului public. [#23]
- **M5** `insert-order.ts`: etichetă „lunar" pe produse anuale (verifică `'yearly'` dar valoarea reală e `'annually'`) + `vatRate:19` **hardcodat** pe item-e (TVA tenant e 21). [#24, [insert-order.ts:151](app/src/lib/server/hosting/insert-order.ts#L151)]
- **M6** Retry pe coliziune username e **mort**: `accountId` generat o singură dată în afara buclei → pre-insert cu același id → **violare PRIMARY KEY** pe a 2-a încercare. [#26, [provision-da.ts:230](app/src/lib/server/stripe/post-payment/provision-da.ts#L230)]
- **M7** FAQ promite PayPal, Revolut, garanție 30 zile, upgrade pro-rata — dar `ENABLE_PAYPAL/REVOLUT=false`. [#27]
- **M8** Două suprafețe de checkout active divergente: wizard `/comanda` forțează firmă+CUI (fără persoană fizică), fără pas domeniu, afișaj TVA diferit. [#28]
- **M9** Subscription embedded nu creează fiabil `recurring_invoice` template (depinde de stamp-ul `crmSubscriptionId` pe PI care poate eșua tranzitoriu). [#29]
- **M10** Modalul trimite `domainName` garbage (`'.ro'`) când `domainMode='have'/'transfer'` → line-item domeniu corupt. [#30]
- **M11** Abandon 3DS pe embedded → PaymentIntent rămâne `requires_action`, inquiry blocat `pending` permanent, niciun handler de expirare. [#31]
- **M12** Placeholder `{username}.hosting-temp.ots` trimis ca domeniu real la `createUserAccount` → cont DA cu domeniu invalid. [#32]

---

## 🟢 LOW / INFO (extras)

- Modal fără **focus-trap** (focus nu intră/nu e prins/nu e restaurat) — accesibilitate. [#39]
- `sendOnboardingMagicLink` emite mereu token nou — docstring „reuse idempotent" e fals. [#34,36]
- Decriptare credențiale DA fără retry pe `DecryptionError` (contra pattern documentat). [#35]
- Cost domeniu afișat în coș dar neîncasat/nefacturat. [#33,41]
- Keez ignoră statutul plătitor-TVA al **emitentului** (tenant). [#40]
- Webhook fără `crmTenantId` → 200 + ignorat silent (events critice cu metadata lipsă dispar). [#45]

---

## ✅ Confirmări pozitive (ce funcționează bine)

- **`payment_intent.succeeded` declanșează corect pipeline-ul post-payment** pentru fluxul embedded — NU există gap-ul „client plătește fără cont/factură". [#47, [webhook-handlers.ts:419](app/src/lib/server/stripe/webhook-handlers.ts#L419)]
- Idempotency lifecycle webhook (`processing→completed/failed` + stuck-recovery 10min), cross-tenant guard, path unificat anti-enumeration, `withTursoBusyRetry` — solide.

## ❌ False-pozitive eliminate la verificarea adversarială (7)

1. „piRef=null pe subscription dahlia" — throw-ul e în try, prins de catch 502. Robust.
2. „provisioning nu re-verifică domeniul" — DA respinge duplicatele la `createUserAccount` (impactul real e capturat de H4/M12).
3. „rate-limit fail-open + XFF spoofing" — `getClientAddress` vine din adapter de încredere.
4. „PK violation în calea admin create-account.ts" — cod mort azi (spre deosebire de M6 care e reachable).
5. „PaymentElement se re-montează la re-render" — model React, nu se aplică în Svelte 5.
6. „Keez emite NET vs Stripe gross" — Keez emite corect din catalog (direcția reală e inversă: Stripe e net).
7. „VAT 21% hardcodat în UI" — UI citește `vatRate` din query, nu hardcodat.
