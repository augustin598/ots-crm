# TikTok Ads Reporting — Audit & Debug Reference

## Arhitectură

```
TikTok Business API v1.3
    ↓ (GET requests)
app/src/lib/server/tiktok-ads/client.ts     ← API client (insights, campaigns, demographics)
    ↓
app/src/lib/remotes/tiktok-reports.remote.ts ← Server queries cu cache 5 min
    ↓
app/src/lib/utils/tiktok-report-helpers.ts   ← Aggregation (by date, by campaign)
app/src/lib/utils/tiktok-column-presets.ts   ← Column definitions for table
    ↓
+page.svelte (admin)  /  +page.svelte (client portal)
```

## Fișiere implementare

| Fișier | Rol |
|--------|-----|
| `app/src/lib/server/tiktok-ads/client.ts` | API client — listCampaignInsights, listCampaigns, listDemographicInsights |
| `app/src/lib/remotes/tiktok-reports.remote.ts` | Server queries cu auth, cache, validare valibot |
| `app/src/lib/utils/tiktok-report-helpers.ts` | TiktokCampaignAggregate, aggregateTiktokInsightsByDate/ByCampaign |
| `app/src/lib/utils/tiktok-column-presets.ts` | 5 column presets (Performance, Engagement, Delivery, Video) |
| `app/src/lib/components/reports/tiktok-demographics-section.svelte` | Demographics (gen, vârstă, locație, dispozitive) |
| `app/src/routes/[tenant]/reports/tiktok-ads/+page.svelte` | Admin report page |
| `app/src/routes/client/[tenant]/(app)/reports/tiktok-ads/+page.svelte` | Client portal report page |

## TikTok API Endpoints folosite

### Campaign Insights
- **Endpoint:** `GET /open_api/v1.3/report/integrated/get/`
- **Method:** GET (POST returnează 405 Method Not Allowed)
- **Params:** advertiser_id, report_type=BASIC, dimensions=["campaign_id","stat_time_day"], data_level=AUCTION_CAMPAIGN
- **Metrici cerute:** spend, impressions, clicks, conversion, cpc, cpm, ctr, cost_per_conversion, reach, frequency, complete_payment, onsite_form, real_time_conversion, likes, comments, shares, follows, profile_visits, video_views_p25/p50/p75/p100
- **Date format:** TikTok returnează `stat_time_day` ca `"2026-03-01 00:00:00"` — trebuie `.slice(0, 10)` pentru YYYY-MM-DD

### Campaigns List
- **Endpoint:** `GET /open_api/v1.3/campaign/get/`
- **Returnează:** campaign_id, campaign_name, objective_type, budget, budget_mode, operation_status
- **Status normalizare:** CAMPAIGN_STATUS_ENABLE→ACTIVE, CAMPAIGN_STATUS_DISABLE→PAUSED, CAMPAIGN_STATUS_DELETE→DELETED

### Demographics
- **Endpoint:** `GET /open_api/v1.3/report/integrated/get/` (cu report_type=AUDIENCE)
- **4 calls paralele:** dimensions=[gender], [age], [province_id], [platform]
- **Province IDs:** Returnează ID-uri numerice (665849=Suceava, 672460=Neamț, 684039=Botoșani) — mapate cu hardcoded ROMANIA_PROVINCES map

### Advertiser Accounts
- **Endpoint:** `GET /open_api/v1.3/oauth2/advertiser/get/`
- **Atenție:** Returnează obiecte `{advertiser_id, advertiser_name}` NU string-uri simple

## Buguri rezolvate

### 1. app_id=undefined pe producție
- **Cauză:** Variabilele TIKTOK_APP_ID, TIKTOK_APP_SECRET, TIKTOK_REDIRECT_URI lipseau din `app-config.json`
- **Fix:** Adăugate în configs[0].data

### 2. [object Object] în advertiser accounts
- **Cauză:** `json.data.list` parsată ca array de string-uri, dar conține obiecte
- **Fix:** `rawList.map(item => typeof item === 'string' ? item : String(item.advertiser_id || item))`

### 3. 405 Method Not Allowed
- **Cauză:** `/report/integrated/get/` nu acceptă POST, doar GET cu query params
- **Fix:** Schimbat la GET cu URLSearchParams

### 4. Invalid Date pe chart X axis
- **Cauză:** TikTok returnează datetime `"2026-03-01 00:00:00"` nu date `"2026-03-01"`
- **Fix:** `.slice(0, 10)` pe `stat_time_day`

### 5. Province IDs numerice
- **Cauză:** TikTok returnează province_id ca numere (665849), nu nume
- **Fix:** Hardcoded ROMANIA_PROVINCES map + fallback API lookup

