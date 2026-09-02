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

## Joburi (BullMQ, Europe/Bucharest)
- `rank-daily-check` (orar): pune în coadă `rank_project_check` per proiect activ al
  tenanților a căror oră (`check_hour`) se potrivește.
- `rank_project_check` (one-shot): rulează verificarea + trimite alerte dacă e cazul.
- `rank-weekly-report` (orar, potrivire zi/oră): raport săptămânal idempotent.
- `rank-volume-refresh` (lunar): volume din Google Ads (`generateKeywordHistoricalMetrics`).
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

## Operațional
- Env: `RANK_PACE_MS` (implicit 8000), `RANK_PROXY_URLS` (listă separată prin virgulă),
  `RANK_MAX_KEYWORDS_PER_PROJECT` (500).
- Debug: `GET /[tenant]/api/_debug-rank-health` (admin) — Chromium, pacing/proxy,
  integrare SERP (fără credențiale); `?probe=1` face un SERP real de test.
- Când apare `blocked` frecvent: crește `RANK_PACE_MS`, adaugă proxy-uri, sau trece
  `provider_mode` pe `auto`/`dataforseo`.
- Demo email: `bun run scripts/demo-rank-report-email.ts > /tmp/rank.html`.
