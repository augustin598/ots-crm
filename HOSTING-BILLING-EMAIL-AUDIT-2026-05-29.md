# Audit complet — Flux Facturare + Email Hosting (OTS CRM)

> **Data:** 2026-05-29 · **Repo:** `/Users/augustin598/Projects/CRM/app` · **Tenant:** `ots`
> **Metodă:** debug sistematic (superpowers) + workflow multi-agent (7 dimensiuni, verificare adversarială per finding) + a doua opinie Gemini + review diff necommitat.
> **Punct de plecare:** `DirectAdminManager/PROMPT-CLAUDE-HOSTING-RENEWAL-PRICE-MISMATCH.md` (email reminder cu preț greșit).
>
> Bani stocați peste tot în **BANI/CENȚI** (întregi). Cota TVA din `invoiceSettings.defaultTaxRate` (fallback ar trebui 21). `recurringInvoice.taxRate` e în **bps** (procent×100); line-item `taxRate` e în **procent**.

---

## 0. TL;DR — ce se întâmplă de fapt

Problema raportată (email 866 RON vs factură 1149 RON) **NU e un caz izolat**. Este simptomul unei probleme arhitecturale: **există 3 valori monetare pentru același cont care pot diverge, fără o singură sursă de adevăr și fără mecanism de auto-sincronizare.**

```
                    ┌─────────────────────────────┐
                    │  hostingProduct.price        │  ← CATALOG = sursa de adevăr
                    │  (/ots/hosting/products)     │
                    └──────────────┬──────────────┘
                                   │ upsertRecurringInvoiceForHostingAccount()
            ┌──────────────────────┼─────── rulează DOAR la: create cont,
            │                      │         import WHMCS, endpoint debug manual
            ▼                      ▼         ── NU la: edit cont, schimbare preț
  ┌───────────────────┐  ┌──────────────────────┐    catalog, sync nocturn DA
  │ recurringInvoice  │  │ hostingAccount         │
  │ .amount (CENȚI)   │  │ .recurringAmount       │  ← SNAPSHOT, driftează
  │ → ce FACTUREAZĂ   │  │ (SNAPSHOT, CENȚI)      │
  │   scheduler-ul    │  │ → ce AFIȘEAZĂ:         │
  └───────────────────┘  │   email reminder,      │
                         │   portal client, panel │
                         │   SUMĂ, MRR, dashboard  │
                         └────────────────────────┘
```

- **Factura** (1149) e generată din `recurringInvoice.amount` → corectă în cazul raportat.
- **Email-ul / portalul / panelul / MRR** citesc `recurringAmount` (snapshot) → 866, greșit.
- **Dar și `recurringInvoice.amount` e un snapshot** care nu se re-sincronizează automat când se schimbă prețul din catalog — deci în alt scenariu *factura însăși* poate fi greșită.

**Rezultat audit:** 2 probleme **CRITICE**, 7 **HIGH**, 9 **MEDIUM**, 9 **LOW**, plus 4 căi confirmate corecte. 9 findinguri inițiale au fost **refuzate** la verificarea adversarială (false positive) — nu sunt în listă.

> ⚠️ **A doua problemă critică (C2 — Stripe 100×) e mai gravă decât cea raportată** și încă nu s-a declanșat. Trebuie tratată cu prioritate maximă alături de bug-ul de email.

---

## Status implementare (actualizat 2026-05-30)

| # | Stare | Note |
|---|-------|------|
| **C1** | ✅ **REZOLVAT** | `notifyHostingRenewalReminder` citește `recurringInvoice.amount/taxRate/currency`; fallback la snapshot cu `logWarning`. Test regresie (86600→114900) + happy-path (snapshot driftat 8660, dovedește 9950 din template) + fallback. `bun test hosting/` 65 pass. |
| **C2** | ✅ **REZOLVAT** | Layer 1: scheduler-ul sare peste template-urile `stripe_subscription:` (recurring-invoices.ts) + log. Layer 2: helper nou `recurring-line-item.ts` (`rate` decimal, `taxRate` percent) folosit în `emit-keez-invoice.ts`. Teste: scheduler skip (2) + helper contract (2). |
| **Faza 2 keystone** | ✅ **REZOLVAT** | `upsertRecurringInvoiceForHostingAccount` reconciliază acum `hostingAccount.recurringAmount`/`currency` la prețul rezolvat din catalog (write-back). Test TDD (snapshot driftat 86600 → reconciliat 114900; dryRun nu scrie). |
| **H1** | ✅ **REZOLVAT** | `updateHostingProduct` re-rulează upsert-ul pentru toate conturile active legate de produs când se schimbă price/currency (+ log count). |
| **H2** | ✅ **REZOLVAT** | `updateHostingAccount` re-rulează upsert-ul după save (paritate cu create) → editarea pachetului/ciclului re-sincronizează factura + snapshot-ul. |
| **H6, M4** | ✅ **auto-fix** (via keystone) | Portal client / panel SUMĂ / MRR citesc `recurringAmount`; acum că snapshot-ul se reconciliază la fiecare upsert, devin corecte automat. **Necesită backfill** (vezi mai jos) pentru conturile existente care n-au mai trecut prin upsert. |
| **H3** | ✅ **REZOLVAT** | `cycleToRecurring` tratează acum `biannually` (alias 6 luni) → nu mai sare crearea template-ului. Test TDD (biannually → created, interval 6). |
| **H4** | ✅ **REZOLVAT** | `retryEmailLog` validează retryabilitatea ÎNAINTE de delete + șterge rândul DOAR după dispatch reușit → emailurile hosting eșuate nu mai dispar la „Retry". (Remote command — verificat type-check + review, fără harness nou.) |
| **M3** | ✅ **parțial** | Constantă nouă `vat/rate.ts` `DEFAULT_VAT_PERCENT=21` pe calea de facturare hosting (emit-keez, recurring-template, notifications, invoice-utils) → elimină divergența fiscal-19 vs email-21. Test fallback (fără settings → 2100 bps). **Rămas:** sweep `?? 19` pe contracte/PDF/UI + default-ul de schemă (migrare). |
| **M7, M8** | ⏳ rămas | Endpoint-urile debug `cancel-and-regenerate` / `patch-hosting-account` încă nu re-rulează upsert-ul (mic, follow-on). |
| **M2** | ⏳ rămas | BNR multiplier (latent — RON/EUR au multiplier=1). |
| restul | ⏳ planificat | L-uri (cosmetice/robustețe) + sweep VAT complet. |

