# Google Ads API - Documentatie Completa

## 1. Generalitati

- **Versiune curenta**: v23 (active: v22, v21)
- **Base URL**: `https://googleads.googleapis.com`
- **Protocol**: gRPC (preferat) sau REST (JSON over HTTP 1.1)
- **Scop**: Management programatic conturi Google Ads — reporting, billing, invoices, campanii

---

## 2. Autentificare & Autorizare

### Credentiale necesare (TOATE call-urile necesita aceste 3)

| Element | Detalii |
|---------|---------|
| **OAuth2 Access Token** | `Authorization: Bearer ACCESS_TOKEN` |
| **Developer Token** | `developer-token: DEVELOPER_TOKEN` (22 caractere, de la https://ads.google.com/aw/apicenter) |
| **Login Customer ID** | `login-customer-id: MCC_ID` (obligatoriu cand accesezi prin manager/MCC account, 10 cifre fara cratime) |

### OAuth2 Scope-uri
```
https://www.googleapis.com/auth/adwords          (scope principal Google Ads)
https://www.googleapis.com/auth/userinfo.email    (pentru email utilizator)
```

### OAuth2 Flow
1. Genereaza URL autorizare cu `access_type: 'offline'`, `prompt: 'consent'`
2. User authorizeaza → redirect la callback cu `code`
3. Exchange `code` → `access_token` + `refresh_token`
4. Auto-refresh cu 5 min buffer inainte de expirare
5. Stocheaza `refresh_token` in DB (nu expira decat daca user revoca)

### HTTP Headers Obligatorii
```http
Authorization: Bearer {access_token}
developer-token: {developer_token}
login-customer-id: {mcc_customer_id}    # doar pentru MCC accounts
Content-Type: application/json
```

### Response Header Important
- `request-id` — ID unic pentru debugging/support Google

---

## 3. Structura API

### Ierarhie Resurse
```
Customer (top level)
  ├── Campaigns
  │     ├── Ad Groups
  │     │     ├── Ad Group Ads
  │     │     └── Ad Group Criteria (keywords)
  │     └── Campaign Criteria
  ├── BillingSetup → AccountBudget → Invoice
  └── CustomerClient (sub-conturi MCC)
```

### Format Resource Names
```
customers/{customer_id}/campaigns/{campaign_id}
customers/{customer_id}/adGroups/{ad_group_id}
customers/{customer_id}/adGroupAds/{ad_group_id}~{ad_id}
customers/{customer_id}/billingSetups/{billing_setup_id}
```

### Customer ID Format
- API: `1234567890` (10 cifre, FARA cratime)
- Display: `123-456-7890`

---

## 4. Endpoint-uri REST

### Metode Custom (NU REST traditional)
API-ul foloseste metode custom cu separator `:`:

| Operatie | Metoda | URL |
|----------|--------|-----|
| Search (paginat) | POST | `/v23/customers/{id}/googleAds:search` |
| SearchStream | POST | `/v23/customers/{id}/googleAds:searchStream` |
| Mutate campaigns | POST | `/v23/customers/{id}/campaigns:mutate` |
| List accessible customers | GET | `/v23/customers:listAccessibleCustomers` |
| List invoices | GET | `/v23/customers/{id}/invoices` |

### Search vs SearchStream
- **Search**: Paginat, pentru UI interactiv. Returneaza `page_token` pentru next page.
- **SearchStream**: Streaming unic, toate rezultatele. Mai eficient pentru >10,000 randuri, batch/background.

### Request Format (Search)
```json
POST /v23/customers/{customer_id}/googleAds:search
{
  "query": "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED'",
  "pageSize": 10000,
  "pageToken": ""
}
```

### JSON Format Notes
- Protocol buffers: `snake_case`
- JSON responses: `lowerCamelCase`
- GAQL queries: MEREU `snake_case`
- Resource identifier: camp `resourceName` (nu `name`)

---

## 5. GAQL (Google Ads Query Language)

### Sintaxa de Baza
```sql
SELECT field1, field2, ...
FROM resource
WHERE condition1 AND condition2
ORDER BY field1 ASC|DESC
LIMIT number
PARAMETERS key=value
```
Doar `SELECT` si `FROM` sunt obligatorii.

### Operatori

| Categorie | Operatori |
|-----------|-----------|
| Comparatie | `=`, `!=`, `>`, `>=`, `<`, `<=` |
| Containment | `IN`, `NOT IN`, `CONTAINS ANY`, `CONTAINS ALL`, `CONTAINS NONE` |
| Pattern | `LIKE`, `NOT LIKE`, `REGEXP_MATCH`, `NOT REGEXP_MATCH` |
| Null | `IS NULL`, `IS NOT NULL` |
| Date range | `DURING`, `BETWEEN` |

### Date Range Literals
`TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS`, `LAST_BUSINESS_WEEK`, `LAST_MONTH`, `THIS_MONTH`

### Tipuri de Campuri
- **Resource fields**: `campaign.id`, `campaign.name`, `campaign.status`
- **Segment fields**: `segments.date`, `segments.device`, `segments.ad_network_type`
- **Metrics**: `metrics.impressions`, `metrics.clicks`, `metrics.ctr`, `metrics.cost_micros`

### Exemple Query-uri

**Performanta campanii (ultimele 30 zile):**
```sql
SELECT
  campaign.name,
  campaign.status,
  segments.device,
  metrics.impressions,
  metrics.clicks,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
```

**Ierarhie conturi MCC:**
```sql
SELECT
  customer_client.client_customer,
  customer_client.level,
  customer_client.manager,
  customer_client.descriptive_name,
  customer_client.currency_code,
  customer_client.time_zone,
  customer_client.id
FROM customer_client
WHERE customer_client.level <= 1
```

**Billing setup-uri:**
```sql
SELECT
  billing_setup.id,
  billing_setup.status,
  billing_setup.payments_account,
  billing_setup.payments_account_info.payments_account_id,
  billing_setup.payments_account_info.payments_account_name
FROM billing_setup
WHERE billing_setup.status = 'APPROVED'
```

### PARAMETERS Clause
- `include_drafts=true` — returneaza si entitati draft
- `omit_unselected_resource_names=true` — exclude resource_names neselectate

### Note Segmentare
- Rezultatele produc un rand per combinatie: resursa principala + fiecare valoare segment
- `segments.date/week/month/quarter/year` — nu trebuie neaparat in SELECT daca sunt in WHERE

---

## 6. Management Conturi

### List Accessible Customers
```
GET /v23/customers:listAccessibleCustomers
```
- NU necesita `customer_id` in request
- Ignora header-ul `login-customer-id`
- Returneaza DOAR conturile direct accesibile (NU full hierarchy)
- Response: lista de resource names (`customers/1234567890`)

### Ierarhie Conturi (CustomerClient)
- Query resursa `customer_client` cu GAQL
- `level = 0` = root (contul curent), `level = 1` = copil direct
- Pentru ierarhie completa: BFS — query fiecare manager account recursiv

### Customer Status Values
| Status | Valoare |
|--------|---------|
| ENABLED | 2 |
| CANCELLED | 3 |
| SUSPENDED | 4 |
| CLOSED | 5 |

---

## 7. Billing & Facturi (Invoice)

### Cerinte
- Contul TREBUIE sa aiba **monthly invoicing** activat
- Facturile inainte de 1 Ianuarie 2019 NU pot fi accesate

### Entitati Billing
1. **BillingSetup** — legatura intre Payments account si Google Ads account
2. **AccountBudgetProposal** — creaza/updateaza bugete (necesita aprobare)
3. **AccountBudget** — buget aprobat
4. **Invoice** — factura lunara cu ajustari, taxe, detalii buget

### InvoiceService.ListInvoices

**Parametri obligatorii:**

| Parametru | Descriere |
|-----------|-----------|
| `customer_id` | ID-ul contului Google Ads |
| `billing_setup` | Resource name billing setup (sau wildcard `-`) |
| `issue_year` | Anul facturii (2019+) |
| `issue_month` | Luna: `JANUARY`, `FEBRUARY`, ..., `DECEMBER` |

**Wildcard billing setup**: `customers/{customer_id}/billingSetups/-` — returneaza facturi pentru TOATE billing setup-urile.

### Campuri Invoice Response

**Identificatori:**
- `payments_account_id` — Billing Account Number
- `payments_profile_id` — Billing ID
- `id` — Invoice Number

**Date:**
- `issue_date` — data emiterii
- `due_date` — data scadenta
- `service_date_range` — { `start_date`, `end_date` }

**Sume (TOATE in micros = suma * 1,000,000):**
| Camp | Descriere |
|------|-----------|
| `subtotal_amount_micros` | Subtotal fara taxe |
| `tax_amount_micros` | Suma taxe |
| `total_amount_micros` | Total cu taxe |
| `adjustments_subtotal_amount_micros` | Ajustari |
| `regulatory_costs_subtotal_amount_micros` | Costuri regulatorii |
| `export_charge_subtotal_amount_micros` | Taxe export |

**Alte campuri:**
- `currency_code` — moneda (EUR, USD, RON etc.)
- `corrected_invoice` — factura corectata (daca e cazul)
- `replaced_invoices` — lista facturi inlocuite
- `pdf_url` — URL temporar pentru download PDF
- `type` — `2 = INVOICE`, `3 = CREDIT_MEMO`

### Account Budget Summaries (per factura)
Fiecare factura include `account_budget_summaries` — detalii per sub-cont:
- `customer` — customer resource name (pentru matching sub-conturi)
- `customer_descriptive_name` — numele contului
- `billable_activity_date_range` — perioada activitate facturabila
- `served_amount_micros` — suma servita
- `billed_amount_micros` — suma facturata
- `overdelivery_amount_micros` — overdelivery
- `invalid_activity_amount_micros` — activitate invalida
- `purchase_order_number` — numar comanda

### Format Micros
```
$10.50    = 10,500,000 micros
€1,234.56 = 1,234,560,000 micros
Formula:  amount_real = amount_micros / 1,000,000
```

### Download PDF Factura
```bash
# 1. Obtine pdf_url din Invoice object
# 2. GET request autentificat
curl --header "Authorization: Bearer {access_token}" "{pdf_url}" > invoice.pdf
```
- URL-ul este **temporar** (time-limited)
- Trebuie folosit **acelasi** Google Account care a obtinut factura

### Facturare Consolidata
O factura poate combina date din TOATE conturile Google Ads care impart acelasi Payments account. Foloseste `account_budget_summaries` pentru a mapa portiunile facturii la sub-conturi/clienti specifici.

---

## 8. Erori Frecvente

| Scenariu | Error Code |
|----------|-----------|
| Campuri obligatorii lipsa | `RequestError.REQUIRED_FIELD_MISSING` |
| Valori invalide | `FieldError.INVALID_VALUE` |
| Factura inainte de 2019 | `InvoiceError.YEAR_MONTH_TOO_OLD` |
| Cont fara monthly invoicing | `InvoiceError.NOT_INVOICED_CUSTOMER` |
| Permisiuni lipsa | `AuthorizationError.ACTION_NOT_PERMITTED` |
| Modificare concurenta | `CONCURRENT_MODIFICATION_ERROR` |
| Permission denied (login-customer-id gresit) | `AuthorizationError.USER_PERMISSION_DENIED` |

---

## 9. Best Practices

- Selecteaza DOAR campurile necesare (reduce latenta)
- Foloseste `LIMIT` in development
- Aplica `WHERE` pentru a minimiza transferul de date
- Foloseste `SearchStream` pentru datasets mari, `Search` pentru UI paginat
- Logheaza `request-id` din response headers pentru debugging
- Validate-only mode disponibil pentru testare mutatii fara aplicare
- Partial failure handling disponibil pentru operatii batch
- Un singur developer token per Google Cloud project

---

## 10. Variabile de Mediu Necesare

```env
GOOGLE_CLIENT_ID=xxx              # Shared cu Gmail integration
GOOGLE_CLIENT_SECRET=xxx          # Shared cu Gmail integration
GOOGLE_ADS_REDIRECT_URI=xxx       # Separat de Gmail redirect
GOOGLE_ADS_DEVELOPER_TOKEN=xxx    # Developer token 22 chars
```

---

## 11. Implementare Existenta in Proiect

### Fisiere
- `app/src/lib/server/google-ads/auth.ts` — OAuth2 flow (connect, disconnect, token refresh, status)
- `app/src/lib/server/google-ads/client.ts` — API client (listMccSubAccounts, listInvoices, downloadInvoicePdf)
- `app/src/lib/server/google-ads/sync.ts` — Invoice sync logic (match invoices la CRM clients via account mapping)
- `app/src/lib/remotes/google-ads-invoices.remote.ts` — Remote functions
- `app/src/lib/server/scheduler/tasks/google-ads-invoice-sync.ts` — Scheduler task

### Tabele DB (migratii 0071, 0072)
- `google_ads_integration` — OAuth tokens, MCC account, developer token, sync config per tenant
- `google_ads_invoice` — Facturi sincronizate, dedup pe `(tenant_id, google_invoice_id)`
- `google_ads_account` — Sub-conturi MCC cached, cu mapping CRM client
- `client.google_ads_customer_id` — Coloana adaugata pentru linking direct client-account

### NPM Packages
- `google-ads-api` — Node.js client library (wraps gRPC)
- `googleapis` — Pentru OAuth2 flow

### Logica Sync
1. Query facturi la nivel MCC (nu per sub-account)
2. Map facturi la CRM clients via `account_budget_summaries` → `googleAdsCustomerId`
3. Download PDF via authenticated HTTP GET
4. Dedup pe `(tenantId, googleInvoiceId, clientId)`
5. Sync luna curenta + 2 luni anterioare
6. Stocheaza PDF in `uploads/google-ads-invoices/{tenantId}/{year}-{month}/`

### Billing Setup Wildcard
Proiectul foloseste `customers/{cleanMcc}/billingSetups/-` (wildcard `-`) → returneaza facturi pentru TOATE billing setup-urile.

---

## 12. Enumerari Luna (pentru ListInvoices)

```typescript
const MONTH_ENUMS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];
// issue_month: MONTH_ENUMS[date.getMonth()]
```

---

## 13. Resurse API Principale

### Cu Metrici (100+)
Campaign, Ad Group, Customer, Conversion Action, Bidding Strategy, Asset Group, Performance Max Placement View, Shopping Performance View, Demographic views, etc.

### Fara Metrici (150+)
Account structures, Asset management, Audience configuration, Batch Job operations, Campaign elements, Billing Setup, Labels, etc.

### GoogleAdsFieldService
- Serviciu metadata pentru compatibilitate campuri
- Returneaza: `attributeResources`, `metrics`, `segments`, `selectableWith`
- 4 niveluri: Resource → Resource field → Segmentation field → Metric
