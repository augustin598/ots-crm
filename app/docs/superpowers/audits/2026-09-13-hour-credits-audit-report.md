# Audit „Bugete ore" — raport (13 sep 2026)

Branch `feat/hour-credits-f1-hourly-rates`. Bază: `bun run test` 2488 pass / 0 fail
după reparații. Date reale: `findHourCreditDrift` = **0 clienți desincronizați**
(ledgerul are doar datele de probă de pe ONE TOP SOLUTION).

## A. Bug-uri reparate (fiecare cu test care pica înainte)

| # | Sev. | Unde | Ce se strica | Test |
|---|---|---|---|---|
| A1 | Critic | `task-credit.ts` `settleTaskCredit` | Verificarea `credit_settled_at` era o citire ÎN AFARA tranzacției. Două Done simultane (drag în kanban + pagina taskului, dublu click) sau o tranzacție reluată de `withTursoBusyRetry` după `SQLITE_BUSY` consumau de două ori. Reprodus: 2 × `settled`, două rânduri `task_consumption`. | `două Done simultane pe același task consumă o singură dată` |
| A2 | Critic | `task-credit.ts` `reverseTaskCredit` | Aceeași cursă la reopen: +213 min restituiți de două ori (sold 813 în loc de 600). | `două reopen simultane…` |
| A3 | Critic | `task-credit.ts` `reverseTaskCredit` | Stornarea lua „ultimul `task_consumption` al taskului", fără legătură cu ciclul curent. Done (consumă X) → reopen (+X) → Done cu sold 0 (niciun rând de consum) → reopen = **+X a doua oară, credit din nimic**. | `reopen după un Done fără consum…` |
| A4 | Mediu | `portal-hour-credits.remote.ts` | Remote-ul nu verifica flag-ul `hourCredits`; un contact secundar fără acces îl putea chema direct (layout-ul gate-uiește doar navigarea). În plus, nota internă a ajustărilor manuale ajungea la client. | `portal-hour-credits.remote.test.ts` |
| A5 | Mic | `hour-credits.ts` `listUncreditedInvoices` | Filtrul „structural" era un regex pe textul motivului și nu prindea factura din „Adaugă ore" → apărea în „Necreditate", cu buton de creditare care e refuzată. Acum `invoiceCreditEligibility` întoarce `structural: true`. | integrare + `hour-credits.test.ts` |
| A6 | Mic | `hour-credits.ts` `listClientCreditTasks` | Filtrul „are ore" rula în memorie DUPĂ `limit 50` → la clienții cu multe taskuri fără ore, cele cu ore dispăreau din „Consum pe taskuri". Filtrul e acum în SQL. | `limita se aplică DUPĂ filtrul de ore…` |
| A7 | Mic | `HcOrderDrawer.svelte` + `listHoursOrders` | Frate al bug-ului din `54894992`: drawerul afișa creditul ca `hours × 60`. 10 h Development = 11 h 45 min credit la referința PM, nu 10 h. `listHoursOrders` întoarce acum `creditMinutes` din ledger (sau estimarea cu aceeași conversie). | `creditul afișat e cel din ledger…` |

Reparația A1–A3: revendicarea taskului e prima scriere din tranzacție, condiționată
(`credit_settled_at IS NULL` la Done, `= valoarea citită` la reopen); consumul stornat
e doar cel cu `created_at >= credit_settled_at`. Testul de integrare nu mai mock-uiește
`withTursoBusyRetry` — reluarea reală era exact ce ascundea bug-ul.

## B. Bug-uri nereparate (cer decizie sau lucru mai mare)

