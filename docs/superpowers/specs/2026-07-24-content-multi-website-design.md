# `/ots/content` — Sistem multi-website de conținut AI (redesign)

**Data:** 2026-07-24
**Branch:** `feat/heylux-content-rewrite`
**Status:** Design aprobat (arhitectură + fazare), în curs de detaliere
**Autor:** Augustin + Claude

---

## 1. Scop

Transformă pagina mono-brand `/ots/content/heylux` (Faza 1: doar scrape+extract advertoriale Heylux) într-un **sistem multi-website de producție de conținut AI**, în care:

1. Articolele sunt **per website**, nu per string `brand`.
2. **`clientWebsite`** (site-urile adăugate pe client) e hub-ul care leagă un website de **SEO**, **WordPress** și **articole**.
3. Fiecare website are un **profil brand structurat** cu care alimentează AI-ul.
4. Articolele se generează prin **pluginul Claude** (ruta `copywriting`) și se **salvează în DB**.
5. Publicarea pe WordPress e **flexibilă**: manual / programat (calendar) / complet automat.
6. Există **articole deja scrise local** (`content/heylux/raw/` surse + `content/heylux/rewritten/` rescrise) — se **importă în DB** ca drafturi de review.
7. UI-ul permite **review + modificare a direcției/contextului** atât **general** (profil website) cât și **per articol**.

**Scope de DATE (revizuit 2026-07-24):** doar **3 website-uri**: **heylux, preziosa, lucky** (omitem forumvideochat/vivadiva/optyma/unknown din vizualizarea de conținut). **Arhitectura rămâne scalabilă/multi-website** — hub-ul `clientWebsite` suportă N website-uri; scope-ul restrânge doar ce importăm/afișăm acum, nu modelul.

Convenții respectate: răspuns/UI în RO; migrări hand-authored (drizzle meta drift, un statement/fișier Turso); remote functions cu `requireStaff`+scoping tenant; `$derived(await query)` + `.updates()` + `<svelte:boundary>`; `[tenant]/+layout.svelte` deja pune `p-6` (nu dubla padding-ul); nu adăuga coloană în schema.ts înainte de migrare (select-all hazard).

## 2. Stare actuală (ce există)

- **`content_article`** (schema.ts:2007): tenant-scoped, cheie pe `brand` string (heylux|luckystudio|preziosa|forumvideochat|vivadiva|unknown — NU FK). Coloane dormante rezervate: `rewriteStatus`, `targetWpSiteId` (fără FK), `wpPostId`, `scheduledAt`. Pipeline in-process (worker pool CONCURRENCY=4) scrape+extract (Readability). **Fără** legătură la client/website/WP/Claude.
- **`content_import_job`** (schema.ts:2045): un job/tenant, contoare, resumable.
- **`clientWebsite`** (schema.ts:1946): `clientId`, `name`, `url`, `isDefault`. Referit de `seoLink.websiteId`. Remote layer complet (CRUD + `getClientWebsitesSeoStats` cu leftJoin+aggregate). **Fără** favicon/brand/wpSiteId/context columns. Delete blocat dacă există seo_link.
- **`claude_integration`** (schema.ts:1351): 1 rând/tenant, 2 sloturi credențiale (api/oat), `routes` jsonb (override per use-case). Ruta **`copywriting`** → Sonnet 5 (default oat) există în catalog (`$lib/claude-usecases`). Helper `getClaudeClientFor(tenantId, useCaseId)` → `ClaudeClient|null`; `client.createMessage(body)` = **raw fetch Response** (caller pune `model`, verifică `res.ok`, parsează `json.content[0].text`). Timeout default 20s (prea mic pt articole). **Consumatorul de rescriere NU există** — doar config-ul.
- **`seoLink`** (schema.ts:1906): `clientId` (notNull) + `websiteId` (nullable FK→clientWebsite), auto-assign pe domeniu (`extractDomainFromUrl`/`hrefBelongsToRoot`). `getClientWebsitesSeoStats` agregă per website. `/clients/[clientId]/seo` = grid de carduri per website (template bun de reutilizat).
- **`wordpressSite`** (schema.ts:4647): `clientId` (nullable, **niciodată setat de UI**), `siteUrl`, `secretKey` (HMAC criptat). Plugin custom „OTS Connector" (`/wp-json/ots-connector/v1/*`), semnare HMAC-SHA256. `WpClient.createPost` publică; status suportă **`future`+publishedAt** (programare nativă). `extractAndUploadInlineImages` pt HTML AI. **Fără** legătură wordpressSite↔clientWebsite. `loadSiteAndClient` reutilizabil.
- **Claude Design**: tokens hex scoped (`.cl-wrap`, NU oklch), Inter, accent `#1877f2`, hero 28px, bandă KPI, rețete `cl-*`. Referință: `interviuri/interviuri.css:5-152` (nucleu brand-agnostic) — de copiat verbatim într-un `content.css` nou. Pagina actuală folosește shadcn/Tailwind pe tokens oklch globali — de înlocuit.

