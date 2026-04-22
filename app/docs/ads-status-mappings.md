# Ads Payment Status — Mapping Reference

**Scop:** document single-source-of-truth pentru cum statusurile raw de la Meta, Google și TikTok sunt mapate la categoria noastră unificată `AdsPaymentStatus`. Consultă acest document când adaugi un status nou, investighezi o alertă sau scrii teste.

**Ultima verificare împotriva docs oficiale:** 2026-04-22 (Claude Opus 4.7 + Gemini review)

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
