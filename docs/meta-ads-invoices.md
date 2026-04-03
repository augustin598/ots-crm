# Meta Ads Invoices - Context & Architecture

## Overview
Pagina `/[tenant]/invoices/meta-ads` gestioneaza facturile si cheltuielile Meta (Facebook) Ads per client.

## Data Sources

### 1. Spending Data (`metaAdsSpending`)
- Sincronizat automat din Meta Ads API (`/insights` endpoint)
- Per ad account, per luna: `spendCents`, `impressions`, `clicks`, `currencyCode`
- Joined cu `client.name` si `metaAdsIntegration.businessName`
- Query: `getMetaAdsSpendingList()` — returneaza ultimele 500 rows

### 2. Invoice Downloads (`metaInvoiceDownload`)
- PDF-uri descarcate din Facebook Billing (cookies-based auth)
- Doua metode de import:
  - **Automat**: `downloadInvoiceForAccount()` → foloseste `invoices_generator` endpoint + fallback pe `billing_transaction`
  - **Bulk import**: `bulkDownloadMetaInvoices()` → primeste JSON cu URL-uri din Facebook Billing page
- Deduplicare: pe `txid` (unique index WHERE txid IS NOT NULL)
- Campuri cheie: `txid`, `invoiceNumber` (FBADS-xxx), `amountText`, `invoiceType`, `pdfPath` (MinIO)
- Query: `getMetaInvoiceDownloads()` — returneaza ultimele 500 rows

### 3. FB Session Cookies (`metaAdsIntegration.fbSessionCookies`)
- Encrypted cu AES-256-GCM
- Status: `fbSessionStatus` = 'none' | 'active'
- Setate manual din Settings → Meta Ads
- Necesare pentru download PDF (Facebook nu ofera API pt facturi)

## Invoice Types
Facturile descarcate pot fi de doua tipuri (`invoiceType`):

| Type | Descriere | Detectie | Exemplu |
|------|-----------|----------|---------|
| `'invoice'` | **Factura fiscala** — document oficial de plata | Are `invoiceId` (FBADS-xxx) | FBADS-108-104380003, RON 3,503.38 |
| `'credit'` | **Credit publicitar** — advertising credit, nu e factura fiscala | NU are `invoiceId`, doar TX id | TX 8328726..., RON 0.79 |

**Regula de detectie:** `link.invoiceId ? 'invoice' : 'credit'` — FBADS-xxx = fiscal, fara FBADS = credit.

**Comportament UI:**
- Creditele sunt **ascunse implicit** — checkbox "Credite Ad" le afiseaza
- Badge galben "Credit" pe sub-rows de tip credit
- Header badge: verde "X facturi" + amber "Y credite" (cand vizibile)
- "+N credite" indicat pe linia lunii cand creditele sunt ascunse

**Exemplu credit publicitar (din PDF):**
- Payment method: "Advertising credit"
- Transaction ID: `8328726830571648-8359447280832931`
- Amount: RON 0.79
- Nu are numar FBADS-xxx — nu e factura fiscala

## UI Architecture

### Page: `+page.svelte`
- **Header**: DateRangePicker, Import Facturi, Download Facturi, Sync Acum
- **Filters**: Search + checkbox "Credite Ad"
- **Bulk Import Panel**: textarea JSON + auto-detect ad account din URL (`act=XXX` → `act_XXX`)
- **Client Cards**: grupate per `clientName`, collapsible (3 nivele)
  - **Nivel 1 — Card header**: client name, badges, totals (collapsible)
  - **Nivel 2 — Period row**: luna, cheltuieli, imp, clicks + badge "N facturi" (collapsible toggle)
  - **Nivel 3 — Invoice row**: FBADS/TX label, amount, butoane PDF/Preview + overflow menu (Re-download, Delete)
- Sub-rows **collapsed implicit** — click pe badge "N facturi" le expandeaza
- Butoane per factura: 2 vizibile (PDF, Preview) + dropdown overflow (Re-download, Delete)

