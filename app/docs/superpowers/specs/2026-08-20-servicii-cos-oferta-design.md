# /servicii — coș de servicii și cerere de ofertă în 3 pași

**Data:** 2026-08-20 · **Branch:** `feat/wizard-public` · **Stare:** aprobat (3 decizii confirmate de user)

## Problema

Pe pagina publică `/servicii`, butonul de pe un tier („Cere ofertă Bronze") deschide
direct formularul de contact pentru **un singur serviciu**. Pagina promite însă
discount la combinarea mai multor servicii (2 → 10 %, 3 → 15 %, 4+ → 20 %), iar
vizitatorul nu are cum să aleagă mai multe pachete într-o singură cerere.
Configuratorul are același defect: trimite bundle-ul ca „pivot + restul în notă".

## Soluția

Coș de servicii pe pagină + modal în 3 pași, pe aceeași coajă vizuală ca
checkout-ul din `/pachete-hosting`, dar cu „Solicită oferta" în loc de plată.

### Decizii confirmate

1. **Tier diferit per serviciu** — fiecare serviciu din coș are propriul tier
   (Google Ads Gold + SEO Bronze e valid). Un singur tier per serviciu.
2. **Pasul 1 = alegerea serviciilor**, fără câmp „Website" (vizitatorul îl poate
   scrie în „Detalii despre proiect").
3. **Configuratorul trece prin același coș + modal**; `RequestQuoteDialog.svelte`
   dispare.

## Fluxul pe pagină (`ServicesCatalog.svelte`)

1. Cardul unei categorii → `PackageComparisonView` (ca acum). Butonul pe tier
   devine **„Adaugă {tier}"**; dacă acel tier e deja în coș → **„În ofertă ✓"**
   (click = scoate din coș); alt tier → înlocuiește tier-ul serviciului. La
   adăugare, comparația se închide și bara de coș confirmă vizual.
2. **Bară sticky jos** (apare când coșul are ≥ 1 serviciu):
   „2 servicii · 1.200 €/lună · −10 % → 1.080 €/lună" + buton **„Solicită oferta"**
   + buton „Golește". În nav, link „Oferta mea (2)" care deschide același modal.
3. Coșul persistă în **`sessionStorage`** (cheie `ots-servicii-cart`, v1) ca să
   supraviețuiască navigării `/servicii` ↔ `/servicii/configurator`. La citire,
   intrările cu slug/tier necunoscute în catalog se ignoră.

## Modalul (`ServicesQuoteModal.svelte`)

Pe `checkout-modal-shell.svelte` (topbar + corp derulabil + footer fix, focus-trap).
Coaja primește două props noi, opționale: `badgeText` (implicit „Plată securizată ·
SSL 256-bit") și `ariaLabel` (implicit „Plată cu cardul") — aici: „Cerere fără
obligații" / „Cerere de ofertă". Stepper-ul și layoutul conținut + sumar se copiază
ca stiluri locale din `hosting-checkout-modal.svelte` (acolo sunt `:global(.co-*)`
într-un fișier de 3.500 de linii; nu le importăm).

- **Pas 1 · Servicii** — lista din coș: icon + nume + selector de tier (segmented
  Bronze/Silver/Gold/Platinum, doar tier-urile cu preț sau setup definite) + preț +
  „Șterge". Sub listă, **„+ Adaugă serviciu"**: categoriile care nu sunt în coș, cu
  un click se adaugă la tier-ul implicit (Silver dacă există, altfel primul tier
  cu preț). Footer: „Continuă" (dezactivat când coșul e gol, cu mesajul
  „Alege cel puțin un serviciu.").
- **Pas 2 · Date contact** — Nume și prenume*, Email*, Telefon, Companie, Detalii
  despre proiect (textarea, preîncărcat cu nota wizardului când vine din
  configurator). Validare client (nume ≥ 2, email valid) înainte de „Continuă".
- **Pas 3 · Solicită oferta** — recapitulare (servicii + tier + contact), textul de
  consimțământ existent, buton **„Trimite cererea de ofertă"**. După succes:
  ecran de confirmare (fără stepper), coșul se golește, „Închide".
- **Sumar (dreapta, pașii 1–3)** — o linie per serviciu (nume, tier, €/lună sau
  „setup one-time"), „Subtotal lunar", „Discount N servicii −X %" (doar dacă ≥ 2
  servicii și discount > 0), **„Total lunar estimat"**, „Setup one-time" (sumă,
  dacă există), notă „EUR fără TVA. Bugetul media și platformele externe se
  plătesc separat." Pe mobil, sumarul trece sub conținut.
- **Stări**: trimitere (butoane dezactivate, „Se trimite..."), eroare server (mesaj
  `role="alert"` sub recapitulare, se poate reîncerca), 403 (sesiune expirată →
  mesaj cu „Reîncarcă pagina"), 429 (text din server).

## Logica coșului (`services-cart.svelte.ts` + `quote-pricing.ts`)

- `services-cart.svelte.ts` — clasă `ServicesCart` cu `$state` pentru
  `items: { categorySlug, tier }[]`; metode `set(slug, tier)` (adaugă sau înlocuiește
  tier-ul), `remove(slug)`, `toggle(slug, tier)`, `clear()`, `has(slug, tier?)`,
  `load()/persist()` pe `sessionStorage` (doar în browser, tolerant la JSON stricat).
- `quote-pricing.ts` (pur, fără import de prețuri — primește categoriile prin
  argument): `computeQuoteSummary(items, categories, discountRules)` →
  `{ lines, serviceCount, monthlySubtotal, discountPct, monthlyDiscount,
  monthlyTotal, setupTotal }`. Regula de discount e aceeași cu
  `discountForServiceCount` din `wizard-engine` (cea mai mare regulă cu
  `minServices ≤ count`); numărul de servicii include și cele setup-only, dar
  discountul se aplică doar pe suma lunară. Rotunjire la întreg, ca în
  `calculateCost`.

## Backend

### Migrație (aditivă; DB dev = DB prod → ajunge direct pe prod, sigur)

- `0452_service_package_request_items.sql`: `ALTER TABLE service_package_request ADD items text;`
- `0453_service_package_request_discount_pct.sql`: `ALTER TABLE service_package_request ADD discount_pct integer;`
- Un statement per fișier (Turso), intrări în `meta/_journal.json` (idx 452, 453).
- Schema Drizzle se modifică **după** aplicarea migrației (hazard `select()` fără
  coloană).

### `submitPublicQuoteRequest` (în `public-services.remote.ts`)

- Input: `items: [{ categorySlug, tier }]` (1–12, slug-uri distincte, tier din
  `TIERS`), `contactName`, `contactEmail`, `contactPhone?`, `companyName?`, `note?`.
- Protecții identice cu `submitPublicPackageRequest`: cookie-ul porții (403),
  rate-limit Redis per IP (`public-services-request`, aceeași găleată), validare pe
  catalog (slug necunoscut sau tier fără preț și fără setup → 400), tenant din
  `resolvePublicTenantId`, `clientId = null`.
- Un singur rând `service_package_request`: `categorySlug`/`tier` = primul item
  (pivot, compatibil cu admin/email/portal), `services` = JSON slug-uri (**și pentru
  un singur serviciu**, ca să fie uniform), `bundleId = null`, `items` = JSON
  `[{ categorySlug, tier, monthlyEur, setupEur }]` (snapshot de preț — prețurile
  se schimbă în timp), `discountPct` = din aceleași reguli, calculat pe server.
- Returnează `{ success: true, requestId }`. Notificare admin fire-and-forget.
- `submitPublicPackageRequest` rămâne (portalul nu-l folosește, dar testele da) —
  se marchează `@deprecated` și se șterge în alt PR după ce UI-ul nu-l mai apelează.

### Admin (`[tenant]/services/+page.svelte`) și email (`sendPackageRequestEmail`)

- `getPackageRequests` returnează și `items` (parsat) + `discountPct`.
- Card cerere: când `items` există → titlu „Ofertă {N} servicii", badge „Ofertă"
  (în loc de „Bundle"), și listă per serviciu cu tier-ul propriu (chip colorat) și
  prețul snapshot; discountul „−X %" dacă > 0. Fără `items` → afișarea de azi.
- Email: când `items` există, secțiunea „Servicii incluse" listează
  „Nume — Tier (€/lună)" per linie + „Discount −X %" + „Total lunar estimat";
  subiectul devine „Cerere ofertă nouă — N servicii" pentru ofertele multi-serviciu.

## Configuratorul (`/servicii/configurator/+page.svelte`)

`onRequest(rec, note)` → `cart.clear()`, `cart.set(slug, rec.tier)` pentru fiecare
serviciu din bundle, nota wizardului devine valoarea inițială a „Detalii despre
proiect", modalul se deschide la **pasul 1** (ca vizitatorul să poată ajusta).
Pagina configuratorului are și ea bara de coș? **Nu** — acolo modalul se deschide
doar din recomandare; coșul e partajat prin `sessionStorage`, deci întoarcerea
pe `/servicii` arată bara cu serviciile alese.

## Testare

- `quote-pricing.test.ts`: 1 serviciu (fără discount), 2/3/4 servicii (10/15/20),
  setup-only nu intră în suma lunară dar contează la număr, tier fără preț → 0,
  rotunjire.
- `services-cart.test.ts`: set/replace/remove/toggle/clear, persist/load, intrări
  invalide ignorate, fără `window` nu crapă.
- `public-services.remote.test.ts`: cazuri noi pentru `submitPublicQuoteRequest`
  — rând unic cu `items`/`services`/`discountPct` corecte, pivot = primul item,
  slug necunoscut 400, duplicat 400, tier invalid pentru categorie 400, gol 400,
  403 poartă, 429 rate-limit, 500 la insert, email lowercase, notificare.
- `no-price-leak.test.ts` rămâne verde (componentele noi nu importă `ots-catalog`
  decât `import type`).
- Browser (testermcp): golden path catalog → 2 servicii → modal → trimite;
  configurator → recomandare → modal cu nota; reload păstrează coșul; mobil 390px.

## În afara scopului

- Cont/Autentificare pentru vizitator, plată, salvarea ofertei ca document.
- Refactorizarea `hosting-checkout-modal.svelte` pe coaja partajată.
- Ștergerea `submitPublicPackageRequest` (PR separat).
