# Modul PageSpeed Insights — Plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modul „SEO Links → PageSpeed" care monitorizează site-uri prin Google PageSpeed Insights API v5, cu scanare manuală + job săptămânal + raport pe email, UI identic cu design-ul Claude (`docs/superpowers/plans/2026-08-31-pagespeed-design/`).

**Architecture:** Client PSI server-side (cheie doar în env `PSI_API_KEY`), procesor de scanare secvențial (1 req/s) rulat prin BullMQ cu progres în Redis; 4 tabele noi (site, measurement, settings, report); remote functions (`query`/`command`, requireStaff + tenant scoping) în locul REST-ului din spec — standardul proiectului; UI portat 1:1 din JSX în Svelte 5, CSS scopat pe `.cl-wrap` după modelul `interviuri.css`.

**Tech Stack:** SvelteKit 5 (runes, remote functions), Drizzle + Turso, BullMQ + Redis, nodemailer prin `sendWithPersistence`, valibot.

**Decizii documentate (deviații de la spec):**
1. REST `/api/pagespeed/*` → remote functions `$lib/remotes/pagespeed.remote.ts` (standard proiect: `feedback_remote_fn_staff_guard`, `feedback_api_routes_tenant_scoped`). Debug operațional: `[tenant]/api/_debug-pagespeed-health`.
2. „Sincron pentru un site" → asincron și pentru un site (PSI 30–60 s × strategii × retry depășește timeout-urile HTTP); criteriul 2 (update fără reload) se păstrează prin polling de progres DOAR pe durata scanării active.
3. `raw_json` (opțional în spec) — omis deliberat (YAGNI, fără consumator).
4. Cron: job orar `pagespeed-weekly-report` care compară `dayOfWeek`+`hour` din setările tenantului cu calendarul Europe/Bucharest (`getBucharestCalendar` din `pdf-report-send.ts`); idempotență prin unique `(tenant_id, week_key)`.

**Referință design (sursa de adevăr UI):** `docs/superpowers/plans/2026-08-31-pagespeed-design/{pagespeed.jsx,pagespeed-bits.jsx,pagespeed-modals.jsx,pagespeed-data.jsx,pagespeed-styles.css}`. Clasele `cl-*` există deja în proiect (model: `app/src/lib/components/interviuri/interviuri.css`); lipsesc doar `cl-btn-mini, cl-field-head, cl-section-actions, cl-switch, cl-switch-slider, cl-toolbar-spacer` (se portează din design) + toate `psi-*`.

**Skill-uri de încărcat la implementare:** `ots-crm-dev`, `database-migrations`, `multi-tenant`, `error-handling`, `email-delivery`, `api-integrations`, `testing-strategy`, `svelte:svelte-core-bestpractices`, `ui-styling` (înainte de UI).

---

## Structura de fișiere

**Create:**
- `app/src/lib/server/pagespeed/client.ts` — apel PSI + parsare răspuns
- `app/src/lib/server/pagespeed/scan.ts` — procesor scanare (1 rps, progres Redis)
- `app/src/lib/server/pagespeed/report.ts` — agregare săptămânală + email HTML
- `app/src/lib/server/pagespeed/__tests__/client.test.ts`
- `app/src/lib/server/pagespeed/__tests__/scan.test.ts`
- `app/src/lib/server/scheduler/tasks/pagespeed-weekly-report.ts`
- `app/src/lib/server/scheduler/tasks/pagespeed-scan.ts` (handler BullMQ pt. scanare manuală)
- `app/src/lib/server/scheduler/tasks/__tests__/pagespeed-weekly-report.test.ts`
- `app/src/lib/remotes/pagespeed.remote.ts`
- `app/src/lib/remotes/__tests__/pagespeed.remote.test.ts`
- `app/src/lib/components/pagespeed/pagespeed.css`
- `app/src/lib/components/pagespeed/PagespeedView.svelte` (pagina principală)
- `app/src/lib/components/pagespeed/psi-bits.svelte.ts` + componente mici: `PsiDonut.svelte`, `PsiSpark.svelte`, `PsiDelta.svelte`, `PsiMetric.svelte`, `PsiCwv.svelte`, `PsiLine.svelte`, `PsiSwitch.svelte`, `PsiStratIcon.svelte`
- `app/src/lib/components/pagespeed/SiteModal.svelte`, `ScheduleModal.svelte`, `SiteDrawer.svelte`, `MailPreviewModal.svelte`
- `app/src/lib/logic/pagespeed.ts` — praguri, nivele, formatare (pur, testabil) + `app/src/lib/logic/pagespeed.test.ts`
- `app/src/routes/[tenant]/seo-links/pagespeed/+page.svelte`, `+page.ts` (`export const ssr = false;`)
- `app/src/routes/[tenant]/api/_debug-pagespeed-health/+server.ts`
- `app/drizzle/0497…0503_*.sql` (7 migrări, o instrucțiune per fișier)
- `app/scripts/demo-pagespeed-report-email.ts` (feedback_email_demo_preview)
- `app/docs/pagespeed.md`

