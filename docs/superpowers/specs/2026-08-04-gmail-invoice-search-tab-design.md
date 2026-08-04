# Tab „Căutare Gmail" pentru facturi furnizori + algoritm de match cu plățile + fixuri parsare

**Data:** 2026-08-04
**Pagina:** `/ots/banking/supplier-invoices`
**Scop:** fluxul lunar „Documente Lipsa" din Keez — găsirea facturilor plătite (Hetzner, Google, DirectAdmin, LiteSpeed, Cursor, INWX, Claude etc.) în Gmail, descărcarea lor (individual sau ZIP) și urcarea manuală în Keez.

## Context

- Lista existentă de facturi importate are deja checkbox-uri, „Descarcă selecția" (ZIP) și filtre — rămâne neatinsă.
- Fluxul de import Gmail există (`/supplier-invoices/import`), dar creează înregistrări în CRM; utilizatorul vrea căutare + descărcare directă, fără import prealabil.
- Keez exportă „Documente Lipsa" ca XLSX (`MissingDocuments.xlsx`) cu coloanele: Tip, Referinta, Data (serial Excel), Partener, Valoare, Valuta, Comentariu (descrierea completă BT), IBAN.
- **Atenție valute:** coloana „Valoare" din export e mereu în RON (contul e în lei), dar facturile din email sunt adesea în EUR/USD. Suma și valuta reală a plății se extrag din „Comentariu": `valoare tranzactie: 16.20 EUR`, `29.00 USD`, `90.45 RON`.

## 1. UI — tab nou pe pagina existentă

`+page.svelte` primește un tab bar cu două taburi:

- **„Facturi importate"** — tabelul actual, neschimbat.
- **„Căutare Gmail"** — componentă nouă în fișier separat (`GmailSearchTab.svelte` sau echivalent, colocat cu ruta).

Tabul „Căutare Gmail" are două moduri:

