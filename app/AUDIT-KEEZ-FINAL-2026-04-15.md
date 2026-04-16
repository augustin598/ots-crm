# Audit Final: Keez Integration

**Data**: 2026-04-15
**Auditori**: Claude Opus + Gemini
**Scope**: Toate fișierele Keez — plugin, remote, mapper, sync, hooks, client, UI
**Referințe**: AUDIT-KEEZ-ITEMS-INVOICES.md (martie 2026), memory/project_keez_decrypt_failures_2026_04.md

---

## Bug-uri CRITICE (3)

### C1. 401 retry nu funcționează — token-ul nu se reobține (client.ts:267-292)

```typescript
const token = await this.getAccessToken(); // ← O SINGURĂ DATĂ, înainte de loop
const headers = { Authorization: `Bearer ${token}`, ... };

for (let attempt = 0; attempt < retries; attempt++) {
    // ...
    if (response.status === 401) {
        this.cachedToken = null; // Golește cache, dar `token` rămâne cel vechi
        continue; // Retry cu ACELAȘI token expirat
    }
}
```

**Impact**: Toate cele 3 retry-uri la 401 folosesc același token expirat. Orice request cu token expirat eșuează definitiv.
**Fix**: Mută `getAccessToken()` și construcția headers ÎNĂUNTRUL loop-ului.

---

### C2. TVA 0% convertit în 19% la import (mapper.ts:783-785, 1131)

```typescript
const taxRate = keezInvoice.invoiceDetails[0]?.vatPercent
    ? Math.round(keezInvoice.invoiceDetails[0].vatPercent * 100) // SARE PESTE ASTA
    : 1900; // RETURNEAZĂ 1900 (19%)
// JS: 0 este falsy → vatPercent 0 → fallback 19%
```

**Impact**: Facturile cu TVA 0% (export, scutiri, intra-comunitar) se importă cu TVA 19%. Sume calculate greșit cu +19%.
**Fix**: `vatPercent !== undefined && vatPercent !== null ? Math.round(vatPercent * 100) : 1900`
**Același bug la linia 1131**: `detail.vatPercent ? ... : null` — 0% devine null.

---

### C3. Detecția "duplicate number" prea permisivă — salturi de numere fiscale (hooks.ts:302)

```typescript
const isDuplicateNumber = errMsg.toLowerCase().includes('number')
    || errMsg.toLowerCase().includes('duplicate')
    || errMsg.toLowerCase().includes('exists')
    || errMsg.toLowerCase().includes('already');
```

**Impact**: ORICE eroare Keez care conține cuvântul "number" (ex: "invalid number format", "phone number required") declanșează incrementarea automată a numărului de factură. Poate crea salturi de numere fiscale greu de detectat.
**Fix**: Match mai specific: `errMsg.includes('duplicate') && errMsg.includes('number')` sau verificare cod eroare specific Keez API.

---

## Bug-uri HIGH (6)

### H1. Lipsă RBAC pe comenzi sensibile (keez.remote.ts)

Următoarele comenzi verifică doar autentificarea, NU și rolul utilizatorului:
- `syncInvoiceToKeez` (linia 360) — push factură la Keez
- `createKeezItem` (linia 305) — creare articol
- `cancelInvoiceInKeez` (linia 1512) — anulare factură
- `createStornoInKeez` (linia 1566) — creare storno
- `validateInvoiceInKeez` (linia 1621) — validare fiscală
- `sendInvoiceToEFactura` (linia 1468) — trimitere e-Factura
- `sendInvoiceEmailFromKeez` (linia 1417) — trimitere email

**Impact**: Un user cu rol `viewer`/`member` poate anula/valida facturi, trimite e-Factura, crea articole.
**Fix**: Adăugare verificare rol owner/admin (ca la `connectKeez` linia 48).

---

### H2. Fallback currency conversion inversată (mapper.ts:562-564)

```typescript
const fallbackNetCurrency = isRON
    ? fallbackNetRON
    : Math.round(fallbackNetRON * exchangeRate * 100) / 100;
//                              ^^^ TREBUIE /exchangeRate
```

