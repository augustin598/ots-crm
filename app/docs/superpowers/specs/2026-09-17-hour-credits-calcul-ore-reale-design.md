# Bugete ore — logica finală de calcul (ore reale)

Data: 17 septembrie 2026 · Branch: `feat/hour-credits-f1-hourly-rates`
Completează `2026-09-10-client-hour-credits-design.md`; unde se contrazic, acest document are prioritate.

## Principiu

Clienții plătesc pentru timp. Fiecare cifră trebuie să fie exactă, reproductibilă din ledger și explicabilă clientului într-o frază.

## 1. Unități și surse de adevăr

- Unitatea unică e **minutul real**, întreg, semnat. Nicio ponderare pe specializare sau regim.
- Sursa de adevăr e `client_hour_ledger` (append-only). `client.hour_credit_minutes` e cache scris în aceeași tranzacție. Invariant: `cache == Σ delta_minutes`.
- Rezervările nu sunt în ledger: `rezervat = Σ estimated_minutes` ale taskurilor cu client, status ∉ {done, cancelled}, `credit_settled_at IS NULL`.
- `disponibil = sold − rezervat`; poate fi negativ.
- Euro apare doar ca preț plătit (comandă, „Adaugă ore") sau facturat (depășire).
- Pasul (`stepMinutes`) și pragul vin din Settings → Tarife orare. Opțiuni de pas: `[10, 15, 30, 60]`, implicit **15**. La 10, Settings afișează un avertisment: Keez primește cantitatea cu 2 zecimale, iar 10 min = 0,1667 h nu încape exact.

## 2. Formule pe evenimente

Funcție nouă, singura rotunjire a timpului:

```ts
ceilToStep(min, step) = Math.ceil(min / step) * step
```

### 2.1 Factură de abonament plătită (client bifat)

```
netEurCents = EUR ? net : round(net / ronPerEur_BNR(ziua plății))
minutes     = floor(netEurCents * 60 / (referenceRateEur * 100))
skip dacă minutes < 1
```

Rotunjire **în jos, la minut** (nu la pas): creditul nu depășește banii plătiți, iar pasul e regula timpului lucrat, nu a banilor. Exemplu: 5.608 RON la 4,96 → 113.065 cenți EUR → 1.233 min = 20 h 33 min. Tariful de referință e cel din Settings (implicit Project Management, 55 €/h). Nota din ledger spune explicit conversia: „1.130,65 € la 55 €/h".

### 2.2 Ore cumpărate („Adaugă ore", /servicii)

`delta = ore × 60`, orice specializare și regim. Prețul (`effectiveRateEur = round(bază × pct / 100)`) intră doar pe factură. Cod deja corect.

### 2.3 Ajustare manuală

`delta ≠ 0`, multiplu de pas, notă ≥ 5 caractere. Minusul nu e lot (fără `expires_at`). Neschimbat. Previzualizarea din formular arată „Sold după: X · Disponibil după: Y".

### 2.4 Estimare / rezervare

Serverul normalizează la scriere `estimatedMinutes = ceilToStep(estimatedMinutes, step)`; UI-ul face același snap în sus.

### 2.5 Decontarea la Done

```
actual     = task.actual_minutes        // lipsă sau 0 → NU se decontează; taskul apare în „De rezolvat"
facturabil = ceilToStep(actual, step)   // o singură rotunjire
din_credit = min(facturabil, max(0, sold))
depășire   = facturabil − din_credit    // fără a doua rotunjire
```

Invariant: `din_credit + depășire == facturabil`.

| sold | actual | pas | facturabil | din credit | depășire |
|---|---|---|---|---|---|
| 600 | 150 | 15 | 150 | 150 | 0 |
| 100 | 142 | 15 | 150 | 100 | 50 |
| 0 | 7 | 15 | 15 | 0 | 15 |
| −20 | 60 | 15 | 60 | 0 | 60 |

Rânduri: `task_consumption` (delta `−din_credit`, `real_minutes = actual`) doar dacă `din_credit > 0`; `overage_invoiced` (delta 0, `real_minutes = depășire`) doar dacă `depășire > 0`. Ambele cu snapshot-urile de preț.

Dacă scăderea parțială condiționată eșuează de 3 ori deși există sold, tranzacția se anulează, se scrie `logError`, rezultatul e `failed`, iar taskul rămâne nedecontat. Creditul existent nu devine niciodată depășire în tăcere.

### 2.6 Linia de depășire

```
unitRate    = effectiveRateEur(tarif_bază, multiplicator)   // din catalog la Done, înghețat în overage_invoiced
amountCents = round(depășire * unitRate * 100 / 60)
quantity    = depășire / 60                                  // doar afișare
```

TVA prin aceeași clasificare ca factura de ore (`resolveHourOrderVat`: intracom/export → 0% + mențiune). Draft lunar per client, ca acum.

### 2.7 Reopen

```
restituit = −( Σ delta(task_consumption ale ciclului) + Σ delta(correction cu source_id ∈ acele rânduri) )
```

`actual_minutes` se păstrează la reopen (altfel fiecare re-Done ar ajunge în „De rezolvat"). Restul regulilor (refuz dacă draftul a ieșit din `draft`) rămân.

### 2.8 Factură anulată

`−( delta(credit) + Σ correction pe acel rând )`, idempotent.

### 2.9 Expirare

FIFO pe minute reale, neschimbat. `correction` nu e lot: cu minus scade lotul din `source_id`; cu plus scade consumul (ca `task_reversal`).

### 2.10 Prag scăzut

`disponibil < prag` → o notificare; reînarmare când urcă peste prag. Neschimbat.

## 3. Kind nou de ledger: `correction`

`kind='correction'`, `source_type='ledger'`, `source_id` = id-ul rândului corectat, `note` cu formula, `created_by_user_id`. Index unic parțial pe `(tenant_id, kind='correction', source_id)` → un singur rând de corecție per rând corectat. Etichetă UI: „Corecție".

## 4. Corecția istorică — ONE TOP SOLUTION S.R.L. (`fd4il5ms2wcdhk3weghrbbpd`)

| Rând corectat | Era | Corecție | Notă |
|---|---|---|---|
| `hjnry3q2mxib44q2fqu7mp7a` (manual, 3 h Development urgent) | +321 | **−141** | „Corecție model ponderat: 3 h cumpărate = 180 min (era 321)" |
| `pzcolfcjwmvbsejwf5wdk55j` (task_consumption, task `sh5gc4lyajrs`) | −178 | **+28** | „Corecție model ponderat: 150 min lucrate = 150 min (era 178)" |

Sold: 143 → **30 min**. Reopen pe `sh5gc4lyajrs` restituie 150. Se aplică prin endpoint owner-only idempotent `[tenant]/api/_debug-hour-credit-correct`, nu prin ajustare manuală (care cere multiplu de pas). Rândurile de test +30/−30 din 17 sep rămân (se anulează).

## 5. Afișări

Reguli: numai ore/minute; euro doar pe prețuri plătite sau facturate.

| Loc | Schimbare |
|---|---|
| Lista admin | se scoate eticheta specializării de referință de pe rând |
| KPI-uri | se scoate „≈ X € la referință" și rândul hero „Tarif de referință"; pragul rămâne afișat |
| Fișa clientului | se scot „referință …, 55 €/h" și „≈ X € la tariful de referință"; cardul „Alimentare din facturi" păstrează regula cu tariful de referință |
| Card/câmpuri task | textul „(sau estimarea)" → „pe orele efective; fără ore efective taskul rămâne nedecontat" |
| Emailuri/WhatsApp | tariful €/h apare doar la depășire („Y min peste credit, facturate la Z €/h"), nu lângă orele consumate din credit |
| `creditToEur` | se șterge (funcție + test) |

### 5.1 Portalul clientului — note informative

În `PortalHourCreditView.svelte`:

- `low` se calculează pe **disponibil**, nu pe sold.
- Se scoate fraza „specializările mai scumpe consumă proporțional mai mult" (falsă pe ore reale).
- Card nou **„Cum funcționează creditul de ore"**, pliabil (`<details>`, deschis implicit când nu există mișcări), cu textele:
  1. **Ce este** — „Creditul e timpul pe care îl ai plătit în avans. 1 oră de credit = 1 oră lucrată, indiferent de tipul lucrării."
  2. **Cum se alimentează** — „Din orele cumpărate (1 h cumpărată = 1 h de credit) și, dacă e activat pentru contul tău, din facturile de abonament plătite: suma netă se transformă în ore la {tarif} €/h." A doua parte apare doar dacă clientul are bifa activă; tariful vine din server.
  3. **Cum se consumă** — „La finalizarea unui task scădem timpul lucrat, rotunjit în sus la {pas} minute. Exemplu: 20 min lucrate = {ceilToStep(20)} min."
  4. **Rezervat** — „Taskurile deschise blochează estimarea lor din sold. Disponibil = sold − rezervat. Nimic nu se scade până la finalizare."
  5. **Dacă se termină creditul** — „Timpul lucrat peste credit se facturează separat, la tariful lucrării, pe factura lunară de depășire."
  6. **Expirare** — doar dacă expirarea e pornită: „Orele neconsumate expiră după {N} zile de la alimentare; consumăm întâi orele cele mai vechi."
  7. **Credit scăzut** — „Te anunțăm când disponibilul scade sub {prag}."
- Valorile `{pas}`, `{prag}`, `{N}`, `{tarif}`, bifa de abonament vin din `getMyHourCredit` (se extinde răspunsul; fără tarife pe specializări).
- Sub fiecare consum din istoric rămâne „X min lucrate"; dacă `facturabil ≠ lucrat`, apare „rotunjit la {pas} min".

## 6. Cazuri limită

| Caz | Comportament |
|---|---|
| Credit zero / sold negativ | `din_credit = 0`, tot `facturabil` merge în draft |
| Credit parțial | depășirea poate fi ne-multiplu de pas; e restul exact |
| Pas schimbat între estimare și Done | `facturabil` cu pasul de la Done; estimarea rămâne cum e stocată |
| Tarif schimbat între cumpărare și depășire | irelevant la credit; depășirea la tariful de la Done, înghețat |
| BNR lipsă | factura RON rămâne în „Facturi necreditate" cu motiv |
| actual < estimare | se decontează `ceilToStep(actual)` |
| Taskuri de 1–5 min | un pas întreg |
| Done fără ore efective | nedecontat, în „De rezolvat" |

## 7. Invarianți de testat

1. `cache == Σ delta_minutes` după orice operație (inclusiv corecții, expirări, reopen).
2. `din_credit + depășire == ceilToStep(actual, step)` pentru orice `(sold, actual, step)`.
3. `din_credit ≤ max(0, sold_înainte)`; `sold_după = sold_înainte − din_credit`.
4. `overage_invoiced.delta == 0`; `real_minutes(overage) == facturabil − din_credit`.
5. `amountCents == round(min × rate × 100 / 60)`.
6. `purchase.delta == ore × 60` pentru orice specializare/regim.
7. `invoice_credit.delta == floor(netEurCents × 60 / (ref × 100))` și valoarea creditului ≤ banii plătiți.
8. Reopen restituie consumul net de corecții; al doilea reopen e no-op.
9. Done fără `actual_minutes` nu scrie în ledger și apare în `listUnsettledDoneTasks`.
10. `manual.delta % step == 0`, ≠ 0, notă ≥ 5.
11. `correction`: `source_type='ledger'`, `source_id` existent, unic per rând corectat.
12. Alertă de prag exact la tranziție, pe disponibil.
13. Corecțiile nu creează loturi de expirare.
14. Stornarea facturii anulate include corecțiile; idempotentă.
15. Corecția din §4: sold 143 → 30; reopen `sh5gc4lyajrs` → +150.
16. CAS parțial eșuat de 3 ori → `failed` + log, fără scrieri.

## 8. Schimbări de cod, în ordinea priorității

1. `logic/hour-credits.ts`: `ceilToStep`; `splitTaskSettlement` pe formula din §2.5; `'correction'` în `LedgerKind` + etichetă; `eurCentsToReferenceMinutes` → floor la minut; `consumptionWorkedLabel` fără €/h pe consum.
2. `server/task-credit.ts`: `settleTaskCredit` (fără fallback pe estimare, consum pe `facturabil`, CAS eșuat → throw + log); `addOverageLine` (sumă din minute, TVA prin `resolveHourOrderVat`); `reverseTaskCredit` (include corecții, păstrează `actual_minutes`).
3. `server/hour-credits.ts`: `creditPaidInvoice` cu floor + notă de conversie; `reverseCancelledInvoiceCredit` include corecții.
4. `logic/hour-credit-expiry.ts`: tratează `correction`.
5. Migrare: index unic parțial pentru `correction` (o singură instrucțiune, fără `IF NOT EXISTS`); endpoint `_debug-hour-credit-correct`.
6. `remotes/tasks.remote.ts` + `task-hour-credit-fields.svelte`: estimări rotunjite în sus.
7. `hourly-catalog.ts` + `hourly-rates.remote.ts` + pagina Settings: pas 10 cu avertisment.
8. UI admin (§5), portal (§5.1) + `portal-hour-credits.remote.ts`, emailuri/WhatsApp (+ `demo-*-email.ts`).
9. Texte moștenite din modelul ponderat: `docs/bugete-ore.md`, comentarii în `hour-credits.remote.ts`, `HcOrderDrawer.svelte`, `_debug-hour-credit-settle`, `db/schema.ts`.
10. Teste pentru toți invarianții din §7 (`bun run test hour-credit`).

## 9. De verificat la implementare

- Draftul de depășire e în EUR, iar factura de ore în RON: se verifică ce acceptă Keez pentru clienții români înainte de a atinge `addOverageLine` dincolo de sumă și TVA.
- Emailul de consum fără €/h schimbă o decizie din 13 sep 2026; se actualizează și demo-ul de email.

## 10. Addendum (17 sep, seara): depășirea se facturează în ore întregi

Decizia owner-ului: nicio factură „la minut". Orice depășire se facturează în ore întregi (minimum 1 h), iar diferența rămâne credit în contul clientului.

```
facturabil = ceilToStep(actual, pas)              // neschimbat
din_credit = min(facturabil, max(0, sold))        // neschimbat
depășire   = facturabil − din_credit              // minutele lucrate peste credit
facturat   = ceil(depășire / 60) × 60             // OVERAGE_BLOCK_MINUTES = 60
surplus    = facturat − depășire                  // intră în credit PE LOC, la Done
sold_după  = sold − din_credit + surplus
```

| sold | lucrat | din credit | depășire | facturat | sold după |
|---|---|---|---|---|---|
| 120 | 150 | 120 | 30 | 60 | 30 |
| 0 | 15 | 0 | 15 | 60 | 45 |
| 60 | 195 | 60 | 135 | 180 | 45 |
| 300 | 150 | 150 | 0 | 0 | 150 |
| −20 | 60 | 0 | 60 | 60 | −20 |

Ledger, în aceeași tranzacție cu consumul:
- `overage_invoiced`: delta 0, `real_minutes = facturat` (ce e pe factură), snapshot-uri de preț. Nota: „{titlu} — {depășire} min peste credit, facturate {facturat/60} h".
- dacă `surplus > 0`: rând `purchase`, delta `+surplus`, `source_type='ledger'`, `source_id = id-ul rândului overage_invoiced` (unic per ciclu de Done), `real_minutes = surplus`, snapshot-uri de tarif/regim, `expires_at` după regula tenantului. Nota: „{titlu} — {facturat/60} h facturate, {depășire} min folosite, {surplus} min rămân credit".

Linia de factură: `quantity = facturat / 60` (întreg), `rate = tarif_efectiv × 100`, UM oră, `amount = quantity × rate` — exact la orice pas; forma cu `quantity 1`/„Buc" nu mai apare. Draftul lunar rămâne: fiecare depășire e o linie, rotunjită la oră; surplusul acoperă taskurile următoare.

Reopen: pe lângă restituirea consumului (net de corecții) și scoaterea liniei din draft, se scrie `purchase_reversal` cu `−surplus`, același `source_type`/`source_id` ca rândul de surplus. Dacă surplusul a fost deja consumat, soldul devine negativ; următoarea decontare îl tratează ca 0 și facturează.

Invarianți noi: (17) `facturat % 60 == 0` și `0 ≤ surplus < 60`; (18) `sold_după = sold − din_credit + surplus`; (19) linia de depășire are `quantity` întreg și `quantity × rate == amount`; (20) Done → reopen readuce soldul exact la valoarea dinainte; (21) cache == Σ ledger după Done cu surplus și după reopen.

Afișări: fișa adminului arată surplusul ca „Ore cumpărate"; „De rezolvat" arată orele facturate. Portal, cardul informativ, punctul „Dacă se termină creditul": „Timpul lucrat peste credit se facturează în ore întregi, la tariful lucrării. Ce nu se folosește din ora facturată rămâne credit în contul tău." Email/WhatsApp la depășire: „{depășire} peste credit → {facturat/60} h facturate la Z €/h; {surplus} rămân credit."

## În afara scopului

Solduri separate pe specializare; tarif de conversie per client; afișarea sumei „plătite" în euro lângă sold.
