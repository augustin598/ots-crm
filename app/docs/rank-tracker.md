# Rank Tracker — poziții Google organic

Modul sub hub-ul „SEO & GEO & AEO" care urmărește zilnic pozițiile organice Google
per cuvânt cheie × dispozitiv × locație, cu istoric nesuprascris, alerte și raport
săptămânal.

## Arhitectură
- **Logică pură** (`$lib/logic/rank-tracker.ts`): CTR, vizibilitate, share of voice,
  delte cu lookback tolerant la goluri, buckets, canibalizare, `rankDayKey`
  (Europe/Bucharest). Partajată identic de server și UI.
- **Provideri SERP** (`$lib/server/rank-tracker/providers/`):
  - `scraper` (implicit, cost zero): puppeteer-core + Chromium de sistem, UULE,
    emulare desktop/mobil, cookie-uri de consimțământ, pacing + jitter, proxy opțional,
    detecție CAPTCHA. **Risc ToS Google**: la volum de pe un singur IP de datacenter
    apar blocări; mitigare = pacing mare (`RANK_PACE_MS`), împrăștiere pe 24h, proxy.
  - `dataforseo` (opțional, plătit): credențiale criptate per tenant în
    `serp_integration`. Selecție prin `provider_mode` (scraper/dataforseo/auto);
    `auto` face failover pe DataForSEO la blocare sau >20% eșec.
- **Runner** (`run.ts`): per proiect, secvențial; UPSERT pe `(keyword, device, zi)` —
  o linie per zi, istoricul între zile nu se suprascrie. Progres în Redis
  `${tenantId}:rank:run:${projectId}`. Eșecul unui keyword nu oprește coada; blocarea
  Google oprește scraperul (și comută pe rezervă în `auto`).
