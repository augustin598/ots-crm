# Modul Rank Tracker (poziții Google organic) — Plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modul „SEO & GEO & AEO → Rank Tracker" care urmărește zilnic pozițiile organice Google per keyword × device × locație, cu istoric nesuprascris, SERP features + AI Overview, competitori din top 10, vizibilitate/share of voice, alerte la scăderi și raport săptămânal pe email cu PDF arhivat în fișa clientului. Sursa SERP: **in-house** (puppeteer-core + Chromium de sistem, deja în imaginea Docker de producție), cu fallback opțional DataForSEO per tenant.

**Architecture:** Clonă arhitecturală a modulului PageSpeed (referința: `docs/superpowers/plans/2026-08-31-pagespeed-insights.md` + codul din `app/src/lib/server/pagespeed/`): logică pură în `$lib/logic`, provider extern cu `deps` injectabile, runner secvențial cu pacing + progres Redis, joburi BullMQ pe cozile existente (cron orar cu potrivire per-tenant pe ora din setări, Europe/Bucharest), remote functions (`query`/`command` + requireStaff + tenant scoping), UI mare tip View + drawer, portal client read-only prin builder partajat cu `clientId` în SQL. Abstracția `SerpProvider` are 2 implementări: `scraper` (implicit, cost zero) și `dataforseo` (opțional, credențiale criptate per tenant, failover automat în modul `auto`).

**Tech Stack:** SvelteKit 5 (runes, remote functions), Drizzle + Turso, BullMQ + Redis, puppeteer-core (Chromium sistem — NU adăuga Playwright: build-ul in-cluster are limită 4Gi), nodemailer prin `sendWithPersistence`, pdfkit + DejaVu, valibot.

