# Ads Payment Status — Mapping Reference

**Scop:** document single-source-of-truth pentru cum statusurile raw de la Meta, Google și TikTok sunt mapate la categoria noastră unificată `AdsPaymentStatus`. Consultă acest document când adaugi un status nou, investighezi o alertă sau scrii teste.

**Ultima verificare împotriva docs oficiale:** 2026-07-17 — verificat live împotriva catalogului `googleAdsFields` v21 (nu doar docs): `customer.suspension_reasons` NU există, tot lanțul a fost eliminat (vezi secțiunea Google).

---

## Categoria unificată

`type AdsPaymentStatus = 'ok' | 'grace_period' | 'risk_review' | 'payment_failed' | 'suspended' | 'closed';`

| Valoare | Ce înseamnă pentru client | Declanșează email? | Prioritate notificare |
|---|---|---|---|
| `ok` | Cont funcțional, reclame rulează | Nu | — |
| `grace_period` | Factură neplătită, dar reclamele încă merg până la X zile | Da (digest) | high |
| `risk_review` | În revizuire / limitat / așteptare — nu e critică, dar necesită atenție | Da (digest) | high |
| `payment_failed` | Plată eșuată sau billing anulat — reclamele oprite | Da (digest) | urgent |
| `suspended` | Cont suspendat de platformă (politică/permisiune/admin) | Da (digest) | urgent |
| `closed` | Cont închis definitiv | Da (digest) | urgent |

**Regulă de bază:** `unknown code → risk_review + log warning` (fail-safer — preferabil să alertezi abuziv decât să ratezi un cont suspendat).

---

## Meta (Facebook) Marketing API v25.0

**Surse:** [AdAccount reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account)

### `account_status`

| Cod | Simbol | Mapare | Note |
|---|---|---|---|
| 1 | ACTIVE | `ok` | Ignoră complet `disable_reason` în acest caz |
| 2 | DISABLED | `suspended` | Verifică `disable_reason` pentru specifice |
| 3 | UNSETTLED | `payment_failed` | Facturi neplătite |
| 7 | PENDING_RISK_REVIEW | `risk_review` | Meta verifică contul |
| 8 | PENDING_SETTLEMENT | `payment_failed` | Plată în așteptare |
| 9 | IN_GRACE_PERIOD | `grace_period` | Plată întârziată, grace period activ |
| 100 | PENDING_CLOSURE | `suspended` | Va fi închis |
| 101 | CLOSED | `closed` | Închis definitiv |
| 102 | ANY_ACTIVE | (nu apare) | Filter-only, nu e returnat live |
| 103 | ANY_CLOSED | (nu apare) | Filter-only |
| altele | ? | `risk_review` + log | fail-safer |

### `disable_reason` (override, doar când `account_status != 1`)

| Cod | Simbol | Mapare override |
|---|---|---|
| 0 | NONE | — (fără override) |
| 1 | ADS_INTEGRITY_POLICY | `suspended` |
| 2 | ADS_IP_REVIEW | `risk_review` |
| 3 | RISK_PAYMENT | `payment_failed` |
| 4 | GRAY_ACCOUNT_SHUT_DOWN | `suspended` |
| 5 | AD_ACCOUNT_DISABLED | `suspended` |
| 6 | BUSINESS_DISABLED | `suspended` |
| 7 | MPG_AFFILIATE_DISABLED | `suspended` |
| 8 | PRE_PAYMENT_ADS_DISABLED | `payment_failed` |
| 9 | PERMISSION_REVOKED | `suspended` |
| 11 | COMPROMISED_ACCOUNT | `suspended` |
| 12 | BUSINESS_INTEGRITY_RS | `suspended` |

**Logică:** dacă status=1 → `ok` (ignorăm disable_reason pentru a preveni false positive din date stale). Altfel, consultăm întâi disable_reason; dacă nu e în listă, cădem la account_status.