Când factura e EUR (`isRON = false`), `fallbackNetRON` e deja în RON. Currency-suffixed trebuie să fie EUR = RON/exchangeRate. Codul face RON*exchangeRate → ~24x mai mare.

**Impact**: Facturi fără line items trimise la Keez cu sume Currency ~4.8x mai mari.
**Fix**: Înlocuire `* exchangeRate` cu `/ exchangeRate`.

---

### H3. `systemUserId` poate fi string gol (sync.ts:97)

```typescript
const systemUserId = tenantOwner?.userId || '';
```

Dacă tenantul nu are owner, facturi se creează cu `createdByUserId: ''`.

**Impact**: Facturi importate fără owner valid, erori la filtrare/permisiuni.
**Fix**: Throw error dacă lipsește owner-ul.

---

### H4. HttpError nu este extras corect (UI — 3 fișiere)

La catch-uri în `+page.svelte` (keez settings), `invoice-line-item-editor.svelte`, `invoices/new/+page.svelte`:
```typescript
error = e instanceof Error ? e.message : 'Failed to...';
// SvelteKit HttpError nu e instanceof Error → mesaj generic
```

**Impact**: Utilizatorul nu vede mesajul real de eroare (ex: "Insufficient permissions"), doar textul generic.
**Fix**: `(e as any)?.body?.message || (e instanceof Error ? e.message : '...')`

---

### H5. `isLegalPerson` verifică doar SRL (mapper.ts:987)

```typescript
isLegalPerson: client.companyType === 'SRL',
```

**Impact**: SA, PFA, SNC, SCS, SCA, etc. sunt trimise la Keez ca persoane fizice.
**Fix**: `isLegalPerson: !!client.companyType && client.companyType !== 'PF'` sau lista completă.

---

### H6. Paginare greșită la `getKeezItems` (keez.remote.ts:297-301)

```typescript
return { data: items, total: items.length, recordsCount: items.length };
// items.length e DUPĂ filtrare, nu totalul real din Keez
```

**Impact**: UI-ul crede că sunt doar N articole (câte trec prin filtru), dezactivează paginarea.
**Fix**: Folosiți `response.total` din răspunsul Keez API, nu `items.length`.

---

## Bug-uri MEDIUM (9)

### M1. `lastSyncAt` se actualizează chiar și la erori (sync.ts:421-424)
Timestamp-ul se updatează indiferent de `result.errors`. User/scheduler crede sync-ul a reușit.

### M2. Currency amounts inversate la re-citire după push EUR (hooks.ts:530)
```typescript
const netAmount = detail.netAmountCurrency ?? detail.netAmount ?? 0;
```
Preferă EUR peste RON, dar CRM stochează în cenți RON → sume suprascrise cu valori EUR (~4.8x mai mici).

### M3. Curs valutar hardcodat 4.82 ca fallback (mapper.ts)
Dacă BNR rate lipsesc, se folosește 4.82 — poate fi depășit.

### M4. Număr factură fără serie la import (mapper.ts:899)
`invoiceNumber: String(keezHeader.number)` → "520" în loc de "OTS 520".

### M5. Import clienți doar pe `partnerName` (keez.remote.ts:1313)
Match doar pe nume, nu pe CUI. Clienți cu nume diferit dar același CUI se duplică.

### M6. Risc împărțire la zero (mapper.ts:1142)
`detail.discountNetValue / detail.originalNetAmount` — dacă originalNetAmount = 0 → NaN.

### M7. `vatNumber` incomplet la import (mapper.ts:950)
`vatNumber: keezPartner.taxAttribute` → setează doar "RO" în loc de "RO40015841".

### M8. Fără concurrency lock pe sync (sync.ts + hooks.ts)
Scheduler + hooks pot rula simultan pe aceeași factură. Last-write-wins.

### M9. `$effect` suprascrie `invoiceNumber` editat manual (invoices/new:297-301)
Effect-ul nu verifică dacă utilizatorul a modificat manual numărul facturii.

---

## Bug-uri LOW (5)