**Modify:**
- `app/src/lib/server/db/schema.ts` — 4 tabele + relations (DOAR după scrierea migrărilor; feedback_schema_select_all_hazard)
- `app/src/lib/server/scheduler/index.ts` — cele 6 puncte (import, taskHandlers, expectedJobIds, add(), JOB_LABELS, JOB_PARAMS/JOB_HANDLER_TYPES)
- `app/src/lib/server/email-logger.ts` — `'pagespeed-report'` în EMAIL_TYPES
- `app/src/lib/server/email.ts` — `EMAIL_SEND_REGISTRY` + funcția `sendPagespeedReportEmail`
- `app/src/lib/config/sidebar-nav.ts` — copil `seo-pagespeed` sub `seo-links`, IconKey `pagespeed`
- `app/src/lib/components/ots-sidebar/NavIcon.svelte` — ramură `GaugeIcon`
- `app/src/lib/server/logger.ts` — doar dacă folosim sursă nouă de log (folosim `'scheduler'` existent → fără modificare)
- `app/.env`, `app/.env.example` — `PSI_API_KEY=`

---

## Task 1: Logica pură (praguri, nivele, formatare, chei de săptămână)

**Files:** Create `app/src/lib/logic/pagespeed.ts`, `app/src/lib/logic/pagespeed.test.ts`

- [ ] **Step 1: test eșuat** — nivele scor (90/50), nivele metrici (praguri Google din `pagespeed-data.jsx` L83-90), `psiFmt` (virgulă zecimală ro, „ms"/„s"), `isoWeekKey(date)` → `2026-W35`, `cwvPass({lcpMs,inpMs,cls})` (≤2500/≤200/≤0.1, null fără date), `nextRunDate(dayOfWeek, hour, now)` pentru Europe/Bucharest.
- [ ] **Step 2: `bun run test pagespeed` → FAIL**
- [ ] **Step 3: implementare** — portează exact `PSI_THRESHOLDS`, `psiScoreLevel`, `psiMetricLevel`, `psiFmt` din `pagespeed-data.jsx` (praguri: lcp 2.5/4.0 s, inp 200/500 ms, cls 0.1/0.25, fcp 1.8/3.0 s, tbt 200/600 ms, si 3.4/5.8 s). Notă: în DB ținem ms; `psiFmt` primește ms și convertește la s unde e cazul.
- [ ] **Step 4: test PASS** → **Step 5: commit** `feat(pagespeed): logica pură praguri/format`

## Task 2: Schema DB + migrări (STRICT: skill database-migrations încărcat)

**Files:** Modify `app/src/lib/server/db/schema.ts`; Create `app/drizzle/0497…0503`

- [ ] **Step 1:** `grep -ri pagespeed app/drizzle/` → nimic (fără migrare duplicată; feedback_migrari_fara_if_not_exists)
- [ ] **Step 2:** verifică pe remote `select max(created_at) from __drizzle_migrations` vs `_journal.json` (reference_drizzle_journal_when_sub_remote)
- [ ] **Step 3:** scrie migrările manual (drizzle-kit generate e STRICAT — reference_drizzle_meta_drift), o instrucțiune per fișier, `when` incrementat manual în `_journal.json`:

`0497_pagespeed_site.sql`:
```sql
CREATE TABLE `pagespeed_site` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text REFERENCES `client`(`id`),
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`cms` text NOT NULL DEFAULT 'WordPress',
	`pages` text NOT NULL DEFAULT '[]',
	`strategies` text NOT NULL DEFAULT '["mobile","desktop"]',
	`alert_threshold` integer NOT NULL DEFAULT 5,
	`active` integer NOT NULL DEFAULT 1,
	`paused_at` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```
