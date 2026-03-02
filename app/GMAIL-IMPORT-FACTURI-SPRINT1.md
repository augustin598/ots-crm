
# Gmail Import Facturi Furnizori — Sprint 1 (2026-02-28)

## Ce s-a implementat

### 1. Schema DB (2 tabele noi)
- `gmail_integration` — stochează OAuth2 tokens per tenant (access_token, refresh_token, token_expires_at, email, isActive, lastSyncAt)
- `supplier_invoice` — facturi importate de la furnizori (invoiceNumber, amount, currency, issueDate, dueDate, status, pdfPath, gmailMessageId, supplierType, emailFrom, emailSubject)
- Migrare: `drizzle/0048_shiny_jack_power.sql`
- Relații adăugate: supplier → supplierInvoices, tenant → gmailIntegration + supplierInvoices
- Tipuri exportate: GmailIntegration, SupplierInvoice

### 2. Gmail OAuth2 Integration
- `app/src/lib/server/gmail/auth.ts` — OAuth2 flow complet:
  - `getOAuthUrl(tenantId)` — generează URL autorizare Google
  - `handleCallback(code, tenantId)` — exchange code → tokens, salvare DB
  - `getAuthenticatedClient(tenantId)` — client cu auto-refresh tokens
  - `getGmailStatus(tenantId)` — status conexiune
  - `disconnectGmail(tenantId)` — revoke + dezactivare
  - `updateLastSyncAt(tenantId)` — update timestamp sincronizare
- API Routes:
  - `GET /api/gmail/auth` — redirect la Google consent
  - `GET /api/gmail/callback` — OAuth2 callback
  - `POST /api/gmail/disconnect` — deconectare Gmail
- Env vars necesare: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

### 3. Gmail API Client
- `app/src/lib/server/gmail/client.ts`:
  - `searchEmails(tenantId, query, maxResults)` — search Gmail
  - `getEmail(tenantId, messageId)` — detalii complete email
  - `getAttachment(tenantId, messageId, attachmentId)` — download atașament

### 4. Parser Architecture (extensibilă)
- `app/src/lib/server/gmail/parsers/index.ts` — registry + interfață SupplierParser
- Parseri implementați:
  - `cpanel.ts` — cPanel/WHM (from:cpanel.net/cpanel.com)
  - `whmcs.ts` — WHMCS (from:whmcs.com)
  - `hetzner.ts` — Hetzner (from:hetzner.com/hetzner.de)
  - `google.ts` — Google (from:google.com + invoice/billing keywords)
  - `generic.ts` — Fallback (orice email cu "invoice"/"factura" + PDF)
- Fiecare parser: matchEmail(), parseInvoice(), getSearchQuery()
- `parseAmount()` — extrage sumă din text ($12.34, 12,34 EUR, etc.)
- `buildSearchQuery()` — combină queries per parseri + date range

### 5. Remote Functions
- `app/src/lib/remotes/supplier-invoices.remote.ts`:
  - `getSupplierInvoices()` — listare cu join pe supplier name
  - `getSupplierInvoice(id)` — detalii factură
  - `deleteSupplierInvoice(id)` — ștergere
  - `getGmailConnectionStatus()` — status conexiune Gmail
  - `previewGmailInvoices({parserIds, dateFrom, dateTo})` — preview fără salvare
  - `importSelectedInvoices({messageIds})` — import selectiv cu PDF download
- Auto-link supplier: caută existent pe email domain / name, creează nou dacă nu există
- PDF storage: `uploads/supplier-invoices/{tenantId}/{yyyy-mm}/`
- Deduplicare: pe baza gmailMessageId

### 6. BullMQ Scheduler
- `app/src/lib/server/scheduler/tasks/gmail-invoice-sync.ts`
- Înregistrat în scheduler index cu ID `gmail_invoice_sync`
- Schedule: zilnic la 5:00 AM Europe/Bucharest
- Pattern: urmează `revolut-transaction-sync.ts`

### 7. UI (3 pagini)
- `[tenant]/settings/gmail/` — conectare/deconectare Gmail, status, ultima sincronizare
- `[tenant]/banking/supplier-invoices/` — tabel facturi importate cu filtre (status, tip furnizor, search text)
- `[tenant]/banking/supplier-invoices/import/` — wizard import în 3 pași:
  1. Configurare (selectare furnizori + date range)
  2. Preview (vizualizare facturi găsite, selectare)
  3. Rezultat (câte importate/duplicate/erori)

### Dependență adăugată
- `googleapis@171.4.0`

## Audit & Bugfix (2026-02-28)

### BUG #1 (CRITIC): PDF Download nu funcționa
- **Cauza**: Link-ul din UI era `href="/uploads/{pdfPath}"` dar `pdfPath` din DB conținea deja `uploads/...` → dublu prefix `/uploads/uploads/...`. Plus SvelteKit nu servește din `/uploads/`.
- **Fix**: Creat endpoint dedicat `[tenant]/banking/supplier-invoices/[invoiceId]/pdf/+server.ts` (pattern identic cu contracte). Link UI actualizat la `/{tenantSlug}/banking/supplier-invoices/{invoice.id}/pdf`.
- Include: auth check, tenant validation, file existence check, size limit 50MB.

### BUG #2: Filename nesanitizat în savePdf()
- **Cauza**: `invoiceNumber` din email folosit direct în filename — caractere speciale (`/`, spații) puteau sparge path-ul.
- **Fix**: Adăugat `.replace(/[^a-zA-Z0-9-_]/g, '_')` în ambele `savePdf()` (remote + scheduler).

### BUG #3: PDF-uri orfane la delete
- **Cauza**: `deleteSupplierInvoice` ștergea doar row-ul DB, PDF-ul rămânea pe disc.
- **Fix**: Adăugat `unlink()` înainte de `db.delete()` cu try/catch (ignoră dacă fișierul nu există).

### BUG #4: rawEmailData inconsistent
- **Cauza**: Scheduler-ul omitea `attachments` din `rawEmailData`, spre deosebire de remote.
- **Fix**: Adăugat `attachments: email.attachments.map(a => a.filename)` în scheduler task.

### Fișiere modificate
- **NOU**: `app/src/routes/[tenant]/banking/supplier-invoices/[invoiceId]/pdf/+server.ts`
- `app/src/routes/[tenant]/banking/supplier-invoices/+page.svelte` (linia 199)
- `app/src/lib/remotes/supplier-invoices.remote.ts` (sanitize + delete PDF + unlink import)
- `app/src/lib/server/scheduler/tasks/gmail-invoice-sync.ts` (sanitize + rawEmailData)

## TODO Sprint 2
- [ ] Parsare avansată PDF (extragere date direct din PDF cu pdf-parse)
- [ ] Configurare auto-sync per tenant (interval, furnizori selectați)
- [ ] Paginare lista facturi furnizori
- [ ] Notificări la import automat (email/in-app)
- [ ] Adăugare parseri noi (OVH, DigitalOcean, AWS, etc.)
- [ ] Link supplier invoice → expense (legătură cu cheltuielile)
