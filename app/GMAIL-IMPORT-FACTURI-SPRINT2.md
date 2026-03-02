
# Gmail Import Facturi Furnizori — Sprint 2 (2026-02-28)

## Ce s-a implementat

### 1. Parsare avansată PDF (enrichment din PDF)
- **NOU**: `app/src/lib/server/gmail/pdf-parser.ts` — `extractInvoiceDataFromPdf(buffer)`
  - Refolosește `extractTextFromPDF` din `pdf-client-extractor.ts` (unpdf)
  - Refolosește `parseAmount` din `parsers/index.ts`
  - Extrage: invoiceNumber, amount, currency, issueDate, dueDate din text PDF
  - Regex-uri multilimba: EN, RO, DE, FR (due date, scadenta, fällig, échéance)
  - Pattern vendor-specific: OVH (FR-XXXXXXX), AWS (INV-xxx), Hetzner (Rxxxxxxxx)
- **Integrare**: PDF parsing = ENRICHMENT (email text rămâne sursa primară, PDF completează câmpurile NULL)
- **Locuri integrate**:
  - `previewGmailInvoices` — preview arată date îmbogățite din PDF
  - `importSelectedInvoices` — import folosește date PDF
  - `processGmailInvoiceSync` — scheduler folosește date PDF
- **Error handling**: try/catch pe tot, PDF-uri encriptate/imagine-only = skip silențios

### 2. Configurare auto-sync per tenant
- **Schema** (5 coloane noi pe `gmail_integration`):
  - `sync_enabled` (boolean, default true)
  - `sync_interval` (text: daily/twice_daily/weekly, default daily)
  - `sync_parser_ids` (text JSON array, null = all)
  - `sync_date_range_days` (integer, default 7)
  - `last_sync_results` (text JSON: {imported, errors, timestamp})
- **Scheduler**: Global worker respectă setări per tenant:
  - Skip tenants cu syncEnabled=false
  - twice_daily: ruleaza și la 17:00
  - weekly: doar Luni dimineața
  - Respectă syncParserIds și syncDateRangeDays
  - Salvează lastSyncResults după fiecare sync
- **NOU schedule**: `gmail-invoice-sync-evening` la 17:00 (pentru twice_daily)
- **Remote**: `updateGmailSyncConfig` command
- **UI**: Settings Gmail page — toggle sync, select interval, checkboxes furnizori, input zile
- **API**: `getGmailStatus` returnează și sync config + lastSyncResults

### 3. Paginare lista facturi furnizori
- Client-side pagination pe `filteredInvoices`
- Default: 25/pagină, opțiuni: 10/25/50/100
- Controls: Anterior/Următor + "Pagina X / Y" + "Afișare X-Y din Z"
- Page size selector integrat în filtre
- Reset automat la pagina 1 la schimbarea filtrelor

### 4. Notificări la import automat
- Banner dismissibil pe pagina facturi când există importuri noi
- Compară `lastSyncResults.timestamp` cu `localStorage.lastSeenSyncTimestamp`
- Dismiss salvează timestamp în localStorage
- lastSyncResults salvat de scheduler (Task 2) — nu necesită queries suplimentare
- `getLastSyncResults` query în remote

### 5. Parseri noi (OVH, DigitalOcean, AWS)
- **NOU**: `app/src/lib/server/gmail/parsers/ovh.ts` — OVH/OVHcloud
  - Match: from ovh.com/ovhcloud.com
  - Invoice: FR-XXXXXXX pattern
  - Default: EUR, suport FR keywords
- **NOU**: `app/src/lib/server/gmail/parsers/digitalocean.ts` — DigitalOcean
  - Match: from digitalocean.com
  - Invoice + receipt + billing keywords
  - Default: USD
- **NOU**: `app/src/lib/server/gmail/parsers/aws.ts` — Amazon Web Services
  - Match: from amazonaws.com/aws.amazon.com + amazon.com cu billing keywords
  - Invoice: INV-xxx pattern
  - Default: USD
- Înregistrați în `parserRegistry` (înainte de genericParser)
- UI actualizat: import wizard + filtre pe lista facturi

### 6. Link supplier invoice → expense
- **Schema**: `supplier_invoice_id` FK pe tabelul `expense` (nullable)
- **Relations** Drizzle: bidirectional via `supplierInvoiceRelations.expenses` + `expenseRelations.supplierInvoice`
- **Remote functions**:
  - `createExpenseFromSupplierInvoice(invoiceId)` — creează expense auto-populat (supplierId, amount, currency, date, pdfPath, isPaid)
  - `linkSupplierInvoiceToExpense({supplierInvoiceId, expenseId})` — link la expense existent
  - `getSupplierInvoices` — LEFT JOIN pe expense, returnează expenseId
- **UI**: Buton "Creează cheltuială" pe fiecare factură fără expense link, Badge "Cheltuială" cu redirect dacă are link

### Migrare DB
- `drizzle/0049_careful_quasimodo.sql` — 6 ALTER TABLE statements
- Gmail integration: 5 coloane sync config
- Expense: 1 coloană FK supplier_invoice_id

## Fișiere noi
- `app/src/lib/server/gmail/pdf-parser.ts`
- `app/src/lib/server/gmail/parsers/ovh.ts`
- `app/src/lib/server/gmail/parsers/digitalocean.ts`
- `app/src/lib/server/gmail/parsers/aws.ts`
- `app/drizzle/0049_careful_quasimodo.sql`
- `app/GMAIL-IMPORT-FACTURI-SPRINT2.md`

## Fișiere modificate
- `app/src/lib/server/db/schema.ts` — 5 coloane gmail_integration + 1 FK expense + relations
- `app/src/lib/server/gmail/parsers/index.ts` — import + register parseri noi
- `app/src/lib/server/gmail/auth.ts` — getGmailStatus returnează sync config
- `app/src/lib/server/scheduler/index.ts` — schedule evening gmail sync
- `app/src/lib/server/scheduler/tasks/gmail-invoice-sync.ts` — per-tenant config + PDF enrichment + save results
- `app/src/lib/remotes/supplier-invoices.remote.ts` — PDF enrichment + sync config commands + expense linking + getLastSyncResults
- `app/src/routes/[tenant]/settings/gmail/+page.svelte` — sync config UI complet
- `app/src/routes/[tenant]/banking/supplier-invoices/+page.svelte` — paginare + banner sync + expense linking + parseri noi filtre
- `app/src/routes/[tenant]/banking/supplier-invoices/import/+page.svelte` — parseri noi în wizard

## Dependență adăugată
- Niciuna (unpdf deja instalat)