`0498_pagespeed_site_tenant_idx.sql`: `CREATE INDEX \`pagespeed_site_tenant_idx\` ON \`pagespeed_site\` (\`tenant_id\`);`

`0499_pagespeed_measurement.sql`:
```sql
CREATE TABLE `pagespeed_measurement` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL REFERENCES `pagespeed_site`(`id`) ON DELETE cascade,
	`strategy` text NOT NULL,
	`measured_at` text NOT NULL,
	`week_key` text NOT NULL,
	`status` text NOT NULL DEFAULT 'ok',
	`error_message` text,
	`performance` integer, `accessibility` integer, `best_practices` integer, `seo` integer,
	`lcp_ms` integer, `cls` real, `tbt_ms` integer, `fcp_ms` integer, `speed_index_ms` integer, `inp_ms` integer,
	`ttfb_ms` integer, `total_bytes` integer, `request_count` integer,
	`field_lcp_ms` integer, `field_inp_ms` integer, `field_cls` real, `field_sample_count` integer,
	`opportunities` text,
	`created_at` text NOT NULL DEFAULT current_timestamp
);
```
`0500_pagespeed_measurement_site_idx.sql`: `CREATE INDEX \`pagespeed_measurement_site_strategy_idx\` ON \`pagespeed_measurement\` (\`site_id\`,\`strategy\`,\`measured_at\`);`

`0501_pagespeed_settings.sql`:
```sql
CREATE TABLE `pagespeed_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL UNIQUE REFERENCES `tenant`(`id`),
	`day_of_week` integer NOT NULL DEFAULT 1,
	`hour` text NOT NULL DEFAULT '07:00',
	`strategies` text NOT NULL DEFAULT '["mobile","desktop"]',
	`recipients` text NOT NULL DEFAULT '[]',
	`alert_threshold` integer NOT NULL DEFAULT 5,
	`only_on_drop` integer NOT NULL DEFAULT 0,
	`include_opportunities` integer NOT NULL DEFAULT 1,
	`attach_pdf` integer NOT NULL DEFAULT 0,
	`send_to_client` integer NOT NULL DEFAULT 0,
	`is_enabled` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
```
`0502_pagespeed_report.sql`:
```sql
CREATE TABLE `pagespeed_report` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`week_key` text NOT NULL,
	`sent_at` text,
	`site_count` integer NOT NULL DEFAULT 0,
	`avg_mobile` integer, `avg_desktop` integer, `delta_mobile` integer,
	`alert_count` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'sent',
	`note` text,
	`recipients` text NOT NULL DEFAULT '[]',
	`created_at` text NOT NULL DEFAULT current_timestamp
);
```
`0503_pagespeed_report_unique_idx.sql`: `CREATE UNIQUE INDEX \`pagespeed_report_tenant_week_idx\` ON \`pagespeed_report\` (\`tenant_id\`,\`week_key\`);`

- [ ] **Step 4:** `bun run db:migrate` + verifică pe remote `PRAGMA table_info(pagespeed_site)` (feedback_migration_flow)
- [ ] **Step 5:** abia ACUM adaugă tabelele în `schema.ts` cu tipurile custom (`timestamp`, `boolean`, `jsonb` din schema.ts:9-25), camelCase→snake_case, + `relations` (site→client, site→many measurements). `strategy` tip `text('strategy', { enum: ['mobile', 'desktop'] })`.
- [ ] **Step 6:** `bun run test` (fără regresii) → commit `feat(pagespeed): schema + migrări 0497-0503`

## Task 3: Client PSI (TDD)

**Files:** Create `app/src/lib/server/pagespeed/client.ts`, `__tests__/client.test.ts` (+ fixture `__tests__/fixtures/psi-response.json` — răspuns real trunchiat)