### Mod A (principal): Upload „Documente Lipsa"
1. Utilizatorul încarcă XLSX-ul exportat din Keez (drag & drop sau file picker). Parsare client-side sau server-side cu `xlsx` (deja în dependencies).
2. Se rețin doar rândurile `Plati fara document`. Rândurile `Incasari fara document` (ex. Stripe) se afișează ca ignorate, cu explicație.
3. Pentru fiecare plată: extragere comerciant + sumă/valută originală din Comentariu, căutare în Gmail, rulare algoritm de match.
4. Tabel rezultat: o linie per plată — Referință Keez, Data, Comerciant, Sumă originală (ex. „180,04 EUR"), Sumă RON, factură găsită (expeditor, subiect, atașament, scor match), badge-uri.
5. Checkbox per rând + „Selectează tot (doar match sigur)" + descărcare individuală sau „Descarcă selecția (ZIP)".

### Mod B: Căutare liberă
- Interval de date (implicit ultimele 30 de zile) + chips furnizori + adrese custom.
- Rezultate: emailuri cu atașamente PDF, checkbox per rând, badge „Importată" (există în `supplier_invoice`) și „Descărcată" (există în evidență).
- Filtru „doar nedescărcate".

## 2. Căutare Gmail

- Comandă remote nouă în `supplier-invoices.remote.ts` (toate cu `requireStaff` — regula F8).
- Query Gmail: `from:(...) has:attachment filename:pdf` + `after:`/`before:`, construit cu `buildSearchQuery()` existent.
- Expeditori: parserele existente + **3 parsere noi: `directadmin`, `cursor` (Anysphere), `inwx`** + adresele custom din `gmailIntegration.customMonitoredEmails` (câmp existent), editabile din UI-ul tabului.
- Detectarea „plătită" din email nu e fiabilă și nu e necesară: pentru acești furnizori (plăți cu card) factura sosește după plată; fereastra de date + match-ul cu plățile acoperă cerința.

## 3. Algoritm de match plată ↔ factură

### Extragere din plată (rând XLSX sau `bank_transaction`)
- **Suma și valuta originală** din Comentariu: regex pe `valoare tranzactie:\s*([\d.,]+)\s*(RON|EUR|USD|GBP)` și varianta `valoare trz:`. Aceasta e cheia principală de match — NU coloana Valoare (RON).
- **Comerciant**: tokenul dintre TID și telefon/țară în descrierea EPOS (ex. `HETZNER ONLINE GMBH`, `DIRECTADMIN.COM`, `* CLAUDE SUB`, `WWW.INWX.DE`, `MPY*KESSELRING SRL`, `MPY*fidasolutions`, `CURSOR, AI POWERED IDE`), plus `Partener` când există.
- **Data plății** din coloana Data (serial Excel → dată; parsare cu `raw: true`).

### Candidați
Facturi/emailuri cu data în fereastra **−3…+10 zile** față de data plății (factura poate preceda sau urma decontarea; Google emite la începutul lunii pentru plata pe 1).

### Scor
| Semnal | Punctaj |
|---|---|
| Sumă + valută originală identice cu suma facturii | +60 |
| Sumă în toleranță ≤2% (FX/rotunjiri), aceeași valută | +40 |
| Comerciant ↔ furnizor prin tabel de aliasuri | +30 |
| Proximitate dată (decay liniar 0–10 zile) | +10 → 0 |

Aliasuri (în cod, extensibil): `hetzner→[HETZNER]`, `google→[GOOGLE CLOUD, GOOGLE WORKSPACE, GOOGLE*]`, `directadmin→[DIRECTADMIN]`, `litespeed→[LITESPEED]`, `anthropic→[CLAUDE SUB, ANTHROPIC]`, `cursor→[CURSOR, ANYSPHERE]`, `inwx→[INWX]`, `openai→[OPENAI, CHATGPT]`, `rotld→[ROTLD, ICI]`.

### Praguri
- **≥70 ȘI potrivire de comerciant — match sigur** (verde): pre-bifat la „Selectează tot". Condiția de comerciant e obligatorie: suma exactă (+60) plus aceeași zi (+10) ating singure 70, iar la abonamente recurente cu aceeași sumă (două plăți de 29,00 USD într-o lună) asta ar eticheta drept „sigură" factura altui furnizor. Un match doar pe sumă rămâne „probabil" și îl confirmi tu.
- **40–69 — probabil** (galben): utilizatorul confirmă manual.
- **<40 — negăsit** (gri): plata rămâne evidențiată ca fără document, cu buton „Caută manual" (deschide Mod B pre-populat cu fereastra de date).

O factură se poate atașa unei singure plăți (asignare greedy după scor descrescător; la egalitate câștigă proximitatea de dată).

## 4. Descărcare

- Atașamentele se iau **live din Gmail la momentul descărcării** — `attachmentId`-urile Gmail sunt efemere (regulă cunoscută): refetch prin `getEmail` propriu + index atașament, niciodată id persistat.
- Endpoint nou per-atașament (GET, `messageId` + index) cu `Content-Disposition` cu filename sanitizat.
- Endpoint nou ZIP (POST, listă `messageId`) — arhivează atașamentele PDF; în Mod A numele fișierelor includ referința Keez și comerciantul (ex. `12326_HETZNER_180.04EUR.pdf`) pentru urcare ușoară în Keez.
- Emailurile care nu mai există / fără PDF se sar și se raportează; ZIP-ul iese cu restul.

## 5. Evidență descărcări

Tabel nou `gmail_invoice_download`:
`id, tenant_id, gmail_message_id, attachment_filename, bank_reference (Referinta Keez, nullable), downloaded_at, downloaded_by_user_id`.

- Scris (upsert) la fiecare descărcare reușită (individuală sau din ZIP).
- Alimentează badge-ul „Descărcată" și filtrul „doar nedescărcate".
- Migrare hand-authored sau `db:gen`, **un singur statement per fișier** (regula Turso), verificată pe remote cu `PRAGMA table_info`.

## 6. Fixuri parsare (buguri confirmate pe facturi reale)

1. **Nr. factură „available" (INWX)** — regexul `invoice\s*#?\s*([\w-]+)` capturează cuvinte din subiect („New Invoice available"). Fix: blacklist (available, ready, attached, enclosed, notification...) + prioritate pe numărul din PDF („Document number: 2026068392", „Nr. 453940").
2. **Sumă greșită** — `pdf-parser.ts` prinde „Total 62,91" (net) în loc de „Total de plată (TVA inclus) 76,12" (ROTLD) și „1.00" (cantitate) în loc de „Total with VAT: 9,50 €" (INWX). Fix: prioritate pattern-uri „total de plată / total with VAT / gesamtbetrag / grand total" peste „total" simplu; ignorarea numerelor din coloane de cantitate.
3. **Valută default USD** — `parsed.currency || 'USD'` la import. Fix: detecție din context PDF (antet „- RON -", simbol €, „TVA"/„VAT xx%" cu RON) și **fără fallback USD** — mai bine câmp gol decât valută greșită.
4. **Status „În așteptare" deși plătită** — `detectStatus` nu rulează pe textul PDF; lipsesc cuvintele-cheie. Fix: status și din PDF; adăugare „achitat", „amount received", „prepayment".

Fixurile repară și afișarea listei existente de facturi importate.

## 7. Testare

- Fixture-uri din facturile reale: ROTLD (RON, net vs total, „Achitat cu (RRN)"), INWX (EUR, „available", cantitate 1.00), pe pattern-ul `gmail/__tests__`.
- Fixture XLSX cu rândurile reale din MissingDocuments (Hetzner 180,04 EUR, DirectAdmin 29 USD, Claude 211,56 EUR, LiteSpeed 36 USD, Google 16,20 EUR, Kesselring 81,09 RON, fidasolutions 8 RON, INWX 51,81 RON) — teste pentru extragerea comerciant/sumă/valută și pentru scorul de match, inclusiv cazul „plata în RON, factura în EUR/USD".
- Teste parsere noi (directadmin, cursor, inwx): match pe expeditor + query de căutare.
- Test evidență: descărcarea scrie în `gmail_invoice_download`; badge-ul reflectă starea.
- `svelte-autofixer` pe componentele noi/modificate; build check înainte de finalizare.

## Din scop (explicit)

- Fără upload automat în Keez (utilizatorul urcă manual).
- Fără import automat în CRM din tabul de căutare (importul rămâne fluxul separat existent).
- Fără procesarea încasărilor („Incasari fara document").
