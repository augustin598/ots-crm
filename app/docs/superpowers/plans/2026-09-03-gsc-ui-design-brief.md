# Brief de design — UI pentru Google Search Console (OTS CRM)

> Prompt de dat lui Claude Design. Backendul e deja implementat și testat; designul
> trebuie să consume **exact** datele de mai jos, fără să inventeze câmpuri.

---

## Ce e de proiectat

Două livrabile, în același limbaj vizual:

1. **Pagină nouă** sub hub-ul „SEO & GEO & AEO": `/[tenant]/seo-links/search-console`
   — administrarea integrării: conectare, ce proprietăți avem, care proiect e legat de
   care proprietate, sincronizare, sănătatea integrării.
2. **Adăugiri în Rank Tracker** — în pagina de detaliu a unui proiect
   (`/[tenant]/seo-links/rank-tracker/[projectId]`) și, opțional, un indicator pe
   cardurile de proiect din hub.

## Contextul de business (de ce există ecranul ăsta)

Pe 2 septembrie 2026, proiectul heylux.ro arăta „30+" la toate cele 26 de cuvinte
cheie — ceea ce citea ca o prăbușire catastrofală de poziții. În realitate **toate
cele 4 rulări de scraping fuseseră blocate de Google**, deci nu exista nicio
măsurătoare; în același timp, snapshotul reușit al altui proiect arăta heylux.ro pe
**poziția 8**. Un client putea fi anunțat că „a picat din Google" pe baza unui
grafic care nu măsurase nimic.

Search Console e API oficial, gratuit, care **nu poate fi blocat**. Rolul lui aici nu e
să înlocuiască scrapingul, ci să fie **martorul care ne prinde pe noi când mințim**.

Designul trebuie să facă vizibilă exact distincția asta. Ierarhia informației:
1. „Măsurătoarea noastră e nesigură" — cel mai important lucru de pe ecran.
2. Cifrele reale de la Google (afișări, clicuri, CTR, poziție medie).
3. Administrare (conectare, mapare proprietăți).

## Reguli de casă, obligatorii

- **Fără breadcrumb.** Layout-ul `[tenant]` are deja unul; designul NU trebuie să
  conțină `cl-crumbs` — ar apărea dublat. (Greșeală făcută deja o dată.)
- **Vocabular existent**: tokenii `--cl-*` și clasele `cl-*` / `psi-*` din
  `pagespeed.css`, plus `rt-*` din `rank-tracker.css`. Clase noi doar cu prefix `gsc-`.
- **Modalele și drawerele se randează ÎN interiorul `.cl-wrap`** — tokenii `--cl-*`
  sunt definiți pe `.cl-wrap` și nu cascadează la frați.
- **Dark mode**: culorile hard-codate au nevoie de override `.dark .clasa { … }`,
  grupate la finalul fișierului CSS. NU folosi `:global(.dark)` (invalid în CSS simplu).
- **Fără auto-polling** (fără `setInterval`) — buton de refresh manual.
- Livrabil: HTML + CSS de sine stătător, ca la portul anterior de Rank Tracker.

---

## Datele care EXISTĂ deja (consumă-le exact așa)

### Starea integrării — `getGscStatus()`
```ts
{ connected: false }
// sau
{ connected: true, email: string, isActive: boolean,
  lastSyncAt: Date | null, lastError: string | null }
```

