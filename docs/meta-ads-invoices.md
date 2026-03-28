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

| Type | Descriere | Detectie |
|------|-----------|----------|
| `'invoice'` | Factura reala de plata (sume mari) | Are `invoiceId` (FBADS-xxx) in JSON |
| `'credit'` | Advertising credit (sume mici, gen RON 0.01-0.79) | NU are `invoiceId` in JSON |

**Comportament UI:**
- Creditele sunt **ascunse implicit** — checkbox "Credite Ad" le afiseaza
- Badge galben "Credit" pe sub-rows de tip credit
- Header badge: verde "X facturi" + amber "Y credite" (cand vizibile)
- "+N credite" indicat pe linia lunii cand creditele sunt ascunse

**Exemplu factura credit (din PDF):**
- Payment method: "Advertising credit"
- Transaction ID: `8328726830571648-8359447280832931`
- Amount: RON 0.79
- Nu are numar FBADS-xxx

## UI Architecture

### Page: `+page.svelte`
- **Header**: DateRangePicker, Import Facturi, Download Facturi, Sync Acum
- **Filters**: Search + checkbox "Credite Ad"
- **Bulk Import Panel**: textarea JSON + auto-detect ad account din URL (`act=XXX` → `act_XXX`)
- **Client Cards**: grupate per `clientName`, collapsible
  - Spending rows: luna, cheltuieli, impressions, clicks, butoane download
  - Download-only rows: luna fara spending, afiseaza `amountText` daca exista
  - Sub-rows: individual invoices (cand >1 per luna) cu badge Credit daca e cazul
  - Butoane per factura: Download, Preview, Re-download, Delete

### Grouping Logic
1. Spending rows filtrate dupa date range → grupate per client
2. Downloads fara spending row asociat → adaugate ca "virtual rows" (`_downloadOnly: true`)
3. Creditele filtrate din display cand checkbox "Credite Ad" e OFF
4. Sortate descrescator dupa `periodStart`
5. Dupa bulk import, date range se auto-expandeaza la cea mai veche factura importata

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

## Known Limitations
- Client page (`/client/[tenant]/(app)/invoices/meta-ads/`) is a separate copy — changes in admin page don't propagate
- Facebook cookies expire periodically — manual refresh required
- No conversions data from Meta API (page shows impressions, labeled as "Impresii")
- Date range defaults to current month — use "Maximum" to see all history
- `metaAdsInvoice` table (legacy) is separate from `metaInvoiceDownload` — different data sources
- Year selector in download dialog: dynamic range `currentYear-2` to `currentYear+1`

## Error Handling
- Storage errors: logged via `logError('storage', ...)` + returned as `storage_error` status
- Download errors: caught per-invoice, aggregated in `errorDetails[]`
- PDF serving: errors logged with `console.error` + returns 404
- Bulk import: try/catch per link, continues on error, returns `{ downloaded, skipped, errors, errorDetails }`