**Decizii documentate (deviații de la spec):**
1. Numele tabelelor sunt prefixate `rank_*` (spec zicea `projects`/`keywords` — coliziune cu tabelul `project` existent și cu `projects.remote.ts`).
2. REST → remote functions `$lib/remotes/rank-tracker.remote.ts` (standard proiect; aceeași deviație documentată la PageSpeed). Debug operațional: `[tenant]/api/_debug-rank-health`.
3. **Sursa SERP nu e un API terț plătit** (cerința userului: totul in-house, cost zero). Provider `scraper`: puppeteer-core cu Chromium de sistem (model `scraper/cloudflare-bypass.ts` + `scraper/find-chrome.ts`), stealth manual, pacing configurabil cu jitter, proxy-uri opționale din env, detecție CAPTCHA/block. Riscul (ToS Google, blocări la volum) e asumat și documentat în `app/docs/rank-tracker.md`. Provider `dataforseo` rămâne opțional per tenant (credențiale criptate `encryptVerified`, tabel `serp_integration`), cu failover automat în modul `auto` când rata de eșec a unei rulări > 20%.
4. **GSC (Google Search Console) NU intră în acest plan.** Nu există nicio integrare GSC în codebase (verificat: 0 hituri pe `searchconsole|webmasters|gsc` în `src/`); ar fi subsistem independent (tabel + OAuth + 3 rute + scope sensibil cu risc de re-verificare a consent screen-ului partajat de Gmail/Ads/Calendar). Se livrează ca plan separat (Faza 2) — poziția medie GSC ca serie de îmbogățire lângă poziția exactă din scraper.
5. **Volumul de căutare** vine din integrarea Google Ads existentă (`google-ads-api` v23 expune `generateKeywordHistoricalMetrics` — neutilizat azi, dar disponibil), job lunar, skip grațios dacă tenantul nu are integrarea. **Dificultatea rămâne `null` în v1** (nu există sursă gratuită; UI afișează „—"). Deviație de la spec §5 documentată.
6. **Eșec de verificare = FĂRĂ rând snapshot** (spec §2: graficul face gap, nu interpolare). Erorile se numără în `rank_run` (`status='partial'`, `error_note`). Re-rularea manuală în aceeași zi face UPSERT pe snapshotul zilei (unique `(keyword_id, device, day_key)`) — istoricul e nesuprascris la granularitate de ZI.
7. **UI-ul de referință `Rank Tracker.html` NU a fost găsit** (nici în repo, nici în ~/Desktop, ~/Downloads, ~/Documents). UI-ul urmează structura din spec (hub proiecte → detaliu proiect → drawer keyword) construită cu vocabularul existent `cl-*`/`psi-*` din `pagespeed.css` + clase noi `rk-*`. Dacă userul furnizează ulterior fișierul, se face un pas de aliniere vizuală.
8. **Locații**: v1 suportă țara din `locale` (`gl`/`hl`) + orașe prin parametrul `uule` (encoder propriu, testat). DataForSEO primește `location_name` direct. Cozile „per locație" din spec = ordonarea secvențială per proiect (un singur worker BullMQ, concurrency 1 — nu există paralelism real de cozi în infrastructura actuală; documentat).
9. **Rollup/prune istoric** (recomandarea Gemini: agregare săptămânală după 90 de zile) — AMÂNAT deliberat, ca follow-up documentat, declanșat când `rank_snapshot` depășește ~500k rânduri. Spec-ul cere „istoricul nu se suprascrie niciodată"; v1 îl respectă literal.
10. Alertele „imediate" = un email per destinatar per RULARE (grupate), nu per keyword — altfel un proiect căzut generează zeci de emailuri.

**Skill-uri de încărcat la implementare:** `ots-crm-dev`, `database-migrations`, `multi-tenant`, `error-handling`, `email-delivery`, `api-integrations`, `testing-strategy`, `svelte:svelte-core-bestpractices`, `ui-styling` (înainte de UI).

**Reguli moștenite (obligatorii):**
- Teste DOAR cu `bun run test` (`bun test` = eșecuri fantomă; mock.module e global). Orice test de server: `await import('$lib/server/db/schema')` PRIMUL, apoi mock-urile, apoi SUT importat dinamic.
- Migrări scrise MANUAL (drizzle-kit generate e stricat — reference_drizzle_meta_drift), O instrucțiune per fișier, FĂRĂ `IF NOT EXISTS`, FĂRĂ `--> statement-breakpoint`; `_journal.json` cu `when` incrementat manual PESTE maximul existent (~1.785e15 — scară „microsecunde"; `Date.now()` ar fi SUB max și migrarea nu ar rula niciodată). Înainte: `grep -ri "rank_" app/drizzle/` (zero) + verifică pe remote `select max(created_at) from __drizzle_migrations` vs `_journal.json`.
- Coloanele intră în `schema.ts` DOAR după ce migrarea a fost aplicată + verificată pe Turso cu `PRAGMA table_info(...)` (feedback_schema_select_all_hazard, feedback_migration_flow).
- ID-uri: `encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))`. Timpul: pasează mereu `new Date()` explicit (default-urile DB sunt nesigure pe tabelele vechi).
- Fără breadcrumb propriu în componente (layoutul `[tenant]` și portalul le au deja — feedback_no_duplicate_breadcrumbs).
- Comentarii, stringuri UI, emailuri, mesaje de log: în ROMÂNĂ cu diacritice.

---

## Structura de fișiere

**Create:**
- `app/src/lib/logic/rank-tracker.ts` + `app/src/lib/logic/__tests__/rank-tracker.test.ts` — logică pură (CTR, vizibilitate, SoV, delte, buckets, dayKey, pagină, canibalizare, formatare)
- `app/src/lib/server/rank-tracker/providers/types.ts` — interfața `SerpProvider` + tipuri rezultat
- `app/src/lib/server/rank-tracker/providers/serp-parser.ts` + `__tests__/serp-parser.test.ts` + `__tests__/fixtures/serp-desktop.html`, `serp-mobile.html`, `serp-ai-overview.html`, `serp-captcha.html` — parsare HTML SERP (pură)
- `app/src/lib/server/rank-tracker/providers/serp-scraper.ts` + `__tests__/serp-scraper.test.ts` — provider in-house (puppeteer-core, stealth, uule, pacing, proxy, detecție block)
- `app/src/lib/server/rank-tracker/providers/dataforseo.ts` + `__tests__/dataforseo.test.ts` + `__tests__/fixtures/dataforseo-serp.json` — provider opțional
- `app/src/lib/server/rank-tracker/providers/resolve.ts` + `__tests__/resolve.test.ts` — selecția providerului per tenant (scraper/dataforseo/auto + failover)
- `app/src/lib/server/rank-tracker/run.ts` + `__tests__/run.test.ts` — runner per proiect (snapshot-uri, run row, progres Redis, alerte)
- `app/src/lib/server/rank-tracker/projects-data.ts` + `__tests__/projects-data.test.ts` — read model partajat admin + portal (`buildRankProjects(tenantId, {clientId})`, `buildRankProjectDetail(...)`)
- `app/src/lib/server/rank-tracker/report-html.ts` (PUR, importuri DOAR relative) + `report.ts` (agregare DB + barrel) + `report-pdf.ts` (pdfkit + DejaVu) + `__tests__/report.test.ts`
- `app/src/lib/server/rank-tracker/alerts.ts` + `__tests__/alerts.test.ts` — calcul + persistare + email alerte
- `app/src/lib/server/rank-tracker/archive.ts` — arhivare PDF în fișa clientului (MinIO + rând `document`)
- `app/src/lib/server/rank-tracker/volume.ts` + `__tests__/volume.test.ts` — volume din Google Ads (`generateKeywordHistoricalMetrics`)
- `app/src/lib/server/scheduler/tasks/rank-daily-check.ts` + `rank-project-check.ts` + `rank-weekly-report.ts` + `rank-volume-refresh.ts` + `__tests__/rank-daily-check.test.ts` + `__tests__/rank-weekly-report.test.ts`
- `app/src/lib/remotes/rank-tracker.remote.ts` + `app/src/lib/remotes/__tests__/rank-tracker.remote.test.ts`
- `app/src/lib/components/rank-tracker/rank-tracker.css` (importă `../pagespeed/pagespeed.css`; doar clase `rk-*` noi)
- `app/src/lib/components/rank-tracker/types.ts` (tipuri UI pure, fără importuri de server) + `lib.ts` (helperi UI)
- `app/src/lib/components/rank-tracker/RankTrackerView.svelte` (hub proiecte) + `RankProjectView.svelte` (detaliu) + `RankClientView.svelte` (portal read-only)
- `app/src/lib/components/rank-tracker/RkPosChart.svelte` (grafic poziții cu axă INVERSATĂ: 1 sus) + `RkPosSpark.svelte` + `RkDistBar.svelte` (distribuție buckets) + `RkFeatureIcons.svelte` (SERP features) + `RkDeviceIcon.svelte`
- `app/src/lib/components/rank-tracker/ProjectModal.svelte` + `KeywordsModal.svelte` (adăugare bulk, un keyword/linie) + `RankSettingsModal.svelte` + `KeywordDrawer.svelte` + `RankMailPreviewModal.svelte`
- `app/src/routes/[tenant]/seo-links/rank-tracker/+page.svelte` + `+page.ts` (`export const ssr = false;`)
- `app/src/routes/[tenant]/seo-links/rank-tracker/[projectId]/+page.svelte` + `+page.ts` (`ssr = false`)
- `app/src/routes/client/[tenant]/(app)/rank-tracker/+page.server.ts` + `+page.svelte`
- `app/src/routes/[tenant]/api/_debug-rank-health/+server.ts`
- `app/drizzle/0508…0523_*.sql` (16 migrări, o instrucțiune per fișier — lista exactă în Task 2)
- `app/scripts/demo-rank-report-email.ts` + `app/scripts/demo-rank-alert-email.ts` (feedback_email_demo_preview)
- `app/docs/rank-tracker.md`

**Modify:**
- `app/src/lib/server/db/schema.ts` — 8 tabele + relations + tipuri, sub banner `// ===== Rank Tracker (SEO → Poziții Google) =====` (DOAR după migrare aplicată)
- `app/src/lib/server/scheduler/index.ts` — cele 6 puncte × 3 joburi recurente + 1 one-shot (import, `taskHandlers`, `expectedJobIds` — NU pentru one-shot, `add()`, `JOB_LABELS`, JOB_PARAMS/HANDLER_TYPES dacă e cazul) + bloc de restart-recovery (`rank_run` status `running` → `interrupted`)
- `app/src/lib/server/email-logger.ts` — `'rank-report'` și `'rank-alert'` în EMAIL_TYPES
- `app/src/lib/server/email.ts` — `sendRankReportEmail`, `sendRankAlertEmail` + EMAIL_SEND_REGISTRY
- `app/src/lib/config/sidebar-nav.ts` — IconKey `'rank-tracker'` + copil `{ id: 'seo-rank', label: 'Rank Tracker', icon: 'rank-tracker', href: '/seo-links/rank-tracker' }` în copiii itemului `seo`
- `app/src/lib/components/ots-sidebar/NavIcon.svelte` — ramură `TrendingUpIcon` pentru `'rank-tracker'`
- `app/src/lib/config/__tests__/sidebar-nav.test.ts` — actualizează asserturile hard pe `seoItem.children` + breadcrumbs
- `app/src/lib/components/seo-hub/SeoHubView.svelte` — al 4-lea card modul + extinde tipul `moduleHrefs` (`rankTracker: string`) + default-ul `hrefs`
- `app/src/lib/components/seo-hub/seo-hub.css` — `.sh-modules` de la `repeat(3,1fr)` la `repeat(4,1fr)` (+ media query ≤1100px la 2 coloane; revizuiește alinierea `.sh-legend` care era aliniată intenționat la 3 coloane)
- `app/src/routes/client/[tenant]/(app)/seo/+page.svelte` — `moduleHrefs.rankTracker` (prop-ul e all-or-nothing)
- `app/src/lib/server/portal-access.ts` — branch `if (rest.startsWith('/rank-tracker')) return 'seo';` (ATENȚIE: fără el ruta portal e NEGATE-uită — prefix necunoscut = permis)
- `app/src/lib/access/catalog.ts` — branch `rest.startsWith('/rank-tracker') => 'portal.seo.view'` (duplicatul conștient al mapării; drift silențios altfel)
- `app/src/routes/client/[tenant]/(app)/+layout.svelte` — copil nav portal `{ id: 'seo-rank', label: 'Rank Tracker', icon: 'rank-tracker', href: '/rank-tracker' }` sub itemul SEO (navul portal e scris de mână acolo, NU citește sidebar-nav.ts)
- `app/.env`, `app/.env.example` — `RANK_PACE_MS=8000`, `RANK_PROXY_URLS=` (opțional, listă separată prin virgulă), `RANK_MAX_KEYWORDS_PER_PROJECT=500`; verifică `git diff .hostedignore` NU exclude `.env`

---

## Task 1: Logica pură (CTR, vizibilitate, SoV, delte, buckets, dayKey, canibalizare)

**Files:** Create `app/src/lib/logic/rank-tracker.ts`, `app/src/lib/logic/__tests__/rank-tracker.test.ts`

- [ ] **Step 1: teste eșuate** (model: `logic/__tests__/pagespeed.test.ts`; describe-uri în română care enunță regula):
  - `ctrForPosition(pos)`: tabelul EXACT din spec — 1→31.7, 2→24.7, 3→18.7, 4→13.6, 5→9.5, 6→6.3, 7→4.3, 8→3.1, 9→2.6, 10→2.4, 11–20→1.1, 21–50→0.35, 51–100→0.1, `null`/peste 100→0.
  - `visibility(positions: (number|null)[])` = `Σ CTR(pos) / (n × 31.7) × 100`, rotunjit la 1 zecimală; `[]` → 0; `[1]` → 100; `[null, null]` → 0.
  - `shareOfVoice(competitorPositions: Record<string, (number|null)[]>)` → `Record<string, number>` — aceeași formulă per domeniu, pe același n.
  - `positionDelta(then, now)` = `then - now` (pozitiv = urcare); orice `null` → `null`; `positionDelta(105→null, 8)` cu ambele: intrat în top (`then=null, now=8` → tip `'entered'`); ieșit (`then=8, now=null` → `'lost'`). Semnătura: `positionDelta(then: number|null, now: number|null): { delta: number|null, kind: 'up'|'down'|'flat'|'entered'|'lost'|'none' }`.
  - `snapshotAtLookback(series: {dayKey: string, position: number|null}[], todayKey: string, daysAgo: number, tolerance: number)` — snapshotul cel mai apropiat de `daysAgo` zile în urmă, în fereastra `[daysAgo - tolerance, daysAgo + tolerance]`; `null` dacă fereastra e goală (gap de scraping → Δ „—", nu 0). Δ1z = `daysAgo=1, tolerance=2` (cea mai recentă zi disponibilă din ultimele 3); Δ7z = `daysAgo=7, tolerance=2`; Δ30z = `daysAgo=30, tolerance=5`. (Amendament din review-ul Gemini: fără asta, o zi de eșec face toate deltele null.)
  - `pageForPosition(pos)` = `Math.ceil(pos/10)`; null → null. `fmtPosition(pos)`: null → `'100+'`, altfel numărul.
  - `bucketForPosition(pos)`: `'1-3' | '4-10' | '11-20' | '21-50' | '51-100' | '100+'`; `distribution(positions)` → `Record<RankBucket, number>`.
  - `rankDayKey(date, tz='Europe/Bucharest')` → `'YYYY-MM-DD'` pe ora Bucureștiului (test cu `2026-09-01T21:30:00Z` = `2026-09-02` ora BU… ATENȚIE: 21:30Z vara = 00:30 EEST a doua zi — exact cazul de testat).
  - `detectCannibalization(snapshots: {dayKey: string, rankingUrl: string|null}[])` → `{ flagged: boolean, urls: string[] }` — ≥2 URL-uri distincte non-null în fereastră (fereastra de 30 de zile o taie apelantul).
  - `bestPosition(positions)` — minimul non-null sau null.
  - `parseLocale('google.ro|ro')` → `{ googleDomain: 'google.ro', hl: 'ro', gl: 'ro' }` (gl = TLD-ul domeniului; `'google.com|en'` → gl `'us'`? NU ghici: gl = partea de după `google.` dacă are 2 litere, altfel `'us'`; testează ambele).
  - Reutilizează din `logic/pagespeed.ts`: `isoWeekKey`, `isoWeekInterval`, `nextRunDate`, `PSI_HOURS` — NU reimplementa (importă și re-exportă ce e nevoie).
- [ ] **Step 2: `bun run test rank` → FAIL** → **Step 3: implementare** (modul PUR: fără DB, fără DOM, doar importuri relative către `./pagespeed`) → **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): logica pură CTR/vizibilitate/delte/buckets`

## Task 2: Schema DB + migrări 0508–0523 (STRICT: skill database-migrations încărcat)

**Files:** Create `app/drizzle/0508…0523_*.sql`; Modify `app/drizzle/meta/_journal.json`, `app/src/lib/server/db/schema.ts`

- [ ] **Step 1:** `grep -ri "rank_" app/drizzle/` → nimic; verifică pe remote max(created_at) din `__drizzle_migrations` vs `_journal.json` (reference_drizzle_journal_when_sub_remote)
- [ ] **Step 2:** scrie cele 16 migrări manual (o instrucțiune per fișier, backtick-uri pe identificatori, fără IF NOT EXISTS):

`0508_rank_project.sql`:
```sql
CREATE TABLE `rank_project` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text REFERENCES `client`(`id`),
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`locale` text NOT NULL DEFAULT 'google.ro|ro',
	`locations` text NOT NULL DEFAULT '["România"]',
	`competitors` text NOT NULL DEFAULT '[]',
	`devices` text NOT NULL DEFAULT '["desktop","mobile"]',
	`alert_threshold` integer NOT NULL DEFAULT 5,
	`active` integer NOT NULL DEFAULT 1,
	`paused_at` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```
`0509_rank_project_tenant_idx.sql`: `CREATE INDEX \`rank_project_tenant_idx\` ON \`rank_project\` (\`tenant_id\`);`

`0510_rank_keyword.sql`:
```sql
CREATE TABLE `rank_keyword` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `rank_project`(`id`) ON DELETE cascade,
	`keyword` text NOT NULL,
	`tag` text,
	`location` text NOT NULL DEFAULT '',
	`volume` integer,
	`volume_updated_at` text,
	`difficulty` integer,
	`target_url` text,
	`active` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```
`0511_rank_keyword_project_idx.sql`: `CREATE INDEX \`rank_keyword_project_idx\` ON \`rank_keyword\` (\`project_id\`);`
`0512_rank_keyword_project_kw_loc_uidx.sql`: `CREATE UNIQUE INDEX \`rank_keyword_project_kw_loc_uidx\` ON \`rank_keyword\` (\`project_id\`,\`keyword\`,\`location\`);` (spec §1: o intrare per keyword + locație)

`0513_rank_snapshot.sql`:
```sql
CREATE TABLE `rank_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL REFERENCES `rank_keyword`(`id`) ON DELETE cascade,
	`device` text NOT NULL,
	`checked_at` text NOT NULL,
	`day_key` text NOT NULL,
	`position` integer,
	`page` integer,
	`ranking_url` text,
	`serp_features` text NOT NULL DEFAULT '[]',
	`ai_overview` text NOT NULL DEFAULT 'absent',
	`competitors` text NOT NULL DEFAULT '{}',
	`top_results` text NOT NULL DEFAULT '[]',
	`provider` text NOT NULL DEFAULT 'scraper',
	`created_at` text NOT NULL DEFAULT current_timestamp
);
```
`0514_rank_snapshot_kw_device_day_uidx.sql`: `CREATE UNIQUE INDEX \`rank_snapshot_kw_device_day_uidx\` ON \`rank_snapshot\` (\`keyword_id\`,\`device\`,\`day_key\`);` (idempotența zilnică + UPSERT la re-rulare manuală)

`0515_rank_run.sql`:
```sql
CREATE TABLE `rank_run` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`project_id` text NOT NULL REFERENCES `rank_project`(`id`) ON DELETE cascade,
	`day_key` text NOT NULL,
	`trigger` text NOT NULL DEFAULT 'cron',
	`triggered_by` text,
	`provider` text NOT NULL DEFAULT 'scraper',
	`started_at` text NOT NULL,
	`finished_at` text,
	`keywords_checked` integer NOT NULL DEFAULT 0,
	`up` integer NOT NULL DEFAULT 0,
	`down` integer NOT NULL DEFAULT 0,
	`flat` integer NOT NULL DEFAULT 0,
	`failed` integer NOT NULL DEFAULT 0,
	`avg_position` real,
	`visibility` real,
	`alerts` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'running',
	`error_note` text,
	`created_at` text NOT NULL DEFAULT current_timestamp
);
```
`0516_rank_run_project_idx.sql`: `CREATE INDEX \`rank_run_project_idx\` ON \`rank_run\` (\`project_id\`,\`started_at\`);`

`0517_rank_alert.sql`:
```sql
CREATE TABLE `rank_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`keyword_id` text NOT NULL REFERENCES `rank_keyword`(`id`) ON DELETE cascade,
	`run_id` text NOT NULL REFERENCES `rank_run`(`id`) ON DELETE cascade,
	`device` text NOT NULL,
	`type` text NOT NULL,
	`delta` integer,
	`from_position` integer,
	`to_position` integer,
	`notified_at` text,
	`created_at` text NOT NULL DEFAULT current_timestamp
);
```
`0518_rank_alert_tenant_idx.sql`: `CREATE INDEX \`rank_alert_tenant_idx\` ON \`rank_alert\` (\`tenant_id\`,\`created_at\`);`