- [ ] **Step 1: teste eșuate** — `parsePsiResponse(json)` extrage: scoruri ×100 rotunjite din `lighthouseResult.categories.{performance,accessibility,best-practices,seo}.score`; din `audits`: `largest-contentful-paint.numericValue`→lcpMs, `cumulative-layout-shift`→cls, `total-blocking-time`→tbtMs, `first-contentful-paint`→fcpMs, `speed-index`→speedIndexMs, `interaction-to-next-paint` (fallback `experimental-interaction-to-next-paint`, poate lipsi)→inpMs, `server-response-time`→ttfbMs, `total-byte-weight`→totalBytes, `network-requests.details.items.length`→requestCount; CrUX din `loadingExperience.metrics` (`LARGEST_CONTENTFUL_PAINT_MS.percentile`, `INTERACTION_TO_NEXT_PAINT.percentile`, `CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile/100`) doar dacă `loadingExperience.origin_fallback !== true`... (păstrează și fallback: dacă doar origin există, folosește-l cu `field_sample_count` null); oportunități: audits cu `details.type === 'opportunity'` și `numericValue > 0` → top 6 `{id, title, savingsMs}` sortate desc.
  `fetchPagespeed(url, strategy)`: construiește URL-ul cu 4× `category`, `locale=ro`, `key` din `env.PSI_API_KEY` (eroare clară dacă lipsește), `AbortSignal.timeout(60_000)`, retry ×2 backoff exponențial cu jitter (model `keez/client.ts:273-375`), 4xx ≠ 429 → fără retry. Test: 500→retry→ok; 400→fără retry; timeout→TimeoutError.
- [ ] **Step 2: FAIL** → **Step 3: implementare** (fetch mock-uit prin injecție: `fetchPagespeed(url, strategy, deps = { fetch })`) → **Step 4: PASS** → **Step 5: commit**

## Task 4: Procesor de scanare + progres Redis (TDD)

**Files:** Create `app/src/lib/server/pagespeed/scan.ts`, `__tests__/scan.test.ts`; Create `app/src/lib/server/scheduler/tasks/pagespeed-scan.ts`

- [ ] **Step 1: teste eșuate** pentru `runPagespeedScan({ tenantId, siteIds?, strategiesOverride? })`:
  - site cu `strategies=["mobile","desktop"]` → 2 măsurători (criteriul de acceptanță 1);
  - eroare API → rând `status='failed'` + `error_message`, restul cozii continuă (criteriul 5);
  - `paceStart` între cereri ≥1000 ms (injectat `sleep` mock);
  - progres scris în Redis `pagespeed:scan:<tenantId>` (`{ scanId, total, done, current, perSite: {siteId: 'running'|'done'|'failed'}, startedAt }`, TTL 15 min, șters la final după 5 s grație pentru UI).
- [ ] **Step 2: FAIL** → **Step 3: implementare** — secvențial: pentru fiecare site activ (sau siteIds), pentru fiecare strategie a site-ului: `fetchPagespeed(pages[0].url, strategy)` → insert `pagespeed_measurement` (id base32, `week_key = isoWeekKey(now)`, `measured_at = new Date()`). Redis: clientul existent al proiectului (cel folosit de BullMQ — vezi `scheduler/index.ts`; refolosește conexiunea/utilitarul existent, nu crea client nou dacă există unul partajat). Returnează `{ scanned, failed, skipped }`.
- [ ] **Step 4: PASS** → **Step 5:** handler BullMQ `pagespeed-scan.ts`: `export async function processPagespeedScan(params)` → validează `tenantId` + apelează `runPagespeedScan`; log prin `logInfo('scheduler', …)`. Commit.

## Task 5: Remote functions (TDD)

**Files:** Create `app/src/lib/remotes/pagespeed.remote.ts`, `__tests__/pagespeed.remote.test.ts`

Toate: `getRequestEvent()`, `throw error(401)` fără user/tenant, `await requireStaff(event)`, orice filtru include `tenantId` (model `seo-links.remote.ts`). ID-uri: `encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))`.

- [ ] **Step 1: teste eșuate** (mock `$app/server` per modelul `interviuri-kpi-fixed-costs.test.ts`, cu eager-load `$lib/server/db/schema` real înainte de mock):
  - `savePagespeedSite` respinge URL invalid și `strategies: []`; normalizează `https://`, derivă `domain` din primul URL;
  - `deletePagespeedSite` filtrează pe `id` ȘI `tenantId`;
  - `getPagespeedSites` returnează per site+strategie: ultima măsurătoare, precedenta (trend = diferența, spec §2), seria spark (ultimele 10), `cwvPass` din field data mobil;
  - `savePagespeedSettings` upsert (select-then-insert-or-update, model `report-schedule.remote.ts:113-172`), validare `recipients` email-uri, `strategies` nevid, `hour` din lista `06:00…21:00`, `dayOfWeek` 1–7;
  - `startPagespeedScan` refuză scan dacă unul e deja activ (cheie Redis existentă).