## 3. Date reale verificate (Turso PROD, 2026-07-24)

Client `lu44x3vi4e5yom6jb2bq6mbi` = **Lucky Group** (`client.website` legacy = https://heylux.ro).

**6 `clientWebsite`:**

| name | url | is_default |
|---|---|---|
| Heylux Studio | https://heylux.ro | ✓ |
| Forrumvideochat.com | https://forumvideochat.com | |
| Forumv Videochat | https://forumvideochat.ro/ | |
| Lucky Studio | https://www.luckystudio.ro/ | |
| Optyma.ro | https://optyma.ro/ | |
| Preziosa Studio | https://preziosa.ro/ | |

**`content_article` (326) pe brand:** heylux 171 (155 ok/16 thin), luckystudio 72 (64/8), preziosa 42 (38/4), unknown 24 (3 ok/7 thin/14 failed), forumvideochat 15 (14/1), vivadiva 2.

**`wordpress_site` (toate `client_id=null`):** Heylux.ro→`https://www.heylux.ro`, Heyluxsuceava.ro, Luckystudio.ro→`https://www.luckystudio.ro`, Preziosa.ro→`https://preziosa.ro`, + Meduza/Wow (alți clienți).

**Auto-match WP pe domeniu (clientWebsite→wordpressSite):** heylux.ro ✓, luckystudio.ro ✓, preziosa.ro ✓; forumvideochat.com/.ro, optyma.ro → niciun WP.

**SEO Lucky Group:** 261 linkuri, 260 cu websiteId, 1 null.

**Conținut local (`content/heylux/`):**
- `raw/*.md` — **155** surse scrapate. Frontmatter: `id`, `brand`, `sourceUrl`, `sourceDomain`, `originalTitle`, `publishedAt`, `wordCount` + corp text.
- `rewritten/*.md` — **113** rescrieri AI gata. Frontmatter: `id` (**identic cu raw**), `brand`, `sourceUrl`, `rewrittenTitle`, `rewrittenExcerpt` + corp **markdown** (`##` secțiuni + FAQ, SEO/GEO on-brand). Toate 113 au sursă raw; 42 raw încă nerescrise.
- `id` din frontmatter = **`content_article.id`** din DB (verificat: cele 5 sample există, brand=heylux, extract_status=ok, `rewrite_status` majoritar `none`, sursa `title`+`body_html` deja în DB). Deci importul **actualizează rânduri existente pe `id`**, nu inserează.
- `brand-context.md` — **product-marketing-context bogat** (Product Overview, ICP, Pain Points, Differentiation, Objections→Response, Customer Language, Brand Voice, Goals, Guardrails „Mesaje INTERZISE"). REGULA supremă: onestitate factuală (doar claim-uri din sursă). Confirmă: Heylux = aceeași echipă cu **Lucky Studio** și **La Preziosa**. Acesta e **contextul general** care alimentează `website_content_profile` (heylux) și e review-abil în UI.
- Toate fișierele locale sunt tag-uite `heylux`. Lucky (72) + Preziosa (42) există ca **surse în DB fără rescriere locală** → rămân „de rescris" (F2). Convertor markdown→HTML: **`marked` (^17)** + `src/lib/utils/markdown.ts` deja în repo.

**Consecințe de design (importante):**
- `source_domain` = site de **presă** (ziaruldeiasi.ro, bzi.ro…), NU domeniul brandului → **backfill pe `brand`, nu pe `source_domain`**.
- `forumvideochat` ambiguu (.ro/.com) → default `.ro` + flag review.
- `vivadiva` (2) + `unknown` (24) → `websiteId=null`, review manual.
- WP `client_id` toate null → backfill bonus.
- Normalizare domeniu obligatorie (www + trailing slash).

## 4. Arhitectură: `clientWebsite` = hub

```
client ──> clientWebsite ──> SEO          seoLink.websiteId              (EXISTĂ)
(Lucky     │  (6 site-uri)  ──> WordPress   clientWebsite.wpSiteId  (NOU, auto-match domeniu + override)
 Group)    │                ──> Articole    contentArticle.websiteId (NOU, pivot de la brand)
           │                ──> Context AI  website_content_profile  (NOU, profil brand + politică publicare)
```

Un website recunoaște deja SEO prin domeniu; adăugăm puntea spre WordPress și pivotăm articolele + contextul pe `websiteId`.

## 5. Modelul de date (Faza F0)

### 5.1 `content_article` — coloane noi

| coloană | tip | rol |
|---|---|---|
| `website_id` | `text` FK→client_website, nullable | **proprietarul real** (backfill din brand) |
| `client_id` | `text` FK→client, nullable | denormalizat pt scoping/filtre |
| `origin` | `text` default `'scraped'` | `scraped` \| `rewrite` \| `brief` |
| `brief` | `text` nullable | subiect/keyword pt articolele `origin='brief'` |
| `generated_title` | `text` nullable | output AI (separat de sursă `title`/`body_html`) |
| `generated_html` | `text` nullable | output AI |
| `generated_excerpt` | `text` nullable | output AI |
| `generated_at` | `timestamp` nullable | |
| `generation_error` | `text` nullable | |
| `model_used` | `text` nullable | modelul Claude folosit |
| `publish_status` | `text` default `'none'` | `none` \| `draft` \| `scheduled` \| `published` \| `failed` |
| `needs_review` | `boolean` default `false` | flag pt review manual |
| `article_direction` | `text` nullable | **direcție/context per articol** (override peste profilul general) — editabil în UI, alimentează (re)generarea |

Reactivate (deja există): `rewrite_status` (extind enum → `none`|`queued`|`drafting`|`ready`|`failed`), `target_wp_site_id` (acum populat + FK logic către wordpress_site), `wp_post_id`, `scheduled_at`.
Păstrează `brand` (provenance/legacy). Index nou: `(tenantId, websiteId, publishStatus)`.

### 5.2 `client_website` — coloană nouă

| coloană | tip | rol |
|---|---|---|
| `wp_site_id` | `text` FK→wordpress_site, nullable | site WP unde se publică (auto-match domeniu, override manual) |

### 5.3 `website_content_profile` — tabel nou (1:1 cu clientWebsite)

```
id text PK
tenant_id text FK tenant notNull
website_id text FK client_website notNull UNIQUE
-- Profil brand (context AI structurat)
tone text                 -- ex: "cald, aspirațional, direct"
audience text             -- public-țintă
language text default 'ro'
keywords text             -- JSON string[]
topics text               -- JSON string[] (subiecte recurente)
do_list text              -- ce SĂ facă (JSON string[] sau text)
dont_list text            -- ce să EVITE
guardrails text           -- „Mesaje INTERZISE" (reguli dure, ex: doar claim-uri din sursă, non-explicit)
sample_urls text          -- JSON string[] articole-exemplu on-brand
extra_notes text          -- instrucțiuni libere / customer language
-- Politică publicare
publish_mode text default 'manual'   -- manual | scheduled | auto
cadence_per_week integer default 3
days_of_week text                    -- JSON number[] (0-6)
publish_time text default '10:00'
default_wp_status text default 'draft' -- draft | publish
auto_approve boolean default false
created_at / updated_at timestamp
```

### 5.4 Backfill (script de migrare de date, idempotent)

Scope: doar cele **3 brand-uri** (heylux, luckystudio, preziosa). Restul (forumvideochat/vivadiva/unknown) rămân `websiteId=null` și **nu apar** în vizualizarea de conținut (filtrate).

1. **brand→website** (map explicit, în Lucky Group): `heylux→heylux.ro`, `luckystudio→luckystudio.ro`, `preziosa→preziosa.ro`. Setează și `client_id`. Restul brand-urilor: `websiteId=null` (ignorate în UI).
2. **clientWebsite.wpSiteId**: auto-match domeniu normalizat (`extractDomainFromUrl`) vs `wordpressSite.siteUrl` → heylux/lucky/preziosa ✓. Restul null.
3. **wordpressSite.clientId** (bonus): setează Lucky Group unde domeniul se potrivește.
4. **website_content_profile**: creează un rând per cele 3 website-uri. Pentru **heylux**, seed din `brand-context.md` (parsat în câmpurile structurate); lucky/preziosa gol (de completat din UI).

Migrări: hand-authored, un statement/fișier, verificare `_journal.json` + `PRAGMA table_info` pe Turso după `db:migrate`. Nu adăuga coloane în schema.ts înainte de aplicare (select-all hazard).

### 5.5 Import conținut local (`content/heylux/raw` + `rewritten` → DB)

Endpoint admin-gated `[tenant]/api/_debug-import-content` (nu bun script — `$lib` nu se rezolvă în scripturi), idempotent, match pe `id`:

1. Parcurge `rewritten/*.md`: parse frontmatter (gray-matter sau parser simplu) → găsește `content_article` pe `id` → setează `generated_title=rewrittenTitle`, `generated_excerpt=rewrittenExcerpt`, `generated_html = marked(corp markdown)`, `origin='rewrite'`, `rewrite_status='ready'`, `website_id=heylux`, `generated_at=now`. **113 articole → ready for review.**
2. `raw/*.md` fără rewrite (42): rămân `origin='scraped'`, `rewrite_status='none'`, `website_id=heylux` (sursa e deja în DB; importul doar confirmă websiteId).
3. Nu inserează rânduri noi (toate id-urile există); doar `UPDATE` pe `id`. Loghează câte s-au potrivit / negăsite.

Corpul rescris e markdown → convertit cu `marked` la HTML pt stocare (TipTap + WP vor HTML). Păstrează markdown-ul original opțional în `generated_html` deja convertit (nu stocăm dublu la MVP).

## 6. Generare AI (Faza F2)

### 6.1 Helper server `generateArticle`

`src/lib/server/content/article-generator.ts`:
- `getClaudeClientFor(tenantId, 'copywriting')` → gate pe `null` (plugin inactiv / fără cheie).
- `createClaudeClient({..., timeoutMs: 120_000})` sau extinde helper-ul pt timeout mărit (default 20s prea mic).
- Injectează `model: client.defaultModel`, `system` = **profilul brand** al website-ului, `messages`, `max_tokens`.
- Verifică `res.ok`, parsează `json.content[0].text`, tratează erori Anthropic; retry pe DecryptionError (pattern existent).
- Returnează `{ title, html, excerpt, model }`.
- **Reutilizabil** de orice consumator AI viitor (thin wrapper centralizat — recomandarea din mapare).

### 6.2 Construcția system prompt-ului (context general + per articol)

Două straturi de context care se compun:
- **General** (`website_content_profile`): brand/website, ton, public, limbă, keywords, topics, do/don't, **guardrails**, note. Seed heylux din `brand-context.md`. Editabil în UI.
- **Per articol** (`content_article.article_direction`): direcție specifică articolului (ex. „focus pe program flexibil pentru mămici", „ton mai factual"), care **se adaugă/suprascrie** peste general la (re)generare.

System prompt = general + (dacă există) direcție per articol + guardrails. Opțional: exemple din `sample_urls`. Fără streaming (single POST).

### 6.3 Două intrări (ai ales „ambele")

- **Rescriere din sursă** (`origin='rewrite'`): `content_article.body_html` scrapat → rescris on-brand → `generated_*`. Acoperă cele 326 advertoriale existente.
- **Articol nou din brief** (`origin='brief'`): `brief` (subiect/keyword) + profil brand → articol original. Funcționează pt website-uri fără surse scrapate.

Job de generare: reutilizează pattern-ul worker-pool din `content-pipeline.ts` (scope adăugat: website). On-demand (1 articol) + batch.

## 7. Publicare + calendar + automatizare (Faza F3)

### 7.1 Moduri (per website, din `publish_mode`)

- **manual**: generezi → editezi TipTap → „Publică" (`WpClient.createPost`, draft sau live).
- **scheduled**: pui pe calendar (`scheduled_at`); task scheduler publică la timp după review.
- **auto**: task generează *și* publică pe cadență (`cadence_per_week`/`days_of_week`/`publish_time`), fără intervenție. „Totul automat" odată ce profilul e bun.

### 7.2 Path de publicare

Reutilizează `loadSiteAndClient` + `extractAndUploadInlineImages` + `WpClient.createPost`. Ținta = `clientWebsite.wpSiteId` (sau `content_article.target_wp_site_id`). Persistă `wp_post_id` + `publish_status`. Gate: dacă website fără `wpSiteId` → cere legare WP întâi.

### 7.3 Scheduler

- `content-auto-publish` (zilnic/orar): publică articolele `scheduled` scadente (respectă modul).
- `content-auto-generate` (pe cadență): pt website-uri `auto`, generează + programează ca să umple calendarul.
Pattern: ca task-urile `wordpress-*` (iterează site-uri connected/non-paused). Timeout AbortSignal pe fetch-uri.
**Notă bug de reparat:** upsert `wordpress_post` face lookup pe `wpPostId` **fără** scoping `siteId` (sync.ts) — coliziune multi-site; de reparat înainte de rollout auto-publish.

### 7.4 Calendar

View lunar pe `scheduled_at`; „generează pentru golurile din calendar". (Drag-to-reschedule = opțional, post-MVP.)

## 8. UI redesign în Claude Design (Faza F1)

Redenumire `/content/heylux` → **`/content`**. Copiază `interviuri.css:5-152` într-un `content.css` nou; înlocuiește shadcn/Tailwind cu markup `cl-*`. Fără padding exterior (layout-ul pune `p-6`; `.cl-wrap` face breakout `margin:-1.5rem`).

### 8.1 `/content` — overview multi-website
- `cl-crumbs`, `cl-hero` (h1 „Content" + p cu numărători), `cl-hero-actions` (search + buton primar).
- Bandă **KPI** (`cl-kpis`): total articole / publicate / programate / în lucru / websites active.
- **Grid carduri per website** (`cl-section`/carduri): favicon (`getFaviconUrl`), nume, client, badge-uri: WP legat? · profil brand setat? · nr. articole · următorul programat. Click → detaliu website.

### 8.2 `/content/[websiteId]` — detaliu website (taburi `cl-tabs`)
- **Articole**: `cl-list-wrap`+`cl-list-table`, status pills (`iv-st`: sursă/draft/ready/programat/publicat), filtre (`cl-select`), butoane „Rescrie din sursă" / „Articol nou". Rând → editor articol.
- **Calendar**: grid lunar + articole pe `scheduled_at`.
- **Context brand**: editor `website_content_profile` (`cl-field`/`cl-input`/`cl-textarea` + chips keywords).
- **Setări**: link WP (auto-match + override `cl-select`), mod publicare (`iv-seg` manual/programat/auto), cadență.

### 8.3 Editor + review articol
TipTap `RichEditor` (reutilizat din `/wordpress/[siteId]/posts/new`). Layout review:
- **Sursă** (raw) alături de **output rescris** (`generated_html`), editabil.
- Câmp **„Direcție articol"** (`article_direction`) + buton **„Regenerează"** (aplică direcția per articol peste contextul general).
- Meta editabil: `generated_title`, `generated_excerpt`.
- Acțiuni: „Aprobă" (`rewrite_status=ready`→ok pt publicare), „Publică"/„Programează", „Respinge"/`needs_review`.
- Contextul **general** al website-ului e accesibil din tab „Context brand" (editor `website_content_profile`, seed din `brand-context.md`), ca să-l ajustezi și el.

### 8.4 Reutilizare directă (fără rescriere)
Remote-uri: `getContentArticles`/`getContentImportJob` + `.updates()`/`.refresh()`; `getClientWebsites`/`getClientWebsitesSeoStats`; CRUD `clientWebsite`. Pattern `$derived(await query)` + `<svelte:boundary>`. `statusVariant`/`formatDate` (repointate pe clase `iv-st`).

## 9. Fazare (aprobat: spec complet → F0→F3 pe rând)

- **F0 — Fundație date + import local**: migrări (§5) + backfill 3 brand-uri (§5.4) + auto-match WP + **import `raw`/`rewritten` din local** (§5.5, 113 rescrieri → ready) + seed profil heylux din `brand-context.md`. Verificare pe Turso. *(deblochează tot; zero UI vizibil)*
- **F1 — UI `/content` redesign + review**: `content.css` + overview multi-website (3 website-uri) + detaliu website (tab Articole citind noul model) + **editor/review articol** (sursă↔rescris, direcție per articol, aprobă/respinge) + tab Context brand (editor profil general). Redenumire rută + sidebar „Content".
- **F2 — Generare AI**: `generateArticle` (context general + direcție per articol) + rescriere surse rămase (42 heylux + lucky 72 + preziosa 42) + brief + „Regenerează" + job generare.
- **F3 — Publicare + calendar + automatizare**: path WP publish + calendar + moduri manual/programat/auto + scheduler + fix bug `wordpress_post` upsert.

Fiecare fază: spec-ul e sursa; plan de implementare (writing-plans) per fază, cu checkpoint-uri.

## 10. Testare

- **F0**: teste migrare/backfill (brand→website map, ambiguu forumvideochat, null vivadiva/unknown); `PRAGMA table_info` pe Turso; conteo articole per website == verificarea din §3.
- **F2**: `article-generator` cu ClaudeClient mock (fetch stub) — succes, `res.ok=false`, JSON malformed, null-client gate; construcția system prompt din profil.
- **F3**: publish path cu WpClient mock; scheduler dryRun; fix upsert `wordpress_post` (test coliziune wpPostId cross-site).
- svelte-autofixer pe fiecare componentă nouă/modificată; `NODE_OPTIONS=--max-old-space-size=8192 svelte-check` (baseline 16 err/56 warn).

## 11. Non-goals (YAGNI)

- Fără streaming AI (single POST e suficient).
- Fără drag-to-reschedule în calendar la MVP.
- Fără per-website routing Claude (rutare rămâne tenant×use-case; contextul brand vine ca prompt input).
- Fără dimensiune nouă în catalogul de use-case-uri (reutilizăm `copywriting`; e extensibil fără migrare dacă apare nevoia).
- Fără import de surse noi generalizat la MVP (rămân cele 326 scrapate + brief); generalizarea `importHeyluxSources`(website, sitemap) = post-MVP.
- Fără migrarea legacy `client.website` (rămâne mirror al default-ului).

## 12. Riscuri / decizii deschise

- **Scope 3 brand-uri** (heylux/preziosa/lucky) confirmat; forumvideochat/vivadiva/optyma/unknown ignorate acum (websiteId=null, filtrate din UI). Arhitectura rămâne scalabilă — se adaugă oricând un website nou fără schimbări de model.
- **Doar heylux are rescrieri locale** (113). Lucky/Preziosa au surse în DB dar 0 rescrieri → apar ca „de rescris" până la F2. E ok (design-ul le suportă).
- **wordpressSite.clientId toate null** + fără UI care să-l seteze: F0 face backfill pe domeniu; UI-ul WP add-site ar trebui extins să accepte client/website (post-F3 sau F1 mic).
- **Timeout Claude 20s** default — F2 trebuie să mărească explicit (articole lungi).
- **Bug upsert `wordpress_post`** (fără siteId scope) — de reparat în F3 înainte de auto-publish.
- **`generated_html` din markdown**: `marked` produce HTML; de verificat că TipTap îl acceptă curat (headings, liste, bold, FAQ) fără pierderi.
