# TikTok Ads Reporting — Audit & Debug Reference

> Ultima actualizare: 2026-03-25

## Arhitectură

```
TikTok Business API v1.3
    ↓ (GET requests, excepție: /tool/targeting/info/ = POST)
app/src/lib/server/tiktok-ads/client.ts     ← API client (insights, campaigns, demographics, province resolution)
    ↓
app/src/lib/remotes/tiktok-reports.remote.ts ← Server queries cu cache 5 min, auth, validare valibot
    ↓
app/src/lib/utils/tiktok-report-helpers.ts   ← Aggregation (by date, by campaign)
app/src/lib/utils/tiktok-column-presets.ts   ← Column definitions for table (5 presets)
    ↓
+page.svelte (admin)  /  +page.svelte (client portal)
```

## Fișiere implementare

| Fișier | Rol |
|--------|-----|
| `app/src/lib/server/tiktok-ads/client.ts` | API client — listCampaignInsights, listCampaigns, listDemographicInsights, resolveProvinceNames |
| `app/src/lib/remotes/tiktok-reports.remote.ts` | Server queries cu auth, cache 5 min, validare valibot |
| `app/src/lib/utils/tiktok-report-helpers.ts` | TiktokCampaignAggregate, aggregateTiktokInsightsByDate/ByCampaign |
| `app/src/lib/utils/tiktok-column-presets.ts` | 5 column presets (Performance, Engagement, Delivery, Video) |
| `app/src/lib/components/reports/tiktok-demographics-section.svelte` | Demographics (gen, vârstă, locație, dispozitive) |
| `app/src/routes/[tenant]/reports/tiktok-ads/+page.svelte` | Admin report page |
| `app/src/routes/client/[tenant]/(app)/reports/tiktok-ads/+page.svelte` | Client portal report page |
| `app/src/lib/server/logger.ts` | LogSource include `'tiktok-ads'` |

## TikTok API Endpoints folosite

### 1. Campaign Insights — `GET /report/integrated/get/`
- **Method:** GET (POST returnează 405 Method Not Allowed!)
- **Params:** advertiser_id, report_type=BASIC, dimensions=["campaign_id","stat_time_day"], data_level=AUCTION_CAMPAIGN
- **Metrici:** result, cost_per_result, result_rate, conversion, cost_per_conversion, spend, impressions, clicks, cpc, cpm, ctr, reach, frequency, complete_payment, real_time_result, likes, comments, shares, follows, profile_visits, video_views_p25/p50/p75/p100
- **Date format:** `stat_time_day` vine ca `"2026-03-01 00:00:00"` → `.slice(0, 10)` pentru YYYY-MM-DD
- **Paginare:** page + page_size (max 1000), loop până page_info.total_number

### 2. Campaigns List — `GET /campaign/get/`
- **Fields param obligatoriu:** `['campaign_id', 'campaign_name', 'operation_status', 'secondary_status', 'objective_type', 'budget_mode', 'budget', 'budget_optimize_on']`
- **Fără `fields` param, budget nu se returnează!**
- **Status normalizare:** CAMPAIGN_STATUS_ENABLE→ACTIVE, CAMPAIGN_STATUS_DISABLE→PAUSED, CAMPAIGN_STATUS_DELETE→DELETED

### 3. Ad Groups (budget fallback) — `GET /adgroup/get/`
- **Fields:** `['adgroup_id', 'campaign_id', 'budget', 'budget_mode']`
- **Când se apelează:** Doar dacă campania nu are buget propriu (BUDGET_MODE_INFINITE)
- **Logica:** Grupează ad groups per campaign_id, sumează bugetele

### 4. Demographics — `GET /report/integrated/get/` (report_type=AUDIENCE)
- **4 calls paralele:** dimensions=[gender], [age], [province_id], [platform]
- **Province IDs:** Se rezolvă dinamic via `/tool/region/`
- **Labels:** Gender (MALE→male, FEMALE→female, NONE→unknown), Age (AGE_18_24→18-24, NONE→unknown), Device (normalizare cu toUpperCase)
- **Filtrare:** Segmente cu label='unknown' și spend=0 sunt eliminate

### 5. Province Resolution — `GET /tool/region/` + `POST /tool/targeting/info/`
- **Strategy 1:** `GET /tool/region/?level_range=TO_PROVINCE` — listează toate provinciile, walk recursiv prin tree
- **Strategy 2:** `POST /tool/targeting/info/` cu scene=GEO — fallback pentru IDs nerezolvate
- **Filtrare:** IDs invalide (-1, 0, empty) sunt eliminate automat
- **Zero date hardcodate** — totul vine din API

### 6. Advertiser Accounts — `GET /oauth2/advertiser/get/`
- **Atenție:** Returnează obiecte `{advertiser_id, advertiser_name}` NU string-uri simple
- **Parsare:** `rawList.map(item => typeof item === 'string' ? item : String(item.advertiser_id || item))`

## Metrici — Reguli CRITICE

