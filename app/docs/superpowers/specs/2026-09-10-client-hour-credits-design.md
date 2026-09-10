# Credit de ore per client — design

**Data:** 2026-09-10
**Stare:** aprobat verbal în brainstorming; revizuit 2026-09-10 (alimentare din
facturi la tarif de referință + consum ponderat); așteaptă review pe document
**Second opinion:** Gemini (flash) + opencode, pe întrebarea de credit insuficient,
pe modelul de date și pe designul complet. Punctele lor sunt integrate mai jos.

## 1. Problema

Agenția vinde ore (abonamente lunare + ore cumpărate pe `/servicii`), dar CRM-ul
nu ține evidența consumului. Golul e notat în `docs/ore-extra-work-regimuri.md`
(„Nu există evidență a consumului de ore în CRM"). Fără evidență nu putem
spune clientului cât mai are, nu putem factura corect ce depășește și nu putem
dovedi orele lucrate.

## 2. Decizii de produs (luate cu userul, nu se renegociază în plan)

| Subiect | Decizie |
|---|---|
| Unitatea creditului | **Ore la tarif de referință**, un singur bazin per client. Tariful de referință = cel mai mic tarif activ din Settings (azi Project Management, 55 €/h), suprascriibil în Settings. |
| Surse de alimentare | (a) **facturile plătite** ale clienților bifați „facturile alimentează creditul" (abonamentul Lucky Studio rămâne în Keez, neschimbat): suma netă → EUR la BNR din ziua plății → ÷ tarif de referință = ore; se exclud automat facturile de hosting, de ads, de depășire și cele ale comenzilor de ore; (b) ore cumpărate pe `/servicii` (comandă plătită), convertite la aceeași referință; (c) ajustare manuală owner/admin cu motiv. |
| Consum ponderat | Un task consumă `ore × (tarif specializare × regim ÷ referință)`. 2 h Development la 65 € scad 2,36 h; 2 h PM scad 2 h. Rezervările se ponderează la fel. |
| Rollover | Orele neconsumate se reportează nelimitat. Nu expiră. |
| Momentul scăderii | Estimare la creare (apare ca **rezervată**, nu scade soldul). Scădere **la Done**, pe orele efective confirmate. Anularea eliberează rezervarea. |
| Credit insuficient | **Fără sold negativ.** La Done se scade cât există; diferența intră într-un **draft de factură cumulat lunar per client**, confirmat manual de admin, apoi emis în Keez. |
| Tarif depășire | Tariful specializării × multiplicatorul regimului, din Settings, **înghețat pe linie** la generare. EUR + TVA; RON la clienții RO după regulile Keez existente. |
| Depășire neplătită | Munca **continuă**; badge roșu „depășire neplătită: X €" în Bugete ore și pe task. Decizia comercială rămâne la owner. |
| Reopen după emitere fiscală | **Interzis.** Un task a cărui depășire a fost emisă în Keez nu se mai redeschide; UI oferă „Creează task de continuare" (task nou, legat de cel vechi). Fără storno în Keez. |
| Prețuri pe oră | Modul **separat în Settings**, per tenant. `/servicii` citește din DB, nu din constante. |
| Pagina de evidență | Intrare **în meniul principal**: „Bugete ore". Plus card „Credit timp" în panoul clientului. |
| Portal client | Sold + istoric complet, categorie nouă de acces. Fără ajustări din portal. |
| Notificări | Email **și** WhatsApp (grupul task-ului, ca la statusuri): credit scăzut (o dată la trecerea sub prag), consum la Done, alimentări. |
| Permisiuni | Ajustare manuală doar owner/admin. Staff vede soldul și alocă ore pe task. |
| Task: câmpuri | „Ore estimate", „Specializare", „Regim" apar doar când task-ul are client; obligatorii dacă orele > 0. Task-urile interne rămân neatinse. |

**Exemplu Lucky Studio:** factură plătită 5.608 RON net ≈ 1.130 € (BNR ~4,96)
→ ÷ 55 = **20,5 h** credit. Un task de 3 h Development (65 €) consumă 3 × 65/55
= 3,55 h; rămân 16,95 h.

## 3. Model de date

Unitatea de stocare: **minute întregi la tarif de referință** (ca „cents" la
bani). UI lucrează în pas de 15 minute (`hour_credit_settings.step_minutes`,
implicit 15), afișare `Xh Ym`. Minutele ponderate se rotunjesc la minut întreg
în sus la consum și la cel mai apropiat pas la alimentare.

### 3.1 Tabele noi

**`hourly_rate`** — specializări per tenant. Seed din `HOURLY_RATES` actual.

| coloană | tip | note |
|---|---|---|
| id, tenant_id | text | |
| slug | text | unic per tenant (`development`, `design-ui-ux`, …) |
| label | text | |
| rate_eur | integer | euro întregi/oră, fără TVA (ca `service_hours_order.rate_eur`) |
| sort_order | integer | |
| is_active | boolean | dezactivare, nu ștergere, dacă e referită |
| created_at, updated_at | | |

**`hourly_rate_mode`** — regimuri per tenant. Seed din `RATE_MODES`.

| coloană | note |
|---|---|
| id, tenant_id, slug, label | `standard`, `urgent`, `weekend`, `night` — slug-uri fixe, doar valorile se editează |
| suffix | sufixul din `rate_label` / linia Keez („Urgență 48h"); gol la standard |
| description | propoziția de sub selectorul de regim, pe `/servicii` |
| multiplier_pct | 100 / 150 / 170 / 200 |
| max_hours | plafon per comandă publică (100/40/24/16) |
| sla | angajamentul comercial afișat pe `/servicii` și înghețat pe comandă |
| sort_order, is_active, created_at, updated_at | |

**`hour_credit_settings`** — un rând per tenant (unic pe `tenant_id`).

| coloană | note |
|---|---|
| low_credit_threshold_minutes | implicit 120 |
| step_minutes | implicit 15 |
| reference_rate_slug | null = cel mai mic `rate_eur` activ; altfel slug-ul ales |
| notify_email, notify_whatsapp | boolean |
| updated_by_user_id, updated_at | |

**`client_hour_ledger`** — append-only, sursa de adevăr a soldului.

| coloană | note |
|---|---|
| id, tenant_id, client_id | `tenant_id` obligatoriu (review Gemini + opencode) |
| delta_minutes | integer, semnat |
| kind | `invoice_credit` · `invoice_credit_reversal` · `purchase` · `purchase_reversal` · `manual` · `task_consumption` · `task_reversal` · `overage_invoiced` |
| source_type | `invoice` · `hours_order` · `task` · `manual` |
| source_id | id-ul sursei |
| reference_rate_eur_snapshot | tariful de referință folosit la conversie (pe orice rând cu bani sau ponderare) |
| net_cents_snapshot, currency_snapshot, fx_rate_snapshot | pe `invoice_credit`/`purchase`: suma netă, moneda și cursul BNR folosit |
| rate_slug, mode_slug, rate_eur_snapshot, multiplier_pct_snapshot, real_minutes | pe consum/depășire: specializarea, regimul, tariful înghețat și minutele REALE lucrate (delta e ponderat) |
| note | motiv manual sau notă automată |
| created_by_user_id | null la evenimente automate |
| created_at | |

Indexuri: `(tenant_id, client_id, created_at)`; **unic parțial** pe
`(tenant_id, kind, source_type, source_id)` doar pentru
`kind IN ('invoice_credit','invoice_credit_reversal','purchase','purchase_reversal')`
= idempotență la evenimente livrate de două ori. Rândurile de task
(`task_consumption`, `task_reversal`, `overage_invoiced`) pot apărea de mai
multe ori pentru același task (Done → reopen → Done); idempotența lor vine din
verificarea `task.credit_settled_at` în interiorul tranzacției de Done.
`overage_invoiced` are `delta_minutes = 0` și există doar ca trasabilitate
(leagă task-ul de linia din draft).

### 3.2 Coloane noi pe tabele existente

| tabel | coloană | rol |
|---|---|---|
| `client` | `hour_credit_minutes` integer default 0 | **cache** al soldului; se scrie doar în aceeași tranzacție cu ledger-ul |
| `client` | `hour_credit_from_invoices` boolean default false | bifa „facturile plătite alimentează creditul de ore" |
| `client` | `low_credit_notified_at` timestamp null | starea alertei „credit scăzut": setată la prima trecere sub prag, golită când soldul urcă peste prag; cât e setată nu se mai trimite nimic (review Gemini) |
| `invoice_line_item` | `task_id` text null | leagă linia de depășire de task; doar pe facturile `hour-overage` |
| `task` | `estimated_minutes`, `actual_minutes`, `rate_slug`, `mode_slug`, `credit_settled_at`, `overage_invoice_id`, `continuation_of_task_id` | vezi §6 |

Index nou: `task(client_id, status)` pentru calculul rezervărilor.

**Rezervate** = `SUM(estimated_minutes × factor)` pe task-urile clientului cu
status diferit de `done` și `cancelled` și `credit_settled_at IS NULL`, unde
`factor = rate_eur × multiplier_pct / 100 / referință` (calculat din catalogul
curent, cu tarifele inactive incluse). Nu se scriu în
ledger (decizie: task-ul e sursa de adevăr pentru estimare, fără cron de
curățare). **Disponibil** = sold − rezervate (poate fi negativ; e doar
avertizare).

Fiecare coloană intră în `schema.ts` **doar după** ce migrarea ei e aplicată
pe remote (hazardul select-all). O instrucțiune SQL per fișier de migrare, fără
`IF NOT EXISTS`, cu grep pe nume înainte.

## 4. Modul Settings „Prețuri pe oră"

Ruta `settings/hourly-rates`, owner/admin, înregistrată în layout-ul Settings.

- **Specializări**: listă editabilă (label, €/h, ordine, activ). Slug-ul se
  generează la creare și nu se mai schimbă. Dezactivarea ascunde specializarea
  din `/servicii` și din formularul de task; task-urile deschise care o
  referă trec la Done normal (review Gemini).
- **Regimuri**: multiplicator, plafon ore, text SLA, activ.
- **Reguli credit**: tarif de referință (implicit „cel mai mic activ", cu
  valoarea afișată), prag „credit scăzut", pas minim, notificări on/off.
  Schimbarea referinței afectează doar alimentările și consumurile
  ulterioare; soldul existent nu se recalculează (rândurile poartă snapshot).

Un singur cititor: `getHourlyCatalog(tenantId)` în
`$lib/server/hourly-catalog.ts` → `{ rates, modes, settings }`. Îl folosesc
`servicii/catalog.server.ts`, `public-hours.remote.ts`,
`emit-keez-hours-invoice.ts`, `PackageComparisonDialog.svelte` (prin load) și
logica de task. `hours-pricing.ts` rămâne pură și primește catalogul ca
argument; testul golden rămâne, cu catalogul seed injectat. Constantele din
`ots-catalog.ts` rămân doar ca seed la prima citire a unui tenant; un test
verifică că seed-ul inserat e exact lista din constante.

Validări: `rate_eur` întreg 1..999; `multiplier_pct` 100..500; `max_hours`
1..500; nu se poate dezactiva ultima specializare activă; nu se poate
dezactiva regimul `standard`; nu se poate dezactiva specializarea aleasă
explicit ca referință.

## 5. Alimentarea creditului

Toate scrierile trec printr-o singură funcție server
`applyLedgerEntry(tx, entry)` care inserează în ledger și face
`UPDATE client SET hour_credit_minutes = hour_credit_minutes + :delta` în
aceeași tranzacție (`withTursoBusyRetry`). Conflictul pe indexul unic e tratat
ca „deja aplicat" (no-op, log info), nu ca eroare.

### 5.1 Facturi plătite (abonamente ținute în Keez)

Listener pe hook-ul existent `invoice.paid`. Se aplică `invoice_credit` cu
`source_type='invoice'`, `source_id=invoice.id` **doar dacă** toate condițiile
de mai jos sunt adevărate:

1. `client.hour_credit_from_invoices = true`;
2. `invoice.hosting_account_id IS NULL` (nu e hosting);
3. `invoice.external_source` nu e sursă de ads (`meta-ads`, `google-ads`,
   `tiktok-ads`) și nu e `hour-overage` (factura de depășire nu poate
   re-credita orele pe care le-a facturat);
4. factura nu e a unei comenzi de ore (`service_hours_order.invoice_id`);
   comenzile creditează prin §5.2, nu de două ori;
5. suma netă > 0.

Conversie: `net = invoice.subtotal` (fără TVA) în moneda facturii; RON → EUR
la cursul BNR al zilei plății (utilitarul BNR existent, `curs.bnr.ro`); EUR
rămâne; alte monede → nu se creditează, log error, iar factura apare în
Bugete ore în lista „Necreditate" cu motivul „monedă neacceptată" (adminul
creditează manual). `minute = round_to_step(net_eur / referință × 60)`. Snapshot pe rând:
sumă, monedă, curs, referință.

O factură = o creditare, oricâte evenimente sosesc (index unic). Lista
„Necreditate" din Bugete ore **nu e un tabel**, ci interogarea: facturi
`paid` ale clienților bifați, eligibile după regulile 2–5, fără rând
`invoice_credit` în ledger; fiecare apare cu motivul (curs BNR indisponibil,
monedă neacceptată, plătită înainte de bifare). Task-ul de scheduler (§9)
reia automat doar cazul „curs indisponibil"; celelalte se creditează manual
din aceeași listă, idempotent. Facturile plătite **înainte** de bifarea
clientului nu se creditează retroactiv fără acțiunea adminului.

Ordinea în listener: excluderile (2–4) sunt **primele verificări**, înaintea
oricărei citiri de client sau curs, astfel încât plata unei facturi
`hour-overage` nu poate ajunge niciodată la creditare. Plata unei facturi
`hour-overage` are un singur efect în modul: stinge badge-ul „depășire
neplătită" al clientului.

Anularea unei facturi creditate (status → `cancelled`) aplică
`invoice_credit_reversal` cu aceeași sursă și același număr de minute, dacă
evenimentul există în hook-uri; altfel adminul ajustează manual.

Abonamentul Lucky Studio rămâne exact cum e în Keez; singura configurare e
bifa pe client.

### 5.2 Ore cumpărate pe `/servicii`

În branch-ul webhook `stripe/hours-purchase.ts`, după marcarea comenzii ca
plătită și emiterea facturii Keez: `purchase` cu `source_type='hours_order'`,
`source_id=order.id`, `delta = round_to_step(net_cents / 100 / referință × 60)`
(deci 10 h Development la 65 € = 650 € = 11 h 49 min credit la referința 55 €,
consumate apoi ponderat; în ore reale de Development revin exact 10 h). Refund Stripe pe PaymentIntent-ul
comenzii → `purchase_reversal`, dacă webhook-ul de refund e tratat; altfel
manual.

Comenzile plătite **înainte** de lansare nu se creditează automat. În Bugete
ore există „Importă comenzile plătite necreditate" (owner/admin), care listează
comenzile `paid` fără rând `purchase` și le aplică la bifare. Idempotent prin
indexul unic.

### 5.3 Manual

Din cardul clientului și din drill-down-ul Bugete ore: `delta` (± în pas de
15 min), motiv obligatoriu (min 5 caractere). Doar owner/admin. `kind='manual'`,
`source_type='manual'`, `source_id = id-ul rândului`.

## 6. Task-uri, consum și depășire

### 6.1 Formular

Când task-ul are `client_id`: „Ore estimate" (input în ore cu zecimale, salvat
ca minute, multiplu de pas, maxim 999 h ca limită de sănătate), „Specializare"
(din catalog, active), „Regim" (implicit `standard`). `max_hours` al
regimului plafonează **doar comenzile publice** de pe `/servicii` (limita
unei singure plăți); pe task-uri nu se aplică, intenționat. Echivalentul
ponderat afișat („2 h Development = 2 h 22 min credit") și rezervările se
calculează **cu catalogul curent**, nu se îngheață la creare; dacă tariful se
schimbă între creare și Done, consumul real e cel de la Done. Ledger-ul
îngheață tariful doar la consum. Obligatorii dacă orele > 0; serverul respinge
`estimated_minutes` fără `client_id` sau fără `rate_slug`. Sub câmp: „2 h
Development = 2 h 22 min credit · Sold: Xh · Rezervate: Yh · Disponibil: Zh";
galben dacă estimarea ponderată > disponibil.
Nimic nu blochează crearea.

### 6.2 Trecerea în Done

Orice tranziție spre `done` (pagină, kanban, WhatsApp `/task`) a unui task cu
client și `estimated_minutes > 0` cere confirmarea orelor efective. În UI:
dialog precompletat cu estimarea. Prin WhatsApp: se folosește estimarea și se
notează „ore efective = estimare (confirmare automată)".

Se calculează `factor = rate_eur × multiplier_pct / 100 / referință` din
catalogul curent și `ponderat = ceil(actual × factor)`.

Într-o singură tranzacție:

1. `consum = min(ponderat, sold)` obținut prin **UPDATE atomic condiționat**:
   întâi `UPDATE client SET hour_credit_minutes = hour_credit_minutes - :ponderat
   WHERE id = :id AND hour_credit_minutes >= :ponderat`; dacă 0 rânduri, se
   citește soldul curent `s` și se face `UPDATE … SET hour_credit_minutes = 0
   WHERE id = :id AND hour_credit_minutes = :s` (retry la 0 rânduri). Așa două
   Done simultane nu pot consuma același minut (review Gemini + opencode).
2. Ledger `task_consumption` cu `delta = -consum`, `real_minutes = actual`,
   snapshot tarif/regim/referință.
3. `depășire_ponderată = ponderat - consum`; în ore reale:
   `depășire_reală = actual - consum / factor` (minute, rotunjit la pas în
   sus). Dacă > 0: linie în draftul lunar (§6.3) cu `depășire_reală` ore la
   tariful efectiv și ledger `overage_invoiced` (`delta 0`,
   `real_minutes = depășire_reală`, `source_id = task.id`).
4. `task.actual_minutes`, `task.credit_settled_at = now`,
   `task.overage_invoice_id` (dacă e cazul).

După commit (best-effort, în afara tranzacției): notificări (§8) și
verificarea pragului „credit scăzut".

Garda de drift: endpoint admin `_debug-hour-credits` care compară
`hour_credit_minutes` cu `SUM(delta_minutes)` per client și poate reconcilia.

### 6.3 Draftul lunar de depășire

O factură CRM obișnuită: `status='draft'`, `external_source='hour-overage'`,
`notes='hour-overage:YYYY-MM'`, `currency='EUR'`, o singură factură per
`(tenant, client, lună)` cu `status='draft'` și `keez_status IS NULL`. Luna =
luna calendaristică a datei Done, în `Europe/Bucharest`.

- Linia: „Depășire ore — {titlu task} ({specializare}, {regim})", cantitate =
  ore zecimale, preț unitar = `rate_eur × multiplier_pct / 100` (rotunjit la
  euro întreg, ca `effectiveRateEur`), în cents, TVA după `resolveVatPercent`
  (regulile intracom existente). Conversia RON se face la emitere, cu cursul
  BNR al zilei, prin emitentul Keez existent (antet RON + linii EUR).
  Cursul de la alimentare (ziua plății) și cel de la emiterea depășirii (ziua
  confirmării) diferă; abaterea e acceptată explicit, fiecare document își
  poartă propriul curs.
- Dacă draftul lunii nu mai e `draft` sau are deja `keez_status` (a fost
  confirmat sau e în trimitere), depășirea deschide draftul **lunii următoare**
  (review Gemini). Nu se scrie niciodată pe o factură ieșită din `draft`.
- Adminul confirmă draftul din Facturi ca pe orice factură; abia atunci pleacă
  în Keez. Nimic nu se emite automat.
- Liniile draftului `hour-overage` sunt **gestionate doar de sistem**: UI-ul
  și remote-urile de facturi refuză editarea sau ștergerea individuală a
  liniilor pe facturile cu `external_source='hour-overage'` (review Gemini:
  altfel `task.overage_invoice_id` rămâne orfan). Adminul poate doar să șteargă
  întregul draft; ștergerea golește `task.overage_invoice_id` pe toate
  task-urile legate prin `invoice_line_item.task_id`, iar ele apar în Bugete
  ore ca „depășire nefacturată" cu buton „Regenerează draftul".

### 6.4 Reopen, cancel, ștergere

- **Reopen din Done** (task cu `credit_settled_at`): permis doar dacă
  `overage_invoice_id` e null sau factura e încă `draft`. Aplică
  `task_reversal` (`+consum`), șterge linia din draft (și draftul dacă rămâne
  gol), golește `actual_minutes`, `credit_settled_at`, `overage_invoice_id`.
  Estimarea redevine rezervare. Rândurile `overage_invoiced` **nu se șterg
  și nu se stornează**: ledger-ul e append-only, iar ele sunt doar urmă
  (delta 0); un task poate avea mai multe, câte un Done. Starea „facturat /
  nefacturat" se citește exclusiv din `task.overage_invoice_id` și din
  `invoice_line_item.task_id`, niciodată din aceste rânduri.
- **Reopen după emitere fiscală**: refuzat cu mesaj clar; butonul „Creează task
  de continuare" clonează titlul/clientul/specializarea într-un task nou cu
  `continuation_of_task_id`.
- **Cancel**: nimic în ledger; rezervarea dispare prin status. Un task deja
  `done` nu se anulează direct (întâi reopen, dacă e permis).
- **Ștergere**: blocată dacă există rânduri în ledger pentru task (mesaj:
  „are consum înregistrat"). Altfel liber.
- **Editarea orelor efective** după Done: doar prin reopen → Done.
- **Editarea estimării** pe task deschis: liberă; e doar rezervare.

## 7. Pagini admin

### 7.1 „Bugete ore" (meniu principal, `/hour-credits`)

Tabel per client (doar clienții bifați pentru alimentare din facturi, cu sold
≠ 0, cu rezervări sau cu depășiri): sold, rezervate, disponibil, consum luna
curentă, alimentare din facturi (da/nu, data și suma ultimei creditări),
depășiri nefacturate (ore reale),
depășiri în draft (€), depășiri neplătite (€, badge roșu), badge „sub prag".
Filtre: doar clienți bifați, sub prag, cu depășiri. Sortare pe sold/disponibil.
Buton Refresh manual; fără polling. Acțiuni owner/admin: „Importă comenzile
plătite necreditate", „Importă facturile plătite necreditate", „Regenerează
draftul".

Drill-down `/hour-credits/[clientId]`: sold + rezervate + disponibil, ledger
paginat (dată, tip, delta, sursă cu link spre task/factură/comandă, cine,
notă), formular de ajustare manuală (owner/admin), lista task-urilor deschise
cu rezervări.

### 7.2 Panoul clientului

Card „Credit timp": sold, rezervate, disponibil, ultima mișcare, link spre
drill-down. Cardul existent „Remaining Credit" (facturi neplătite) rămâne
neatins.

Toate remote-urile cer `requireStaff`; ajustările verifică owner/admin. Datele
sunt scoped pe `locals.tenant`.

## 8. Portal client și notificări (faza 4)

- Categorie nouă `hourCredits` în `ACCESS_CATEGORIES` (`portal-access.ts`) și
  în oglinda client-side din `team.ts`, plus restul celor 6 locuri din
  checklist-ul de acces portal, în același commit. Pagină în portal: sold/rezervate/disponibil
  + istoric (fără ajustări, fără nume de useri interni).
- **Email** (template + `demo-hour-credit-email.ts`): credit scăzut (o singură
  dată la trecerea sub prag; se reînarmează după ce soldul urcă peste prag),
  consum la Done („Task X: N h, sold rămas M h"), alimentare (factură plătită sau
  cumpărare). Link spre `/servicii` pentru cumpărare.
- **WhatsApp**: aceleași trei evenimente, în grupul legat de task/client, prin
  `task-notifications.ts` și outbox-ul existent (politica de rate a
  outbox-ului rămâne cea de azi). Fără grup legat = fără mesaj.
- Toate notificările pleacă **după** commit și nu blochează tranzacția
  (review opencode: hook-urile nu sunt atomice cu ledger-ul, deci ledger-ul
  e singurul adevăr, notificarea e best-effort).

## 9. Erori și cazuri limită

| Caz | Comportament |
|---|---|
| `invoice.paid` livrat de 2 ori | al doilea = no-op prin indexul unic |
| Webhook Stripe reluat | idem |
| Done simultan pe același client | UPDATE atomic condiționat; nici un minut consumat de două ori |
| Specializare dezactivată pe task deschis | Done trece; catalogul se citește cu `includeInactive` la valorizare |
| Task fără client dar cu ore | respins pe server |
| Client nebifat, factură plătită | nimic; apare în Bugete ore doar dacă are ore din alte surse |
| Client bifat, factură de hosting / ads / depășire / comandă de ore plătită | exclusă explicit; log info cu motivul |
| Factură în altă monedă decât RON/EUR | nu se creditează; log error; ajustare manuală |
| Curs BNR indisponibil la plată | nu se scrie nimic în ledger; task nou în scheduler-ul existent (`src/lib/server/scheduler`), rulat orar, reia facturile eligibile plătite în ultimele 30 de zile fără rând `invoice_credit`; lista „Necreditate" din Bugete ore arată motivul |
| Draft lunar confirmat în timp ce alt Done adaugă linie | linia merge pe luna următoare |
| Reopen după emitere fiscală | refuzat; task de continuare |
| Sold cache ≠ sumă ledger | endpoint de reconciliere; log error |

## 10. Testare

- Logică pură (`$lib/logic/hour-credits.ts`): split consum/depășire, prag,
  rotunjire pas 15, valorizare linie; golden pe catalogul seed.
- Ledger: idempotență (același eveniment de 2 ori → un rând), reversal,
  manual cu `source_id` propriu.
- Tranzacția Done: sold suficient, insuficient, zero, două Done concurente
  (simulare prin UPDATE condiționat).
- Hook `invoice.paid`: client bifat/nebifat, fiecare excludere (hosting, ads,
  depășire, comandă de ore), RON cu curs, EUR, altă monedă.
- Ponderare: factor per specializare/regim, rotunjiri, depășire reală vs
  ponderată (golden).
- Draft lunar: creare, reutilizare, „lună următoare" când e confirmat, ștergere
  linie la reopen.
- Settings: validări, seed vs DB.
- Toate cu `bun run test` (proces per fișier), niciodată `bun test`.

## 11. Fazare (fiecare fază = plan, PR și deploy propriu)

1. **F1 — Prețuri pe oră în Settings**: tabelele `hourly_rate`,
   `hourly_rate_mode`, `hour_credit_settings`; seed **lazy** în
   `getHourlyCatalog`: un tenant fără rânduri primește constantele la prima
   citire, idempotent prin indexul unic + `onConflictDoNothing` (acoperă și
   tenanții existenți la deploy, și tenanții noi, fără migrare de date); pagina Settings;
   `getHourlyCatalog`; `/servicii`, comanda de ore și emitentul Keez citesc
   din DB. Rezultat vizibil: aceleași prețuri, dar editabile.
2. **F2 — Ledger și alimentări**: `client_hour_ledger`,
   `client.hour_credit_minutes`, `client.hour_credit_from_invoices`; listener
   `invoice.paid` cu excluderi și conversie BNR; creditare la `hours_purchase`;
   import facturi/comenzi vechi; ajustare manuală; pagina „Bugete ore" (fără
   coloanele de task) + card „Credit timp" + bifa în editarea clientului.
3. **F3 — Task-uri și depășire**: coloanele pe `task`; formular; dialog Done;
   tranzacția de consum; draft lunar; reopen/cancel/ștergere; coloanele de
   rezervări și depășiri în Bugete ore; garda de drift.
4. **F4 — Portal și notificări**: categorie de acces, pagină portal, email +
   WhatsApp.

## 12. În afara scopului

Time tracking cu cronometru, pontaj pe zile, storno/notă de credit în Keez,
bazine per specializare, expirarea orelor, discount pe pachete de ore,
cumpărarea de ore din portal (rămâne pe `/servicii`), abonamente cu ore
incluse definite în CRM (abonamentele rămân în Keez).