### 6. Age "NONE" în demographics
- **Cauză:** TikTok returnează "NONE" ca age group
- **Fix:** Mapat la "unknown" + filtrat dacă spend=0

### 7. Device labels brute (Iphone, Ipad)
- **Cauză:** DEVICE_MAP nu conținea toate variantele
- **Fix:** Normalizare cu `.toUpperCase()` + map extins (IPHONE, IPAD, MOBILE_APP etc.)

## Logging disponibil (vizibil în Logs si Debug)

Toate log-urile folosesc tag-ul `[TIKTOK-ADS]`:

```
[TIKTOK-ADS] Fetching campaign insights for {advertiserId}
[TIKTOK-ADS] Got X rows for {advertiserId}. Sample metrics: conversion=X, complete_payment=X, onsite_form=X, reach=X
[TIKTOK-ADS] Found X campaigns for {advertiserId}. Y with budget. Sample: {name} daily={budget} lifetime={budget}
[TIKTOK-ADS] Fetching demographics for {advertiserId}
[TIKTOK-ADS] Demographics loaded for {advertiserId} {gender: X, age: X, region: X, devicePlatform: X}
[TIKTOK-ADS] Listing campaigns for {advertiserId}
```

Erori:
```
[TIKTOK-ADS] Campaign insights API error for {advertiserId} — errorCode, errorMessage, requestId
[TIKTOK-ADS] Demographics API error ({dimension}) — errorCode, errorMessage
[TIKTOK-ADS] Demographics JSON parse error for {dimension} — status, preview
```

## Probleme cunoscute / limitări

### Conversions = 0 pentru LEAD_GENERATION
- TikTok API returnează `conversion=0` pentru campanii LEAD_GENERATION
- Am adăugat fallback chain: `conversion → complete_payment → onsite_form → real_time_conversion`
- Dacă tot arată 0, e posibil ca TikTok Pixel/Events să nu fie configurat pe advertiser account
- **Debug:** Verifică log-ul `Sample metrics:` — dacă toate sunt 0, problema e în TikTok Ads Manager (nu în cod)

### Buget = "-"
- TikTok API returnează `budget` și `budget_mode` pe campaign
- Dacă `budget_mode` lipsește sau e diferit de `BUDGET_MODE_DAY`/`BUDGET_MODE_TOTAL`, bugetul nu se afișează
- **Debug:** Verifică log-ul `Found X campaigns... Y with budget`
- TikTok poate returna bugetul în micro-units (ex: 5000000 = 50 RON) — verifică valorile reale

### Province mapping incomplet
- Hardcoded map conține doar ~40 județe românești cu ID-uri estimate
- ID-urile 665849=Suceava, 672460=Neamț, 684039=Botoșani sunt confirmate
- Alte ID-uri pot fi greșite — se rezolvă pe măsură ce apar în date reale
- Fallback: afișează ID-ul numeric dacă nu e în map

### TikTok API Rate Limits
- Cache server-side 5 minute (MAX_CACHE_SIZE=200 entries)
- TikTok Business API are rate limits stricte — cache-ul previne exceeded limits

## Diferențe față de Facebook Ads report

| Feature | Facebook | TikTok |
|---------|----------|--------|
| Budget editing | Da (dialog) | Nu |
| Campaign on/off toggle | Da (Switch) | Nu |
| ROAS | Da | Nu (TikTok nu expune purchase value) |
| Ad preview link | Da | Nu |
| Reach aggregation | Separat (nu se poate suma) | Direct din API |
| Demographics labels | Direct readable | Necesită mapping (province IDs, status codes) |
| API method | POST | GET (POST returnează 405) |
| Token refresh | 60 zile (long-lived) | 24h access + 365 zile refresh |

## Cum să adaugi metrici noi

1. Adaugă metrica în array-ul `metrics` din `listCampaignInsights()` (client.ts)
2. Parsează valoarea din `row.metrics` în mapping-ul de return
3. Adaugă câmpul în `TiktokAdsCampaignInsight` interface (client.ts)
4. Adaugă câmpul în `TiktokCampaignAggregate` interface (tiktok-report-helpers.ts)
5. Adaugă aggregarea în `aggregateTiktokInsightsByCampaign()` (tiktok-report-helpers.ts)
6. Adaugă coloana în preset-uri (tiktok-column-presets.ts)

## Environment variables necesare

```env
TIKTOK_APP_ID=7616575498574888977
TIKTOK_APP_SECRET=bd1db750fc41ca6e0cffdd715d9dd7166c53c42c
TIKTOK_REDIRECT_URI=https://clients.onetopsolution.ro/api/tiktok-ads/callback
```

Trebuie în `.env` (local) ȘI în `app-config.json` (producție).
