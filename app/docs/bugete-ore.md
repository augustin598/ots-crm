# Bugete ore (creditul de ore per client)

Modulul ține creditul de ore al fiecărui client: cât are, cât e rezervat de
taskuri deschise, de unde vin orele și când expiră.

Rute:

- `/[tenant]/hour-credits` — lista clienților + comenzi de ore + facturi
  necreditate + raport lunar
- `/[tenant]/hour-credits/[clientId]` — fișa de credit a unui client
- `/[tenant]/settings/hourly-rates` — specializări, regimuri de lucru, reguli
- `client/[tenant]/(app)/hour-credits` — ce vede clientul în portal

Widgets: cardul „Bugete ore" din Dashboard și cardul de credit din panoul
clientului (`$lib/components/hour-credits/HcDashboardWidget.svelte`,
`HcClientWidget.svelte`).

## Unitatea de măsură

Soldul e în **minute reale**, întregi, semnate — nicio ponderare pe
specializare sau regim. 1 oră de credit (cumpărată sau lucrată) înseamnă
exact 1 oră, indiferent de tariful specializării.

Singura rotunjire a timpului e `ceilToStep(minute, pas)` din
`$lib/logic/hour-credits.ts` — în sus, la pasul din Settings, aplicată **o
singură dată**: la decontarea taskului (Done) și la normalizarea estimărilor.
Pasul (`stepMinutes`) are opțiunile `10 / 15 / 30 / 60`, implicit 15. La
pasul de 10 min, 10 min = 0,1667 h nu se scrie exact cu 2 zecimale — Settings
arată nota direct pe câmp. Facturile de depășire nu mai sunt afectate: pleacă în
ore întregi (vezi „Depășirea se facturează în ore întregi").

Tariful de referință (Settings; dacă nu e ales niciunul, cel mai mic tarif
activ — `resolveReferenceRate`) NU mai intervine la decontarea taskurilor.
Singurul loc unde contează e conversia facturilor de abonament plătite (mai
jos), unde suma netă devine minute, rotunjite **în jos**, la minut.

Interfața arată doar ore/minute pentru sold, rezervat și disponibil; euro
apare numai pe prețuri plătite (comenzi, „Adaugă ore") sau facturate
(depășire) — nicio echivalență „≈ X €" lângă credit.

## Sursa de adevăr

`client_hour_ledger` — append-only, mișcări semnate. Soldul e `SUM(delta_minutes)`;
`client.hour_credit_minutes` e doar cache, scris în aceeași tranzacție
(`applyLedgerEntry`). Garda de drift: `findHourCreditDrift` / `reconcileHourCredit`.

Idempotența alimentărilor vine din indexuri unice parțiale, nu din verificări în
cod:

| Index | Acoperă |
|---|---|
| `client_hour_ledger_source_uidx` | `invoice_credit`, `purchase` și stornările lor |
| `client_hour_ledger_expire_uidx` | `expire` — un lot expiră o singură dată |

## De unde vin orele

1. **Facturi plătite** — doar clienții cu `hour_credit_from_invoices`. Suma
   netă (EUR direct, sau RON convertit cu cursul BNR **din ziua plății**) se
   transformă în minute la tariful de referință, **rotunjite în jos, la
   minut** (`floor(netEurCents × 60 / (tarif × 100))`; creditul nu depășește
   niciodată banii plătiți). Nota din ledger scrie explicit conversia — ex.
   „1.130,65 € la 55 €/h". Regulile de eligibilitate sunt în
   `invoiceCreditEligibility`: nu alimentează facturile de hosting, cele din
   surse ads, cele de depășire, cele ale comenzilor de ore și nici cele emise
   din „Adaugă ore".
2. **Comenzi de ore de pe `/servicii`** — `ore × 60`, orice specializare sau
   regim; orele intră după confirmarea plății.
3. **„Adaugă ore" din admin** — creditul intră **la emitere**, apoi se emite
   factura și pleacă pe email cu link de plată
   (`$lib/server/hour-credit-orders.ts`). Rândul din ledger e `purchase` cu
   `source_type = 'invoice'` și `source_id` = id-ul facturii: intră în raportul
   lunar și se poate retrage dacă factura e anulată. Modalul trimite o cheie de
   idempotență (`requestId`), deci dublul click sau retry-ul nu dublează nimic;
   două taburi separate rămân două comenzi.
4. **Ajustare manuală** — owner/admin, cu motiv obligatoriu care rămâne în ledger.

### De ce factura din „Adaugă ore" nu mai creditează la plată

Pentru că orele au intrat deja când s-a emis. Factura poartă
`external_source = 'hour-credit'`, iar `invoiceCreditEligibility` o respinge
explicit. Fără marcajul ăsta, `invoice.paid` ar adăuga a doua oară aceleași ore.

## Rezervat vs. disponibil

`rezervat` = suma estimărilor taskurilor deschise, în minute reale
(`computeReservedMinutes`); estimarea se normalizează la scriere cu
`ceilToStep(estimatedMinutes, pas)`, la fel ca timpul lucrat la Done. **Nu
scade soldul** — scade doar disponibilul:

```
disponibil = sold − rezervat
```

„Sub prag" se calculează pe *disponibil*, nu pe sold — și în listă, și în
alerta de „credit scăzut" (`lowCreditTransition`). Formularul de task avertizează
când estimarea (rotunjită la pas) trece de disponibil, fără să numere de două ori
rezervarea taskului editat (`availableForTask`).

## Decontarea taskurilor (concurență)

`settleTaskCredit` și `reverseTaskCredit` revendică taskul ca **primă scriere**
din tranzacție (`credit_settled_at IS NULL` la Done, `= valoarea citită` la
reopen). O verificare făcută înainte de tranzacție nu ajunge: două Done simultane
sau o tranzacție reluată de `withTursoBusyRetry` după `SQLITE_BUSY` consumau de
două ori. Reopen-ul stornează doar consumul ciclului curent
(`created_at >= credit_settled_at`).

Depășirea: rândul `overage_invoiced` intră în aceeași tranzacție cu consumul;
linia din draft și legarea ei de task vin după. Dacă taskul s-a schimbat între
timp, linia se retrage. Liniile se caută după `invoice_line_item.task_id`, nu doar
după `task.overage_invoice_id`.

## Depășirea se facturează în ore întregi

Decizia owner-ului (17 sep 2026, addendum §10 din
`docs/superpowers/specs/2026-09-17-hour-credits-calcul-ore-reale-design.md`):
nicio factură „la minut". Timpul lucrat peste credit se facturează în ore
întregi (minimum 1 h), la tariful × regimul taskului, iar partea nefolosită din
ora facturată intră în creditul clientului **pe loc, la Done**.

```
facturabil = ceilToStep(actual, pas)
din_credit = min(facturabil, max(0, sold))
depășire   = facturabil − din_credit
facturat   = ceil(depășire / 60) × 60        // OVERAGE_BLOCK_MINUTES, invoicedOverageMinutes
surplus    = facturat − depășire             // 0…59
sold_după  = sold − din_credit + surplus
```

Exemplu: sold 2 h, lucrat 2 h 30 → 2 h din credit, 30 min depășire, o linie de
1 h pe draft, sold după = 30 min.

Ledger, în tranzacția de consum (`settleTaskCredit`):

- `overage_invoiced`: delta 0, `real_minutes` = **minutele facturate** (multiplu de
  60), snapshot-uri de preț;
- dacă `surplus > 0`: rând `purchase` (+surplus), `source_type = 'ledger'`,
  `source_id` = id-ul rândului `overage_invoiced` al ciclului (unic per Done, deci
  indexul `client_hour_ledger_source_uidx` nu se lovește la re-Done), `expires_at`
  după regula tenantului. E un lot de credit ca oricare altul: apare ca „Ore
  cumpărate", expiră la fel, iar nota lui se vede în portal.

Linia de factură: `quantity = facturat / 60` (întreg), UM oră, `rate` = tariful
efectiv în cenți, `amount = quantity × rate` exact la orice pas. `addOverageLine`
aruncă dacă primește minute care nu sunt multiplu de 60. Draftul lunar rămâne: o
linie per depășire; surplusul acoperă taskurile următoare.

Reopen (`reverseTaskCredit`), în aceeași tranzacție: pe lângă restituirea
consumului, scrie `purchase_reversal` cu `−surplus` și aceeași sursă ca rândul de
surplus (expirarea îl scade din lotul lui, nu FIFO). Se retrage netul: surplus +
corecțiile lui − ce a expirat deja din lot. Soldul revine exact la valoarea
dinainte de Done; dacă surplusul a fost consumat între timp de alt task, soldul
devine negativ, iar decontarea următoare îl tratează ca 0 și facturează.

Urme moștenite: rândurile `overage_invoiced` scrise înainte de regula asta țin
minutele exacte (pot fi non-multipli de 60). „Regenerează" le facturează rotunjit
în sus la oră și creditează surplusul o singură dată, cu același rând `purchase`
legat de urma depășirii (idempotent prin indexul unic). Liniile deja aflate pe
drafturi/facturi nu se rescriu.

Notificări (email + WhatsApp), fraza comună `overageNoticeSentence`: „30 min peste
credit → 1 h facturate la 65 €/h; 30 min rămân credit." (fără surplus, ultima
parte lipsește).

## Corecții istorice (`kind = 'correction'`)

Un rând de ledger nu se editează niciodată — un rând scris greșit (ex. sub
vechiul model ponderat) se corectează append-only. `client_hour_ledger.kind =
'correction'`, cu `source_type = 'ledger'` și `source_id` = id-ul rândului
corectat; un index unic parțial pe `(tenant_id, kind='correction', source_id)`
garantează o singură corecție per rând. FIFO-ul de expirare, reopen-ul și
stornarea unei facturi anulate țin cont de corecțiile rândurilor lor.

Se scriu doar prin endpointul owner-only `[tenant]/api/_debug-hour-credit-correct`
(`POST { ledgerId, deltaMinutes, note }`, notă ≥ 5 caractere), idempotent — a
doua chemare pe același `ledgerId` întoarce `applied: false`. Nu prin
ajustarea manuală din UI, care cere un delta multiplu de pas.

## Tabul „De rezolvat"

- **Depășiri fără factură** — urma `overage_invoiced` a decontării curente, fără
  linie pe niciun draft (draft picat, legare picată, draft șters). Coloana arată
  orele care se vor factura (întregi). „Regenerează" relegă linia existentă sau o
  recreează la tariful înghețat.
- **Taskuri Done nedecontate** — fie taskul n-are `actual_minutes` (lipsă sau
  0: nu există fallback pe estimare, taskul rămâne „De rezolvat" până se
  introduc orele efective), fie decontarea a eșuat propriu-zis (CAS-ul
  parțial eșuat de 3 ori deși există sold → `failed` + `logError`, creditul
  existent nu devine niciodată depășire în tăcere). „Decontează" rulează
  logica reală, cu orele introduse manual când lipsesc.
- **Ore adăugate fără factură** — „Adaugă ore" cu curs BNR lipsă sau INSERT eșuat.
  „Emite factura" folosește prețul înghețat în ledger, cursul și TVA-ul de azi, și
  id-ul facturii referit de rândul din ledger (a doua emitere e refuzată); creditul
  nu se acordă din nou (`reissueHourCreditInvoice`).
- **Facturi anulate care au dat ore** — „Retrage orele" scrie
  `invoice_credit_reversal` / `purchase_reversal`, idempotent prin indexul unic.

Draftul de depășire nu se editează din antet (sumă, cotă, monedă, client), iar
nota trebuie să păstreze marcajul `hour-overage:YYYY-MM`
(`overageDraftEditBlockReason`). Ștergerea draftului desprinde taskurile
(`detachOverageInvoiceTasks`).

## Expirarea

Oprită implicit (`credit_expiry_days = 0`). Când e pornită, alimentările primesc
`expires_at = data alimentării + N zile`; creditul existent la momentul activării
rămâne fără termen (fără retroactiv).

Alocarea consumului pe loturi e **FIFO pe expirare**: se consumă întâi lotul cu
termenul cel mai apropiat, iar creditul fără termen ultimul — ca să piardă
clientul cât mai puțin. Logica e pură și testată în
`$lib/logic/hour-credit-expiry.ts`.

Stornările nu sunt loturi: `task_reversal` se scade din consum (minutele
restituite rămân în lotul lor și, dacă termenul a trecut, expiră la rularea
următoare), iar `invoice_credit_reversal` / `purchase_reversal` retrag exact
alimentarea cu aceeași sursă. Un lot care expiră a doua oară primește cheia
`id#2` (indexul unic ar bloca altfel a doua expirare).

Oprirea expirării (0 zile) ascunde „expiră la…" din UI și oprește jobul. La
repornire se fixează `hour_credit_settings.credit_expiry_enabled_at` (migrarea
0562): termenele trecute cât expirarea a fost oprită **nu expiră retroactiv**
(`nextExpiryEnabledAt`, `expiringBatches`).

Jobul citește ledgerul și scrie expirarea în aceeași tranzacție per client. Altfel
un Done strecurat între citire și scriere consuma din lot, expirarea scădea apoi lotul
întreg, iar la sold insuficient soldul ajungea negativ și depășirea nu se factura.

Jobul zilnic `hour-credit-expiry` (04:30 Europe/Bucharest) scrie rândurile
`expire`. E idempotent de două ori: prin indexul unic, și prin faptul că rândul
de expirare devine el însuși consum, deci la rularea următoare lotul nu mai apare
ca neconsumat.

## Prețul orelor

O singură sursă: `effectiveRateEur(baseRateEur, multiplierPct)` din
`$lib/logic/hours-pricing.ts` — tarif de bază × multiplicatorul regimului,
**rotunjit la euro întreg**. Aceeași funcție rulează pe `/servicii`, în modalul
din admin (prin `quoteHourCreditOrder`) și la emiterea facturii. Previewul din
modal cere cotația serverului, ca suma afișată să nu poată diverge de cea
facturată.

**Regula de îngheț:** o comandă plătită păstrează tariful și SLA-ul de la
momentul plății (`rate_eur`, `mode_multiplier_pct`, `mode_sla_snapshot`).
Modificările din Settings afectează doar `/servicii` și comenzile noi.

## Valuta pe factura de ore

Tarifele sunt în EUR, dar Keez refuză facturi în EUR pentru clienți din România.
Factura are deci **antetul în RON** cu cursul BNR blocat pe rând
(`invoice.exchange_rate`) și **linia în EUR**. Fără curs BNR în bază nu se emite
factura — dar creditul rămâne acordat, iar adminul reia emiterea după sync-ul BNR.

## Portalul clientului

`PortalHourCreditView.svelte` arată soldul, rezervatul și disponibilul, plus
un card pliabil **„Cum funcționează creditul de ore"** (`<details>`, deschis
implicit cât timp nu există nicio mișcare) cu explicații pe înțelesul
clientului: ce e creditul, cum se alimentează (ore cumpărate și, dacă bifa e
activă, facturile de abonament la tariful de referință), cum se consumă (cu
exemplul rotunjirii la pas), ce înseamnă rezervat, ce se întâmplă la
depășire, expirarea (doar dacă e pornită) și pragul de alertă. Valorile —
pas, prag, zile de expirare, tariful de conversie — vin din `getMyHourCredit`,
nu sunt hardcodate în componentă. Alerta „sub prag" se calculează pe
disponibil, nu pe sold, la fel ca în admin.