### L1. OQL injection în filtre Keez API (client.ts:563)
Valori `code`, `series` nesanitizate în filtre OQL. Caractere speciale pot cauza erori API.

### L2. `setTimeout` fără cleanup la navigare (settings/keez:72-74)
Timere active după ce componenta e distrusă. Nu cauează crash dar e anti-pattern.

### L3. `console.log` debug rămase în producție (invoices/new:269-270)
Expun date de configurare în consola browser-ului.

### L4. ID-uri HTML duplicate între branch-uri if/else (settings/keez:209+449)
Formularele "credentialsCorrupt" și "Not Connected" folosesc aceleași ID-uri pe input-uri.

### L5. Textele UI în engleză, inconsistent cu restul platformei (settings/keez)
Toate textele Keez settings sunt în engleză, restul platformei e în română.

---

## Statistici

| Severitate | Count |
|------------|-------|
| CRITICAL   | 3     |
| HIGH       | 6     |
| MEDIUM     | 9     |
| LOW        | 5     |
| **TOTAL**  | **23** |

---

## Fișiere afectate

| Fișier | Bug-uri |
|--------|---------|
| `plugins/keez/client.ts` | C1 (401 retry), L1 (OQL injection) |
| `plugins/keez/mapper.ts` | C2 (TVA 0%), H2 (currency fallback), H5 (isLegalPerson), M3 (4.82), M4 (serie), M6 (div/0), M7 (vatNumber) |
| `plugins/keez/hooks.ts` | C3 (duplicate detect), M2 (currency re-read), M8 (concurrency) |
| `plugins/keez/sync.ts` | H3 (systemUserId), M1 (lastSyncAt), M8 (concurrency) |
| `remotes/keez.remote.ts` | H1 (RBAC), H6 (paginare), M5 (import clienți) |
| `settings/keez/+page.svelte` | H4 (HttpError), L2 (setTimeout), L4 (ID-uri), L5 (limba) |
| `invoice-line-item-editor.svelte` | H4 (HttpError) |
| `invoices/new/+page.svelte` | H4 (HttpError), M9 (invoiceNumber), L3 (console.log) |

---

## Prioritate reparare

1. **C1** — 401 retry broken (risc: toate requesturile cu token expirat eșuează)
2. **C2** — TVA 0% → 19% (risc: calcule fiscale greșite)
3. **C3** — Duplicate number detect (risc: salturi numere fiscale)
4. **H1** — RBAC lipsă (risc: securitate)
5. **H2** — Currency fallback inversat (risc: sume greșite 4.8x)
6. **H4** — HttpError extract (risc: UX, deja raportat în audituri anterioare)
7. **H5** — isLegalPerson (risc: partener tip greșit la Keez)
8. Restul MEDIUM/LOW

---

## Fix-uri aplicate (2026-04-15)

### Commit 1: Decrypt failures fix
- **UI credentialsCorrupt** — scos `isActive` din condiție
- **Scheduler retry** — retry cu fresh DB read înainte de dezactivare
- **Crypto diagnostics** — validare date goale/parțiale + logging detaliat