### `disable_reason` + `account_status` RO copy (2026-04-24)

Capturate la nivel primar (numeric) în `paymentStatusRaw` (`code` + `disableReason`); afișate ca RO label + sugestie acționabilă în [`$lib/ads/status-copy.ts:translateMetaDisableReason`](../src/lib/ads/status-copy.ts) și `translateMetaAccountStatus`.

Logica `describeStatus` pentru Meta:
1. Dacă `disable_reason` ≠ 0 → headline + body + sugestie din `translateMetaDisableReason` (11 valori traduse)
2. Dacă lipsește (status-uri ca `PENDING_RISK_REVIEW`/`IN_GRACE_PERIOD`/`PENDING_CLOSURE`/`CLOSED`) → cade pe `translateMetaAccountStatus` (7 valori cu copy specific: 2, 3, 7, 8, 9, 100, 101)
3. Dacă nici una nu produce o traducere → cade la generic copy din ramura finală a `describeStatus`

**Exemple live:**

| account_status | disable_reason | UI label |
|---|---|---|
| 2 (DISABLED) | 1 (ADS_INTEGRITY_POLICY) | "Cont suspendat de Meta — Încălcare politici reclame" |
| 3 (UNSETTLED) | 8 (PRE_PAYMENT_ADS_DISABLED) | "Plata a eșuat pe Meta — Sold restant neachitat" |
| 9 (IN_GRACE_PERIOD) | 0 (NONE) | "Cont Meta — Perioadă de grație — factură neachitată" |
| 7 (PENDING_RISK_REVIEW) | 0 (NONE) | "Cont Meta — Verificare cont în curs" |
| 101 (CLOSED) | 0 (NONE) | "Cont închis definitiv" |

Forward-compat: dacă Meta adaugă `disable_reason` necunoscut (e.g. cod 13+), translator-ul emite `console.warn('[ads-status] Unknown Meta disable_reason: ...')` ca să nu rămână blind spot.

---

## Google Ads API v17+