| # | Sev. | Unde | Problemă | Propunere |
|---|---|---|---|---|
| B1 | Mare | `task-credit.ts` `settleTaskCredit` → `addOverageLine` | Dacă draftul de depășire pică după commit-ul consumului, taskul rămâne decontat, `overage_invoice_id` null și **niciun rând** nu ține minte depășirea (`overage_invoiced` se scrie abia după draft). Butonul „Regenerează draftul" din spec §6.3 nu există. Bani nefacturați, invizibili. | Scrie `overage_invoiced` în tranzacția de consum; listă „depășire nefacturată" = rânduri `overage_invoiced` fără linie cu `task_id`. |
| B2 | Mare | spec §6.3 neimplementat | Remote-urile de facturi NU refuză editarea/ștergerea liniilor pe draftul `hour-overage`; ștergerea draftului nu golește `task.overage_invoice_id`. | Gardă în `invoices.remote.ts` pe `external_source = 'hour-overage'`. |
| B3 | Mediu | `tasks.remote.ts` (4 căi) | `settleTaskCredit` întoarce `failed` (ex. fără tarif de referință) fără să arunce; apelantul nu vede nimic. Taskul rămâne `done` fără decontare: nici rezervă, nici consum — credit gratis, nedetectat. Pe date reale: 0 cazuri azi. | Listă „Done nedecontate" în Bugete ore (query: `status='done' AND estimated_minutes>0 AND credit_settled_at IS NULL`). |
| B4 | Mediu | `hour-credit-expiry.ts` `remainingBatches` | `task_reversal` (+) devine lot NOU fără termen, iar consumul pe care îl anulează rămâne în FIFO. Reopen înainte de expirare transformă credit expirabil în credit permanent. Același efect pentru orice consum anterior activării expirării (se alocă pe loturile noi). Nu afectează prod azi (expirarea e oprită). | Stornarea se scade din consum, nu formează lot. **Decizie:** la reopen DUPĂ termen, minutele expiră la rularea următoare. |
| B5 | Mediu | `hour-credit-orders.ts` | „Adaugă ore" nu are cheie de idempotență: două taburi = două credite + două facturi. Rândul de ledger e `manual` fără legătură cu factura → la anularea/stornarea facturii nimic nu semnalează că orele au rămas acordate; raportul lunar nu le numără (numără doar `invoice_credit`/`purchase`). | `source_id` = id-ul facturii (sau kind nou) + includere în raport. |
| B6 | Mediu | spec abatere (4) | Anularea/stornarea unei facturi creditate nu stornează creditul și nu apare nicăieri ca alertă. | Cel puțin o listă „facturi creditate, acum anulate". |
| B7 | Mic | `hour-credit-notifications.ts:125` | Alerta „credit scăzut" folosește soldul; UI-ul și documentația spun „sub prag = pe disponibil". | Aliniere (decizie). |
| B8 | Mic | `task-hour-credit-fields.svelte` | Avertizarea galbenă compară estimarea cu soldul, nu cu disponibilul (spec §6.1). Estimările nu sunt validate ca multiplu de pas. | — |
| B9 | Mic | `hour-credit-orders.ts` `quoteHourCreditOrder` | Schema admin permite 500 h, `isValidHours` taie la 100 („Număr de ore invalid"). | Limită proprie pentru admin. |
| B10 | Mic | `scheduler/tasks/hour-credit-expiry.ts` | Cursă îngustă: un Done între citirea ledgerului și inserarea `expire` face lotul fără termen să piardă minutele. Dezactivarea expirării lasă „expiră la…" în UI; reactivarea expiră retroactiv tot ce a trecut de termen. | — |

## C. Preferințe de design (nu bug-uri)

- Contrast `#94a3b8` pe alb ~2,5:1 (sub AA) — confirmat, de decis.
- „Rezervat": verde în cardul de task, ambru hașurat în gauge — inconsecvent.
- Schimbarea tarifului celui mai ieftin (referință automată) schimbă valoarea
  soldului existent în minute; documentat, dar merită un avertisment în Settings.
- Luna „consum luna curentă" și KPI „expiră luna asta" sunt în UTC; draftul de
  depășire e în Europe/Bucharest.

## D. Secțiuni fără constatări

- **Idempotența alimentărilor**: indexurile parțiale sunt corecte; `isUniqueViolation`
  prinde conflictul prin lanțul `cause` (testat pe libSQL real). Webhook-ul `hours_purchase`
  e protejat și de `status === 'paid'`.
- **Dubla creditare prin facturi**: factura comenzii de ore e legată de comandă în
  aceeași tranzacție și inserată direct `paid` (fără hook); `hour-credit`/`hour-overage`
  sunt respinse primele. Singurul risc rămas: o factură creată manual pentru o comandă
  a cărei emitere a picat (fără legătură cu comanda) ar credita a doua oară la plată.
- **Multi-tenant**: toate query-urile noi sunt scopate; remote-urile trec prin
  `requireStaff`/`requireOwnerOrAdmin`; join-urile fără tenant pornesc din rânduri scopate.
- **TVA**: fără procent hardcodat. `/servicii` e în practică doar RO (client nou `country: 'RO'`,
  CUI prin ANAF). Draftul de depășire ignoră intracom — abatere asumată în spec.
- **Plata facturii „Adaugă ore"**: `invoice.paid` → creditul o respinge; Keez validează
  proforma (politica existentă); DirectAdmin ignoră (fără `hostingAccountId`). Nu trebuie
  `validateInvoiceInKeezForTenant` la emitere (e neîncasată). Dacă push-ul Keez a picat
  (ex. `OTS 561`), plata nu o mai fiscalizează automat — comportamentul general al facturilor.
- **Settings non-tranzacțional**: nu poate rămâne o referință inactivă — `resolveReferenceRate`
  cade pe cel mai mic tarif activ, iar dezactivarea referinței explicite e blocată.
- **Date reale**: rândul „Adaugă ore" de 321 min nu e multiplu de 15 — urmă din înainte de `54894992`.

## E. Runda 2 (13 sep 2026) — după second opinion Gemini + deciziile userului

Gemini a confirmat reparațiile A1–A3 (fără regresii) și a găsit două găuri reale,
verificate și reproduse înainte de reparație:

| # | Problemă | Reparație | Test |
|---|---|---|---|
| G1 | Reopen intrat între commit-ul consumului și scrierea `task.overage_invoice_id`: taskul redeschis rămânea legat de draft, cu linia orfană → Done-ul următor factura depășirea a doua oară. | `billOverage`: legarea e condiționată pe `credit_settled_at` al decontării; dacă taskul s-a schimbat, linia se retrage. Reopen-ul șterge liniile după `task_id`. | `reopen concurent între consum și linia de depășire…` |
| G2 | Linia inserată, legarea picată → linie facturată pe care reopen-ul n-o mai găsea. | Idem (după `task_id`) + regenerarea relegă linia existentă. | `reopen scoate linia taskului chiar dacă…`, `regenerarea refolosește linia…` |

Din secțiunea B, reparate (fiecare cu test care pica înainte):

- **B1** — `overage_invoiced` intră în tranzacția de consum; `listUnbilledOverages` + `regenerateOverageDraft`.
- **B2** — `overageDraftEditBlockReason` în `updateInvoice`; `detachOverageInvoiceTasks` în `deleteInvoice`.
  (Liniile unei facturi existente nu se editează din /invoices; singura altă cale care le rescrie e sync-ul Keez, pe documente deja emise.)
- **B3** — `listUnsettledDoneTasks` + acțiunea „Decontează".
- **B4** — decizie: stornarea nu e lot; restituit după termen = expiră la rularea următoare; a doua expirare a unui lot primește cheia `id#2`. Test de integrare pe job (verificat că pica pe logica veche: 0 min expirate în loc de 500).
- **B5** — „Adaugă ore" scrie `purchase` pe factură, cu cheie de idempotență din modal. Protejează dublul click/retry; două taburi separate rămân două comenzi (nu se pot deosebi de o comandă legitimă repetată).
- **B6** — `listCancelledCreditedInvoices` + „Retrage orele" (`*_reversal`, idempotent).
- **B7** — decizie: pragul pe disponibil (`lowCreditTransition`), email + WhatsApp arată disponibilul.
- **B8** — avertizarea din formular pe disponibil (`availableForTask`), estimarea se rotunjește la pas la blur.
- **B9** — limita de 100 h a comenzii publice nu mai taie adminul; plafonul regimului rămâne (comportament existent).

UI: tabul „De rezolvat" în Bugete ore (`HcIssuesPanel.svelte`).

## F. Runda 3 — ultimele puncte

- **B10, cursa jobului** — confirmată ca bug real doar la sold insuficient: Done strecurat
  între citire și scriere → sold −180 și depășire nefacturată (reprodus în test). Reparat:
  citire + scriere în aceeași tranzacție per client.
- **B10, expirare oprită/repornită** — decizie: fără expirare retroactivă. Coloana
  `hour_credit_settings.credit_expiry_enabled_at` (migrarea 0562, aplicată pe Turso și
  verificată cu `pragma_table_info`); UI-ul nu mai arată „expiră" cu expirarea oprită.
- **Factura „Adaugă ore" neemisă** — `listUninvoicedHourCredits` + „Emite factura" în
  „De rezolvat", la prețul înghețat în ledger, fără a doua creditare.
- Datele de probă (`OTS 561`, rând `manual`) — decizie: neatinse.

Verificare: `bun run test` 2523 pass / 0 fail · svelte-check 0 erori / 0 avertismente ·
`bun run build` trece.