`0519_rank_settings.sql`:
```sql
CREATE TABLE `rank_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`check_hour` text NOT NULL DEFAULT '06:00',
	`report_day` integer NOT NULL DEFAULT 1,
	`report_hour` text NOT NULL DEFAULT '07:00',
	`recipients` text NOT NULL DEFAULT '[]',
	`send_to_client` integer NOT NULL DEFAULT 0,
	`attach_pdf` integer NOT NULL DEFAULT 1,
	`archive_to_client` integer NOT NULL DEFAULT 1,
	`alerts_enabled` integer NOT NULL DEFAULT 1,
	`provider_mode` text NOT NULL DEFAULT 'scraper',
	`is_enabled` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```
`0520_rank_settings_tenant_uidx.sql`: `CREATE UNIQUE INDEX \`rank_settings_tenant_uidx\` ON \`rank_settings\` (\`tenant_id\`);`

`0521_rank_report.sql`:
```sql
CREATE TABLE `rank_report` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`week_key` text NOT NULL,
	`sent_at` text,
	`project_count` integer NOT NULL DEFAULT 0,
	`keyword_count` integer NOT NULL DEFAULT 0,
	`avg_position` real,
	`visibility` real,
	`delta_visibility` real,
	`top_up` text NOT NULL DEFAULT '[]',
	`top_down` text NOT NULL DEFAULT '[]',
	`distribution` text NOT NULL DEFAULT '{}',
	`alert_count` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'sent',
	`note` text,
	`recipients` text NOT NULL DEFAULT '[]',
	`created_at` text NOT NULL DEFAULT current_timestamp
);
```
`0522_rank_report_tenant_week_uidx.sql`: `CREATE UNIQUE INDEX \`rank_report_tenant_week_uidx\` ON \`rank_report\` (\`tenant_id\`,\`week_key\`);`

