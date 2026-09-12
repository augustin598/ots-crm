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

Soldul e în **minute la tariful de referință**. O oră de specializare scumpă
consumă proporțional mai mult credit decât una ieftină — raportul se calculează
cu `weightFactor` din `$lib/logic/hour-credits.ts`.

Tariful de referință e cel ales în Settings; dacă nu e ales niciunul, e cel mai
mic tarif activ (`resolveReferenceRate`).

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

1. **Facturi plătite** — doar clienții cu `hour_credit_from_invoices`. Conversia
   se face la tariful de referință, cu cursul BNR **din ziua plății**. Regulile
   de eligibilitate sunt în `invoiceCreditEligibility`: nu alimentează facturile
   de hosting, cele din surse ads, cele de depășire, cele ale comenzilor de ore
   și nici cele emise din „Adaugă ore".
2. **Comenzi de ore de pe `/servicii`** — orele intră după confirmarea plății.
3. **„Adaugă ore" din admin** — creditul intră **la emitere**, apoi se emite
   factura și pleacă pe email cu link de plată
   (`$lib/server/hour-credit-orders.ts`).
4. **Ajustare manuală** — owner/admin, cu motiv obligatoriu care rămâne în ledger.

### De ce factura din „Adaugă ore" nu mai creditează la plată

Pentru că orele au intrat deja când s-a emis. Factura poartă
`external_source = 'hour-credit'`, iar `invoiceCreditEligibility` o respinge
explicit. Fără marcajul ăsta, `invoice.paid` ar adăuga a doua oară aceleași ore.

## Rezervat vs. disponibil

`rezervat` = suma estimărilor taskurilor deschise, ponderate
(`computeReservedMinutes`). **Nu scade soldul** — scade doar disponibilul:

```
disponibil = sold − rezervat
```

„Sub prag" se calculează pe *disponibil*, nu pe sold.

## Expirarea

Oprită implicit (`credit_expiry_days = 0`). Când e pornită, alimentările primesc
`expires_at = data alimentării + N zile`; creditul existent la momentul activării
rămâne fără termen (fără retroactiv).

Alocarea consumului pe loturi e **FIFO pe expirare**: se consumă întâi lotul cu
termenul cel mai apropiat, iar creditul fără termen ultimul — ca să piardă
clientul cât mai puțin. Logica e pură și testată în
`$lib/logic/hour-credit-expiry.ts`.

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
- Salvarea din Settings trimite mai multe comenzi (una per rând modificat), nu o
  singură tranzacție: dacă una pică, restul rămân salvate, formularul rămâne
  dirty și mesajul de eroare cere reluarea.