> **Modificările sunt pe `main`, necommitate.** Fișiere atinse până acum:
> C1: `hosting/notifications.ts` (+test). C2: `scheduler/tasks/recurring-invoices.ts` (+test), `stripe/post-payment/emit-keez-invoice.ts`, `hosting/recurring-line-item.ts` (+test).
> Faza 2: `hosting/recurring-template.ts` (+test), `remotes/hosting-products.remote.ts`, `remotes/hosting-accounts.remote.ts`.
> **120 pass / 0 fail** (hosting+scheduler+stripe), **0 erori de tip noi**.

> ⚠️ **Backfill recomandat (operațional, o singură dată):** snapshot-urile existente se reconciliază doar când upsert-ul rulează pentru un cont. Rulează `POST /ots/api/_debug-sync-hosting-recurring` o dată → reconciliază toate conturile active la catalog (acum că write-back-ul e activ). Apoi panel/portal/MRR vor fi corecte peste tot.
>
> ⚠️ **Implicație comportament:** write-back-ul face ca `recurringAmount` introdus manual în formular să fie suprascris cu prețul din catalog ori de câte ori se rezolvă un produs din catalog (= catalog ca sursă unică, direcția recomandată de audit). Pentru conturi fără produs din catalog rezolvabil, upsert-ul returnează `skipped` și snapshot-ul manual rămâne neatins. Follow-up UI: scoaterea câmpului editabil `recurringAmount` (DRIFT-1).

---

## 1. Index probleme

| # | Sev | Titlu | Fișier principal |
|---|-----|-------|------------------|
| **C1** | 🔴 CRITIC | Email reminder citește `recurringAmount` (snapshot stale), nu prețul facturat | `hosting/notifications.ts:1056,1121` |
| **C2** | 🔴 CRITIC | Template recurent Stripe stochează `rate` în CENȚI → scheduler facturează ×100 | `stripe/post-payment/emit-keez-invoice.ts:568` + `invoice-utils.ts:556,670` |
| **H1** | 🟠 HIGH | `recurringInvoice.amount` nu se re-sincronizează la schimbarea prețului din catalog | `hosting-products.remote.ts` (updateHostingProduct) + `directadmin-sync-accounts.ts` |
| **H2** | 🟠 HIGH | Edit manual cont scrie snapshot dar nu re-rulează upsert (spre deosebire de create) | `hosting-accounts.remote.ts:905-944` vs `:238` |
| **H3** | 🟠 HIGH | Ciclul `biannually` → niciun `recurringInvoice` creat → pierdere de venit silențioasă | `recurring-template.ts:32-52` |
| **H4** | 🟠 HIGH | Retry manual admin pentru email hosting ȘTERGE rândul apoi aruncă eroare | `email-logs.remote.ts:212,119-132` |
| **H5** | 🟠 HIGH | Provision Stripe scrie snapshot dar nu creează template recurent pe calea DA | `stripe/post-payment/provision-da.ts:276` |
| **H6** | 🟠 HIGH | Portal CLIENT afișează snapshot-ul stale ca "Preț" | `portal-hosting.remote.ts:50,88` + pagini client |
| **H7** | 🟠 HIGH | (NOU, necommitat) Alertă admin status-change suprimată după eșec email client | `hosting/notifications.ts:655,716,914,975` |
| **M1** | 🟡 MED | Eșec SMTP tranzitoriu pierde reminder-ul (dedupe înainte de send + payload:null) | `hosting/notifications.ts:1144,1182` |
| **M2** | 🟡 MED | `getLatestBnrRate` întoarce rata AS-IS (per multiplier) → ×100 pt HUF/JPY | `bnr/client.ts:132` + `recurring-template.ts:404-435` |
| **M3** | 🟡 MED | Fallback TVA divergent: 19 vs 21 în 4+ locuri | `emit-keez-invoice.ts:141`, `invoice-utils.ts:476`, `recurring-template.ts:270`, `notifications.ts:1117` |
| **M4** | 🟡 MED | Suprafețe operator (SUMĂ, MRR, ARR, dashboard, banner edit) afișează snapshot | `hosting-account-row.svelte:193` + `hosting-dashboard.remote.ts` + `hosting-products.remote.ts` |
| **M5** | 🟡 MED | Formularul de edit hardcodează 19% TVA | `hosting-account-edit-form.svelte:184` |
| **M6** | 🟡 MED | Drift-detector compară 2 snapshot-uri, nu față de catalog | `_debug-hosting-invoices-state/+server.ts:217` |
| **M7** | 🟡 MED | `_debug-cancel-and-regenerate` regenerează fără re-sync din catalog | `_debug-cancel-and-regenerate/+server.ts:146` |
| **M8** | 🟡 MED | `_debug-patch-hosting-account` mută preț/produs fără re-sync | `_debug-patch-hosting-account/+server.ts:173-189` |
| **M9** | 🟡 MED | (NOU, necommitat) Pill-urile de status numără dintr-un set deja filtrat → restul = 0 | `hosting/accounts/+page.svelte` + `hosting-accounts.remote.ts:1542` |
| **L1** | 🟢 LOW | Coerciție valută la RON pentru orice ≠ RON/EUR/USD | `hosting/notifications.ts:1104` |
| **L2** | 🟢 LOW | `escapeHtml` (text-context) folosit pentru atribute `href`; `panelUrl` neescapat | `_escape-html.ts` + `account-created.ts:34`, `password-reset.ts:29` |
| **L3** | 🟢 LOW | Suspend/reactivare manuală deduplicate pe zi calendaristică | `hosting/notifications.ts:1822,1967` |
| **L4** | 🟢 LOW | MRR însumează valute mixte (RON+EUR+USD) fără conversie | `hosting-dashboard.remote.ts:91` + `hosting-products.remote.ts` |
| **L5** | 🟢 LOW | `one_time` numărat ca venit lunar în widget-ul "expiră 30z" | `hosting-dashboard.remote.ts:162-185` |
| **L6** | 🟢 LOW | Mapare ciclu→luni duplicată în 5+ locuri (vocabular divergent) | `mapper.ts:49` + 4 alte |
| **L7** | 🟢 LOW | Preview debug email reproduce snapshot-ul + 21 hardcodat | `_debug-hosting-emails/+server.ts:338-340` |
| **L8** | 🟢 LOW | Import WHMCS scrie `recurringAmount` din prețul WHMCS (a 4-a sursă) | `whmcs-import-da.remote.ts:502,575` |
| **L9** | 🟢 LOW | (NOU, necommitat) KPI dashboard compară `createdAt` cu `Date` JS în raw `sql` | `hosting-dashboard.remote.ts:93` |