`0523_serp_integration.sql`:
```sql
CREATE TABLE `serp_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`provider` text NOT NULL DEFAULT 'dataforseo',
	`login_encrypted` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`is_active` integer NOT NULL DEFAULT 1,
	`last_tested_at` text,
	`last_error` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```
(+ unique pe tenant în același stil dacă numărul de fișiere o cere: `0524_serp_integration_tenant_uidx.sql`: `CREATE UNIQUE INDEX \`serp_integration_tenant_uidx\` ON \`serp_integration\` (\`tenant_id\`);` — da, se adaugă, totalul devine 17 fișiere 0508–0524.)

- [ ] **Step 3:** adaugă intrările în `_journal.json` cu `idx` 508…524 și `when` incrementat manual peste maximul existent (+1 per fișier)
- [ ] **Step 4:** `bun run db:migrate` + verifică pe remote `PRAGMA table_info(rank_project)` și `PRAGMA index_list(rank_snapshot)` (feedback_migration_flow)
- [ ] **Step 5:** abia ACUM tabelele în `schema.ts` (banner `// ===== Rank Tracker =====`, custom types `timestamp`/`boolean`/`jsonb` din capul fișierului, camelCase→snake_case, enum-uri: `device: text('device', { enum: ['desktop','mobile'] })`, `aiOverview: text('ai_overview', { enum: ['absent','present','cited'] })`, `status` run: `['running','ok','partial','interrupted']`, `type` alertă: `['drop','out_of_top10','lost']`, `providerMode: ['scraper','dataforseo','auto']`) + `relations` (project→client, project→many keywords, keyword→many snapshots, run→project) + tipuri `$inferSelect`/`$inferInsert`
- [ ] **Step 6:** `bun run test` (fără regresii) → commit `feat(rank-tracker): schema + migrări 0508-0524`

## Task 3: Parser SERP (pur) + fixtures

**Files:** Create `providers/types.ts`, `providers/serp-parser.ts`, `__tests__/serp-parser.test.ts`, `__tests__/fixtures/*.html`

`types.ts`:
```ts
export interface SerpQuery { keyword: string; device: 'desktop'|'mobile'; googleDomain: string; hl: string; gl: string; location: string; depth: number; }
export interface SerpOrganicResult { position: number; url: string; domain: string; title: string; snippet: string; }
export interface SerpResult {
  organic: SerpOrganicResult[];              // toate pozițiile organice găsite (max depth)
  features: string[];                        // 'ai'|'snippet'|'local'|'paa'|'images'|'video'|'shopping'|'ads'
  aiOverview: 'absent'|'present'|'cited';    // 'cited' doar dacă domeniul țintă apare ca sursă
  raw?: { blocked?: boolean };
}
export class SerpProviderError extends Error { constructor(message: string, public kind: 'blocked'|'timeout'|'network'|'parse'|'config', public retryable: boolean) { super(message); } }
export interface SerpProvider { name: 'scraper'|'dataforseo'; fetchSerp(q: SerpQuery, targetDomain: string): Promise<SerpResult>; }
```

- [ ] **Step 0: script de captură fixtures** — Create `app/scripts/capture-serp-fixture.ts`: lansează puppeteer-core local (findChromePath), navighează pe un query dat ca argument, salvează `page.content()` în `__tests__/fixtures/<nume>.html`. Rulează-l pentru desktop + mobile + un query care declanșează AI Overview. DACĂ execuția e blocată (CAPTCHA / fără Chromium local), FALLBACK: scrie fixture-uri de mână, HTML minimal dar structural fidel (documentează în fixture un comentariu `<!-- fixture sintetic, structura Google sept 2026 -->`); fixture-ul CAPTCHA se scrie întotdeauna de mână (`Our systems have detected unusual traffic` + form `#captcha-form`). (Amendament Gemini: agentul implementator nu are browser cu IP românesc garantat.)
- [ ] **Step 1: fixtures** — cele 4 fișiere: desktop cu 10+ organice + PAA + local pack, mobile, AI Overview (marker `AI Overview` cu listă de surse — `cited` se decide căutând LINK-URILE din interiorul blocului AIO, nu doar prezența blocului), CAPTCHA. Parserul se scrie pe structura din fixtures, cu selectoare DEFENSIVE (mai multe strategii: `a[href^="http"]` cu `h3` în subtree, filtrat de containerele de ads `[data-text-ad]`, dedup pe URL).
- [ ] **Step 2: teste eșuate** pentru `parseSerpHtml(html, { targetDomain, competitors }): SerpResult` + `matchDomain(url, domain)` (subdomenii DA — `blog.example.ro` ∈ `example.ro`; alt TLD NU; www strip; exclus rezultate plătite) + `pickTargetPosition(organic, targetDomain)` → primul organic al domeniului + `competitorPositions(organic, competitors)` → `Record<string, number|null>` din top 10 + `detectBlocked(html)` → true pe fixture-ul CAPTCHA.
  - **Guard anti-„lost fals"** (amendament Gemini): HTML nedetectat ca blocat dar cu 0 rezultate organice parsate → `SerpProviderError(kind: 'parse', retryable: false)` — NU un SerpResult gol. Un selector rupt de un redesign Google trebuie să producă eșec de verificare (fără snapshot, run `partial`), NU snapshot cu `position: null` care ar declanșa alerte „lost" în tot portofoliul.