- [ ] **Step 2: FAIL** → **Step 3: implementare** — exporturi:
  - `getPagespeedSites = query(async () => …)` — site-uri + agregate KPI (medii mobile/desktop actuale și precedente, cwvPass count, alerte = delta mobil ≤ −alertThreshold) + `lastScanAt` (max measured_at) + serii pt. graficul mare (medii pe `week_key`, ultimele 10 săptămâni ISO, pe strategie);
  - `getPagespeedSiteHistory = query(v.string(), …)` — istoricul complet al unui site (drawer): măsurători pe strategie, categorii, field data, oportunități (JSON), verificând site.tenantId;
  - `getPagespeedSettings = query(async () => …)` — rând sau default-uri (`PSI_SCHEDULE_DEFAULT` din design: luni 07:00, ambele strategii, threshold 5, includeOpportunities true);
  - `savePagespeedSettings = command(schema, …)`;
  - `savePagespeedSite = command(schema, …)` / `deletePagespeedSite = command(v.string(), …)`;
  - `getPagespeedReports = query(async () => …)` — istoric `pagespeed_report` desc;
  - `startPagespeedScan = command(v.optional(v.array(v.string())), …)` — enqueue BullMQ `{ type: 'pagespeed_scan', params: { tenantId, siteIds } }` cu `jobId` unic (`pagespeed-scan-<tenantId>-<Date.now()>`), NU jobul repetabil;
  - `getPagespeedScanStatus = query(async () => …)` — citește cheia Redis (pt. polling pe durata scanării);
  - `sendPagespeedReportNow = command(async () => …)` — trimite raportul curent (Task 6) manual, `note: 'trimis manual'`;
  - `getPagespeedClients = query(...)` — `{id, name}` din `client` pe tenant, pt. dropdown-ul din SiteModal.
  Mutațiile folosesc `.updates()` la apel din UI (feedback_remote_functions_pattern).
- [ ] **Step 4: PASS** → **Step 5: commit**

## Task 6: Raport email + job săptămânal (TDD)

**Files:** Create `app/src/lib/server/pagespeed/report.ts`, `scheduler/tasks/pagespeed-weekly-report.ts`, `__tests__/pagespeed-weekly-report.test.ts`; Modify `email-logger.ts` (EMAIL_TYPES + `'pagespeed-report'`), `email.ts` (sendPagespeedReportEmail + EMAIL_SEND_REGISTRY), `scheduler/index.ts` (6 puncte), `app/scripts/demo-pagespeed-report-email.ts`

- [ ] **Step 1: teste eșuate** pentru `processPagespeedWeeklyReport()`:
  - tenant cu `dayOfWeek/hour` care NU se potrivesc calendarului Bucharest → skip;
  - rând `pagespeed_report` existent pentru `(tenant, week_key)` → skip (idempotent, spec §3);
  - potrivire → scan + insert report + email către recipients; `onlyOnDrop=true` fără scăderi ≥ threshold → report `status='skipped'`, fără email;
  - o măsurătoare failed → `status='partial'` + `note` cu site-urile picate;
  - `recipients=[]` → nu trimite email, report `note='fără destinatari'`.