**Confirmate corecte (info):** I1 email-uri suspended/reactivated/payment-failed folosesc `invoice.totalAmount` (corect); I2 motorul de facturare bps/cenți e corect (confirmă că 1149 e bun, 866 e greșit); I3 recipient/tenant/dueDate solide; I4 fix-ul `suspendUser`/`unsuspendUser` din DA client e corect (repară un eșec silențios).

---

## 2. CRITICE

### C1 — Email reminder citește `recurringAmount` (snapshot stale) în loc de prețul facturat 🔴
**Fișier:** [`src/lib/server/hosting/notifications.ts:1056,1121`](app/src/lib/server/hosting/notifications.ts#L1121) · **Aceasta e problema raportată.**

`notifyHostingRenewalReminder` selectează `account.recurringAmount` (1056) și calculează:
```ts
const subtotal = Number(account.recurringAmount ?? 0);   // :1121  ← snapshot
const vatAmount = Math.round((subtotal * vatRate) / 100);
const totalAmount = subtotal + vatAmount;
```
Dar factura reală e generată din `recurringInvoice.amount`, care la rândul lui e setat din `hostingProduct.price` de `recurring-template.ts` (care **ignoră intenționat** `recurringAmount` — comentariu la liniile 122-127). Comentariul de la `notifications.ts:1119-1120` ("recurringAmount is NET ... matches what the customer will actually be charged") e **fals** și probabil a cauzat bug-ul.

- **Caz real:** email = 866.00 net / 1047.86 total; catalog/factură = 1149.00 net / 1390.29 total.
- **Impact:** client primește în email un preț care nu corespunde cu factura → dispute, erodare încredere. Apare doar când snapshot-ul a driftat (nu la fiecare trimitere), dar driftul e silențios.
- **Fix:** sursa subtotalului = `recurringInvoice` pentru `hostingAccountId == accountId`:
  ```ts
  // citește recurringInvoice.amount (CENȚI), .currency, .taxRate (BPS → /100 = procent)
  // dacă nu există rând recurringInvoice → skip + logWarning (nu trimite snapshot)
  ```
  Alternativ: extrage `resolveHostingCatalogPrice()` din `recurring-template.ts` (vezi handoff-ul original) și apeleaz-o în dry-run. **Nu mai citi `account.recurringAmount` pentru sume către client.** Corectează și comentariul fals de la 1119-1120.
- **Atenție:** ia valuta din `recurringInvoice.currency` (poate diferi de `account.currency` după conversie BNR).

---

### C2 — Template recurent Stripe stochează `rate` în CENȚI → scheduler-ul facturează ×100 🔴
**Fișiere:** [`emit-keez-invoice.ts:564-575`](app/src/lib/server/stripe/post-payment/emit-keez-invoice.ts#L568) + [`invoice-utils.ts:556,670`](app/src/lib/server/invoice-utils.ts#L556) + [`recurring-invoices.ts:17-26`](app/src/lib/server/scheduler/tasks/recurring-invoices.ts#L17)
**Confirmat de Gemini ca real și accesibil. Latent — se declanșează la prima reînnoire generată de scheduler pentru un cont Stripe.**

Contract divergent pentru `lineItemsJson.rate`:
- `recurring-template.ts:282` (canonic): `rate: effectiveAmount / 100` → **DECIMAL RON**.
- `emit-keez-invoice.ts:568` (Stripe): `rate: netCents` → **CENȚI**.

Scheduler-ul:
1. `recurring-invoices.ts:18-26` selectează **orice** template `isActive` cu `nextRunDate <= now` — **fără filtru** pe template-urile Stripe (`notes` care încep cu `stripe_subscription:`).
2. `invoice-utils.ts:556`: `let latestRate = Math.round(item.rate * 100)` — presupune DECIMAL. Pentru un `rate` de 114900 cenți → **11.490.000 cenți = 114.900 RON**.
3. `invoice-utils.ts:670`: `amount = subtotal` — **suprascrie** header-ul corect cu subtotalul umflat din line-items (deci nici headerul corect din emit:553 nu salvează).
4. `taxRate`-ul line-item-ului (deja bps, ex. 2100) e re-înmulțit la `invoice-utils.ts:649` → 210000 bps.

- **Impact:** prima reînnoire generată de cron pentru un cont hosting cu abonament Stripe = factură ~×100 (114.900 RON în loc de 1.149 RON), plus dublă-facturare (Stripe taxează deja). Document fiscal greșit împins și în Keez.
- **Fix (defense in depth — fă AMBELE):**
  - (a) În `createRecurringTemplate`: `rate: netCents / 100, amount: netCents / 100, taxRate: vatPercent` (procent, NU `lineTaxRate`). Cel mai bine: rutează template-urile Stripe prin `upsertRecurringInvoiceForHostingAccount` (un singur writer canonic).
  - (b) În `processRecurringInvoices`: skip pentru template-uri al căror `notes`/sursă = `stripe_subscription:` (Stripe deține reînnoirea lor).
  - Test replay: un template Stripe generează totalul corect în cenți.

---

## 3. HIGH

### H1 — `recurringInvoice.amount` nu se re-sincronizează automat din catalog 🟠
**Fișiere:** `updateHostingProduct` (`hosting-products.remote.ts`) + `directadmin-sync-accounts.ts`

`upsertRecurringInvoiceForHostingAccount` are doar 3 apelanți de producție: create cont (`hosting-accounts.remote.ts:238`), import WHMCS, endpoint debug. **Nici editorul de preț din catalog, nici sync-ul nocturn DA nu îl apelează** (grep confirmă: niciun task de scheduler nu importă `recurring-template.ts`).
- **Impact:** după ce un operator schimbă `hostingProduct.price`, clienții continuă să fie facturați (și împinși în Keez) la prețul vechi până când cineva rulează manual `/api/_debug-sync-hosting-recurring`. **Bani facturați greșit, silențios, în tot intervalul.**
- **Notă din verificare:** template-ul hosting are `lineItemsJson` fără `serviceId`/`keezItemExternalId`, deci cele două ramuri de refresh-preț din generator (`invoice-utils.ts:572` și `:599`) sunt moarte pentru hosting → rata stocată stale curge verbatim în factura fiscală.
- **Fix:** la finalul `updateHostingProduct`, re-rulează upsert pentru toate conturile active legate de produs (după `hostingProductId`, și după `daPackageId` cu garda de ambiguitate din `recurring-template.ts:172-180`). Plus: pasă nocturnă de re-sync pentru toate conturile active (≤24h drift). Centură-și-bretele: `generateInvoiceFromRecurringTemplate` să re-rezolve prețul din catalog la generare pentru template-urile hosting.

### H2 — Edit manual cont scrie snapshot dar NU re-rulează upsert-ul 🟠
**Fișier:** [`hosting-accounts.remote.ts:905-944`](app/src/lib/remotes/hosting-accounts.remote.ts#L912) (vs create la `:238`)

`updateHostingAccount` scrie `recurringAmount`, `hostingProductId`, `billingCycle`, `currency` în snapshot (`:921-924`) și se întoarce `{success:true}` — **fără** apel `upsertRecurringInvoiceForHostingAccount`. `createHostingAccount` îl apelează (`:238`). `hostingProductId`/`billingCycle`/`currency` sunt exact inputurile resolver-ului de preț.
- **Impact:** operatorul schimbă pachetul/ciclul/prețul → `recurringInvoice` rămâne pe tariful vechi → factura următoare e greșită, dar panelul/email-ul arată valoarea nouă. Cauza structurală a divergenței în 3 direcții.
- **Fix:** după `db.update`, apelează upsert-ul cu valorile post-update (best-effort, ca la create `:219-270`). **Recomandat:** scoate complet câmpul editabil `recurringAmount` din formular și lasă catalogul singura sursă (upsert-ul oricum ignoră valoarea tastată).

### H3 — Ciclul `biannually` → niciun `recurringInvoice` creat (pierdere de venit) 🟠
**Fișier:** [`recurring-template.ts:32-52`](app/src/lib/server/hosting/recurring-template.ts#L32)

`cycleToRecurring()` tratează `semiannually`/`biennially`/`triennially` dar **NU** `biannually` (alias WHMCS scris cu „a"). `biannually` e valoare permisă în picklist-ul `UpdateAccountSchema` (`hosting-accounts.remote.ts:814-825`) și în comentariul schemei. Pe căile care apelează upsert-ul (create cont `:250`, endpoint `_debug-sync` `:102`), `biannually` → `default: return null` → upsert skip cu `billing_cycle_one_time_or_unknown` → **niciun `recurringInvoice`, nicio facturare**.
- **Fix:** adaugă `case 'biannually':` ca fall-through lângă `case 'semiannually': return { type:'monthly', interval:6 }` (la fel cum fac deja `emit-keez-invoice.ts:490-493` și `stripe/price.ts:95-97`). Pe termen lung: normalizează `biannually`→`semiannually` la scriere și scoate aliasul din picklist.

### H4 — Retry manual admin pentru email hosting ȘTERGE rândul apoi aruncă eroare 🟠
**Fișier:** [`email-logs.remote.ts:212,119-132`](app/src/lib/remotes/email-logs.remote.ts#L212)

`retryEmailLog` face `db.delete(emailLog)` (`:212`) ÎNAINTE de dispatch; pentru email cu `payload:null` cade pe `dispatchLegacyRetry`, care aruncă fiindcă `hosting-renewal-reminder` (și toate `hosting-*`) nu sunt în `LEGACY_RETRYABLE_EMAIL_TYPES`.
- **Impact:** admin apasă „Retry" pe un reminder/suspendare/payment-failed eșuat → rândul e șters → eroare → email pierdut **și** fără urmă în log. Confirmă că bug-ul dedupe-before-send (M1) nu are niciun escape hatch uman.
- **Fix:** nu șterge rândul înainte de dispatch reușit (șterge doar la succes, sau restore la eșec). Pentru hosting: fă-le replayable (payload care re-invocă `notifyHostingX(tenantId, accountId, …)` din metadata; dedupe deja previne dublu-send).

### H5 — Provision Stripe scrie snapshot dar NU creează template recurent pe calea DA 🟠
**Fișier:** [`stripe/post-payment/provision-da.ts:276`](app/src/lib/server/stripe/post-payment/provision-da.ts#L276)

`provision-da.ts` scrie `recurringAmount = product.price` (`:276`, valută copiată corect și ea, `:277`) dar **nu** apelează upsert-ul. Singurul template recurent al unui cont Stripe e cel creat de `emit-keez-invoice.ts` (= bug-ul C2 cu cenți). Dacă emit-keez eșuează/e sărit, contul are snapshot + email reminder care îl citează, dar **niciun template** → nicio factură CRM generată corect.
- **Fix:** decide o singură proveniență de template per cont. **Recomandat:** rutează provisioning-ul Stripe prin același `upsertRecurringInvoiceForHostingAccount` ca create manual (cale unică, unități corecte) și șterge insert-ul ad-hoc din emit-keez. Sau documentează explicit că Stripe nu are template CRM și gate-uiește email-ul + scheduler-ul corespunzător.

### H6 — Portal CLIENT afișează snapshot-ul stale ca „Preț" 🟠
**Fișiere:** [`portal-hosting.remote.ts:50,88`](app/src/lib/remotes/portal-hosting.remote.ts#L50) + `client/[tenant]/(app)/hosting/+page.svelte:128` + `.../accounts/[accountId]/+page.svelte:147`

Ambele pagini client randează `{fmtPrice(account.recurringAmount, account.currency)}` din snapshot — niciun join la `recurringInvoice`/`hostingProduct`.
- **Impact:** clientul logat vede persistent (nu doar la email) un preț care poate diferi de factura reală. Suprafața cu cea mai mare încredere.
- **Fix:** în `portal-hosting.remote.ts` join `recurringInvoice` (pe `hostingAccountId`) și întoarce `recurringInvoice.amount`/`currency`; fallback `hostingProduct.price` (BNR) când nu există template.

### H7 — (NOU, necommitat) Alertă admin status-change suprimată după eșec email client 🟠
**Fișier:** `hosting/notifications.ts:648-656, 716-722` (suspend) și `:907-915, 975-981` (reactivare)

În `notifyHostingSuspended`/`notifyHostingReactivated`, `fireAutoAdminStatusAlert(...)` e plasat **după** early-return-ul de dedupe al email-ului client. Comentariul promite că alerta admin „are propriul dedupe pe invoiceId, retry-urile se colapsează natural" — dar fiind sub early-return, asta nu se întâmplă niciodată:
1. Prima rulare: dedupe client se inserează, apoi `sendWithPersistence` aruncă → catch la nivel de funcție → linia alertei admin nu e atinsă.
2. Retry în aceeași zi: dedupe client există → `return` → **alerta admin nu e încercată niciodată** (până se schimbă day-bucket-ul).
- **Impact:** un eșec tranzitoriu de send client pierde permanent notificarea internă „contul a fost auto-suspendat" — exact în cazul de eșec în care ops are cea mai mare nevoie de ea. Fluxurile *manuale* fac corect (alertă în try/catch separat, necondiționat).
- **Fix:** mută `fireAutoAdminStatusAlert(...)` în afara try-ului de email client / dincolo de early-return (ex. `finally`, sau restructurare ca alerta admin să ruleze mereu — e deja deduplicată și nu aruncă).

---

## 4. MEDIUM

### M1 — Eșec SMTP tranzitoriu pierde reminder-ul (dedupe înainte de send + payload:null) 🟡
**Fișier:** `hosting/notifications.ts:1144-1160,1182,1229-1236`

Rândul de dedupe se inserează (`:1144`) ÎNAINTE de send (`:1189`); `payload:null` (`:1182`). Dacă `sendWithPersistence` aruncă tranzitoriu, catch-ul (`:1229-1236`) doar loghează + rethrow — **nu** șterge dedupe-ul. Rularea următoare a scheduler-ului găsește dedupe-ul → `noop` (`hosting-renewal-reminder.ts:134-138`). `email-retry.ts:96` exclude `payload:null`, iar notifier-ul nu e în `EMAIL_SEND_REGISTRY` → rând abandonat permanent.
- **Impact:** un blip SMTP poate suprima un avertisment de reînnoire (14/7/1z) pentru ciclul respectiv. Operatorul e alertat (logError + notificare admin), deci nu e silențios pentru ops; cazul cel mai rău (client fără niciun avertisment) cere ca fereastra de 1z să blip-uiască.
- **Fix (cel mai mic):** în catch, șterge rândul de dedupe înainte de rethrow → scheduler-ul re-trimite la rularea următoare (cheia per-(dueDate,window) păstrează idempotența la succes). Vezi și H4 (escape hatch manual).

### M2 — `getLatestBnrRate` întoarce rata AS-IS (per multiplier) → ×100 pentru HUF/JPY 🟡
**Fișiere:** [`bnr/client.ts:132`](app/src/lib/server/bnr/client.ts#L132) + `recurring-template.ts:404-435`

`convertCentsViaBnr` presupune „1 unitate = N RON", dar `getLatestBnrRate` întoarce `rate` AS-IS (comentariu propriu `:130-131` „per multiplier units"; docstring-ul `:113` se contrazice cu corpul). BNR publică HUF cu `multiplier=100`. → conversia e greșită cu factorul multiplier (×100 pentru HUF).
- **Impact:** latent azi (OTS vinde în RON/EUR, multiplier=1); devine mis-billing real în clipa folosirii unei valute cu multiplier.
- **Fix:** **NU** schimba `getLatestBnrRate` în loc (Keez `mapper.ts:366,377` consumă intenționat rata AS-IS). Adaugă `getLatestBnrRatePerUnit` (= `rate/multiplier`) și pointează ambele copii ale `convertCentsViaBnr` (inclusiv duplicatul din `_debug-cleanup-hosting-drafts/+server.ts:243-264`) către ea. Corectează docstring-urile contradictorii.

### M3 — Fallback TVA divergent: 19 vs 21 în 4+ locuri 🟡
**Fișiere:** `emit-keez-invoice.ts:141` (`?? 19`), `invoice-utils.ts:476` (`?? 19`), `recurring-template.ts:270` (`?? 21`), `notifications.ts:1117` (`?? 21`); + `recurring-invoices.remote.ts:126`, `public-hosting.remote.ts:94`, `portal-hosting.remote.ts:120`, `invoices.remote.ts:231`; default coloană schemă = 19 (`schema.ts:1432`).

Un tenant **fără** rând `invoiceSettings` (posibil — INSERT-ul există doar la salvarea din UI-ul de settings, `invoice-settings.remote.ts:212`, fără bootstrap la creare tenant) ar primi document fiscal Keez la 19% dar email/template la 21% pentru același produs. Pentru `ots` (rând există) toate căile citesc valoarea stocată → fără mis-billing live azi.
- **Fix:** o singură constantă/`getDefaultTaxRate(tenantId)` (per `feedback_no_hardcode.md`) folosită în toate locurile; aliniază și default-ul coloanei (19→21).

### M4 — Suprafețe operator (SUMĂ, MRR, ARR, dashboard, banner edit) afișează snapshot 🟡
**Fișiere:** `hosting-account-row.svelte:193`, `hosting-dashboard.remote.ts:91,181,234,402`, `hosting-products.remote.ts:251-264`, `hosting-accounts.remote.ts:1544`, `hosting-account-edit-form.svelte:481`

Toate citesc `recurringAmount` (snapshot), niciuna `recurringInvoice.amount`/`hostingProduct.price`. Include MRR KPI, istoricul MRR 12 luni, ARR (`mrr×12`), distribuția per produs, MRR per client grupat.
- **Impact:** reconcilierea de venit a operatorului poate să nu corespundă cu ce e facturat. Operator-facing → medium.
- **Fix:** o sursă canonică pentru display. Curat: derivă din `recurringInvoice.amount` (LEFT JOIN), DAR conturile fără template (one_time/produs nerezolvat) ar avea MRR null → preferă ruta auto-heal (fix H1/H2) care reconciliază snapshot-ul, păstrând SQL-ul agregat ieftin.

### M5 — Formularul de edit hardcodează 19% TVA 🟡
**Fișier:** [`hosting-account-edit-form.svelte:184`](app/src/lib/components/hosting/hosting-account-edit-form.svelte#L184)

`const vat = ron * 1.19;` (randat ca „cu TVA" la `:901`). Hardcodează 19%, contrazice `recurring-template.ts:270`/`notifications.ts:1117` (21). Variabila `vat` ține de fapt grossul, nu TVA-ul.
- **Fix:** pasează `defaultTaxRate` în componentă; `const gross = ron * (1 + vatRate/100)`. Redenumește variabila. (Netul afișat e deja din snapshot — vezi M4.)

### M6 — Drift-detector compară 2 snapshot-uri, nu față de catalog 🟡
**Fișier:** [`_debug-hosting-invoices-state/+server.ts:217`](app/src/routes/[tenant]/api/_debug-hosting-invoices-state/+server.ts#L217)

WHERE = `invoice.amount != hostingAccount.recurringAmount` (două snapshot-uri). Selectează `productPrice` (`:200`) dar nu-l compară. Bug-ul raportat e exact cazul unde cele două snapshot-uri sunt de acord pe o valoare greșită (~866) iar catalogul zice 1149 → detectorul raportează zero drift fix în scenariul pe care ar trebui să-l prindă.
- **Fix:** adaugă clasă de drift `invoice/recurringAmount vs hostingProduct.price` (normalizat valutar, BNR-aware). Tratează catalogul ca autoritate oriunde calculezi drift.

### M7 — `_debug-cancel-and-regenerate` regenerează fără re-sync din catalog 🟡
**Fișier:** [`_debug-cancel-and-regenerate/+server.ts:146`](app/src/routes/[tenant]/api/_debug-cancel-and-regenerate/+server.ts#L146)

Scop declarat: „Anulată — facturare corectată" (`:140`). Dar apelează `generateInvoiceFromRecurringTemplate(template.id)` (`:146`) **fără** upsert prealabil. Dacă template-ul ține snapshot-ul stale (chiar problema), factura „corectată" reproduce aceeași sumă greșită.
- **Fix:** înainte de regenerare, apelează upsert-ul pentru contul legat (force re-sync din catalog); întoarce diff preț before/after în preview.

### M8 — `_debug-patch-hosting-account` mută preț/produs fără re-sync 🟡
**Fișier:** [`_debug-patch-hosting-account/+server.ts:173-189`](app/src/routes/[tenant]/api/_debug-patch-hosting-account/+server.ts#L173)

Poate schimba `hostingProductId`, `currency`, `recurringAmount` (toate inputurile resolver-ului) — apoi doar `db.update` + log, fără upsert. Docstring-ul (`:13-14`) zice „catalogul e sursa de adevăr" dar nu propagă în template.
- **Fix:** după apply, când s-au schimbat `hostingProductId`/`currency`/`recurringAmount`/`billingCycle`, apelează upsert-ul și include diff-ul în răspuns.

### M9 — (NOU, necommitat) Pill-urile de status numără dintr-un set deja filtrat → restul = 0 🟡
**Fișier:** `hosting/accounts/+page.svelte` (IIFE statusCounts) + `hosting-accounts.remote.ts:1282-1297,1542`

`allGroups` e rezultatul deja filtrat după `statusFilter` (query aplică `eq(status, …)`, `byStatus` la `:1542` se construiește doar din rândurile întoarse). `statusFilter` inițial = `'active'`, deci la prima randare: Active = N, **toate celelalte pill-uri = 0** (și „Eșuate" e mereu 0, „Toate" exclude `failed`).
- **Fix:** numără independent de filtrul de status (query agregat separat care ignoră `status`).

---

## 5. LOW

- **L1** — `notifications.ts:1104`: orice valută ≠ EUR/USD e forțată la `'RON'`. Edge-case (formularul oferă RON/EUR/USD). Fix: ia valuta din `recurringInvoice.currency`; pentru valute nesuportate skip+log, nu coerciție.
- **L2** — `_escape-html.ts`: helper text-context folosit pe `href`. Neexploatabil azi (`"`→`&quot;`, URL-uri server-construite), dar `account-created.ts:34` și `password-reset.ts:29` interpolează `panelUrl` **neescapat**. Fix: helper `escapeAttr`/URL dedicat; escapează `panelUrl`.
- **L3** — `notifications.ts:1822,1967`: suspend/reactivare manuală dedupe pe `dayBucketEET()` fără discriminator de acțiune → re-suspend în aceeași zi nu trimite al doilea email. Agravat de lipsa gărzii de status curent. Fix: token per-acțiune în cheia de dedupe.
- **L4** — `hosting-dashboard.remote.ts:91` etc.: MRR însumează cenți din valute diferite fără conversie. Latent (azi RON). Fix: grupare per valută sau normalizare BNR la RON; minim filtrează `currency='RON'`.
- **L5** — `hosting-dashboard.remote.ts:162-185`: `one_time` cade pe divizor `1` în widget-ul „expiră 30z" → numărat ca venit lunar integral (KPI-urile principale folosesc `MRR_CASE_SQL` cu `ELSE 0`, deci diverg). Fix: ramură explicită `one_time → 0` + gardă `/0`.
- **L6** — Mapare ciclu→luni duplicată în 5+ locuri cu vocabular divergent (`semiannually` vs `biannually`). Cauza structurală a H3. Fix: o singură `BILLING_CYCLE_MONTHS` (din `mapper.ts:49`) din care derivă SQL CASE + divizorii JS + mapa recurentă.
- **L7** — `_debug-hosting-emails/+server.ts:338-340`: preview-ul reproduce `recurringAmount || 4990` + `previewVatRate = 21` hardcodat (deși docstring-ul zice că citește `invoiceSettings`). Preview-ul confirmă bug-ul în loc să-l expună. Fix: rezolvă din catalog + citește `invoiceSettings`; sau afișează snapshot vs catalog side-by-side.
- **L8** — `whmcs-import-da.remote.ts:502,575`: `recurringAmount = priceToCents(s.amount)` din WHMCS (a 4-a proveniență a snapshot-ului). Fix: după ce upsert-ul rezolvă prețul din catalog, scrie `effectiveAmount` înapoi în `recurringAmount`; verifică că importul setează `hostingProductId`/`daPackageId`.
- **L9** — (NOU, necommitat) `hosting-dashboard.remote.ts:93`: `SUM(CASE WHEN ${createdAt} >= ${minus30} …)` leagă un `Date` JS în raw `sql`, ocolind `toDriver` al customType-ului; plus comparație lexicografică inconsistentă între timestamp-uri cu `T`/`Z` (ORM) și spațiu (default SQLite). Fix: `${minus30.toISOString()}` (convenția codebase-ului).

---

## 6. Confirmate CORECTE (nu modifica)

- **I1** — `notifyHostingSuspended`/`PaymentFailed`/`Reactivated` folosesc `invoice.totalAmount` (cenți), NU snapshot-ul → sursa corectă. Modelul pe care trebuie să-l urmeze fix-ul C1.
- **I2** — Motorul de facturare (`invoice-utils.ts`) face corect bps/procent + cenți: catalog 114900 → 24129 TVA → 139029 total = exact 1390.29. **Confirmă: 1149 e corect, 866 e greșit.**
- **I3** — Rezolvarea recipient (3-tier, tenant-scoped), guard `nextDueDate`, cheia de dedupe pe `dueDate` — solide. Notă minoră: `formatTextDateRo` nu fixează timezone → poate da off-by-one pe host UTC-negativ (inofensiv în RO).
- **I4** — (necommitat) Fix-ul `suspendUser`/`unsuspendUser` din `directadmin/client.ts` (de la `action=suspend` la `CMD_SELECT_USERS` + `dosuspend`/`select0`) e **corect** — repară un eșec silențios al vechii forme.

**Refuzate la verificarea adversarială (false positive — NU sunt probleme):** divergență TVA email-vs-factură (ambele citesc aceeași coloană per-tenant); rotunjire TVA (corectă, half-up integer); template-urile manuale noi nu afișează sume (intenționat); provision-da fără conversie BNR (o singură valută, coerent); calea principală Stripe→CRM→Keez (matematică consistentă); divergența import WHMCS snapshot-vs-factură (nu se creează factură la import pe acea cale).

---

## 7. Plan de remediere (fazat)

### Faza 0 — Hotfix bug raportat (azi, mic, customer-facing)
1. **C1**: `notifyHostingRenewalReminder` să ia subtotal/valută/TVA din `recurringInvoice` pentru `hostingAccountId` (fallback: skip+log dacă nu există template). Corectează comentariul fals `:1119-1120`.
2. Test regresie: `recurringAmount=86600`, `recurringInvoice.amount=114900` → email subtotal `114900`, TVA `24129`, total `139029`.
3. **Backfill operațional:** rulează `/ots/api/_debug-sync-hosting-recurring` apoi verifică cu `_debug-hosting-invoices-state` că snapshot-urile au fost reconciliate (corectează întâi M6 ca să compari față de catalog).
4. Script demo preview email (per `feedback_email_demo_preview.md`): `app/scripts/demo-renewal-reminder-email.ts`.

### Faza 1 — Oprește hemoragia (bug critic de bani)
5. **C2**: corectează cenți/decimal în `emit-keez-invoice.ts` **și** filtrează template-urile Stripe în `processRecurringInvoices`. Test replay.
6. **H5**: unifică proveniența template-ului Stripe (rutează prin `upsertRecurringInvoiceForHostingAccount`).

### Faza 2 — Elimină driftul la sursă (single source + auto-heal)
> Direcția recomandată de audit **și** de Gemini: păstrează `recurringInvoice` ca sursă derivată unică + auto-heal; scrie `effectiveAmount` rezolvat înapoi în `recurringAmount` ca snapshot-ul să nu mai poată drifta. Audit trail via `recurringInvoice.updatedAt`.

7. **H1**: `updateHostingProduct` re-rulează upsert pentru conturile afectate + pasă nocturnă de re-sync.
8. **H2**: `updateHostingAccount` re-rulează upsert (sau scoate câmpul editabil `recurringAmount`).
9. **M7/M8**: endpoint-urile debug `cancel-and-regenerate` și `patch-hosting-account` re-rulează upsert înainte de generare/după patch.
10. **H6 + M4 + L8**: după ce snapshot-ul nu mai driftează, suprafețele de display (portal client, panel SUMĂ, MRR, dashboard) devin automat corecte; scrie valoarea rezolvată înapoi în snapshot la import WHMCS.

### Faza 3 — Hardening corectitudine
11. **H3 + L6**: `biannually` în `cycleToRecurring` (sau normalizare) + centralizare `BILLING_CYCLE_MONTHS`.
12. **H4 + M1**: email-uri hosting replayable (payload + registry) sau șterge dedupe la eșec; nu șterge rândul de log înainte de dispatch reușit.
13. **H7**: mută alerta admin în afara early-return-ului de dedupe (necommitat — repară înainte de ship).
14. **M3 + M5 + L7**: o singură constantă TVA (`getDefaultTaxRate`); scoate hardcodările 19/21; preview-ul debug să citească sursa reală.
15. **M2**: `getLatestBnrRatePerUnit` + ambele copii `convertCentsViaBnr`.
16. **M6**: drift-detector vs catalog (autoritate).
17. **M9 + L9 + L1-L5**: corecturi UI/robustețe (pill-counts, timestamp raw-sql, coerciție valută, escape href, dedupe per-acțiune, valute mixte MRR, one_time).

---

## 8. Note metodă & verificare

- **Workflow multi-agent:** 40 agenți, 7 dimensiuni × finder + verificare adversarială per finding. 31 findinguri brute → **22 confirmate, 9 refuzate**. Dimensiunea `wip-review` a eșuat să producă output structurat → acoperită separat de un agent dedicat (a găsit H7, M9, L9 + a confirmat I4).
- **A doua opinie (Gemini):** a citit codul independent și a **confirmat** toate cele 8 findinguri majore, inclusiv accesibilitatea criticului C2 (Stripe ×100) și suprascrierea header-ului la `invoice-utils.ts:670`. A recomandat aceeași direcție (single-derived-source + auto-heal) și a notat TVA ca a 4-a posibilă sursă de drift.
- **Confirmări independente (Claude):** C1, H1 (sync nocturn nu apelează upsert), H2 (create apelează upsert, update nu), provision-da copiază valuta corect.
- **Limitări:** fără credențiale DB live → câteva findinguri (L4/L1 valute non-RON, BNR multiplier) sunt confirmate ca *reachable prin cod* dar nu am putut confirma un cont afectat în producție. `svelte-check` a dat OOM în mediul agentului → componentele Svelte au fost revizuite prin citire.

---

*Raport generat 2026-05-29. Următorul pas sugerat: aprobă Faza 0 (hotfix C1) — pot implementa cu test de regresie. Spune „Nu scrie cod încă" dacă vrei doar planul rafinat mai întâi.*