- [ ] **Step 3: implementare** — parsare cu regex/`HTMLRewriter`-free: folosește `cheerio`? NU adăuga dependență nouă fără verificare: verifică `bun pm ls | grep -i cheerio` — dacă nu există, parsează cu `DOMParser` NU e disponibil în Bun server… soluția standard în repo: verifică ce folosește `content/` la parsare HTML (există `node-html-parser` sau similar în package.json?). Dacă nu există NIMIC: adaugă `node-html-parser` (mic, fără binare — sigur pentru buildul 4Gi) și documentează în plan-deviations. Parserul e PUR (string in → obiect out).
- [ ] **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): parser SERP cu fixtures`

## Task 4: Provider scraper in-house (puppeteer-core)

**Files:** Create `providers/serp-scraper.ts`, `__tests__/serp-scraper.test.ts`

- [ ] **Step 1: teste eșuate** (browserul se injectează prin `deps` — testele NU deschid Chromium):
  - `buildSerpUrl(q: SerpQuery)` → `https://www.google.ro/search?q=...&num=100&hl=ro&gl=ro` + `uule` doar când `location` nenul; `buildUule('București,Romania')` → encoding canonic (`w+CAIQICI` + lungime + numele, base64-safe) — test cu o valoare cunoscută verificată manual.
  - device mobile → viewport 390×844 + UA de Chrome Android; desktop → 1366×768 + UA desktop.
  - `fetchSerpScraper(q, targetDomain, deps)`: pe HTML normal → SerpResult; pe HTML CAPTCHA → aruncă `SerpProviderError('blocked', kind:'blocked', retryable:false)`; timeout navigare → `kind:'timeout'`, retryable true; retry ×2 DOAR pe retryable, cu backoff + jitter (model `pagespeed/client.ts`).
  - pacing: între apeluri consecutive `sleep(paceMs + jitter)`, `paceMs` din `env.RANK_PACE_MS` (default 8000) — verificat cu `sleep` injectat.
  - proxy: dacă `env.RANK_PROXY_URLS` e setat, browserul se lansează cu `--proxy-server=<următorul din listă round-robin>` — testabil prin captura opțiunilor de launch injectate.
- [ ] **Step 2: FAIL** → **Step 3: implementare**:
  - `deps = { launch?, sleep?, env? }`; implementarea reală: `puppeteer-core` + `findChromePath()` din `$lib/server/scraper/find-chrome` (CHROME_PATH în prod = `/usr/bin/chromium`, deja în Dockerfile). Stealth MANUAL după modelul `scraper/cloudflare-bypass.ts` (nu activa puppeteer-extra-plugin-stealth — există în package.json dar codebase-ul îl evită deliberat).
  - Un browser per rulare de proiect (nu per keyword): lansat de runner și pasat providerului; pagină nouă per query, închisă după. Cookie-uri de consimțământ Google: setează cookie `SOCS`/`CONSENT` înainte de navigare (documentează valoarea în cod).
  - `waitUntil: 'networkidle2'` + `AbortSignal`-echivalent prin `page.goto(..., { timeout: 45_000 })`, apoi `page.content()` → `parseSerpHtml`.
- [ ] **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): provider scraper puppeteer-core`

## Task 5: Provider DataForSEO (opțional) + selecția providerului

**Files:** Create `providers/dataforseo.ts`, `providers/resolve.ts`, `__tests__/dataforseo.test.ts`, `__tests__/resolve.test.ts`, `__tests__/fixtures/dataforseo-serp.json`

- [ ] **Step 1: teste eșuate**:
  - `parseDataforseoResponse(json, targetDomain, competitors)` pe fixture (endpoint `/v3/serp/google/organic/live/advanced`, `depth: 100`, item types `organic`/`ai_overview`/`people_also_ask`/`local_pack`) → același `SerpResult` ca parserul HTML.
  - `fetchSerpDataforseo(q, targetDomain, deps)`: Basic auth din credențiale decriptate; `AbortSignal.timeout(30_000)`; 401/402 → `kind:'config'` neretryable; 5xx/timeout → retryable; `location_name` din `q.location` sau din `gl` („Romania").
  - `resolveSerpProvider(tenantId)`: `provider_mode='scraper'` → scraper; `'dataforseo'` → DataForSEO (eroare clară dacă nu există `serp_integration` activ); `'auto'` → scraper, dar `shouldFailover(run: {keywordsChecked, failed})` → true când `failed/keywordsChecked > 0.2` și există integrare activă.
  - decriptarea: `decrypt` cu retry o dată pe `DecryptionError` cu re-citire din DB (modelul EXACT din `plugins/claude/index.ts::decryptSlot`); crypto = re-export din `plugins/smartbill/crypto` (`encryptVerified`/`decrypt`/`DecryptionError`).
- [ ] **Step 2: FAIL** → **Step 3: implementare** → **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): provider DataForSEO + failover auto`

## Task 6: Runner per proiect (snapshot-uri + run + progres Redis + alerte)

**Files:** Create `run.ts`, `alerts.ts`, `__tests__/run.test.ts`, `__tests__/alerts.test.ts`

