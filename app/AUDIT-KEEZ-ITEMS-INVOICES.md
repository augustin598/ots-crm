# Audit: Keez Items — Pagina /invoices/new

**Data**: 2026-03-02
**Modul**: Invoice Creation + Keez Items Integration
**Severitate**: Medium — iteme fără preț/TVA ajungeau în factură cu valoare 0

---

## Probleme identificate

### BUG 1: Items Keez fără `lastPrice` — rate = 0
- **Fișiere**: `+page.svelte` (invoices/new), `invoice-line-item-editor.svelte`, recurring page
- **Cauză**: API-ul Keez returnează `lastPrice` ca field opțional (`lastPrice?: number`). Items fără istoric de preț aveau `lastPrice: undefined/null`
- **Efect**: La selectarea unui item Keez, `rate: keezItem.lastPrice || 0` → prețul unitar = 0
- **Fix**: Normalizare server-side în `getKeezItems` remote: `lastPrice: item.lastPrice ?? 0`

### BUG 2: `vatRate` din Keez ignorat complet
- **Fișiere**: toate cele 3 locuri unde se selectează un Keez item
- **Cauză**: La selectare se folosea mereu `taxRate: defaultTaxRate` (din settings), ignorând `keezItem.vatRate`
- **Efect**: Items cu TVA diferit (ex: 9%, 5%, 0%) primeau mereu TVA default (19%)
- **Fix**: `taxRate: keezItem.vatRate && keezItem.vatRate > 0 ? keezItem.vatRate : defaultTaxRate`

### BUG 3: Items inactive/incomplete în dropdown
- **Fișier**: `keez.remote.ts` (`getKeezItems`)
- **Cauză**: Items returnate direct din Keez API fără filtrare — inclusiv inactive, fără nume, fără externalId
- **Efect**: Dropdown-ul conținea items inutilizabile
- **Fix**: Filtrare: `item.isActive && item.name && item.externalId`

### BUG 4: Dropdown nu arăta prețul
- **Fișiere**: toate cele 3 componente cu keezItemOptions
- **Cauză**: Label-ul opțiunii era doar `{name} ({code})` — fără indiciu de preț
- **Efect**: Userul nu putea distinge items cu preț de cele fără preț
- **Fix**: Label actualizat: `{name} ({code}) — {lastPrice} {currency}` sau `fără preț`

### BUG 5: Mock item la creare fără `vatRate`
- **Fișier**: `invoice-line-item-editor.svelte` (`handleCreateKeezItem`)
- **Cauză**: La crearea unui item nou în Keez, mock-ul local nu includea `vatRate` deși userul completa câmpul
- **Efect**: Item-ul creat era adăugat în lista locală fără TVA
- **Fix**: Adăugat `vatRate: parseFloat(newItemVatRate) || defaultTaxRate` în mock

### BUG 6: Recurring page — missing measure unit map + currency validation
- **Fișier**: `invoices/recurring/[invoiceId]/+page.svelte`
- **Cauză**: La selectarea unui Keez item, `unitOfMeasure` era hardcodat 'Pcs' și currency nu era validat
- **Fix**: Adăugat MEASURE_UNIT_MAP (ca în /new) + validare CURRENCIES.includes()

### BUG 7 (CRITIC): Summary arată 0.00 când item.currency ≠ invoice currency
- **Fișiere**: `+page.svelte` (invoices/new), recurring page
- **Cauză**: `totalsByCurrency` grupează items pe `item.currency`, dar Summary citea doar `totalsByCurrency[currency]` (valuta facturii). Dacă un item Keez avea `currencyCode: "EUR"` pe o factură RON, totalurile se acumulau sub cheia "EUR", dar Summary citea din "RON" → 0.
- **Efect**: Summary arăta Subtotal 0.00, Tax 0.00, Grand Total 0.00 deși row-urile individuale afișau valorile corecte
- **Fix**: Summary iterează `Object.entries(totalsByCurrency)` și afișează totaluri **per valută**. Dacă e o singură valută, aspectul rămâne identic. Dacă sunt mai multe (RON + EUR), afișează secțiuni separate cu header de valută.

