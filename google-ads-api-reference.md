# Google Ads API - Reference complet pentru implementare rapoarte

## 1. Overview

Google Ads API (versiunea curentă: **v23**) este interfața programatică pentru gestionarea conturilor Google Ads. Suportă **gRPC** și **REST**.

**Bibliotecă Node.js (community):** `google-ads-api` ([npm](https://www.npmjs.com/package/google-ads-api)) - nu este oficială Google, dar este cea folosită în proiect.

---

## 2. Autentificare

### Headere HTTP obligatorii

| Header | Descriere |
|--------|-----------|
| `Authorization: Bearer ACCESS_TOKEN` | Token OAuth2 |
| `developer-token: DEVELOPER_TOKEN` | Token dezvoltator (din ads.google.com/aw/apicenter) |
| `login-customer-id: MCC_ID` | Necesar când accesezi sub-conturi prin MCC (fără cratime) |

### OAuth2 Setup

- **Scope:** `https://www.googleapis.com/auth/adwords`
- **Refresh token flow:**
```bash
curl --data "grant_type=refresh_token" \
  --data "client_id=CLIENT_ID" \
  --data "client_secret=CLIENT_SECRET" \
  --data "refresh_token=REFRESH_TOKEN" \
  https://www.googleapis.com/oauth2/v3/token
```

### Configurare client (google-ads-api npm)

```typescript
import { GoogleAdsApi } from 'google-ads-api';

const client = new GoogleAdsApi({
  client_id: 'YOUR_CLIENT_ID',
  client_secret: 'YOUR_CLIENT_SECRET',
  developer_token: 'YOUR_DEVELOPER_TOKEN'
});

const customer = client.Customer({
  customer_id: '1234567890',        // Sub-account ID (fără cratime)
  login_customer_id: '9876543210',  // MCC ID (fără cratime)
  refresh_token: 'YOUR_REFRESH_TOKEN'
});

// Execută query GAQL
const results = await customer.query(`
  SELECT campaign.name, metrics.clicks
  FROM campaign
  WHERE segments.date DURING LAST_7_DAYS
`);
```

---

## 3. GAQL (Google Ads Query Language)

### Structura query-ului

```
SELECT field1, field2, ...
FROM resource
[WHERE condition AND condition ...]
[ORDER BY field ASC|DESC]
[LIMIT n]
[PARAMETERS key = value]
```

**Clauze obligatorii:** `SELECT` + `FROM`

### Tipuri de câmpuri selectabile

| Tip | Exemplu | Descriere |
|-----|---------|-----------|
| Resource attributes | `campaign.id`, `campaign.name` | Câmpuri ale resursei |
| Metrics | `metrics.impressions`, `metrics.clicks` | Metrici de performanță |
| Segments | `segments.date`, `segments.device` | Dimensiuni de segmentare |
| Attributed resources | `campaign_budget.amount_micros` | Resurse asociate (join implicit) |

### Operatori WHERE

| Operator | Exemplu |
|----------|---------|
| `=`, `!=`, `>`, `>=`, `<`, `<=` | `campaign.status = 'ENABLED'` |
| `IN`, `NOT IN` | `campaign.status IN ('ENABLED', 'PAUSED')` |
| `LIKE`, `NOT LIKE` | `campaign.name LIKE '%brand%'` |
| `CONTAINS ANY/ALL/NONE` | Operații pe array-uri |
| `IS NULL`, `IS NOT NULL` | Verificare null |
| `BETWEEN` | `segments.date BETWEEN '2024-01-01' AND '2024-01-31'` |
| `DURING` | `segments.date DURING LAST_30_DAYS` |
| `REGEXP_MATCH`, `NOT REGEXP_MATCH` | Pattern matching (RE2 syntax) |

### Date Range Literals (pentru DURING)

| Literal | Descriere |
|---------|-----------|
| `TODAY` | Ziua curentă |
| `YESTERDAY` | Ieri |
| `LAST_7_DAYS` | Ultimele 7 zile |
| `LAST_14_DAYS` | Ultimele 14 zile |
| `LAST_30_DAYS` | Ultimele 30 zile |
| `LAST_BUSINESS_WEEK` | Ultima săptămână lucrătoare |
| `LAST_WEEK_MON_SUN` | Ultima săptămână (Luni-Duminică) |
| `LAST_WEEK_SUN_SAT` | Ultima săptămână (Duminică-Sâmbătă) |
| `LAST_MONTH` | Luna trecută |
| `THIS_MONTH` | Luna curentă |
| `THIS_WEEK_MON_TODAY` | Săptămâna curentă (Luni-Azi) |
| `THIS_WEEK_SUN_TODAY` | Săptămâna curentă (Duminică-Azi) |

### Parametri opționali

```sql
PARAMETERS include_drafts = true
PARAMETERS omit_unselected_resource_names = true
```

---

## 4. Resurse disponibile (FROM clause)

### Resurse cu metrici (70+)

Cele mai importante pentru rapoarte:

| Resursă | Descriere | Utilizare |
|---------|-----------|-----------|
| `campaign` | Campanii | Overview campanii, spend, performanță |
| `ad_group` | Grupuri de anunțuri | Detalii la nivel de ad group |
| `ad_group_ad` | Anunțuri individuale | Performanța fiecărui anunț |
| `keyword_view` | Cuvinte cheie | Performanța keyword-urilor |
| `search_term_view` | Termeni de căutare | Ce au căutat utilizatorii |
| `age_range_view` | Demografice - vârstă | Breakdown pe grupe de vârstă |
| `gender_view` | Demografice - gen | Breakdown pe gen |
| `geographic_view` | Locații | Performanța pe locații |
| `location_view` | Targeting locații | Locații targetate |
| `ad_group_audience_view` | Audiențe | Performanța audiențelor |
| `video` | Video | Metrici video |
| `shopping_performance_view` | Shopping | Performanța produselor |
| `click_view` | Click-uri | Detalii la nivel de click |
| `landing_page_view` | Landing pages | Performanța paginilor de destinație |
| `expanded_landing_page_view` | Landing pages expandate | URL-uri complete |
| `campaign_budget` | Bugete campanii | Informații buget |
| `conversion_action` | Acțiuni de conversie | Setup conversii |
| `customer` | Cont | Informații la nivel de cont |
| `customer_client` | Sub-conturi MCC | Listare sub-conturi |
| `hotel_performance_view` | Hoteluri | Performanța hotelurilor |
| `distance_view` | Distanță | Breakdown pe distanță |
| `device_view` | (prin segments.device) | Breakdown pe dispozitiv |
| `ad_schedule_view` | Program anunțuri | Performanța pe ore/zile |
| `topic_view` | Subiecte | Performanța pe topicuri |
| `managed_placement_view` | Plasamente | Performanța plasamentelor |
| `display_keyword_view` | Keywords Display | Keywords rețea Display |
| `dynamic_search_ads_search_term_view` | DSA terms | Termeni DSA |
| `campaign_audience_view` | Audiențe campanie | Audiențe la nivel campanie |
| `income_range_view` | Venituri | Breakdown pe venituri |
| `parental_status_view` | Status parental | Breakdown parental |
| `user_location_view` | Locația userului | Locația fizică a userului |
| `bidding_strategy` | Strategii de licitare | Performanța bid strategies |
| `campaign_search_term_view` | Search terms campanie | Termeni la nivel campanie |
| `performance_max_placement_view` | Plasamente PMax | Performanța PMax |

### Resurse fără metrici (150+)

Folosite pentru management/configurare (ex: `campaign_criterion`, `ad_group_criterion`, `geo_target_constant`, `billing_setup`, etc.)

---

## 5. Metrici disponibile (metrics.*)

### Metrici de bază

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.impressions` | INT64 | Număr afișări |
| `metrics.clicks` | INT64 | Număr click-uri |
| `metrics.cost_micros` | INT64 | Cost total (în micros, ÷ 1,000,000 = valută) |
| `metrics.ctr` | DOUBLE | Click-through rate (0.0 - 1.0, × 100 = %) |
| `metrics.average_cpc` | DOUBLE | CPC mediu (în micros) |
| `metrics.average_cpm` | DOUBLE | CPM mediu (în micros) |
| `metrics.average_cpv` | DOUBLE | CPV mediu (în micros) |

### Metrici conversii

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.conversions` | DOUBLE | Număr conversii |
| `metrics.conversions_value` | DOUBLE | Valoare totală conversii |
| `metrics.cost_per_conversion` | DOUBLE | Cost per conversie (în micros) |
| `metrics.conversions_from_interactions_rate` | DOUBLE | Rata de conversie |
| `metrics.all_conversions` | DOUBLE | Toate conversiile (inclusiv cross-device) |
| `metrics.all_conversions_value` | DOUBLE | Valoare totală toate conversiile |
| `metrics.value_per_conversion` | DOUBLE | Valoare medie per conversie |
| `metrics.value_per_all_conversions` | DOUBLE | Valoare medie toate conversiile |

### Metrici video

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.video_views` | INT64 | Vizualizări video |
| `metrics.video_view_rate` | DOUBLE | Rata de vizualizare video |
| `metrics.video_quartile_p25_rate` | DOUBLE | % vizualizare 25% |
| `metrics.video_quartile_p50_rate` | DOUBLE | % vizualizare 50% |
| `metrics.video_quartile_p75_rate` | DOUBLE | % vizualizare 75% |
| `metrics.video_quartile_p100_rate` | DOUBLE | % vizualizare 100% |

### Metrici interacțiuni

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.interactions` | INT64 | Interacțiuni |
| `metrics.interaction_rate` | DOUBLE | Rata de interacțiune |
| `metrics.engagement_rate` | DOUBLE | Rata de engagement |
| `metrics.engagements` | INT64 | Număr engagement-uri |

### Metrici Quality Score

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.historical_quality_score` | INT64 | Quality Score istoric |
| `metrics.historical_creative_quality_score` | ENUM | Scor calitate anunț |
| `metrics.historical_landing_page_quality_score` | ENUM | Scor landing page |
| `metrics.historical_search_predicted_ctr` | ENUM | CTR prezis |

### Metrici buget/licitare

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.average_cost` | DOUBLE | Cost mediu (micros) |
| `metrics.cost_per_all_conversions` | DOUBLE | Cost per toate conversiile |
| `metrics.cross_device_conversions` | DOUBLE | Conversii cross-device |

### Metrici Search

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.search_impression_share` | DOUBLE | Search Impression Share |
| `metrics.search_rank_lost_impression_share` | DOUBLE | Lost IS (rank) |
| `metrics.search_budget_lost_impression_share` | DOUBLE | Lost IS (buget) |
| `metrics.search_exact_match_impression_share` | DOUBLE | Exact Match IS |
| `metrics.search_top_impression_share` | DOUBLE | Top IS |
| `metrics.search_absolute_top_impression_share` | DOUBLE | Absolute Top IS |
| `metrics.top_impression_percentage` | DOUBLE | % afișări top |
| `metrics.absolute_top_impression_percentage` | DOUBLE | % afișări absolute top |

### Metrici Gmail / Display

| Metric | Tip | Descriere |
|--------|-----|-----------|
| `metrics.gmail_forwards` | INT64 | Gmail forwards |
| `metrics.gmail_saves` | INT64 | Gmail saves |
| `metrics.gmail_secondary_clicks` | INT64 | Gmail clicks secundare |

---

## 6. Segmente disponibile (segments.*)

### Segmente de timp (Core Date Segments)

| Segment | Format | Notă |
|---------|--------|------|
| `segments.date` | `YYYY-MM-DD` | Poate fi în WHERE fără a fi în SELECT |
| `segments.week` | `YYYY-MM-DD` | (prima zi a săptămânii) |
| `segments.month` | `YYYY-MM-01` | |
| `segments.quarter` | `YYYY-MM-01` | (prima zi a trimestrului) |
| `segments.year` | `YYYY` | |
| `segments.day_of_week` | ENUM | MONDAY, TUESDAY, ... |
| `segments.hour` | INT32 | 0-23 |

### Segmente de dispozitiv/platformă

| Segment | Valori |
|---------|--------|
| `segments.device` | `MOBILE`, `DESKTOP`, `TABLET`, `CONNECTED_TV`, `OTHER` |
| `segments.slot` | `SEARCH_SIDE`, `SEARCH_TOP`, `SEARCH_OTHER`, `CONTENT`, `MIXED` |

### Segmente de rețea

| Segment | Descriere |
|---------|-----------|
| `segments.ad_network_type` | `SEARCH`, `SEARCH_PARTNERS`, `CONTENT`, `YOUTUBE_SEARCH`, `YOUTUBE_WATCH`, `MIXED` |

### Segmente de conversie

| Segment | Descriere |
|---------|-----------|
| `segments.conversion_action` | Resource name-ul acțiunii de conversie |
| `segments.conversion_action_category` | Categorie (PURCHASE, LEAD, etc.) |
| `segments.conversion_action_name` | Nume acțiune |
| `segments.external_conversion_source` | Sursa externă |

### Segmente keyword

| Segment | Descriere |
|---------|-----------|
| `segments.keyword.info.text` | Textul keyword-ului |
| `segments.keyword.info.match_type` | `EXACT`, `PHRASE`, `BROAD` |
| `segments.keyword.ad_group_criterion` | Resource name criterion |

**ATENȚIE:** Folosirea `segments.keyword.*` restricționează rezultatele doar la Search Network keywords, excluzând DSA, Shopping, PMax, Display.

### Segmente geografice

| Segment | Descriere |
|---------|-----------|
| `segments.geo_target_city` | Oraș |
| `segments.geo_target_country` | Țară |
| `segments.geo_target_metro` | Zonă metro |
| `segments.geo_target_region` | Regiune |
| `segments.geo_target_most_specific_location` | Locația cea mai specifică |

### Segmente click type

| Segment | Descriere |
|---------|-----------|
| `segments.click_type` | Tipul de click (HEADLINE, SITELINK, etc.) |

### Alte segmente

| Segment | Descriere |
|---------|-----------|
| `segments.ad_destination_type` | Tip destinație (WEBSITE, APP_STORE, etc.) |
| `segments.product_channel` | Canal produs (ONLINE, LOCAL) |
| `segments.product_item_id` | ID produs |
| `segments.product_title` | Titlu produs |

---

## 7. Reguli de segmentare

1. **Segmentarea implicită:** Fiecare query este segmentat automat pe resursa din FROM
2. **Segmentele date (core)** pot fi în WHERE fără a fi în SELECT
3. **Toate celelalte segmente** dacă sunt în WHERE, trebuie să fie și în SELECT
4. **Multiple segmente** multiplică exponențial numărul de rânduri
5. **Dacă un segment date e în SELECT**, trebuie un interval finit în WHERE

---

## 8. SearchStream vs Search

| Aspect | `SearchStream` | `Search` |
|--------|---------------|----------|
| Tip conexiune | Stream continuu | Paginat |
| Rânduri/pagină | Toate odată | 10,000/pagină |
| Performanță (>10k rows) | Mai rapid | Mai lent (round-trips) |
| Performanță (<10k rows) | Similar | Similar |
| Operațiuni contorizate | 1 | 1 (indiferent de pagini) |

**Recomandare:** `SearchStream` pentru rapoarte mari, `Search` pentru rapoarte mici.

---

## 9. Query-uri cookbook (exemple complete)

### 9.1 Campaigns Overview
```sql
SELECT campaign.name,
  campaign_budget.amount_micros,
  campaign.status,
  campaign.optimization_score,
  campaign.advertising_channel_type,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  campaign.bidding_strategy_type
FROM campaign
WHERE segments.date DURING LAST_7_DAYS
  AND campaign.status != 'REMOVED'
```

### 9.2 Ad Groups Overview
```sql
SELECT ad_group.name,
  campaign.name,
  ad_group.status,
  ad_group.type,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros
FROM ad_group
WHERE segments.date DURING LAST_7_DAYS
  AND ad_group.status != 'REMOVED'
```

### 9.3 Ads Overview
```sql
SELECT ad_group_ad.ad.expanded_text_ad.headline_part1,
  ad_group_ad.ad.expanded_text_ad.headline_part2,
  ad_group_ad.ad.expanded_text_ad.headline_part3,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.expanded_text_ad.description,
  ad_group_ad.ad.expanded_text_ad.description2,
  campaign.name,
  ad_group.name,
  ad_group_ad.policy_summary.approval_status,
  ad_group_ad.ad.type,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros
FROM ad_group_ad
WHERE segments.date DURING LAST_7_DAYS
  AND ad_group_ad.status != 'REMOVED'
```

### 9.4 Search Keywords
```sql
SELECT ad_group_criterion.keyword.text,
  campaign.name,
  ad_group.name,
  ad_group_criterion.system_serving_status,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.approval_status,
  ad_group_criterion.final_urls,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros
FROM keyword_view
WHERE segments.date DURING LAST_7_DAYS
  AND ad_group_criterion.status != 'REMOVED'
```

### 9.5 Search Terms
```sql
SELECT search_term_view.search_term,
  segments.keyword.info.match_type,
  search_term_view.status,
  campaign.name,
  ad_group.name,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  campaign.advertising_channel_type
FROM search_term_view
WHERE segments.date DURING LAST_7_DAYS
```

### 9.6 Audiences
```sql
SELECT ad_group_criterion.resource_name,
  ad_group_criterion.type,
  campaign.name,
  ad_group.name,
  ad_group_criterion.system_serving_status,
  ad_group_criterion.bid_modifier,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  campaign.advertising_channel_type
FROM ad_group_audience_view
WHERE segments.date DURING LAST_7_DAYS
```

### 9.7 Age Demographics
```sql
SELECT ad_group_criterion.age_range.type,
  campaign.name,
  ad_group.name,
  ad_group_criterion.system_serving_status,
  ad_group_criterion.bid_modifier,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  campaign.advertising_channel_type
FROM age_range_view
WHERE segments.date DURING LAST_7_DAYS
```

### 9.8 Gender Demographics
```sql
SELECT ad_group_criterion.gender.type,
  campaign.name,
  ad_group.name,
  ad_group_criterion.system_serving_status,
  ad_group_criterion.bid_modifier,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  campaign.advertising_channel_type
FROM gender_view
WHERE segments.date DURING LAST_7_DAYS
```

### 9.9 Locations
```sql
SELECT campaign_criterion.location.geo_target_constant,
  campaign.name,
  campaign_criterion.bid_modifier,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros
FROM location_view
WHERE segments.date DURING LAST_7_DAYS
  AND campaign_criterion.status != 'REMOVED'
```

### 9.10 Geo Constants Lookup
```sql
SELECT geo_target_constant.canonical_name,
  geo_target_constant.country_code,
  geo_target_constant.id,
  geo_target_constant.name,
  geo_target_constant.status,
  geo_target_constant.target_type
FROM geo_target_constant
WHERE geo_target_constant.resource_name = 'geoTargetConstants/1014044'
```

---

## 10. Valori micros

**IMPORTANT:** Multe câmpuri monetare sunt în **micros** (1 unitate = 1,000,000 micros):

```typescript
const costInCurrency = Number(row.metrics.cost_micros) / 1_000_000;
const cpcInCurrency = Number(row.metrics.average_cpc) / 1_000_000;
const budgetInCurrency = Number(row.campaign_budget.amount_micros) / 1_000_000;
```

**CTR** vine ca fracție (0.05 = 5%), trebuie × 100 pentru afișare procentuală.

---

## 11. Enum-uri frecvent utilizate

### Campaign Status
| Valoare numerică | String |
|-----------------|--------|
| 2 | `ENABLED` |
| 3 | `PAUSED` |
| 4 | `REMOVED` |

### Advertising Channel Type
| Valoare numerică | String |
|-----------------|--------|
| 2 | `SEARCH` |
| 3 | `DISPLAY` |
| 6 | `VIDEO` |
| 7 | `SHOPPING` |
| 8 | `HOTEL` |
| 9 | `PERFORMANCE_MAX` |
| 10 | `MULTI_CHANNEL` |
| 11 | `DEMAND_GEN` |

### Gender Type
| Valoare | String |
|---------|--------|
| 10 | `MALE` |
| 11 | `FEMALE` |
| 20 | `UNDETERMINED` |

### Age Range Type
| Valoare | String |
|---------|--------|
| 503001 | `AGE_RANGE_18_24` |
| 503002 | `AGE_RANGE_25_34` |
| 503003 | `AGE_RANGE_35_44` |
| 503004 | `AGE_RANGE_45_54` |
| 503005 | `AGE_RANGE_55_64` |
| 503006 | `AGE_RANGE_65_UP` |
| 503999 | `AGE_RANGE_UNDETERMINED` |

### Device
| String |
|--------|
| `MOBILE` |
| `DESKTOP` |
| `TABLET` |
| `CONNECTED_TV` |
| `OTHER` |

---

## 12. Structura existentă în proiect

### Client (`app/src/lib/server/google-ads/client.ts`)
- `getCustomerClient()` - client MCC
- `getSubAccountClient()` - client sub-account
- `listMccSubAccounts()` - listare sub-conturi
- `listInvoices()` - facturi MCC
- `listCampaignInsights()` - insights campanii (cu segments.date)
- `listCampaigns()` - listare campanii (status, buget)
- `listAdGroupInsights()` - insights ad groups per campanie
- `listDemographicInsights()` - breakdown gender/age/device

### Helpers (`app/src/lib/utils/google-report-helpers.ts`)
- `aggregateGoogleInsightsByDate()` - agregare time-series
- `aggregateGoogleInsightsByCampaign()` - agregare per campanie
- `aggregateGoogleInsightsByAdGroup()` - agregare per ad group

### Pattern folosit
```typescript
const customer = getSubAccountClient(mccId, customerId, devToken, refreshToken);
const results = await customer.query(`GAQL QUERY HERE`);
// results este array de obiecte cu structura row.campaign.*, row.metrics.*, row.segments.*
```

---

## 13. Query-uri utile noi pentru extinderea raportării

### Performanță pe locații
```sql
SELECT campaign.name,
  geographic_view.country_criterion_id,
  geographic_view.location_type,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros,
  metrics.conversions
FROM geographic_view
WHERE segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
```

### Performanță pe ore
```sql
SELECT campaign.name,
  segments.hour,
  segments.day_of_week,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros
FROM campaign
WHERE segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
```

### Landing pages
```sql
SELECT landing_page_view.unexpanded_final_url,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM landing_page_view
WHERE segments.date DURING LAST_30_DAYS
```

### Performanță pe rețea
```sql
SELECT campaign.name,
  segments.ad_network_type,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros,
  metrics.conversions
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
```

### Quality Score keywords
```sql
SELECT ad_group_criterion.keyword.text,
  metrics.historical_quality_score,
  metrics.historical_creative_quality_score,
  metrics.historical_landing_page_quality_score,
  metrics.historical_search_predicted_ctr,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros
FROM keyword_view
WHERE segments.date DURING LAST_30_DAYS
  AND ad_group_criterion.status != 'REMOVED'
```

### Search Impression Share
```sql
SELECT campaign.name,
  metrics.search_impression_share,
  metrics.search_top_impression_share,
  metrics.search_absolute_top_impression_share,
  metrics.search_rank_lost_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
  AND campaign.advertising_channel_type = 'SEARCH'
```

### Conversii per tip acțiune
```sql
SELECT segments.conversion_action_name,
  segments.conversion_action_category,
  metrics.conversions,
  metrics.conversions_value,
  metrics.cost_per_conversion
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
```

### Device breakdown per campanie
```sql
SELECT campaign.name,
  segments.device,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros,
  metrics.conversions,
  metrics.ctr,
  metrics.average_cpc
FROM campaign
WHERE segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
  AND campaign.status != 'REMOVED'
```

---

## 14. Best practices

1. **Selectează doar câmpurile necesare** - reduce timpul de răspuns
2. **Folosește WHERE** pentru a filtra datele la sursă
3. **LIMIT** în development pentru teste rapide
4. **SearchStream** pentru rapoarte mari (>10k rânduri)
5. **Verifică compatibilitatea câmpurilor** - nu toate metricile/segmentele sunt compatibile cu toate resursele
6. **segments.keyword.*** restricționează la Search Network
7. **Valori micros** - împarte la 1,000,000 pentru valori reale
8. **CTR** vine ca fracție (0-1), nu procent
9. **Status-urile** pot veni ca numeric sau string, tratează ambele cazuri
10. **Evită query-uri prea largi** - multiple segmente multiplică rândurile exponențial