- [ ] **Step 1: teste eșuate** pentru `runRankProjectCheck({ tenantId, projectId, trigger }, deps)` (deps: `{ provider?, sleep?, now? }`; dbMock cu selectQueue, Redis = Map — modelul `pagespeed/__tests__/scan.test.ts`):
  - proiect cu 2 keywords active × devices `["desktop","mobile"]` → 4 apeluri provider, 4 UPSERT-uri snapshot (`onConflictDoUpdate` pe `(keyword_id, device, day_key)`), `page = ceil(position/10)`, `competitors` doar din top 10, `top_results` = primele 10 organice `{position,domain,url,title,snippet}`.
  - poziție negăsită în depth 100 → `position: null`, `page: null`, `ranking_url: null` (afișat „100+").
  - eroare provider pe un keyword (după retry) → FĂRĂ rând snapshot pentru acel (keyword, device), `run.failed++`, restul cozii continuă; `run.status='partial'` + `error_note` cu lista.
  - eroare `kind:'blocked'` → oprește scraperul imediat (nu insista — evită ban), run `partial`, `error_note='blocat de Google (CAPTCHA)…'`; în modul `auto` cu integrare activă → **restul cozii din ACEEAȘI rulare** continuă cu providerul DataForSEO și notează `provider='dataforseo'` pe snapshot-urile respective (nu se amână pe rularea următoare). Regula de failover în modul `auto`: la `blocked` SAU când, după ≥10 verificări, `failed/checked > 0.2`.
  - `day_key` se calculează O DATĂ la STARTUL rulării (`rankDayKey(now)`) și se folosește pentru toate snapshot-urile rulării — o rulare care traversează miezul nopții nu scrie pe 2 zile (amendament Gemini).
  - alerta `'lost'` se emite DOAR când snapshotul zilei există cu `position: null` (verificare reușită, domeniu negăsit) — niciodată din verificări eșuate (parse/blocked/timeout).
  - progres Redis `${tenantId}:rank:run:${projectId}` `{ runId, total, done, currentKeyword, startedAt, finishedAt? }` TTL 30 min, șters cu grație 20 s la final (modelul `scanProgressKey`).
  - agregate run: `up/down/flat` din compararea cu snapshotul zilei precedente CELE MAI RECENTE per (keyword, device) (`positionDelta`), `avg_position` (medie pozițiilor non-null, null peste 100 EXCLUS din medie dar numărat în vizibilitate cu CTR 0), `visibility` cu formula din Task 1, `status='ok'` când failed=0, `finished_at` setat.
  - re-rulare manuală în aceeași zi → UPSERT (nu rând nou), iar run rows: rând NOU cu `trigger='manual'`.
  - **alerte** (`alerts.ts`, `computeAlerts(prev, next, threshold)` pur + `persistAlerts`): `delta <= -threshold` → `type='drop'`; era ≤10 și acum >10 sau null → `'out_of_top10'`; era non-null și acum null → `'lost'`; un rând `rank_alert` per (keyword, device, tip), `run.alerts` = count.
- [ ] **Step 2: FAIL** → **Step 3: implementare** (secvențial, pacing între apeluri prin provider; browserul scraper e deschis o dată per rulare și închis în `finally`) → **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): runner + alerte`

## Task 7: Joburi scheduler (daily check + one-shot per proiect + recovery)

**Files:** Create `scheduler/tasks/rank-daily-check.ts`, `rank-project-check.ts`, `__tests__/rank-daily-check.test.ts`; Modify `scheduler/index.ts`

- [ ] **Step 1: teste eșuate** pentru `processRankDailyCheck(now, deps)` (deps `{ enqueue, listTenants }`-style, model `pagespeed-weekly-report.test.ts` cu `bucharestNow`):
  - tenant cu `rank_settings.is_enabled=1` și `check_hour` care se potrivește orei Bucharest → enqueue câte un job `rank_project_check` per proiect ACTIV (`active=1`, fără `paused_at`), `jobId` = `rank-project-check-<projectId>-<dayKey>` (dedup natural BullMQ pe zi), `attempts: 1`, `removeOnComplete/Fail: true`.
  - oră nepotrivită → skip; proiect care ARE deja `rank_run` cu `status IN ('ok','partial')` pe `day_key`-ul curent → skip (idempotență la nivel de zi).
  - `processRankProjectCheck(params)` → validează `tenantId` + `projectId`, delegă la `runRankProjectCheck`, apoi dacă `run.alerts > 0` apelează trimiterea emailului de alerte (Task 8) cu deps injectate.
- [ ] **Step 2: FAIL** → **Step 3: implementare + înregistrare în `scheduler/index.ts`** — TOATE punctele:
  1. importuri `processRankDailyCheck`, `processRankProjectCheck` (+ Task 8/9: `processRankWeeklyReport`, `processRankVolumeRefresh`);
  2. `taskHandlers`: `rank_daily_check`, `rank_project_check`, `rank_weekly_report`, `rank_volume_refresh`;
  3. `expectedJobIds`: `'rank-daily-check'`, `'rank-weekly-report'`, `'rank-volume-refresh'` (NU `rank_project_check` — e one-shot; altfel joburile recurente sunt ȘTERSE la fiecare boot);
  4. `add()`-uri: `rank-daily-check` pattern `'0 * * * *'` tz Europe/Bucharest `attempts: 1`; `rank-weekly-report` `'0 * * * *'` (potrivire internă pe report_day/report_hour); `rank-volume-refresh` `'0 5 1 * *'`;
  5. `JOB_LABELS`: `rank_daily_check: 'Verificare zilnică poziții (Rank Tracker)'` etc.;
  6. JOB_PARAMS/JOB_HANDLER_TYPES dacă schema existentă o cere.
  - **Bloc restart-recovery** în `startScheduler()` lângă cel pentru `seo_link_discovery_job`: `rank_run` cu `status='running'` → `status='interrupted'`, `error_note='întrerupt de restart'`.
- [ ] **Step 4: PASS** (`bun run test rank`) → **Step 5: commit** `feat(rank-tracker): joburi scheduler + recovery`

## Task 8: Alerte email + raport săptămânal (HTML + PDF + arhivare în fișa clientului)

**Files:** Create `report-html.ts` (PUR, doar importuri relative), `report.ts`, `report-pdf.ts`, `archive.ts`, `scheduler/tasks/rank-weekly-report.ts`, `__tests__/report.test.ts`, `__tests__/rank-weekly-report.test.ts`, `scripts/demo-rank-report-email.ts`, `scripts/demo-rank-alert-email.ts`; Modify `email-logger.ts`, `email.ts`

- [ ] **Step 1: teste eșuate**:
  - `buildRankReportData(tenantId, weekKey)` → `{ weekKey, weekLabel, interval, projectCount, keywordCount, avgPosition, visibility, deltaVisibility, topUp: [{keyword, domain, from, to, delta}]×5, topDown×5, distribution: Record<RankBucket, number>, aiOverview: {present, cited}, alertCount, projects: [...] }` — comparând ultima zi cu snapshot din săptămâna raportată vs aceeași zi acum 7 zile; serializabil JSON integral (replay registry).
  - `processRankWeeklyReport(now, deps)`: potrivire `report_day`+`report_hour` Bucharest; idempotent pe unique `(tenant_id, week_key)` (select-then-skip); `recipients=[]` → nu trimite, report `note='fără destinatari'`; `send_to_client=1` → adaugă emailurile clienților proiectelor cu client asociat; o parte din emailuri eșuate → `status='partial'`.
  - arhivare (`archive.ts`): pentru FIECARE proiect cu `client_id` și `archive_to_client=1` → `generateRankReportPdf(dataPerProiect)` → `storage.uploadBuffer(tenantId, buffer, 'raport-pozitii-S<nn>-<domeniu>.pdf', 'application/pdf')` → insert rând `document` (ATENȚIE: `document.clientId` NOT NULL — de-asta arhivarea e per proiect-cu-client, nu per tenant; `document.uploadedByUserId` NOT NULL — folosește userul owner al tenantului, rezolvat cu ACELAȘI pattern ca în `documents.remote.ts:259` `generateDocumentFromTemplate`; citește fișierul înainte).
- [ ] **Step 2: FAIL** → **Step 3: implementare**:
  - `email-logger.ts`: `'rank-report'`, `'rank-alert'` în EMAIL_TYPES.
  - `email.ts`: `sendRankReportEmail(tenantId, recipientEmail, data)` + `sendRankAlertEmail(tenantId, recipientEmail, alertData)` prin `sendWithPersistence` (emailType corespunzător, payload `{sendFn, args}` serializabil, EMAIL_SEND_REGISTRY ambele; brand prin `renderBrandedEmail` + `fetchTenantBrand`, `text:` alternativ din renderer-ul pur, `attachments` cu `brand.logoAttachment`; PDF-ul importat dinamic în `buildMail` doar când `attach_pdf=1`).
  - Subiecte: `Raport poziții Google — S<nn> (<interval>)`; `Alerte poziții Google — <domeniu> (<n> alerte)`. Conținut alertă: tabel keyword / device / poziție veche → nouă / Δ, cu tipul în română („scădere", „ieșit din top 10", „dispărut din top 100").
  - `report-pdf.ts`: pdfkit A4, fonturi DejaVu prin `resolveAssetsDir()` cu DOUĂ adâncimi de path (model `pagespeed/report-pdf.ts` — altfel diacriticele mor DOAR în prod).
  - `rank-weekly-report.ts`: NU redeclanșează verificări (folosește snapshot-urile existente ale săptămânii — spre deosebire de PageSpeed, rularea zilnică e deja separată).
- [ ] **Step 4: PASS**; rulează ambele demo-uri (`bun run scripts/demo-rank-report-email.ts > /tmp/rank-report.html && open /tmp/rank-report.html`) → **Step 5: commit** `feat(rank-tracker): alerte + raport săptămânal + arhivare`

## Task 9: Volume de căutare din Google Ads (lunar)

**Files:** Create `volume.ts`, `__tests__/volume.test.ts`, `scheduler/tasks/rank-volume-refresh.ts`

- [ ] **Step 1: teste eșuate** pentru `refreshKeywordVolumes(tenantId, deps)`:
  - tenant fără `google_ads_integration` activă → `{ skipped: true, reason }` (fără eroare);
  - cu integrare: batch-uri de max 20 keywords per apel `generateKeywordHistoricalMetrics` (limita API 10k/req dar batch mic = erori izolate), update `rank_keyword.volume` + `volume_updated_at`; eroare API → log + continuă cu următorul batch.
- [ ] **Step 2: FAIL** → **Step 3: implementare** — folosește `getAuthenticatedClient(tenantId)` din `google-ads/auth.ts` + `Customer(...)` ca în `google-ads/client.ts`; `keywordPlanIdeaService.generateKeywordHistoricalMetrics({ customer_id, keywords, geo_target_constants: ['geoTargetConstants/2642'] /* România */, language: 'languageConstants/1032' /* ro */ })`; `avg_monthly_searches` → volume. GOTCHA documentat în cod: dev token per tenant — un token de test întoarce volume goale.
- [ ] **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): volume lunare din Google Ads`