### BUG 8 (MEDIU): Item discount ignorat în calculul TVA din Summary
- **Fișiere**: `+page.svelte` (invoices/new), recurring page
- **Cauză**: `totalsByCurrency` calcula taxa pe `itemSubtotal` (qty × rate), dar row-ul calcula taxa pe `itemNetValue` (qty × rate - discount). Summary TVA era mai mare decât suma TVA-urilor din tabel.
- **Fix**: `totalsByCurrency` calculează acum discount per item (% sau fixed) și aplică taxa pe `itemNetValue`

### BUG 9 (LOW): Currency indicator lipsea din tabel pe Amount/Final Amount
- **Fișiere**: `+page.svelte` (invoices/new), recurring page
- **Cauză**: Coloanele Amount și Final Amount afișau doar `{formatNumber(value)}` fără currency
- **Efect**: Când items aveau valute diferite, nu era clar în ce valută era fiecare sumă
- **Fix**: Adăugat indicator `{item.currency}` mic (text-xs text-gray-500) lângă Amount/Final Amount, vizibil doar când item.currency ≠ invoice currency

---

## Fișiere modificate

| Fișier | Modificare |
|--------|-----------|
| `app/src/lib/remotes/keez.remote.ts` | Filtrare items inactive/incomplete + normalizare lastPrice/vatRate |
| `app/src/routes/[tenant]/invoices/new/+page.svelte` | keezItemOptions cu preț, vatRate din Keez, toast warning, **Summary multi-currency**, **discount în calculul TVA**, **currency indicator pe Amount/Final Amount** |
| `app/src/lib/components/app/invoice-line-item-editor.svelte` | vatRate din Keez, mock item cu vatRate, keezItemOptions cu preț |
| `app/src/routes/[tenant]/invoices/recurring/[invoiceId]/+page.svelte` | keezItemOptions cu preț, vatRate din Keez, MEASURE_UNIT_MAP, currency validation, **Summary multi-currency**, **discount în calculul TVA**, **currency indicator pe Amount/Final Amount** |

### BUG 10 (CRITIC): Sumele RON/EUR inversate în Keez (mapper)
- **Fișier**: `mapper.ts` (keez plugin) — liniile 259-314
- **Cauză**: `item.rate / 100` dădea prețul în valuta itemului (EUR), dar mapper-ul îl trata ca RON. Apoi `unitPriceCurrency = unitPriceRON * exchangeRate` inversa sensul conversiei — Keez primea EUR în câmpul RON și RON în câmpul EUR.
- **Efect**: PDF-ul Keez arăta sumele corecte numeric dar în valutele greșite. Ex: unitPrice=1000 (trebuia RON=5095.90), unitPriceCurrency=5095.90 (trebuia EUR=1000)
- **Fix**: Rewrite complet:
  - `itemPriceDecimal = unitPriceCents / 100` = preț în valuta itemului
  - Dacă item e RON: `unitPriceRON = itemPriceDecimal` (deja RON)
  - Dacă item e EUR: `unitPriceRON = itemPriceDecimal × exchangeRate` (convertit la RON), `unitPriceCurrency = itemPriceDecimal` (EUR original)
  - Aceeași logică pentru toate amounts (net, vat, gross, discount)

### BUG 11 (CRITIC): `referenceCurrencyCode` lipsea din header
- **Fișiere**: `client.ts` (KeezInvoice interface), `mapper.ts` (header)
- **Cauză**: Interfața `KeezInvoice` nu avea câmpul `referenceCurrencyCode`, mapper-ul nu îl seta. Keez nu știa care e a doua valută.
- **Efect**: Keez interpreta toate sumele ca fiind într-o singură valută. Moneda calcul era greșit setată.
- **Fix**: Adăugat `referenceCurrencyCode?: string` în KeezInvoice + detectare automată din items: `referenceCurrencyCode = prima valută non-RON din items`