- [ ] **Step 2: FAIL** → **Step 3: implementare**:
  - `report.ts`: `buildPagespeedReportData(tenantId, weekKey)` (agregate identice cu preview-ul din UI: medii, delta vs săptămâna precedentă, alerte, tabel site-uri) + `renderPagespeedReportHtml(data, brand)` — HTML inline-styles pe modelul `psi-mail-*` din design (header slate, 4 KPI, tabel, casetă alerte roșie, footer „Trimis automat de OTS CRM · sursa datelor: Google PageSpeed Insights API v5"), prin `renderBrandedEmail` + `escapeHtml`; evidențiere scăderi > 5 pct și scoruri < 50 (spec §4). Subiect: `Raport PageSpeed — S<nn> (<interval>)`.
  - `email.ts`: `sendPagespeedReportEmail(tenantId, recipientEmail, data)` cu `sendWithPersistence` (`emailType: 'pagespeed-report'`, payload serializabil pt. retry) + înregistrare în `EMAIL_SEND_REGISTRY`; gate pe `emailSettings.isEnabled` (model `pdf-report-send.ts:83-89`). `attachPdf=true` → atașament PDF generat cu pdfkit (tabel simplu, model `report-pdf-generator.ts`); `sendToClient=true` → adaugă `client.email` distinct per site-urile cu client asociat.
  - `pagespeed-weekly-report.ts`: iterează tenants cu `pagespeed_settings.is_enabled=1`, folosește `getBucharestCalendar()`; scanează site-urile active (aceleași funcții din Task 4), inserează `pagespeed_report`, trimite emailurile; log start/sfârșit/nr. site-uri/erori prin `logInfo/logError('scheduler', …)` (spec §3 — logul de execuție e `debug_log`, vizibil în Admin→Logs).
  - `scheduler/index.ts`: import + `taskHandlers.pagespeed_weekly_report` + `taskHandlers.pagespeed_scan` + `expectedJobIds` `'pagespeed-weekly-report'` + `schedulerQueue.add('pagespeed-weekly-report', { type: 'pagespeed_weekly_report', params: {} }, { repeat: { pattern: '0 * * * *', tz: 'Europe/Bucharest' }, jobId: 'pagespeed-weekly-report', attempts: 1 })` + `JOB_LABELS['pagespeed-weekly-report'] = 'Raport săptămânal PageSpeed'` (+ label pt. scan) + JOB_PARAMS/JOB_HANDLER_TYPES dacă e nevoie.
- [ ] **Step 4: PASS**; rulează `bun run scripts/demo-pagespeed-report-email.ts` → HTML de previzualizare (feedback_email_demo_preview) → **Step 5: commit**

## Task 7: Env + debug endpoint

**Files:** Modify `app/.env`, `app/.env.example`; Create `app/src/routes/[tenant]/api/_debug-pagespeed-health/+server.ts`

- [ ] `PSI_API_KEY=` în ambele fișiere (`$env/dynamic/private`); verifică `git diff .hostedignore` NU exclude `.env` (feedback_hostedignore_keep_env). Endpoint admin-gated (model celorlalte `_debug-*`): raportează prezența cheii (nu valoarea!), un apel PSI de probă opțional `?probe=1` pe `https://example.com`, starea cheii Redis de scan, ultima măsurătoare. Cheia NU apare în niciun răspuns (criteriul 4). Commit.

## Task 8: UI — port 1:1 din design (skill-uri: ui-styling, svelte-core-bestpractices; fazele Plan/Audit/Verify din crm-dev-flow 4b)

**Files:** Create componentele din structura de fișiere; Modify `sidebar-nav.ts`, `NavIcon.svelte`

Reguli de port (JSX → Svelte 5):
- Aceleași clase, aceeași ierarhie DOM, aceleași texte românești ca în design (criteriul 6). `useState`→`$state`, `useMemo`→`$derived`, `useEffect`→`$effect`.
- Icoane: `@lucide/svelte/icons/*` echivalente (Search, X, Settings, Mail, RefreshCw, Plus, Activity, TrendingUp, FileText, Eye, Download, Calendar, Send, Check, AlertTriangle, Globe, Phone, Clock, Users, Zap, Link, Edit=pencil, Trash-2, ExternalLink, Folder, Monitor pt. desktop) cu `size` din design.
- Date reale din remotes: `$derived(await getPagespeedSites())` etc.; mutații prin `command.updates(...)`; toast prin `svelte-sonner` DAR design-ul are `.psi-toast` propriu — folosește toast-ul din design (criteriul 6).
- Stări explicite: listă goală (`cl-empty` din design L316-318), scanare în curs (banner + spinner pe rând), măsurătoare failed (tag `psi-tag danger` + tooltip `error_message` pe rând — echivalentul „parțial" din design), site fără istoric („prima scanare" pe Δ, „—" pe metrici, donut „–").
- Polling progres: `$effect` care pornește `setInterval` de 2 s DOAR când există scan activ și îl oprește la final (excepție motivată de la feedback_no_auto_polling — e stare tranzitorie declanșată de user).
- Dark mode: variante `.dark .psi-*` unde design-ul folosește culori hard-codate (model interviuri.css).

- [ ] **Step 1: `pagespeed.css`** — copiază baza `cl-*` din `interviuri.css` (inclusiv breakout `margin:-1.5rem` și dark mode), adaugă cele 6 clase `cl-*` lipsă (din `style-2.css` al design-ului: cl-btn-mini, cl-field-head, cl-section-actions, cl-switch, cl-switch-slider, cl-toolbar-spacer) + tot `pagespeed-styles.css` (inclusiv `.psi-table-scroll .cl-list-table { min-width: 1120px; }` — spec §6) + dark variants.
- [ ] **Step 2: componente bits** — port direct din `pagespeed-bits.jsx` (Donut cu conic-gradient, Spark SVG, Delta, Metric, Cwv, Line cu benzile 0-49/50-89/90-100, Switch, StratIcon).
- [ ] **Step 3: `PagespeedView.svelte`** — port `pagespeed.jsx`: breadcrumb `cl-crumbs`, hero cu acțiuni, 6 KPI-uri, banner scanare, toolbar (tabs Toate/Necesită atenție/Trec CWV/În pauză + segmented mobil/desktop + filtre Client/Sortare + căutare), tabelul principal (10 coloane, click pe rând → drawer, acțiuni rescan/edit/link extern cu `stopPropagation`), graficul de trend cu cardul „următorul raport", tabelul „Rapoarte trimise" (din `getPagespeedReports`; acțiunea Download PDF doar dacă `attachPdf` — altfel omite butonul).
- [ ] **Step 4: modale + drawer** — port `pagespeed-modals.jsx`: `SiteModal` (nume/client/CMS/pagini dinamice/strategii checkbox/prag/switch activ + validări + ștergere), `ScheduleModal` (zi/oră/strategii checkbox/prag/destinatari chips/4 toggles/reset/salvare — buton „Setări raport" din header ȘI butonul mic de lângă grafic, spec §6), `SiteDrawer` (scoruri Lighthouse 4 donuts, metrici laborator cu bare, CrUX + fallback „volum insuficient", oportunități, grafic 10 săptămâni, pagini incluse — donut real doar pe prima pagină, „–" pe celelalte), `MailPreviewModal` (agregate identice cu emailul + „Trimite acum" → `sendPagespeedReportNow`).
- [ ] **Step 5: rută + sidebar** — `+page.svelte` (doar `<PagespeedView />` + `svelte:head` titlu), `+page.ts` cu `ssr=false`; `sidebar-nav.ts`: entry `seo-links` devine grup cu copilul `{ id: 'seo-pagespeed', label: 'PageSpeed', icon: 'pagespeed', href: '/seo-links/pagespeed' }`; `NavIcon.svelte`: `GaugeIcon`.
- [ ] **Step 6:** `svelte-autofixer` pe FIECARE componentă; `/build-check`; commit.
- [ ] **Step 7 (Audit):** `design-auditor` + `web-design-guidelines` pe componentele noi; fix Critical/High; test overflow cu domenii/emailuri lungi.
- [ ] **Step 8 (Verify):** `testermcp` pe golden path: login dev (reference_dev_login_credentials, tenant ots) → /ots/seo-links/pagespeed → adaugă site (ambele strategii) → rulează scanare → vezi progres → scoruri apar fără reload → drawer → setări raport → salvare. Screenshot-uri. Commit.

## Task 9: Verificare finală + review

- [ ] `bun run test` complet (0 fail); `/build-check` (baseline 16 err/56 warn — fără erori noi)
- [ ] Verifică criteriile de acceptanță 1–6 unul câte unul cu dovezi (superpowers:verification-before-completion)
- [ ] `grep -r PSI_API_KEY app/src` → doar în cod server (`$lib/server/**`), nu în componente/remotes client-visible (criteriul 4)
- [ ] `app/docs/pagespeed.md` — model de date, fluxuri, env, joburi
- [ ] superpowers:requesting-code-review + gemini second opinion (modul nou, suprafață mare)
- [ ] Fix-uri din review → re-verificare → commit final
- [ ] `graphify . --update`; propune deploy și AȘTEAPTĂ „go" (feedback_deploy_workflow)

## Self-review (făcut la scriere)

- Spec §1 (API v5, parametri, extrageri, erori, rate limit) → Task 3, 4. §2 (model + trend) → Task 2, 5. §3 (cron UI-configurabil, idempotent, log, buton scan) → Task 5, 6. §4 (email) → Task 6. §5 (endpoints) → Task 5 (deviație documentată). §6 (reguli UI) → Task 8. Criterii 1–6 → mapate în Task 9.
- Praguri culori scor (≥90 verde / 50–89 portocaliu / <50 roșu) vin din `psiScoreLevel` (Task 1) — identice cu design-ul.
- `inp_ms` poate lipsi din răspuns (spec: „dacă există") — parserul îl lasă null; UI afișează „—".