### Commit 2: Full audit fix (toate 23 bug-uri rezolvate)
- **C1**: Token refresh mutat înăuntrul loop-ului de retry (client.ts)
- **C2**: vatPercent 0 tratat corect cu `!== undefined && !== null` (mapper.ts)
- **C3**: isDuplicateNumber match strict pe pattern combinat (hooks.ts)
- **H1**: RBAC `viewer` blocat pe 7 comenzi sensibile (keez.remote.ts)
- **H2**: Currency fallback conversion `/ exchangeRate` nu `*` (mapper.ts)
- **H3**: systemUserId — skip sync dacă tenant fără owner (sync.ts)
- **H4**: HttpError `e.body.message` extras în 3 UI files
- **H5**: isLegalPerson acceptă toate tipurile juridice, nu doar SRL (mapper.ts)
- **H6**: Pagination total = rawCount pre-filtrare (keez.remote.ts)
- **M1**: lastSyncAt actualizat doar la succes (sync.ts)
- **M2**: Prefer RON amounts (non-suffixed) la re-read din Keez (hooks.ts)
- **M3**: Eliminat hardcoded 4.82 — log warning + fallback la 1 dacă BNR lipsește (mapper.ts)
- **M4**: invoiceNumber include seria la import (mapper.ts)
- **M5**: Import clienți match pe CUI first, apoi pe nume (keez.remote.ts)
- **M6**: Div/0 protection la discount calculation (mapper.ts)
- **M7**: vatNumber = taxAttribute + identificationNumber concatenat (mapper.ts)
- **M8**: In-memory concurrency lock per tenant — `activeSyncs` Set previne sync-uri simultane (sync.ts)
- **M9**: invoiceNumber nu mai suprascrie valoarea editată manual (invoices/new)
- **L1**: OQL injection — sanitizare single quotes în filtre (client.ts)
- **L2**: setTimeout cleanup — înlocuit cu `showSuccess()` helper + `clearTimeout` centralizat (settings/keez)
- **L3**: console.log debug șterse din invoices/new
- **L4**: ID-uri duplicate — prefix `new-` pe formularul "Not Connected" (settings/keez)
- **L5**: Toate textele UI traduse în română (settings/keez)

### Commit 3: Simplify review + Svelte autofixer (2026-04-16)

**Simplify (code reuse + quality + efficiency):**
- `extractErrorMessage(e, fallback)` — helper extras în `$lib/utils.ts`, înlocuiește 6 pattern-uri inline `(e as any)?.body?.message || ...` din 3 fișiere
- Indentare corectată în sync.ts wrapper (`_syncKeezInvoicesForTenantInner`)

**Svelte autofixer:**
- `settings/keez/+page.svelte` — adăugat key pe `{#each syncHistory}` → `(record.id ?? record.invoiceId)`
- `settings/keez/+page.svelte` — eliminat import nefolosit `Upload`
- `invoice-line-item-editor.svelte` — `newItemVatRate` simplificat la `$state('19')` (eliminat `$effect` inutil)
- `invoice-line-item-editor.svelte` — `keezSelections` convertit de la `$state` + `$effect` la `$derived.by()` (idiomatic Svelte 5)
- `invoice-line-item-editor.svelte` — eliminate mutații directe pe `keezSelections` (acum derivat)
- `invoice-line-item-editor.svelte` — eliminat import nefolosit `Select, SelectContent, SelectItem, SelectTrigger`

**Svelte 5 best practices (invoices/new):**
- `$derived()` → `$derived.by()` pe `defaultInvoiceSeries` și `defaultInvoiceNumber` (linia 74/84) — `$derived` cu function body e incorect, trebuie `$derived.by`
- Eliminat `()` din toate apelurile: `defaultInvoiceSeries()` → `defaultInvoiceSeries` (acum e valoare, nu funcție)
- 7 `{#each}` fără key → adăugat keys: `c.id`, `curr`, `plugin.name`, `item.id`

**Notat pentru refactoring viitor (outside scope):**
- RBAC helper `requireMinRole()` — ar elimina ~18 verificări inline din 3+ remote-uri
- `parseKeezDate` duplicat în sync.ts vs hooks.ts — extragere în utils comun
- Index lipsă pe `client.cui` — necesită migrare DB
- `getLatestBnrRate()` N+1 la batch sync — cache in-memory pe durata sync-ului

---

## Referințe audituri anterioare

- **AUDIT-KEEZ-ITEMS-INVOICES.md** (martie 2026) — 12 buguri fixate: lastPrice, vatRate, currency EUR/RON inversat, exchangeRate, referenceCurrencyCode
- **project_keez_decrypt_failures_2026_04.md** — Decrypt failures: Turso transient reads, aggressive deactivation, UI condition
- **project_meta_ads_audit_2026_04.md** — Pattern similar: isActive nevalidat, cache keys, HttpError display
- **project_invoice_email_audit_2026_03.md** — Pattern similar: sendMailWithRetry lipsă, URL-uri publice, status incorect