**Surse:**
- [CustomerStatusEnum](https://developers.google.com/google-ads/api/reference/rpc/latest/CustomerStatusEnum)
- [BillingSetupStatusEnum](https://developers.google.com/google-ads/api/reference/rpc/latest/BillingSetupStatusEnum)

### `CustomerStatusEnum` (convertit din int → string în `client.ts`)

| Cod | Simbol | Mapare |
|---|---|---|
| 0 | UNSPECIFIED | `risk_review` + log |
| 1 | UNKNOWN | `risk_review` + log |
| 2 | ENABLED | depinde de billing_setup (vezi mai jos) |
| 3 | CANCELED/CANCELLED | `closed` |
| 4 | SUSPENDED | `suspended` |
| 5 | CLOSED | `closed` |

> **Notă nume:** Google enum-ul e `CANCELED` (un L). În codul nostru îl normalizăm la `CANCELLED` (două L) pentru consistență cu billing_setup.

### `BillingSetupStatusEnum` (doar când CustomerStatus = ENABLED)

| Cod | Simbol | Mapare |
|---|---|---|
| 0 | UNSPECIFIED | (căzut la risk_review prin default) |
| 1 | UNKNOWN | (căzut la risk_review prin default) |
| 2 | PENDING | `risk_review` |
| 3 | APPROVED_HELD | `ok` (reclame rulează, doar un hold administrativ) |
| 4 | APPROVED | `ok` |
| 5 | CANCELLED | `payment_failed` |
| null | (lookup API eșuat) | `ok` (null-safe, nu firăm false positive pe eșec de infra) |
| `'NONE'` (custom) | (zero billing setups returnate) | `risk_review` |

### Bug istoric — ATENȚIE

**2026-04-22:** Mapperul inițial avea codurile 3→'APPROVED' și 4→'CANCELLED' (inversate). Rezultat: 39 din 78 conturi Google de la un tenant au fost clasificate `payment_failed` când erau de fapt APPROVED. Fix-ul e în [`google-ads/client.ts:999-1013`](../src/lib/server/google-ads/client.ts) cu comentariu inline.

### `customer.suspension_reasons` — NU EXISTĂ. Nu-l re-adăuga.

**Verificat live 2026-07-17** împotriva catalogului de metadate al API-ului
(`POST /v21/googleAdsFields:search`), care e sursa autoritativă:

- `SELECT name WHERE name LIKE 'customer.%'` → **38 câmpuri**, niciunul nu e `suspension_reasons`.
- `SELECT name WHERE name LIKE '%suspension%'` pe tot API-ul → **un singur** rezultat, `recommendation.shopping_fix_merchant_center_account_suspension_warning_recommendation` (Merchant Center, fără legătură).
- `SELECT name WHERE name LIKE '%unpaid%'` / `'%balance%'` → **zero**.
- Query-ul real pe cont: `SELECT customer.suspension_reasons FROM customer` → `UNRECOGNIZED_FIELD`, pe fiecare cont.

Enum-ul `CustomerStatusEnum.SuspensionReason` (cu `UNPAID_BALANCE` etc.) **nu există**
în Google Ads API. Versiunile anterioare ale acestui document îl documentau ca
funcțional; era fals — nu a returnat niciodată nimic.

**Ce s-a întâmplat (2026-04-24 → 2026-07-17):** `fetchCustomerSuspensionReasons`
rula acel query pentru fiecare cont `SUSPENDED`, primea `UNRECOGNIZED_FIELD`, iar
un `try/catch` înghițea eroarea și returna `null`. Testele treceau fiindcă testau
doar traducătorul pur cu string-uri scrise de mână — niciun test nu atingea API-ul.
Coloana `paymentStatusRaw.googleSecondary` era `null` pe **toate** rândurile din
prod: dovada că n-a funcționat niciodată. Tot lanțul (fetch, `googleSecondary`,
`translateGoogleSuspensionReason`, randarea în UI) a fost eliminat.

**Consecință pentru mapare:** pentru Google, `suspended` e cel mai specific status
pe care API-ul îl poate da. Motivul suspendării e vizibil DOAR în interfața Google
Ads. Copy-ul din [`status-copy.ts`](../src/lib/ads/status-copy.ts) enumeră cauzele
frecvente (sold neachitat / plată suspicioasă / politici) și trimite admin-ul în
Google Ads → Billing, în loc să pretindă un motiv pe care nu-l avem.

### Override `no_delivery` — cum prindem soldul restant (2026-07-17)

**Problema:** un cont Google cu sold restant e oprit din difuzare, dar API-ul îl
raportează perfect sănătos pe TOATE câmpurile de status. Verificat live pe
DS TECH SERVICES (`3278389595`), care avea în UI bannerul *„Anunțurile tale nu
sunt difuzate — efectuează o plată pentru a acoperi soldul restant"*:

| Câmp | Valoare raportată | |
|---|---|---|
| `customer.status` | `ENABLED` | ✅ sănătos |
| `billing_setup.status` | `APPROVED` | ✅ sănătos |
| `account_budget.status` | `APPROVED` | ✅ sănătos |
| `campaign.primary_status` | `ELIGIBLE` / `LIMITED` | ✅ sănătos |
| **impresii reale, 14 zile** | **0** | 🚨 **cont mort** |

Motivul campaniei `LIMITED` vine literalmente ca `UNKNOWN` — inclusiv prin REST,
deci nu e o problemă de proto vechi în bibliotecă. Google pur și simplu nu spune.

**Soluția** (analogul lui `fetchAdvertiserCampaignHealth` de la TikTok):
`fetchGoogleDeliveryHealth` în [`google-ads/client.ts`](../src/lib/server/google-ads/client.ts)
+ regula pură `shouldFlagGoogleNoDelivery` în [`status-mappers.ts`](../src/lib/server/ads/status-mappers.ts).
Rulează DOAR când status-ul a ieșit `ok` (nu costă query-uri pe conturi deja flagged):

- fără campanii `ENABLED` → nu flagui (pauză intenționată, nu defect)
- `health === null` (query eșuat) → nu flagui (un hiccup de API nu inventează alerte)
- campanii `ENABLED` + **0 impresii ieri** → `risk_review` + `rawDisableReason='no_delivery'`

Se folosește `DURING YESTERDAY`, nu `TODAY`: o zi închisă complet în fusul orar al
contului, ca să nu citim o zi parțială drept „oprit".

**Validat pe toate cele 9 conturi cu client (2026-07-17):** 1 alertă (DS TECH),
0 false positive. Cele 5 conturi sănătoase livrau în fiecare zi; cele 3 fără
campanii active au fost excluse de guard.

**Prag:** 1 zi, ales explicit de user. Riscul acceptat: campanii cu ad schedule
weekday-only pot alerta în weekend. Dacă apare zgomot, schimbă `YESTERDAY` în
`LAST_3_DAYS` în `fetchGoogleDeliveryHealth` și pragul devine 3 zile.

**Ce să NU mapezi:** `BUDGET_CONSTRAINED` / `SEARCH_VOLUME_LIMITED` /
`BIDDING_STRATEGY_LIMITED` din `campaign.primary_status_reasons` apar pe conturi
perfect sănătoase (4 din 9 live) — sunt performanță, nu plată. Mapate la
`risk_review` ar produce alerte permanente false.

---

## TikTok Business API v1.3

**Sursă:** [/v1.3/advertiser/info/](https://business-api.tiktok.com/portal/docs?id=1738449495615490)

TikTok folosește **string enums**, nu coduri numerice. Toate valorile încep cu `STATUS_`.

| Status | Mapare | Note |
|---|---|---|
| `STATUS_ENABLE` | `ok` | Cont activ |
| `STATUS_DISABLE` | `suspended` | Dezactivat administrativ |
| `STATUS_CBD_DISABLE` | `payment_failed` | Credit-Based Delivery disabled = problemă billing |
| `STATUS_CBT_ACCOUNT_CLOSED` | `closed` | Închis prin expirare contract CBT |
| `STATUS_DELETED` | `closed` | Cont șters |
| `STATUS_PUNISH` | `suspended` | Sub penalizare |
| `STATUS_PUNISH_END_ADS` | `suspended` | Penalizare cu oprire ads |
| `STATUS_LIMIT` | `risk_review` | Cont cu livrare parțială / restricție |
| `STATUS_CONTRACT_PENDING` | `risk_review` | Contract nesemnat |
| `STATUS_CONFIRM_FAIL` | `risk_review` | Confirmare eșuată |
| `STATUS_WAIT_FOR_PUBLIC_AUTHORIZE` | `risk_review` | Așteaptă autorizare publică |
| `STATUS_ADVERTISER_AUTHORIZATION_PENDING` | `risk_review` | Legacy, echivalent |
| altele | `risk_review` + log | fail-safer |

### Status secundar (stocat în `paymentStatusRaw.tiktokSecondary`)

Pentru diagnostic mai fin, din `/advertiser/info/` capturăm acum și:

| Câmp | Descriere | Apariții tipice |
|---|---|---|
| `display_status` | Status UI-facing (poate diferi de `status`) | rar diferit |
| `sub_status` | Motiv granular: `REASON_ADVERTISER_AUDIT`, `REASON_ADVERTISER_PUNISH`, ... | la conturi cu probleme active |
| `reject_reason` | Cod explicativ pt. conturi respinse: `INVALID_BUSINESS_LICENSE`, ... | doar la STATUS_REJECTED |
| `deliveryIssue` | Agregat la nivel de cont din campaign health: `none \| budget_exceeded \| no_delivery \| all_paused` | override-ul nostru |

Fișiere: [`campaign-health.ts`](../src/lib/server/tiktok-ads/campaign-health.ts), [`client.ts:fetchAdvertiserStatuses`](../src/lib/server/tiktok-ads/client.ts). Persistate via `paymentStatusRaw` JSON (fără migrație).

### Campaign `secondary_status` — `delivering` vs `blocked`

Contul TikTok e marcat `risk_review` când primary = `STATUS_ENABLE` dar `deliveringCount === 0` peste toate campaniile user-enabled. "Delivering" include:

- `CAMPAIGN_STATUS_DELIVERY_OK` — normal
- `CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY` — **unele reclame respinse la nivel de ad, dar campania livrează cu cele aprobate**

Toate celelalte (`BUDGET_EXCEED`, `NOT_DELIVERY`, `ADVERTISER_AUDIT_DENY`, `ADVERTISER_ACCOUNT_PUNISH`, lifecycle `DONE`/`NOT_START`/`TIME_DONE`/`NO_SCHEDULE`, `DISABLE`, `DELETE`) nu contează ca delivering.

Clasificatorul pur: [`campaign-health.ts:classifySecondaryStatus`](../src/lib/server/tiktok-ads/campaign-health.ts). Testat în [`campaign-health.test.ts`](../src/lib/server/tiktok-ads/campaign-health.test.ts) (13 teste, 28 aserții).

---

## Date reale observate (tenant OTS, 2026-04-22)

Pe acest tenant specific, la primul run cu fix-ul aplicat:

| Provider | Distribuția cod raw | Total | Observații |
|---|---|---|---|
| Meta | `(1,0)` 37 · `(101,0)` 7 · `(2,9)` 1 | 45 | (2,9) = PERMISSION_REVOKED, 1 cont, suspendat corect |
| Google | ENABLED+CANCELLED 39 · ENABLED+PENDING 2 · CANCELLED 34 · SUSPENDED 1 · CLOSED 2 | 78 | 39 false-positive în versiunea veche — acum corect `ok` după fix enum |
| TikTok | STATUS_ENABLE 8 · STATUS_LIMIT 7 · STATUS_DISABLE 1 | 16 | STATUS_LIMIT era tratat silențios ca `ok` înainte de fix |

---

## Cum testezi

```bash
cd app
bun test src/lib/server/ads/payment-status.test.ts
```

Fișierul de test [`payment-status.test.ts`](../src/lib/server/ads/payment-status.test.ts) asertează **fiecare valoare documentată** + cazuri edge (disable_reason override, null billing, unknown codes, date reale observate).

**47 teste, 128 expects.** Status curent: toate trec.

---

## Cum adaugi un status nou

1. **Verifică în docs oficiale.** Nu presupune. Nu ghici. Caută valoarea exactă:
   - Meta: developers.facebook.com/docs/marketing-api/reference/ad-account
   - Google: developers.google.com/google-ads/api → căutare enum
   - TikTok: business-api.tiktok.com/portal/docs

2. **Editează [`status-mappers.ts`](../src/lib/server/ads/status-mappers.ts)** — adaugă `case` în funcția pură + ID-ul în `isKnownXStatus`.

3. **Adaugă un test** în `payment-status.test.ts` care asertează noul cod.

4. **Rulează `bun test`** — dacă trec, commit.

5. **Opțional — verifică realtime pe un cont real:**
   - Creează un endpoint temporar `src/routes/api/_debug-verify-meta/+server.ts` (vezi git history pentru exemplu)
   - Apelează-l cu `curl http://localhost:5173/...`
   - Compară `stored.paymentStatus` vs `computed_paymentStatus` din API
   - Șterge endpoint-ul după

6. **Verifică log-urile** după primul run — dacă apare `logWarning 'Unknown X status'`, ai ratat un caz.

---

## Cum investighezi o alertă falsă

1. **Identifică contul** din email sau din dashboard-ul [/admin/ads-payment-status](../src/routes/\[tenant\]/admin/ads-payment-status/+page.svelte).
2. **Citește `rawStatusCode`** afișat în dashboard — acela e codul real din API.
3. **Verifică în acest document** ce ar trebui să însemne acel cod.
4. **Rulează realtime check** (endpoint debug temporar) pentru a confirma API returnează același lucru.
5. **Dacă API zice altceva decât DB:** bug de persistență (vezi `persistStatus` în [payment-alerts.ts](../src/lib/server/ads/payment-alerts.ts)).
6. **Dacă API zice codul corect dar mapperul îl clasifică greșit:** actualizează `status-mappers.ts` + testul asociat.

---

## Istoric incidente

| Data | Incident | Cauză rădăcină | Fix |
|---|---|---|---|
| 2026-04-22 | ~90 emailuri false-positive la prima rulare | `payment_status` default 'ok' vs status real → tranziție fantomă | seed-without-alert când `paymentStatusCheckedAt IS NULL` ([`a5623ff`](https://github.com/)) |
| 2026-04-22 | 39 Google accounts false `payment_failed` | Enum BillingSetupStatus 4→'CANCELLED' în loc de 'APPROVED' | Remapare enum corectă |
| 2026-04-22 | 7 TikTok `STATUS_LIMIT` silent `ok` | Mapper fără case explicit, default era 'ok' | Adăugat case + default fail-safer la `risk_review` |
| 2026-04-24 | 1+ TikTok cont marcat `risk_review` greșit | `PARTIAL_AUDIT_DENY` era tratat ca "not delivering" deși campaniile livrau cu reclame aprobate | Introdus `isCampaignDelivering` + capturat `sub_status`/`reject_reason`/`display_status` în raw snapshot |
| 2026-04-24 | Google suspendări afișate fără context | `customer.suspension_reasons` nu era interogat; doar `status=SUSPENDED` generic apărea în UI/email | Nouă funcție `fetchCustomerSuspensionReasons` (quota-aware: doar SUSPENDED), translate RO în `describeStatus`, dashboard + email digest cu copy bogat |
| 2026-04-24 | Meta suspendări afișate fără context | `disable_reason` numeric era stocat dar nu tradus; clientul vedea doar "Cont suspendat" generic indiferent de motiv | Translatori RO `translateMetaDisableReason` (11 valori) + `translateMetaAccountStatus` (7 valori cu copy specific) integrați în `describeStatus`; partajat cu admin dashboard, card client și email digest |

---

## Fișiere relevante

- **Mapping pur (testabil):** [`src/lib/server/ads/status-mappers.ts`](../src/lib/server/ads/status-mappers.ts)
- **Teste:** [`src/lib/server/ads/payment-status.test.ts`](../src/lib/server/ads/payment-status.test.ts)
- **Wrapper Meta (log + fetch):** [`src/lib/server/meta-ads/status.ts`](../src/lib/server/meta-ads/status.ts)
- **Wrapper Google:** [`src/lib/server/google-ads/status.ts`](../src/lib/server/google-ads/status.ts)
- **Wrapper TikTok:** [`src/lib/server/tiktok-ads/status.ts`](../src/lib/server/tiktok-ads/status.ts)
- **Reconciler + digest:** [`src/lib/server/ads/payment-alerts.ts`](../src/lib/server/ads/payment-alerts.ts)
- **Scheduler task:** [`src/lib/server/scheduler/tasks/ads-status-monitor.ts`](../src/lib/server/scheduler/tasks/ads-status-monitor.ts)
- **Billing setup enum (Google client):** [`src/lib/server/google-ads/client.ts:984-1019`](../src/lib/server/google-ads/client.ts)
- **Audit inițial:** [`docs/audit/ads-status-monitor-2026-04-22.md`](audit/ads-status-monitor-2026-04-22.md)