### BUG 12 (CRITIC): `exchangeRate` = undefined pentru facturi RON cu iteme EUR
- **Fișier**: `mapper.ts` — linia 532
- **Cauză**: `exchangeRate: !isRON ? exchangeRate : undefined` — când factura e RON (`isRON = true`), exchange rate nu se trimitea, chiar dacă existau iteme EUR care necesitau conversie.
- **Efect**: Keez primea items cu sume convertite dar fără exchange rate — imposibil de reconstituit conversia
- **Fix**: `exchangeRate: needsExchangeRate ? ... : undefined` unde `needsExchangeRate = hasNonRONItems || !isRON`

---

## Fișiere modificate

| Fișier | Modificare |
|--------|-----------|
| `app/src/lib/remotes/keez.remote.ts` | Filtrare items inactive/incomplete + normalizare lastPrice/vatRate |
| `app/src/routes/[tenant]/invoices/new/+page.svelte` | keezItemOptions cu preț, vatRate din Keez, toast warning, **Summary multi-currency**, **discount în calculul TVA**, **currency indicator pe Amount/Final Amount** |
| `app/src/lib/components/app/invoice-line-item-editor.svelte` | vatRate din Keez, mock item cu vatRate, keezItemOptions cu preț |
| `app/src/routes/[tenant]/invoices/recurring/[invoiceId]/+page.svelte` | keezItemOptions cu preț, vatRate din Keez, MEASURE_UNIT_MAP, currency validation, **Summary multi-currency**, **discount în calculul TVA**, **currency indicator pe Amount/Final Amount** |
| `app/src/lib/server/plugins/keez/client.ts` | Adăugat `referenceCurrencyCode` în KeezInvoice interface |
| `app/src/lib/server/plugins/keez/mapper.ts` | **Rewrite currency conversion**: non-suffixed = RON, Currency-suffixed = EUR original, `referenceCurrencyCode`, `exchangeRate` trimise corect |

---

## Root cause

**BUG 1-9**: Interfața `KeezItem` din `client.ts` definește `lastPrice` și `vatRate` ca opționale (`?`). API-ul Keez nu garantează aceste câmpuri pentru toate itemele (ex: items noi fără facturi anterioare). Frontend-ul nu normaliza datele și nu oferea feedback vizual.

**BUG 10-12**: `mapper.ts` trata `item.rate / 100` ca fiind mereu în RON, dar de fapt e în valuta itemului (EUR dacă item.currency = EUR). Conversia era inversată: câmpurile RON conțineau EUR și invers. În plus, `referenceCurrencyCode` și `exchangeRate` nu se trimiteau pentru facturi RON cu items EUR.

## Referință: Keez EUR-RON format (din documentatie)

```
currencyCode: 'RON'              — Moneda factură
referenceCurrencyCode: 'EUR'     — Moneda calcul
exchangeRate: 4.9767             — Curs EUR → RON

Non-suffixed amounts = MEREU RON:
  unitPrice: 248.835             = 50 EUR × 4.9767
  originalNetAmount: 497.67      = 100 EUR × 4.9767

Currency-suffixed = referenceCurrency (EUR):
  unitPriceCurrency: 50          = EUR original
  originalNetAmountCurrency: 100 = EUR original
```

## Testare recomandată

1. Deschide /invoices/new → tab "From Keez" → verifică că dropdown-ul arată prețul
2. Selectează un item cu preț → verifică că rate și taxRate se completează corect
3. Selectează un item fără preț → verifică toast warning + rate = 0 (editabil manual)
4. Creează un item nou din dialog → verifică că vatRate e inclus
5. **Adaugă item Keez cu currencyCode EUR pe factură RON → verifică că Summary arată secțiune EUR cu totaluri corecte**
6. **Adaugă items în RON + EUR → verifică că Summary arată 2 secțiuni separate (RON, EUR)**
7. **Adaugă item cu discount % → verifică că Summary Tax = suma Tax-urilor din tabel**
8. **Adaugă item cu discount fixed → aceeași verificare**
9. **Verifică că Amount/Final Amount arată currency indicator (ex: "EUR") lângă sumă când item.currency ≠ invoice currency**
10. Verifică pagina recurring — aceleași teste
11. **Creează factură RON cu item EUR (lastPrice=1000, exchangeRate=5.0959) → în Keez:**
    - `currencyCode = "RON"`, `referenceCurrencyCode = "EUR"`, `exchangeRate = 5.0959`
    - `unitPrice = 5095.90` (RON), `unitPriceCurrency = 1000` (EUR)
    - PDF: Monedă calcul = EUR, Monedă factură = RON
