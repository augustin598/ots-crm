# Predare — Rank Tracker: port UI 1:1 din designul Claude Design

> **Pentru sesiunea nouă.** Modulul Rank Tracker e COMPLET pe backend + testat; a rămas UN singur task: rescrierea UI-ului admin ca să fie **1:1 cu designul** din Claude Design (fișierele sunt deja în repo). UI-ul actual a fost construit din spec textual (nu aveam fișierul de design) — funcțional dar simplificat. Userul a furnizat între timp sursele exacte.

## Context rapid
- Branch: **`feat/rank-tracker`** (nemerge-uit; ~19 commituri). NU e pe main.
- Backend 100% gata + testat: `bun run test rank` = 153 pass; suita completă 2059 pass; `svelte-check` 0/0.
- Migrări 0508–0524 **aplicate pe Turso** (8 tabele). Vezi memoria `project-rank-tracker-2026-09-02` și planul `docs/superpowers/plans/2026-09-01-rank-tracker.md`.
- Date reale existente pe prod pentru testare vizuală: proiect **heylux.ro** (nume „Lucky Studio", client Lucky Group, tenant ots), 3 cuvinte: „angajare videochat", „studio de videochat", „studio de videochat iasi" (desktop+mobil). Pozițiile sunt „100+" până la prima rulare.

## Sursa de adevăr a designului (deja în repo)
`docs/superpowers/plans/2026-09-01-rank-tracker-design/`:
- `rank.jsx` (583 linii) — view principal: HUB (carduri proiecte `rt-proj` + grafic portofoliu + distribuție + „scăderi de urmărit") și DETALIU proiect (6 KPI-uri, toolbar cu tab-uri, GRUPURI pe etichete, tabelul mare, „cele mai importante cuvinte" + „share of voice", istoric rulări).
- `rank-bits.jsx` (164) — componente mici: `RTPos` (pastilă poziție colorată top3/top10/top20/low/out), `RTGain` (▲/▼ delta), `RTSpark` (sparkline 30z), `RT7` (ultimele 7 zile, celule colorate up/down), `RTFeats` (chips SERP features 2-litere colorate), `RTAi` (badge AI: citat/apare/—), `RTVis` (bară vizibilitate), `RTDist` (bară distribuție + legendă), `RTRankChart` (grafic poziții axă INVERSATĂ log 1→100), `RTCompRow` (rând share of voice).
- `rank-modals.jsx` (421) — `RTKwDrawer` (drawer keyword: KPI mini, grafic istoric, SERP mock, canibalizare, competitori), `RTProjectModal`, `RTScheduleModal`, `RTAddKwModal`, `RTReportPreview`. **CITEȘTE acest fișier — nu l-am apucat să-l citesc.**
- `rank-data.jsx` (192) — praguri + helperi (CTR identic cu al nostru, `rtPosLevel`, `rtBuckets`, `RT_FEATURES` cu culori/short, `RT_BUCKET_COLORS/LABELS`). Doar REFERINȚĂ — logica reală e deja în `$lib/logic/rank-tracker.ts`.
- `rank-styles.css` (112) — **stilul exact**; clasele `rt-*` + tokenii `--cl-*`/`.psi-*` existenți. Model de port: exact ca PageSpeed (`docs/superpowers/plans/2026-08-31-pagespeed-design/`).
- `Rank Tracker.html` — designul randat (deschide-l ca referință vizuală).

## Fișierele Svelte de rescris (existente, construite din spec)
`app/src/lib/components/rank-tracker/`:
- `RankTrackerView.svelte` (hub) → rescrie 1:1 după partea HUB din `rank.jsx` (carduri `rt-proj`, grafic portofoliu, distribuție, alerte).
- `RankProjectView.svelte` (detaliu) → rescrie 1:1 după partea DETALIU din `rank.jsx` (ăsta e ecranul din screenshot-ul userului). Include: 6 KPI-uri, toolbar cu tab-uri (Toate/Top 10/Au urcat/Au scăzut/AI Overview/Canibalizare) + segmented Desktop/Mobil + Locație + Sortare, chips GRUPURI, tabelul complet (checkbox, Cuvânt cheie+tag+locație+URL, Volum, KD, Poziție-pastilă, Pagina, Δ1z, Δ7z, Best, Ultimele 7 zile, 30 zile sparkline, SERP features, AI Overview, Acțiuni), graficul „cele mai importante cuvinte", „share of voice", istoric rulări.
- Componente noi (port din `rank-bits.jsx`): `RtPos.svelte`, `RtGain.svelte`, `RtSpark.svelte`, `Rt7.svelte`, `RtFeats.svelte`, `RtAi.svelte`, `RtVis.svelte`, `RtDist.svelte`, `RtRankChart.svelte`, `RtCompRow.svelte`. (Înlocuiesc `RkDistBar.svelte`/`RkPosChart.svelte` actuale — le poți șterge sau refolosi.)
- Modale: rescrie `ProjectModal.svelte`, `RankSettingsModal.svelte` (=RTScheduleModal), `KeywordsModal.svelte` (=RTAddKwModal), `KeywordDrawer.svelte` (=RTKwDrawer) după `rank-modals.jsx`.
- `rank-tracker.css` → înlocuiește conținutul cu `rank-styles.css` (clasele `rt-*` exacte). Păstrează doar utilitarele care NU există în `pagespeed.css` (verifică fiecare clasă cu grep înainte).

## Reguli de port JSX→Svelte 5 (identice cu PageSpeed)
- `useState`→`$state`, `useMemo`→`$derived`, `useEffect`→`$effect`. Icoanele `Icon.X`→`@lucide/svelte/icons/*` (Eye, Target, Star, TrendingUp, AlertTriangle, Clock, Search, Mail, RefreshCw, Plus, Edit=pencil, ChevronRight, MapPin=map-pin, Users, BarChart=bar-chart-3, CalDays=calendar-days, ExternalLink, Trash=trash-2, CheckSquare=check-square, Sparkles, Folder, X, Check).
- Aceleași clase, aceeași ierarhie DOM, aceleași texte românești ca în design.
- **STRICT (bug deja pățit)**: modalele/drawer-ele TREBUIE randate ÎNĂUNTRUL `<div class="cl-wrap">`, nu ca frați — tokenii `--cl-*` sunt definiți pe `.cl-wrap` și nu cascadează la frați (fundal transparent, input-uri fără chenar). Toast-ul la fel.
- Import CSS: în componenta View fă `import '../pagespeed/pagespeed.css'` + `import './rank-tracker.css'` (ca RankTrackerView actual). Modalele NU importă CSS (moștenesc global).
- `svelte-autofixer` pe fiecare `.svelte` modificat; sugestiile despre `setInterval`/prefill în `$effect` sunt false-pozitive acceptate (pattern-ul PageSpeed).

## Mapare date design (dummy) → date reale (remotes)
Datele reale vin din `getRankProjects()` / `getRankProjectDetail(projectId)` (`$lib/remotes/rank-tracker.remote.ts`) → `$lib/server/rank-tracker/projects-data.ts`. Pattern remote: `const q = $derived(getX()); q.current`. Mutații: `await cmd(...).updates(q)`.

Per keyword, `buildRankProjectDetail` întoarce (interfața `RankKeywordDetail`): `position, page, delta1, delta7, delta30, best, features[], aiOverview('absent'|'present'|'cited'), spark30:(number|null)[30], competitors:Record<dom,pos>, cannibalization:{flagged,urls}, volume, difficulty(=KD, null în v1 → „—"), tag, location, targetUrl, device`. Plus la nivel de proiect: `visibility, avgPosition, distribution, aiPresent, aiCited, trend:{days,visibility,avgPosition}, runs[], shareOfVoice, competitors, locations, alertThreshold, locale`.
- `RTPos pos` = `position`. `Δ1z`=`delta1`, `Δ7z`=`delta7` (pozitiv=urcare, deja). `Best`=`best`. `Pagina`=`page`.
- `RT7` (ultimele 7 zile) = ultimele 7 din `spark30`. `RTSpark`/`RTRankChart` = `spark30` / `trend`.
- Tab „Canibalizare" = `cannibalization.flagged` (design folosea `altUrl`). Tab „AI Overview" = `aiOverview!=='absent'`.
- GRUPURI = etichetele distincte din `tag`. „Share of voice" = `shareOfVoice` + `competitors`.
- KPI „Mișcări azi" (up/down) = din `runs[0]` (up/down). „Scăderi peste prag" = nr. keywords cu `delta1 <= -alertThreshold`. „Următoarea rulare" = ora din setări (`getRankSettings().checkHour`, `devices`) — adaugă un `settingsQuery` în view.
- Tabelul design arată UN device (segmented Desktop/Mobil). `detail.keywords` are câte un rând per (keyword, device) — filtrează pe device-ul selectat (default = dispozitivul principal: desktop dacă e urmărit, altfel mobil).
- GAP acceptat: KD (difficulty) rămâne „—" în v1 (nu există sursă gratuită); afișează coloana cu „—". Fără date reale de scraping (poziții „100+") până la prima rulare — normal.

## Verificare
1. `cd app && bun run test` (nu strica cele 2059 pass) + `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning` (ținta 0/0).
2. Vizual: dev server pe `localhost:5173` (rulează din main, vezi memoria `feedback-local-preview-needs-main`... de fapt userul îl are pornit). Login dev: office@onetopsolution.ro / sghp910o, tenant ots. Ruta: `/ots/seo-links/rank-tracker` și `/ots/seo-links/rank-tracker/<projectId>` (proiectul heylux.ro există deja). Folosește `testermcp` (create_session pe http://localhost:5173, login prin evaluate: setează input[type=email]/[type=password] cu descriptorul nativ + dispatch 'input', click Login) sau chrome-devtools.
3. Compară cu `Rank Tracker.html` deschis alături.
4. `design-auditor` + `web-design-guidelines` pe componente (crm-dev-flow 4b). Dark mode (design are tokeni pe `.cl-wrap`).

## După ce e gata
- Commit pe `feat/rank-tracker`. Rulează `graphify . --update`.
- Deploy rămâne GATED — propune, așteaptă „go" (production/staging). La prod, prima verificare cu `_debug-rank-health?probe=1` (Chromium in-cluster).
- Portalul client (`RankClientView.svelte`) e read-only simplu — poți să-l aliniezi și pe el la stil, dar nu e prioritar (designul e pentru admin).

## Ce s-a livrat deja (nu reface)
Logică pură, schema+migrări, 2 provideri SERP (scraper in-house puppeteer + DataForSEO) + failover, runner cu upsert zilnic + alerte, 4 joburi scheduler + recovery, raport+alerte email, volume Ads, remotes + read model, debug endpoint, docs (`app/docs/rank-tracker.md`), 9 buguri din audit reparate. Toate cu teste.