## Task 10: Read model partajat + remote functions

**Files:** Create `projects-data.ts`, `__tests__/projects-data.test.ts`, `remotes/rank-tracker.remote.ts`, `remotes/__tests__/rank-tracker.remote.test.ts`

- [ ] **Step 1: teste eșuate**:
  - `buildRankProjects(tenantId, { clientId? })` → `{ projects: [{ id, name, domain, clientName, keywordCount, avgPosition, visibility, delta7dVisibility, distribution, lastRunAt, lastRunStatus, alertsLast7d, active }] , totals }` — `clientId` intră în WHERE-ul SQL (niciodată filtrare în JS);
  - `buildRankProjectDetail(tenantId, projectId, { clientId? })` → proiect + keywords cu `{ position, page, delta1, delta7, delta30, best, rankingUrl, features, aiOverview, volume, tag, location, device split, spark30: (number|null)[], cannibalization }` + serii de trend (vizibilitate + avg pe ultimele 30 de zile, cu GAP la zilele lipsă — `null` în serie, NU interpolare) + runs recente + SoV competitori;
  - remotes (mock `$app/server` cu `withSchema` care rulează valibot REAL; model `pagespeed.remote.test.ts`):
    - `getRankProjects = query(...)`, `getRankProjectDetail = query(v.string(), ...)`, `getRankSettings/saveRankSettings` (upsert; validare `check_hour`/`report_hour` din `PSI_HOURS`… NU: orele de verificare permit orice `HH:00` 00–23 — listă proprie `RANK_HOURS`; `report_day` 1–7), `saveRankProject = command(schema)` (normalizează domain: strip `https://`, `www.`, lowercase; validare competitors ≤ 10, locations ≤ 5), `deleteRankProject = command(v.string())` (filtru pe `id` ȘI `tenantId`), `addRankKeywords = command({ projectId, keywords: string[], tag?, location?, device-agnostic })` — dedup contra unique-ului `(project, keyword, location)`, REFUZĂ peste `RANK_MAX_KEYWORDS_PER_PROJECT` (spec §5: blochează peste limită, mesaj clar), `updateRankKeyword` / `deleteRankKeyword`, `startRankCheck = command({ projectId? })` — 409 dacă progresul Redis există; **rate limit manual: refuză dacă proiectul are un run `trigger='manual'` în ultima ORĂ** (spec §2); enqueue `rank_project_check` cu jobId timestampat, `getRankRunStatus = query(...)` (citește cheile Redis), `getRankReports = query(...)`, `sendRankReportNow = command(...)` (`note: 'trimis manual'`), `getRankAlerts = query(...)` (ultimele 50), `getRankClients = query(...)` ({id,name} pt. dropdown), `saveSerpIntegration = command(...)` (`encryptVerified`, `keyHint`-style: NU întoarce NICIODATĂ credențialele; test explicit) + `testSerpIntegration = command(...)`;
    - tenant scoping negativ: id de alt tenant → 404/throw + `expect(inserted.length).toBe(0)`.
- [ ] **Step 2: FAIL** → **Step 3: implementare** (toate încep cu `requireTenantEvent()` + `await requireStaff(event)`; mutațiile cu `.updates()` la apel din UI) → **Step 4: PASS** → **Step 5: commit** `feat(rank-tracker): read model + remote functions`

## Task 11: UI admin (hub proiecte + detaliu + drawer) — crm-dev-flow 4b: Plan/Audit/Verify

**Files:** Create componentele + rutele din structura de fișiere; Modify `sidebar-nav.ts`, `NavIcon.svelte`, `sidebar-nav.test.ts`, `SeoHubView.svelte`, `seo-hub.css`, `(app)/seo/+page.svelte`

Reguli: Svelte 5 runes; date prin `$derived(await getRankProjects())` etc.; stări explicite Loading/Empty/Error definite ÎNAINTE de markup; dark mode pentru orice culoare hard-codată; tabelele late în containere `overflow-x: auto`; fără breadcrumb propriu; polling progres DOAR cât există run activ ($effect + setInterval 2.5s — excepția motivată de la feedback_no_auto_polling).