- **Anti-„lost fals"**: o pagină neblocată dar cu 0 organice = selector rupt → eroare
  `parse`, FĂRĂ snapshot (nu alertă falsă de „lost").

## Model de date (migrări 0508–0524, aplicate pe Turso)
`rank_project`, `rank_keyword` (unique `project+keyword+location`), `rank_snapshot`
(unique `keyword+device+day`), `rank_run`, `rank_alert`, `rank_settings`
(unique `tenant`), `rank_report` (unique `tenant+week`), `serp_integration`.

## Google Search Console (sursa care nu poate fi blocată)

Pe 2 sep. 2026 heylux.ro arăta „30+" la toate cele 26 de cuvinte — dar toate cele 4
rulări fuseseră blocate de Google, deci nu exista nicio măsurătoare, iar snapshotul
altui proiect îl arăta pe poziția 8. GSC e API oficial, gratuit, care nu poate fi
blocat; îl folosim ca martor pentru cât de mult ne putem baza pe poziția scrapată.

- **Pozițiile NU se contopesc niciodată.** Poziția GSC e mediată peste dispozitive,
  locații și pagini; cea scrapată e „poziția 8, desktop, România". Stau în coloane
  separate, iar între ele calculăm doar `gscTrust` (`$lib/logic/gsc.ts`):
  `scrape-missing` (noi n-am găsit nimic, Google raportează afișări → badge roșu
  **„nemăsurat"**), `divergent` (≥10 poziții diferență), `ok`.
- **Model de date** (migrări 0525–0529): `gsc_integration` (OAuth per tenant, tokeni
  DOAR criptați, unique pe tenant), `rank_gsc_daily` (unique `keyword+device+gsc_date`),
  coloana `gsc_property` pe `rank_project`.
- **`gsc_date` NU e `rank_snapshot.day_key`** — GSC lucrează în ora Pacificului, noi în
  Europe/Bucharest. Numele diferit e intenționat: nu face JOIN pe egalitate între ele.
- **Job**: `gsc-daily-pull`, zilnic la 05:00, ÎNAINTEA verificării de poziții. Retrage
  o fereastră de 7 zile cu upsert, fiindcă `dataState: 'all'` aduce zile parțiale pe
  care Google le rescrie. `TABLET` se ignoră. O proprietate care crapă (403) nu oprește
  coada. Se scriu doar interogările care se potrivesc cu un `rank_keyword` urmărit
  (potrivire pe `normalizeKeyword`).
- **Proprietatea se ține pe proiect, nu pe tenant** — un tenant are proiecte pentru
  clienți diferiți. „domain" (`sc-domain:heylux.ro`) și „URL prefix"
  (`https://www.heylux.ro/`) sunt proprietăți DIFERITE, cu date diferite: se alege din
  `sites.list`, niciodată construită din domeniu.
- **Debug**: `GET /[tenant]/api/_debug-gsc-health` (admin). `?probe=1` face apel REAL —
  e singurul lucru care dovedește că **Search Console API e activat în Google Cloud**;
  OAuth „connected" nu spune nimic despre asta (lecția de la Google Calendar). Sonda
  detectează `SERVICE_DISABLED` și întoarce un `hint` explicit.
- **Config extern**: `https://<domeniu>/api/gsc/callback` pe același OAuth client ca
  Gmail/Google Ads, plus Search Console API activat. Scope-ul e readonly.
- **Ce NU rezolvă GSC**: niciun competitor (tot panoul „Competitori" e invizibil acolo),
  iar datele au ~2 zile întârziere. De asta păstrăm scrapingul.
- **Faze ulterioare**: (2) descoperirea interogărilor pe care clientul le are în GSC dar
  nu sunt urmărite; (3) CTR real în formula de vizibilitate, în locul lui `ctrForPosition`.

## Joburi (BullMQ, Europe/Bucharest)
- `rank-daily-check` (orar): pune în coadă `rank_project_check` per proiect activ al
  tenanților a căror oră (`check_hour`) se potrivește.
- `rank_project_check` (one-shot): rulează verificarea + trimite alerte dacă e cazul.
- `rank-weekly-report` (orar, potrivire zi/oră): raport săptămânal idempotent.
- `rank-volume-refresh` (lunar): volume din Google Ads (`generateKeywordHistoricalMetrics`).
- `gsc-daily-pull` (zilnic 05:00): trage Search Console pe fereastră de 7 zile, upsert
  pe `(keyword, device, gsc_date)`; rulează ÎNAINTEA verificării de poziții.
- Recovery: rulările `running` rămase după restart devin `interrupted`.

## UI
- Admin: `/[tenant]/seo-links/rank-tracker` (hub) + `/[projectId]` (detaliu + drawer).
- Portal client (read-only): `/client/[tenant]/rank-tracker` (categoria de acces `seo`).
- **Port 1:1 din Claude Design** (`docs/superpowers/plans/2026-09-01-rank-tracker-design/`):
  aceleași clase `rt-*` peste vocabularul `cl-*`/`psi-*` din `pagespeed.css`.
  `rank-tracker.css` = `rank-styles.css` + `.psi-two`/`.iv-muted`/`.cl-back` (lipsesc din
  `pagespeed.css`) + variantele `.dark` pentru culorile hard-codate din design.
- Componente (`$lib/components/rank-tracker/`): `RankTrackerView` (hub),
  `RankProjectView` (detaliu), bits `Rt{Pos,Gain,Spark,7,Feats,Ai,Vis,Dist,RankChart,CompRow}`,
  modale `ProjectModal`, `RankSettingsModal`, `KeywordsModal`, `ReportPreviewModal`,
  `KeywordDrawer`. Helper-ele de etichete/culori sunt în `rank-tracker/lib.ts`.
- **STRICT**: modalele/drawerul se randează ÎN interiorul `.cl-wrap` — tokenii `--cl-*`
  sunt definiți pe `.cl-wrap` și nu cascadează la frați.
- Breadcrumbul vine din layout-ul `[tenant]`; designul are `cl-crumbs`, noi NU (ar fi dublat).

### Diferențe acceptate față de design
- **KD (dificultate)** rămâne „—": nu există sursă gratuită în v1.
- **Verificare per cuvânt**: backendul rulează per proiect (`startRankCheck(projectId)`),
  deci rândurile n-au buton de re-verificare; acțiunile pe rând sunt „SERP în Google" și
  „Șterge", iar bara de selecție multiplă are „Anulează" + „Șterge".
- **Istoric rulări**: coloanele „Poziție medie"/„Vizibilitate" se citesc din `trend` pe ziua
  rulării; „Alerte" din design e înlocuit cu „Eșuate" (nu ținem alerte per rulare în read model).
- **Drawer**: designul are o coloană „URL în SERP" per zi; noi nu păstrăm URL-ul istoric per zi
  (doar cel curent + lista din canibalizare), deci coloana lipsește.
- **Hub**: fără segmented desktop/mobil (agregatele din lista de proiecte sunt pe dispozitivul
  principal); tabelul de jos e „Rapoarte trimise" (rulările sunt per proiect, în detaliu).

## Scraper: ce a măsurat auditul din 2 sep. 2026
Google a schimbat regulile; toate cele de mai jos sunt MĂSURATE pe google.ro, nu presupuse.
- **`num=100` = blocare instantanee.** Aceeași interogare, același browser: cu `&num=100`
  → HTTP 429 → `/sorry/`; fără `num` → 200 cu rezultate. Adâncimea vine acum din paginare
  `&start=0,10,20…`, deci `depth` = numărul MAXIM de cereri per (cuvânt × dispozitiv).
- **`--disable-blink-features=AutomationControlled` e obligatoriu**; fără el, chiar și o
  interogare simplă ia 429 din prima. `navigator.webdriver` trebuie să fie `undefined`,
  nu `false` (proprietatea prezentă e ea însăși un semnal).
- **Pagina de CAPTCHA e servită cu status 200** și NU conține „/sorry/index"; în schimb
  pagina VALIDĂ îl conține (în JS-ul inline). Deci: blocarea se detectează prin
  `captcha-form`/`g-recaptcha` în HTML + `/sorry/` în URL-ul FINAL — niciodată prin
  căutarea lui „/sorry/index" în corp.
- **Selectoare organice**: `.g` = 0, `.mnr-c` = 0; funcționează `.tF2Cxc` (desktop, 10)
  și `.MjjYud` (mobil, 26). `href`-ul nu mai conține destinația (`/goto?url=CAES…`,
  protobuf opac) — URL-ul real se ia din `<cite>`.
- Feature-uri verificate ca funcționale: `#tads`/`#tadsb` (ads), `[jsname="Cpkphb"]` (PAA),
  `.rllt__details` (local pack). Pentru images/video/shopping/snippet/AI Overview nu am avut
  un SERP care să le conțină → selectoarele rămân NEVERIFICATE pe layoutul curent.
- **DESCHIS — extragerea pe MOBIL nu merge.** Desktopul e validat cap-coadă (rulare reală
  2 sep. 2026: „studio de videochat iasi" → poziția 14, pagina 2, `https://www.heylux.ro`),
  dar pe mobil parserul întoarce 0 organice și rularea iese „parțial". Ce s-a măsurat:
  `.MjjYud` = 26 containere, `#rso cite` = **0** (deci extragerea din `<cite>` nu are de unde
  citi URL-ul), iar `#rso h3` prinde fișele din local pack (fără `href`, fără `cite`), nu
  rezultate organice. Nu am putut măsura structura organică de pe mobil: IP-ul intrase în
  CAPTCHA. Efect: NU se scrie niciun snapshot pe mobil (deci fără alerte false de „lost"),
  doar rularea rămâne „parțial". De reluat cu IP odihnit / proxy.

## Dezvoltare locală: worker-ul NU ia codul nou la HMR
Worker-ul BullMQ e pornit o singură dată (`globalThis[Symbol.for('ots_crm_scheduler_initialized')]`)
și ține în closure modulele de la momentul pornirii. După orice modificare în
`rank-tracker/providers/*` sau `run.ts` trebuie **repornit `vite dev`**, altfel rulările
folosesc scraperul vechi. Simptom exact întâlnit: `_debug-rank-health?probe=1` (rută, cod
proaspăt) întorcea `ok:true`, iar rularea prin worker eșua „blocat de Google" în aceeași minută.
Atenție și la **dev servere multiple**: două instanțe consumă din aceeași coadă Redis, iar cea
veche răspunde „Unknown scheduler job type" la joburile adăugate de codul nou.

## Strategia anti-blocare (gratuită, 2 sep. 2026)
Brainstorming Claude + opencode; Gemini n-a răspuns la timp. DataForSEO nu are magie de
cod — puterea lor sunt IP-urile rezidențiale multiple. Pe UN IP, pârghiile gratuite reale:
1. **Sesiune persistentă cu warm-up**: la lansare, browserul vizitează homepage-ul Google
   cu cookie-urile sesiunii precedente (Redis `rank:scraper:session`, TTL 7 zile) —
   „utilizator recurent", nu browser proaspăt. La blocare, sesiunea se ARUNCĂ (profil ars).
2. **Ferestre orare**: proiectele pornesc pe rând, la `RANK_STAGGER_MINUTES` distanță
   (implicit 150 = 2h30) + 0-10 min aleator. Salve de 26, nu rafală de 78.
3. **Pauze umane**: la fiecare 8-12 interogări, 45-90 s de liniște; jitter puternic
   pace..2×pace (interval cvasi-constant = tipar de robot).
4. **Amprentă consecventă pe rulare, variată între rulări**: pool de 4 combinații
   UA+viewport, aleasă la lansarea browserului.
5. **Stealth suplimentar**: `window.chrome` fals, patch pe `permissions.query`
   (ambele semnale clasice de headless), Referer de pe homepage.
6. **Ordine aleatorie a cuvintelor** la fiecare rulare.
Ce NU s-a implementat (raport impact/efort slab pe un singur IP): mișcări de mouse/scroll,
tastare simulată, rotație de IP prin VPN/Tor (blocklist public — mai rău). Dacă blocarea
persistă și după astea: `RANK_PACE_MS` mai mare, volum mai mic, sau DataForSEO pe `auto`.

## Motorul adaptiv de rulare (`$lib/logic/scrape-engine.ts` + `engine-store.ts`)
Stare per canal de ieșire (IP/proxy), persistată în Redis (`rank:engine:direct`), partajată
de TOATE rulările — cron și manual deopotrivă (cerință explicită: pornirea manuală nu
ocolește regulile). Reviewed de opencode; fix-urile lui aplicate (recuperare accelerată,
reset de ritm la epocă nouă, buget parțial, semnal de pre-blocare).
- **AIMD**: blocare → ritm ×1.6 (cap 60 s) + cooldown exponențial 30 min→8 h; succes →
  −5% din bază, −15% după 20 de succese consecutive; 3 eșecuri soft consecutive → ×1.3
  preventiv. Blocările mai vechi de 24 h se iartă (ritmul revine la bază).
- **Poarta de start**: în cooldown nu se rulează deloc; buget zilnic `RANK_DAILY_QUERY_BUDGET`
  (120) cu tăiere PARȚIALĂ a batch-ului (rulează cât încape, restul se amână).
- **Re-programare automată**: rulare amânată sau blocată la mijloc → jobul se re-pune în
  coadă singur după cooldown (+2 min), max 2 reluări/zi, cu DOAR cuvintele rămase.
- **Planificarea zilei**: `planWindows` — fiecare proiect pornește după durata estimată a
  celui dinainte (cuvinte × ritmul curent) + gaura `RANK_STAGGER_MINUTES` (120). Scalabil:
  un proiect de 200 de cuvinte împinge automat următoarele.
- Starea e vizibilă în `_debug-rank-health` (câmpul `engine`).

## Operațional
- Env: `RANK_PACE_MS` (implicit 8000), `RANK_PROXY_URLS` (listă separată prin virgulă),
  `RANK_MAX_KEYWORDS_PER_PROJECT` (500), `RANK_STAGGER_MINUTES` (120, gaura dintre ferestre), `RANK_DAILY_QUERY_BUDGET` (120), `RANK_SERP_DEPTH` (implicit **30** = 3 pagini;
  cu paginare, 100 ar însemna până la 10 cereri per cuvânt → peste 10 minute și blocare
  aproape sigură. Ridică-l doar cu proxy-uri sau pe DataForSEO).
- Debug: `GET /[tenant]/api/_debug-rank-health` (admin) — Chromium, pacing/proxy,
  integrare SERP (fără credențiale); `?probe=1` face un SERP real de test.
- Când apare `blocked` frecvent: crește `RANK_PACE_MS`, adaugă proxy-uri, sau trece
  `provider_mode` pe `auto`/`dataforseo`.
- Demo email: `bun run scripts/demo-rank-report-email.ts > /tmp/rank.html`.