12. **Creează factură RON-RON (fără EUR items) → verifică că NU trimite referenceCurrencyCode/exchangeRate**
13. **Compară PDF-ul generat cu exemplul din `documentatiekeez/example_EUR_RON.html`**

---

## Implementare: Curs Valutar BNR (auto-fill)

**Data**: 2026-03-02
**Scop**: Eliminarea introducerii manuale a cursului valutar pe facturi + afișare curs BNR în Settings

### Ce s-a implementat

1. **Tabel DB `bnr_exchange_rate`** — stochează cursurile BNR zilnice (~38 valute)
   - Schema: `currency`, `rate`, `multiplier`, `rateDate`, `fetchedAt`
   - Unique index pe `(currency, rateDate)` pentru upsert
   - Migrare: `0050_tense_beyonder.sql`

2. **BNR Client** (`app/src/lib/server/bnr/client.ts`)
   - `fetchBnrRates()` — fetch XML de la `https://www.bnr.ro/nbrfxrates.xml` + parse regex
   - `syncBnrRates()` — upsert în DB (onConflictDoUpdate)
   - `getLatestBnrRate(currency)` — query ultima rată din DB
   - `getLatestBnrRates()` — toate ratele de la ultima dată disponibilă
   - `ensureBnrRatesSynced()` — sync la startup dacă nu există rate din ziua curentă

3. **Scheduler task** (`bnr-rate-sync.ts`) — cron `0 10 * * *` (zilnic la 10:00 AM)

4. **Remote** (`bnr.remote.ts`) — `getBnrRates`, `getBnrRate(currency)`, `refreshBnrRates` (rate limited 5 min)

5. **Settings page** — Card "Curs Valutar BNR" cu EUR, USD, GBP, CHF + buton refresh + data curs

6. **Invoice pages** (new + recurring) — auto-fill `exchangeRate` din BNR când currency ≠ invoiceCurrency
   - Hint sub input: "Curs BNR auto-completat"
   - Placeholder: "Curs BNR"
   - User poate override manual

7. **Mapper fallback** — `mapInvoiceToKeez` (acum async) folosește `getLatestBnrRate()` în loc de hardcodat 4.82
   - Hooks.ts + keez.remote.ts actualizate cu `await` la toate apelurile

### Fișiere create/modificate

| Fișier | Acțiune |
|--------|---------|
| `app/src/lib/server/db/schema.ts` | Adăugat tabel `bnr_exchange_rate` |
| `app/drizzle/0050_tense_beyonder.sql` | **NOU** — migrare |
| `app/src/lib/server/bnr/client.ts` | **NOU** — fetch + parse XML + sync DB + query |
| `app/src/lib/server/scheduler/tasks/bnr-rate-sync.ts` | **NOU** — task handler |
| `app/src/lib/server/scheduler/index.ts` | Înregistrare task + cron 10:00 AM |
| `app/src/hooks.server.ts` | `ensureBnrRatesSynced()` la startup |
| `app/src/lib/remotes/bnr.remote.ts` | **NOU** — getBnrRates, getBnrRate, refreshBnrRates |
| `app/src/routes/[tenant]/settings/+page.svelte` | Card "Curs Valutar BNR" |
| `app/src/routes/[tenant]/invoices/new/+page.svelte` | Auto-fill exchangeRate din BNR + hint |
| `app/src/routes/[tenant]/invoices/recurring/[invoiceId]/+page.svelte` | Auto-fill exchangeRate din BNR + hint |
| `app/src/lib/server/plugins/keez/mapper.ts` | Async + BNR fallback în loc de 4.82 |
| `app/src/lib/server/plugins/keez/hooks.ts` | `await mapInvoiceToKeez()` |
| `app/src/lib/remotes/keez.remote.ts` | `await mapInvoiceToKeez()` |