### Grouping Logic
1. Spending rows filtrate dupa date range → grupate per `clientName`
2. Downloads fara spending row asociat → adaugate ca "virtual rows" (`_downloadOnly: true`)
3. Creditele filtrate din display cand checkbox "Credite Ad" e OFF
4. Multi-account detection: daca un client are >1 `metaAdAccountId`, flag `hasMultipleAccounts = true`
5. Sortare: `periodStart DESC`, apoi `adAccountName ASC` (grupeaza conturile in aceeasi luna)
6. Dupa bulk import, date range se auto-expandeaza la cea mai veche factura importata

### Multi-Account Clients
Cand un client are 2+ conturi Facebook Ads (ex: `beonemedical.ro` + `BeautyOneShop.ro`):
- Fiecare rand afiseaza `Martie 2026 (beonemedical.ro)` — numele contului in paranteza
- Spending query face join cu `metaAdsAccount` pe `(tenantId, metaAdAccountId)` pt `accountName`
- Download-only virtual rows preiau `adAccountName` din `metaInvoiceDownload.adAccountName`
- Cand clientul are 1 singur cont, numele contului NU se afiseaza (economie de spatiu)

### Ad Account Dropdown (Bulk Import)
Populeaza din 3 surse (in ordine):
1. Spending data (conturile cu cheltuieli)
2. Downloads existente (conturile cu facturi descarcate)
3. Downloadable accounts (conturile cu sesiune activa)
4. **Auto-detect**: daca nu e selectat, extrage `act=XXX` din primul URL

### PDF Serving
- Admin: `/[tenant]/invoices/meta-ads/downloads/[downloadId]/pdf`
- Client: `/client/[tenant]/(app)/invoices/meta-ads/downloads/[downloadId]/pdf`
- Citeste din MinIO via `getFileBuffer(pdfPath)`
- Erori loggate cu `console.error` inainte de throw 404

## Storage (MinIO/S3)
- Config: `$env/dynamic/private` → `MINIO_ENDPOINT`, `MINIO_BUCKET_NAME`, etc.
- Upload: `uploadBuffer(tenantId, buffer, filename, mimeType, metadata)`
- Path format: `{tenantId}/{timestamp}-{filename}`
- `getBucketName()` — lazy getter (evita evaluare la import-time)
- `getFileBuffer()` — logheaza erori cu `logError('storage', ...)`
- Upload errors in import flows: caught per-invoice, nu crapa tot comanda

## Database Tables
| Table | Purpose |
|-------|---------|
| `metaAdsIntegration` | Business Manager connections (token, cookies) |
| `metaAdsAccount` | Ad accounts per integration, mapped to CRM clients |
| `metaAdsSpending` | Monthly spending data per account |
| `metaInvoiceDownload` | Downloaded invoice PDFs |
| `metaAdsInvoice` | Legacy — synced invoice metadata (not actively used in UI) |

### metaInvoiceDownload — Key Fields
| Field | Type | Notes |
|-------|------|-------|
| `txid` | text, nullable | Facebook Transaction ID, unique per tenant |
| `invoiceNumber` | text, nullable | FBADS-108-XXXXXXX format |
| `amountText` | text, nullable | Raw amount "RON3,503.38" |
| `invoiceType` | text, NOT NULL, default 'invoice' | 'invoice' or 'credit' |
| `pdfPath` | text, nullable | MinIO storage path |
| `status` | text, NOT NULL, default 'pending' | 'pending', 'downloaded', 'error' |

## Key Migrations
| Migration | Change |
|-----------|--------|
| 0073 | Created integration, account, invoice tables |
| 0075 | Created spending table |
| 0076 | Created metaInvoiceDownload + FB cookies fields |
| 0084 | Added `txid` column |
| 0085 | Added `invoice_number` column |
| 0086 | Unique index on `(tenant_id, txid)` |
| 0087 | Dropped period-based dedup index |
| 0088 | Added `amount_text` column |
| 0089 | Added `invoice_type` column (invoice/credit) |