### Forme SINGULARE (nu plurale!)
TikTok API folosește forme **singulare**. Formele plurale sunt ignorate silențios (returnează null):
- `result` NU `results`
- `conversion` NU `conversions`
- `real_time_result` NU `real_time_results`

### Results vs Conversions
- **`result`** = primary optimization goal (lead-uri pentru LEAD_GENERATION, achiziții pentru CONVERSIONS, click-uri pentru TRAFFIC)
- **`conversion`** = secondary goal (diferit de result!)
- **`cost_per_result`** = cost per primary result (folosit direct din API, mai precis decât spend/result)
- **Fallback chain:** `result → conversion → complete_payment → real_time_result`

## Budget — Logica completă

### Budget Modes TikTok
| Mode | Tip | Unde apare |
|------|-----|-----------|
| `BUDGET_MODE_DAY` | Zilnic | Campaign sau Ad Group |
| `BUDGET_MODE_DYNAMIC_DAILY_BUDGET` | Zilnic dinamic | Campaign sau Ad Group |
| `BUDGET_MODE_TOTAL` | Lifetime/Total | Campaign sau Ad Group |
| `BUDGET_MODE_INFINITE` | Fără limită | Campaign (bugetul e la ad group level) |

### Logica de rezolvare budget
1. **Campaign level:** Verifică `budget` + `budget_mode` din `/campaign/get/`
2. **Dacă INFINITE:** Fetch ad groups via `/adgroup/get/`
3. **Grupare:** Ad groups grupate per campaign_id
4. **Sumare:** Sumează bugetele zilnice separat de cele lifetime
5. **Prioritate:** Daily budget > Lifetime budget
6. **Afișare:** Valoarea e în currency units (NU cenți), ex: budget=80 → "80,00 RON/zi"

### Multi-adgroup per campanie
- Campanie cu 2 ad groups x 80 RON/zi → afișează "160,00 RON/zi" (suma)
- Campanie cu 1 ad group 80 RON/zi + 1 ad group 50 RON/zi → "130,00 RON/zi"
- Campanie cu ad groups mixed (zilnic + lifetime) → preferă suma zilnică

## Buguri rezolvate (cronologic)

### 1. app_id=undefined pe producție
- **Cauză:** TIKTOK_APP_ID, TIKTOK_APP_SECRET, TIKTOK_REDIRECT_URI lipseau din `app-config.json`
- **Fix:** Adăugate în configs[0].data

### 2. [object Object] în advertiser accounts
- **Cauză:** `json.data.list` parsată ca array de string-uri, dar conține obiecte
- **Fix:** Map cu type check: `typeof item === 'string' ? item : String(item.advertiser_id)`

### 3. 405 Method Not Allowed pe report/integrated/get/
- **Cauză:** Endpoint-ul acceptă doar GET, nu POST
- **Fix:** Schimbat toate apelurile la GET cu URLSearchParams (inclusiv listAdvertiserInsights)

### 4. Invalid Date pe chart X axis
- **Cauză:** TikTok returnează datetime `"2026-03-01 00:00:00"` nu date
- **Fix:** `.slice(0, 10)` pe `stat_time_day`

### 5. Province IDs numerice în demographics
- **Cauză:** TikTok returnează `province_id` ca numere (665849, 672460)
- **Fix:** Rezolvare dinamică via `GET /tool/region/` cu walk recursiv prin tree
- **Inițial:** Hardcoded map (greșit!) → Înlocuit cu API call (corect)

### 6. Age "NONE" în demographics
- **Cauză:** TikTok returnează "NONE" ca age group
- **Fix:** Mapat la "unknown" + filtrat segmente cu spend=0

### 7. Device labels brute (Iphone, Ipad)
- **Cauză:** DEVICE_MAP incomplet
- **Fix:** Normalizare cu `.toUpperCase()` + map extins (IPHONE, IPAD, MOBILE_APP, WAP etc.)

### 8. Metrici cu forme plurale (CRITIC)
- **Cauză:** Codul trimitea `results`, `conversions`, `real_time_results` — ignorate silențios de API
- **Fix:** Corectat la forme singulare: `result`, `conversion`, `real_time_result`
- **Lecție:** TikTok API folosește ÎNTOTDEAUNA forme singulare

### 9. Rezultate/Lead-uri = 0 pentru LEAD_GENERATION
- **Cauză:** Se folosea `conversion` (secondary goal) în loc de `result` (primary goal)
- **Fix:** Metrica corectă e `result` + fallback chain: result → conversion → complete_payment → real_time_result

### 10. Budget = "-" pe toate campaniile
- **Cauză:** `/campaign/get/` nu returna budget fără `fields` param explicit
- **Fix:** Adăugat `fields` param cu budget_mode, budget, budget_optimize_on

### 11. Budget = "-" pe campanii cu BUDGET_MODE_INFINITE
- **Cauză:** Bugetul e la ad group level, nu campaign level
- **Fix:** Fetch `/adgroup/get/`, grupare per campaign, sumare bugete

