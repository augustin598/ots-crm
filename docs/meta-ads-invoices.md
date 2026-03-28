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
- Campuri cheie: `txid`, `invoiceNumber` (FBADS-xxx), `amountText`, `pdfPath` (MinIO)
- Query: `getMetaInvoiceDownloads()` — returneaza ultimele 500 rows

### 3. FB Session Cookies (`metaAdsIntegration.fbSessionCookies`)
- Encrypted cu AES-256-GCM
- Status: `fbSessionStatus` = 'none' | 'active'
- Setate manual din Settings → Meta Ads
- Necesare pentru download PDF (Facebook nu ofera API pt facturi)

## UI Architecture

### Page: `+page.svelte`
- **Header**: DateRangePicker, Import Facturi, Download Facturi, Sync Acum
- **Bulk Import Panel**: textarea JSON + auto-detect ad account din URL
- **Client Cards**: grupate per `clientName`, collapsible
  - Spending rows: luna, cheltuieli, impressions, clicks, butoane download
  - Download-only rows: luna fara spending, doar butoane download
  - Sub-rows: individual invoices (cand >1 per luna)

### Grouping Logic
1. Spending rows filtrate dupa date range → grupate per client
2. Downloads fara spending row asociat → adaugate ca "virtual rows" (`_downloadOnly: true`)
3. Sortate descrescator dupa `periodStart`

### PDF Serving
- Admin: `/[tenant]/invoices/meta-ads/downloads/[downloadId]/pdf`
- Client: `/client/[tenant]/(app)/invoices/meta-ads/downloads/[downloadId]/pdf`
- Citeste din MinIO via `getFileBuffer(pdfPath)`

## Storage (MinIO/S3)
- Config: `$env/dynamic/private` → `MINIO_ENDPOINT`, `MINIO_BUCKET_NAME`, etc.
- Upload: `uploadBuffer(tenantId, buffer, filename, mimeType, metadata)`
- Path format: `{tenantId}/{timestamp}-{filename}`
- `getBucketName()` — lazy getter (evita evaluare la import-time)

## Database Tables
| Table | Purpose |
|-------|---------|
| `metaAdsIntegration` | Business Manager connections (token, cookies) |
| `metaAdsAccount` | Ad accounts per integration, mapped to CRM clients |
| `metaAdsSpending` | Monthly spending data per account |
| `metaInvoiceDownload` | Downloaded invoice PDFs |
| `metaAdsInvoice` | Legacy — synced invoice metadata (not actively used in UI) |

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

## Known Limitations
- Client page (`/client/[tenant]/(app)/invoices/meta-ads/`) is a separate copy — changes in admin page don't propagate
- Facebook cookies expire periodically — manual refresh required
- No conversions data from Meta API (page shows impressions, labeled as "Impresii")
- Date range defaults to current month — use "Maximum" to see all history
- `metaAdsInvoice` table (legacy) is separate from `metaInvoiceDownload` — different data sources

## Error Handling
- Storage errors: logged via `logError('storage', ...)` + returned as `storage_error` status
- Download errors: caught per-invoice, aggregated in `errorDetails[]`
- PDF serving: errors logged with `console.error` + returns 404
- Bulk import: try/catch per link, continues on error, returns summary
