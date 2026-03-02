# Audit Facturi - TVA Fix (2026-03-02)

## Problema
TVA (VAT) nu mai aparea in PDF-ul generat si nici in pagina de detalii a facturii.

Exemplu: Factura OTS 532 — Digital Marketing 7.645,20 RON
- %TVA: `-` (dash) in loc de `21%`
- Val. TVA: `0,00` in loc de `1.605,49`
- TOTAL: `7.645,20` in loc de `9.250,69`

## Root Cause
Campul `tax_application_type` din tabela `invoice` era **NULL** pentru toate cele 500 de facturi din baza de date.

Codul de afisare (PDF + web UI) verifica strict `invoice.taxApplicationType === 'apply'`, care evalueaza `false` cand valoarea e `null`.

Ironic, calculul TVA din remote-ul `createInvoice` functiona corect (verifica `data.taxApplicationType === 'apply'` si primea `'apply'` de la form), dar la salvare pe linia `taxApplicationType: data.taxApplicationType || null` valoarea se pierdea cumva si nu era persistata in DB.

## Fix-uri aplicate

### BUG 1: PDF Generator nu afisa TVA (invoice-pdf-generator.ts)
- **Cauza**: `invoice.taxApplicationType === 'apply'` fail-uia cand era null
- **Fix**: Adaugat `const taxType = invoice.taxApplicationType || 'apply';` si inlocuit toate verificarile cu `taxType === 'apply'`
- **Linii afectate**: 132, 321, 371, 407, 443

### BUG 2: Pagina de detalii nu afisa TVA ([invoiceId]/+page.svelte)
- **Cauza**: Aceleasi verificari stricte `invoice.taxApplicationType === 'apply'`
- **Fix**: Adaugat `const taxType = $derived(invoice?.taxApplicationType || 'apply');` si inlocuit toate verificarile
- **Linii afectate**: 81, 126, 186, 596, 623

### BUG 3: Remote createInvoice nu salva taxApplicationType (invoices.remote.ts)
- **Cauza**: `taxApplicationType: data.taxApplicationType || null` — desi valoarea ar fi trebuit sa fie 'apply', se salva null
- **Fix**: Normalizat devreme `const taxApplicationType = data.taxApplicationType || 'apply';` si folosit variabila peste tot
- **Linii afectate**: 321, 393, 416, 479

### BUG 4: Recurring invoice generator nu salva taxApplicationType (invoice-utils.ts)
- **Cauza**: `taxApplicationType: invoiceFields.taxApplicationType || null`
- **Fix**: Schimbat default la `'apply'` in loc de `null`
- **Linia afectata**: 553

### Backfill DB
- Rulat: `UPDATE invoice SET tax_application_type = 'apply' WHERE tax_application_type IS NULL;`
- 500 facturi actualizate

## Fisiere modificate
1. `app/src/lib/server/invoice-pdf-generator.ts` — null → 'apply' default
2. `app/src/routes/[tenant]/invoices/[invoiceId]/+page.svelte` — null → 'apply' default
3. `app/src/lib/remotes/invoices.remote.ts` — default 'apply' la save + calc
4. `app/src/lib/server/invoice-utils.ts` — default 'apply' la recurring gen