### 12. BUDGET_MODE_DYNAMIC_DAILY_BUDGET nerecunoscut
- **Cauză:** Codul trata doar BUDGET_MODE_DAY și BUDGET_MODE_TOTAL
- **Fix:** BUDGET_MODE_DYNAMIC_DAILY_BUDGET tratat ca daily budget

### 13. Mesaj "Facebook Pixel" în conversions chart
- **Cauză:** Component partajat cu text hardcodat
- **Fix:** Schimbat la "Nu sunt date de conversii disponibile"

### 14. LogSource 'tiktok-ads' invalid
- **Cauză:** 'tiktok-ads' nu era în tipul LogSource din logger.ts
- **Fix:** Adăugat la union type

## Logging disponibil (Logs si Debug)

### Info logs
```
[TIKTOK-ADS] Fetching campaign insights for {advertiserId}
[TIKTOK-ADS] Got X rows for {advertiserId}. Sample: result=X, conversion=X, cost_per_result=X, reach=X
[TIKTOK-ADS] Found X campaigns for {advertiserId}. Y with budget
[TIKTOK-ADS] Ad groups: X found. Sample: budget=Y, budget_mode=Z, campaign_id=W
[TIKTOK-ADS] Ad group budget: X/Y campaigns resolved from Z ad groups
[TIKTOK-ADS] Fetching demographics for {advertiserId}
[TIKTOK-ADS] Region API response keys: [region_info, region_list]
[TIKTOK-ADS] Region API: X locations found. Samples: ...
[TIKTOK-ADS] Resolved X/Y provinces via /tool/region/
[TIKTOK-ADS] Demographics loaded for {advertiserId} {gender: X, age: X, region: X, devicePlatform: X}
[TIKTOK-ADS] Unresolved province IDs: X, Y — /tool/targeting/info/ did not return names
```

### Error logs
```
[TIKTOK-ADS] Campaign insights API error for {advertiserId} — errorCode, errorMessage, requestId
[TIKTOK-ADS] Demographics API error ({dimension}) — errorCode, errorMessage
[TIKTOK-ADS] Demographics JSON parse error for {dimension} — status, preview
[TIKTOK-ADS] Region API error — errorCode, errorMessage
[TIKTOK-ADS] Ad group API error — errorCode, errorMessage
[TIKTOK-ADS] Province resolution failed — error message
```

## Diferențe față de Facebook Ads report

| Feature | Facebook | TikTok |
|---------|----------|--------|
| Budget editing | Da (dialog) | Nu (read-only) |
| Campaign on/off toggle | Da (Switch) | Nu |
| ROAS | Da | Nu (TikTok nu expune purchase value public) |
| Ad preview link | Da | Nu |
| Budget source | Campaign sau AdSet (tracked) | Campaign sau AdGroup (summat) |
| Budget format | Cenți (÷100) | Currency units direct |
| Reach aggregation | Separat (nu se poate suma zilnic) | Direct din API |
| Demographics labels | Direct readable | Necesită mapping (province IDs, status codes) |
| API method | POST | GET (POST → 405) |
| Token refresh | 60 zile (long-lived) | 24h access + 365 zile refresh |
| Metric names | Plurale (impressions, conversions) | SINGULARE (result, conversion) |
| Province names | Direct text | Numeric IDs → rezolvate via /tool/region/ |

## Cum să adaugi metrici noi

1. Adaugă metrica în array-ul `metrics` din `listCampaignInsights()` (`client.ts`)
   - **Atenție:** Folosește forma SINGULARĂ (verifică docs TikTok)
2. Parsează valoarea din `row.metrics` în mapping-ul de return
3. Adaugă câmpul în `TiktokAdsCampaignInsight` interface (`client.ts`)
4. Adaugă câmpul în `TiktokCampaignAggregate` interface (`tiktok-report-helpers.ts`)
5. Adaugă aggregarea în `aggregateTiktokInsightsByCampaign()` (`tiktok-report-helpers.ts`)
6. Adaugă coloana în preset-uri (`tiktok-column-presets.ts`)

## Environment variables necesare

```env
TIKTOK_APP_ID=7616575498574888977
TIKTOK_APP_SECRET=bd1db750fc41ca6e0cffdd715d9dd7166c53c42c
TIKTOK_REDIRECT_URI=https://clients.onetopsolution.ro/api/tiktok-ads/callback
```

Trebuie în `.env` (local) **ȘI** în `app-config.json` (producție configs[0].data).

## Documentație oficială TikTok

- **Report API:** https://business-api.tiktok.com/portal/docs?id=1735713875563521
- **Campaign API:** https://business-api.tiktok.com/portal/docs?id=1739315828649986
- **Ad Group API:** https://business-api.tiktok.com/portal/docs?id=1739314558673922
- **Region/Location API:** https://business-api.tiktok.com/portal/docs?id=1761237614418945
- **Targeting Info API:** https://business-api.tiktok.com/portal/docs?id=1761237655498754
- **Metrics Reference:** https://ads.tiktok.com/help/article/all-metrics
- **TikTok SDK (JS):** https://github.com/tiktok/tiktok-business-api-sdk/tree/main/js_sdk/docs