- [ ] **Step 1: `rank-tracker.css`** — importă vocabularul `cl-*`/`psi-*` (`@import '../pagespeed/pagespeed.css'` NU se face în CSS — importă în componentă ca la SeoHubView; vezi cum face `seo-hub.css`) + clase noi doar `rk-*` (badge-uri features, chip canibalizare, celule Δ, distribuție).
- [ ] **Step 2: `RankTrackerView.svelte`** (hub): hero cu acțiuni (Proiect nou, Setări raport, Verifică tot), 4 KPI (proiecte active, keywords urmărite, vizibilitate medie, alerte 7 zile), tabel proiecte (domeniu+favicon `PsiFav`, client, keywords, vizibilitate cu Δ7d, poziție medie, distribuție mini `RkDistBar`, ultima rulare + status, acțiuni: verifică/edit/pauză), click pe rând → navighează la detaliu; secțiunea „Rapoarte trimise" (model PageSpeed) + „Alerte recente".
- [ ] **Step 3: `RankProjectView.svelte`** (detaliu, ruta `[projectId]`): header proiect (domeniu, locale, locații, competitori, prag alertă), KPI-uri (vizibilitate, poziție medie, distribuție, AI Overview count), grafic trend 30 zile (`RkPosChart` — vizibilitate + avg position pe axe INVERSATE unde e cazul; gap-urile din serie rămân goluri vizibile), toolbar (căutare, filtre tag/locație/device segmented, sortare), tabelul de keywords (keyword, tag, device icon, poziție + `Pagina N`, Δ1z/Δ7z/Δ30z cu `PsiDelta`-style, best, URL care rankează truncat, features `RkFeatureIcons`, AI Overview badge — „citat" verde, volum, spark 30z), click → `KeywordDrawer` (istoric 90 zile chart, competitori SoV pe keywordul respectiv din `competitors` snapshot, ambele URL-uri la canibalizare cu chip roșu, target URL vs ranking URL mismatch warning), banner rulare în curs cu progres.
- [ ] **Step 4: modale** — `ProjectModal` (nume, client dropdown, domeniu, locale select `google.ro|ro`/`google.com|en`/`google.de|de`…, locații chips max 5, competitori chips max 10, devices checkbox, prag, activ), `KeywordsModal` (textarea bulk „un cuvânt pe linie", tag, locație, contor + avertisment limită 500), `RankSettingsModal` (oră verificare zilnică, zi+oră raport, destinatari chips, toggles: trimite clientului / atașează PDF / arhivează în fișa clientului / alerte activate, mod provider: In-house / DataForSEO / Auto + formular credențiale DataForSEO cu test conexiune), `RankMailPreviewModal` (agregatele raportului + „Trimite acum").
- [ ] **Step 5: rute + nav + hub** — `+page.svelte`-urile subțiri cu `<svelte:head>` titlu; `+page.ts` cu `ssr=false`; sidebar (IconKey + copil + NavIcon `TrendingUpIcon`); **actualizează `sidebar-nav.test.ts`** (assertul hard pe children); `SeoHubView` al 4-lea card (icon TrendingUp, stats: proiecte/keywords/vizibilitate) + `moduleHrefs.rankTracker` + grid CSS 4 coloane + portal call-site.
- [ ] **Step 6:** `svelte-autofixer` pe FIECARE componentă modificată/creată; `/build-check` (fără erori noi peste baseline).
- [ ] **Step 7 (Audit):** `design-auditor` + `web-design-guidelines` pe componentele noi; fix Critical/High; test overflow cu keyword-uri/URL-uri lungi; dark mode verificat.
- [ ] **Step 8 (Verify):** `testermcp` golden path: login dev (tenant ots) → `/ots/seo-links/rank-tracker` → creează proiect (domeniu real al unui client) → adaugă 3 keywords → Verifică acum → progres → poziții apar → detaliu → drawer → setări → salvare. Screenshots. Commit `feat(rank-tracker): UI admin`.

## Task 12: Portal client (read-only)

**Files:** Create `(app)/rank-tracker/+page.server.ts`, `+page.svelte`, `RankClientView.svelte`; Modify `portal-access.ts`, `access/catalog.ts`, `(app)/+layout.svelte`

- [ ] **Step 1:** `portal-access.ts` — branch `/rank-tracker` → `'seo'` (FĂRĂ el ruta e nepăzită!); `catalog.ts` — branch → `'portal.seo.view'`; test în `team-access-categories.test.ts` SAU testul existent de route mapping (verifică unde se testează `routeRequiresAccess` azi și extinde acolo).
- [ ] **Step 2:** `+page.server.ts` — guard verbatim (`if (!tenant || !event.locals.isClientUser || !client) throw error(403, 'Acces doar din portalul clientului.')`) + `buildRankProjects(tenant.id, { clientId: client.id })` + pentru fiecare proiect `buildRankProjectDetail` LIMITAT (sau un builder dedicat `buildRankClientData` care întoarce proiectele clientului cu keywords + serii — decide după mărimea datelor; nu trimite `top_results`/competitori interni dacă nu se afișează).
- [ ] **Step 3:** `RankClientView.svelte` — read-only: proiectele clientului, KPI-uri, tabel keywords cu poziții/Δ/pagina/features, grafic trend; FĂRĂ butoane de rulare/editare/setări; nav portal + `moduleHrefs` deja legate în Task 11.
- [ ] **Step 4:** autofixer + `/build-check` + testermcp pe portal (user client) → commit `feat(rank-tracker): portal client`

## Task 13: Env + debug endpoint + docs

**Files:** Modify `.env`, `.env.example`; Create `[tenant]/api/_debug-rank-health/+server.ts`, `app/docs/rank-tracker.md`

- [ ] `RANK_PACE_MS=8000`, `RANK_PROXY_URLS=`, `RANK_MAX_KEYWORDS_PER_PROJECT=500` în ambele; `git diff .hostedignore` curat. Endpoint admin-gated (modelul `_debug-pagespeed-health`): starea Chromium (`findChromePath()` + versiune), pacing/proxy config (FĂRĂ valorile proxy-urilor — doar count), `?probe=1` → un SERP real pe un keyword de test cu domeniu example.com (raportează blocked/ok/durata), starea cheilor Redis de run, ultimul `rank_run` per proiect, starea `serp_integration` (există/activ/lastError — NICIODATĂ credențialele). Docs cu secțiunile: Arhitectură / Model de date (migrări 0508–0524) / Provideri SERP + riscul ToS și mitigări / Joburi / UI / Operațional (ce faci când apare `blocked`). Commit.

## Task 14: Verificare finală + review

- [ ] `bun run test` complet (0 fail, fără CRASH-uri — verifică lista de fișiere, nu doar pass count); `/build-check` fără erori noi
- [ ] Criteriile din spec verificate unul câte unul cu dovezi (superpowers:verification-before-completion): §1 model de date ✓ tabele+istoric nesuprascris; §2 rulare zilnică 06:00 configurabilă + retry + partial + gap + manual rate-limited; §3 vizibilitate/SoV/Δ/canibalizare/distribuție (teste pure); §4 alerte + raport luni + AI Overview raportat separat; §5 limita 500 + 1 request per verificare; §6 câmpurile preluate din GreatStack (`currentPosition/currentPage/bestPosition/positionChange/competitors{position,url,domain,title,snippet}` + „Pagina N")
- [ ] `grep -rn "RANK_PROXY_URLS\|login_encrypted\|password_encrypted" app/src` → doar în cod server; credențialele nu ajung în niciun răspuns remote
- [ ] superpowers:requesting-code-review + gemini second opinion (modul nou, suprafață mare, security pe scraper + credențiale)
- [ ] Fix-uri din review → re-verificare → commit final
- [ ] `graphify . --update`; propune deploy și AȘTEAPTĂ „go" (feedback_deploy_workflow). NOTĂ deploy: prima rulare pe prod trebuie verificată cu `_debug-rank-health?probe=1` (Chromium in-cluster) + memoria `reference_prod_deploy_verification_probe`.

## Self-review (făcut la scriere)

- Spec §1 → Task 2 (nume prefixate, deviație documentată; `runs.status` extins cu `running`/`interrupted` pentru recovery — superset al spec-ului). §2 → Task 4, 6, 7 (cron, retry ×2 pe retryable, partial, gap, manual 1/oră). §3 → Task 1 (formule exacte + teste). §4 → Task 8 (alerte grupate per rulare — deviația 10; raport luni idempotent; AI Overview în raport). §5 → Task 10 (limita 500 refuzată la add), costul = 0 request-uri plătite în modul implicit. §6 → Task 6/11 (top_results cu title+snippet, „Pagina N", bestPosition).
- Riscul principal (blocări Google) e tratat: detecție `blocked` + oprire imediată + failover `auto` + pacing/jitter/proxy config + documentație operațională (Task 13).
- Review Gemini (01 sep) încorporat: delta cu lookback tolerant la gap-uri (Task 1), guard anti-„lost fals" pe parse gol (Task 3, 6), `day_key` fixat la start de rulare (Task 6), `triggered_by` pe `rank_run` (Task 2), script de captură fixtures + fallback sintetic (Task 3), regula de failover clarificată mid-run (Task 6). Respins argumentat: proxy obligatoriu (contrazice constrângerea de cost zero — rămâne opțional + failover), UNIQUE cu location (locația e deja parte din identitatea rândului `rank_keyword`), index suplimentar pe snapshot (redundant cu unique-ul `(keyword_id, device, day_key)`), SET NULL pe `rank_run.project_id` (convenția casei = cascade pe copii).
- Punctele de integrare cu cod existent care RUP teste dacă sunt uitate: `sidebar-nav.test.ts` (Task 11), `moduleHrefs` all-or-nothing (Task 11), `expectedJobIds` (Task 7), branch-urile portal duplicate (Task 12).