## Token & Integration Lifecycle
- **Un token per Business Manager** — partajat de TOATE conturile ad din acel BM
- `metaAdsIntegration.isActive` = token valid; `false` = dezactivat automat sau manual
- Token refresh scheduler ruleaza la fiecare 6 ore (`token-refresh.ts`)
- Erori permanente (`Error validating access token`, `Session has expired`, `has not authorized application`) → `isActive = false` automat
- `consecutiveRefreshFailures` — tracked dar NU folosit pentru dezactivare, doar pentru notificari (>= 5 failures)
- `getAuthenticatedToken(integrationId)` → filtreaza `isActive = true` → returneaza `null` daca dezactivat
- **Reports page** (`reports.remote.ts`): `getReportAdAccounts()` returneaza `integrationActive` pentru a marca conturile cu integrare dezactivata in dropdown
- **Cache keys** includ `integrationId` pentru a evita coliziuni intre integrari diferite
- **Error classification** (`throwMetaApiError`): diferentiaza token expired (401), permisiuni (403), autorizare (401), si erori generice (500)

## Known Limitations
- Client page (`/client/[tenant]/(app)/invoices/meta-ads/`) is a separate copy — changes in admin page don't propagate
- Facebook cookies expire periodically — manual refresh required
- No conversions data from Meta API (page shows impressions, labeled as "Impresii")
- Date range defaults to current month — use "Maximum" to see all history
- `metaAdsInvoice` table (legacy) is separate from `metaInvoiceDownload` — different data sources
- Year selector in download dialog: dynamic range `currentYear-2` to `currentYear+1`

## Invoice Download Flow (invoice-downloader.ts)

### Download Strategy (3-level fallback)
1. **invoices_generator** — monthly aggregated invoice (may return PDF or ZIP with multiple PDFs)
2. **billing_transaction** — individual transaction download via Graph API transaction list
3. **No invoice** — clean up stale errors

### Multi-PDF ZIP Handling
- `invoices_generator` may return a ZIP with multiple PDFs (one per transaction)
- `extractAllPdfsFromZip()` extracts ALL PDFs (not just first)
- Each PDF is saved as a separate `metaInvoiceDownload` row
- txid parsed from ZIP filename (pattern: `{digits}-{digits}` or `{digits}_{digits}`)

### Billing Transaction Fallback
- Graph API `GET /act_{id}/transactions` fetches all transactions for the month
- Downloads ALL transactions individually (not just the first)
- Each transaction gets its own DB row with `txid`, `amountText`, `invoiceType`
- `invoiceType` auto-detected: `amountCents > 0` → `'invoice'`, otherwise `'credit'`

### Re-download Logic
- If record has `txid` → uses `billing_transaction` direct URL
- If no `txid` → falls back to `invoices_generator` (monthly ZIP/PDF)

### Deduplication Strategy
- **No period-based skip**: months are NOT skipped even if downloads exist (fixes old bug where only 1st PDF from ZIP was saved)
- **txid-based dedup**: individual transactions are deduplicated by `(tenant_id, txid)` unique index
- This allows re-processing months to recover previously missed transactions while preventing actual duplicates

### Scheduler Catch-Up
- Scheduler runs monthly, downloads previous month + up to 11 catch-up months (full year)
- `downloadAllReceiptsForMonth()` re-processes all months; txid dedup prevents duplicates

### Scraper (meta-scraper.ts)
- Uses `loadAllTransactions()` — scrolls + clicks "See More" button (max 50 iterations)
- Date range: account lifetime (`1642284000` to now), not just last 6 months
- Supports English and Romanian date formats

### Userscript (facebook-ads-invoice-extractor.user.js)
- Match patterns: `/billing_hub/*`, `/latest/billing_hub/*`, `/ads/manage/billing*`
- 2-strategy extraction: table rows first (FBADS + txid patterns), billing_transaction links fallback

## Error Handling
- Storage errors: logged via `logError('storage', ...)` + returned as `storage_error` status
- Download errors: caught per-invoice, aggregated in `errorDetails[]`
- PDF serving: errors logged with `logError` + returns 404
- Bulk import: try/catch per link, continues on error, returns `{ downloaded, skipped, errors, errorDetails }`
- All logging uses structured logger (`logInfo`/`logWarning`/`logError`) — no console.log/error
