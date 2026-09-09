# Facturi Google Ads — cum ajung PDF-urile în CRM

Actualizat: 2026-09-09 (după incidentul „nicio factură din 4 mai").

## Cele trei căi

| Cale | Cine rulează | Pentru ce conturi | Stare |
|------|--------------|-------------------|-------|
| **1. Userscript Tampermonkey v3 („Trimite în CRM")** | browserul utilizatorului, logat în Google Ads | toate (card sau facturare lunară) | **recomandată** |
| 2. Sync API (`Sync Acum`, cron 1 ale lunii 06:00) | server, Google Ads API `InvoiceService` | **doar** conturile pe facturare lunară (monthly invoicing); conturile plătite cu cardul nu au facturi în API | funcțională, dar acoperă 0 din conturile actuale |
| 3. „Scan cu Browser (local)" | puppeteer cu Chrome vizibil pe calculatorul dev; DB-ul e comun cu prod | toate | doar pe un calculator cu ecran; butonul e ascuns pe server |

Panoul „Import Facturi" (JSON + descărcare pe server cu cookie-urile Google salvate) rămâne ca fallback, dar depinde de o sesiune Google validă pe server, care se degradează în câteva zile (Google rotește `__Secure-*PSIDTS` la ~30 min).

## Calea 1: userscript v3

Fișier: `static/google-ads-invoice-extractor.user.js` (servit la `/google-ads-invoice-extractor.user.js`).

Flux, pe pagina `ads.google.com/aw/billing/documents` a unui sub-cont:

1. Citește tabelul din iframe-ul `payments.google.com` (`[data-url*="/payments/apis-secure/doc"]`): id factură, dată, sumă, link.
2. Detectează ID-ul contului (`xxx-xxx-xxxx` din header; override per `ocid` salvat cu `GM_setValue`; prompt dacă nu-l găsește).
3. `POST /{tenant}/api/google-ads/invoices/check` `{ customerId, invoiceIds[] }` → `{ ok, account, missing[], existing[] }`. Dacă contul nu e asociat unui client → 404 `account_not_mapped`.
4. Pentru fiecare factură lipsă: `fetch` în iframe cu `credentials: 'include'` (sesiunea reală Google) → verifică `%PDF` → base64 → `POST /{tenant}/api/google-ads/invoices/ingest` `{ customerId, invoiceId, date, amountText, accountName, pdfBase64 }` → `{ ok, status: imported|updated|skipped, dateGuessed }`.
5. Rezumat în panou. Fallback „📋 JSON" (comportamentul v2).

Autentificare: `GM_xmlhttpRequest` trimite cookie-ul de sesiune CRM (`auth-crm`) al domeniului țintă; endpoint-urile cer `requireStaff`. Body-ul e JSON, deci CSRF-ul SvelteKit (doar pentru form/multipart) nu intervine. Configurare (adresă CRM + tenant) din butonul ⚙; implicit `https://clients.onetopsolution.ro` / `ots`.

Limite: un PDF per request, max 6 MB (`BODY_SIZE_LIMIT` = 10M pe adapter).

## Persistență comună

`src/lib/server/google-ads/invoice-ingest.ts` → `persistGoogleInvoicePdf()` este singura cale de scriere (folosită și de `downloadGoogleInvoicesFromLinks`). Idempotent pe `(tenantId, googleInvoiceId)`; un rând existent cu PDF doar își corectează atribuirea / primește suma (backfill).

Parsare pură (sumă RO/US, dată RO/EN, magic bytes PDF, scheme valibot): `src/lib/server/google-ads/invoice-parsing.ts`.

## Diagnostic 2026-09-09 (de ce nu mai intrau facturi)

1. Ultima factură importată: 4 mai 2026 (emisă 30 aprilie). Mai–august lipseau pentru toți clienții → „În așteptare" în portal.
2. Keep-alive-ul proba `payments.google.com/payments/u/0/w/home`, care răspunde **200 și nelogat** → `google_session_status='active'` era un fals pozitiv permanent. Acum proba e `ads.google.com/aw/billing/documents` (nelogat → 302 la `accounts.google.com/ServiceLogin`). Vezi `src/lib/server/scraper/google-probe.ts`.
3. „Scan cu Browser" pe prod pornea Chromium `headless: 'shell'` pe pod (fără DISPLAY): nimeni nu se putea loga. Acum `startScraperSession` refuză cu mesaj clar, iar butonul apare doar când `browserScanAvailable` (macOS sau `DISPLAY` setat).
4. Sync-ul API loga erorile ca `[object Object]` (biblioteca aruncă obiecte `GoogleAdsFailure`, nu `Error`). Vezi `sync-errors.ts`. Contul Meduza dispăruse din MCC dar rămăsese `is_active=1`; `fetchGoogleAdsAccounts` dezactivează acum conturile care nu mai apar în listarea MCC (`reconcile-accounts.ts`).
5. `google-ads-invoices.remote.ts` mai avea 3 `await import()` (pericol rolldown → `await void 0` pe prod); acum sunt importuri statice.

## Verificare

- `bun run test google-ads` și `bun run test scraper`.
- Pe pagina Google Ads → Facturare → Documente, panoul scriptului arată „N facturi detectate"; după „Trimite în CRM", în CRM → Facturi → Google Ads luna respectivă trece din „În așteptare" în „1 factură", iar portalul clientului arată butonul „Descarcă factura".
- Erorile de ingest sunt în `debug_log` cu `source='google-ads-ingest'`.