### Proprietățile disponibile — `getGscProperties()`
```ts
string[]  // ex: ['sc-domain:heylux.ro', 'https://www.heylux.ro/', 'sc-domain:preziosa.ro']
```
**Atenție de design:** `sc-domain:heylux.ro` (domain property) și
`https://www.heylux.ro/` (URL prefix) sunt proprietăți **DIFERITE, cu date diferite**.
Utilizatorul trebuie să aleagă din listă, niciodată să scrie/ghicească. Formatul e
tehnic și urât — designul trebuie să-l facă lizibil (etichetă „domeniu întreg" vs
„doar acest prefix") fără să ascundă string-ul real.

### Legarea proprietății de proiect — `setGscProperty({ projectId, property })`
`property: null` = dezlegare.

### Sincronizare manuală — `runGscPullNow()`
```ts
{ tenants: number, properties: number, rowsSaved: number, failed: number }
```

### Conectarea (OAuth)
Link simplu către `/api/gsc/auth?tenant=<slug>`. Google redirectează înapoi la
`/[tenant]/seo-links/rank-tracker?gsc=connected` sau `?gsc_error=<mesaj>`.
**Designul trebuie să propună unde aterizează după conectare** — probabil pe pagina
nouă, nu în Rank Tracker (destinația se poate schimba în cod).

### Sonda de sănătate — `GET /[tenant]/api/_debug-gsc-health?probe=1`
```ts
{ connected, isActive, email, lastSyncAt, lastError,
  activeProjects, projectsWithProperty,
  probe?: { ok: true, durationMs, properties: string[], probedProperty, window, rowCount }
        | { ok: false, durationMs?, error: string, hint?: string } }
```
`hint` apare când API-ul e dezactivat în Google Cloud. **Asta e capcana clasică**:
OAuth arată „connected" iar totul pare în regulă, dar fiecare apel dă 403. S-a
întâmplat deja la Google Calendar. Designul are nevoie de un loc unde starea asta se
vede fără să sapi în JSON.

### Per cuvânt cheie (deja în read model, `RankKeywordDetail.gsc`)
```ts
gsc: {
  date: string;          // ziua GSC, „2026-09-01" — ORA PACIFICULUI, nu Bucureștiului
  clicks: number;
  impressions: number;
  ctr: number;           // 0–100
  position: number;      // poziție medie, o zecimală
  trust: 'ok' | 'divergent' | 'scrape-missing';
} | null
```

**`trust` e inima funcționalității:**
- `scrape-missing` → **badge roșu „nemăsurat"**. Noi n-am găsit site-ul, Google
  raportează afișări. Datele NOASTRE sunt greșite, nu pozițiile clientului.
- `divergent` → **badge ambru „divergent"**. Diferență ≥10 poziții față de media GSC.
- `ok` → fără badge.

### Proiectele existente (date reale, pentru mockup)
| Nume | Domeniu | Cuvinte | Proprietate legată |
|---|---|---|---|
| Lucky Studio | heylux.ro | 26 | — |
| Preziosa | preziosa.ro | 26 | — |
| Lucky Studio Videochat | luckystudio.ro | 26 | — |

---

## Ce NU există (nu inventa; dacă designul le cere, spune explicit)

- **Niciun competitor în GSC.** Tot panoul „Competitori pe acest cuvânt" e invizibil
  acolo. Nu proiecta comparații de competitori cu date GSC.
- **Poziția GSC nu e comparabilă direct** cu cea scrapată: e mediată peste dispozitive,
  locații și pagini. **NU proiecta niciun ecran care le contopește într-un singur
  număr sau într-o singură linie de grafic.** Coloane separate, întotdeauna.
- **Datele au ~2 zile întârziere**, iar ultimele 2-3 zile sunt parțiale și Google le
  rescrie retroactiv. Designul trebuie să comunice asta, altfel userul crede că
  cifrele de azi sunt greșite.
- **Un contor „cuvinte nemăsurate" la nivel de tenant** ar fi cea mai valoroasă
  informație de pe pagina nouă, dar **azi nu există interogare pentru el** — ar
  însemna backend nou. Proiectează-l dacă merită, dar marchează-l explicit ca
  „necesită backend nou", ca să știm ce costă.
- Nu există istoric GSC în UI (grafic pe zile). Datele zilnice sunt în DB
  (`rank_gsc_daily`, 7 zile retrase la fiecare rulare), dar read model-ul expune azi
  **doar ultima zi** per (cuvânt, dispozitiv). Un grafic ar cere backend nou.

---

## Întrebările la care vreau răspuns prin design

1. **Unde stă adevărul despre „nemăsurat"?** Badge-ul per rând există deja. Merită un
   rezumat la nivel de proiect („7 din 26 de cuvinte nemăsurate — rulările au fost
   blocate")? Unde — în antetul proiectului, în pagina nouă, în ambele?
2. **Cum arată maparea proiect → proprietate** când sunt 3 proiecte și 6 proprietăți,
   dintre care unele domain și unele URL-prefix? Tabel cu dropdown pe rând? Card per
   proiect?
3. **Starea „conectat dar API dezactivat"** — cum o arăți fără să sperii degeaba când
   totul e în regulă?
4. **Ce vede cineva care n-a conectat încă nimic?** (starea goală e starea implicită
   pentru orice tenant nou)

---

## Ce vreau înapoi

- HTML + CSS pentru pagina nouă `search-console`, inclusiv starea goală (neconectat),
  starea conectată și starea de eroare.
- HTML + CSS pentru adăugirile din Rank Tracker (detaliu proiect; opțional cardul din hub).
- Clasele noi prefixate `gsc-`, cu variantele `.dark` grupate la final.
- O notă scurtă cu ce ai proiectat și care bucăți cer backend nou.