## Design

Ecranele urmează `design_handoff_hour_credits/`. Stilurile stau în
`$lib/components/hour-credits/hour-credits.css` (clase `hc-*` și `hr-*`).

Tokenii `--cl-*` și `--hc-*` sunt definiți **în interiorul fișierului**, pe
`.hc-wrap`, `.hc-widget`, `.hc-ovl` și `.hc-modal-ovl`. Motivul: drawerul,
modalul și widgets-urile se randează în afara paginii (la rădăcina componentei
sau în alt ecran), iar dacă tokenii ar veni din `pagespeed.css` un
`var(--cl-surface)` nerezolvat ar face panoul transparent. Orice rădăcină nouă
de portal trebuie adăugată în acele liste de selectori.

Varianta dark e derivată din aceiași tokeni, sub `.dark .hc-wrap` (în `.css`
simplu se scrie `.dark .x`, nu `:global(.dark)`).

## Limite cunoscute

- Paleta light a handoff-ului folosește `#94a3b8` pentru textele „mut", ceea ce
  dă ~2,5:1 pe alb — sub pragul WCAG AA de 4,5:1 pentru text mic. Varianta dark
  (derivată) e la ~5,5:1. De discutat dacă se întunecă tokenul în light.
- Portalul verifică flag-ul `hourCredits` și în remote, nu doar în layout; notele
  ajustărilor manuale nu ajung la client.
- Salvarea din Settings trimite mai multe comenzi (una per rând modificat), nu o
  singură tranzacție: dacă una pică, restul rămân salvate, formularul rămâne
  dirty și mesajul de eroare cere reluarea.
