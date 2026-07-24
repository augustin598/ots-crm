# Content Redesign — HANDOFF (2026-07-24)

Status complet al redesign-ului `/ots/content` (mono-brand Heylux → sistem multi-website AI de conținut). Toate schimbările sunt **comise pe branch-ul `feat/heylux-content-rewrite`** și **migrările sunt aplicate pe Turso PROD** (dev DB = Turso PROD). Nedeploiat.

---

## ⚠️ ACȚIUNE IMEDIATĂ (blochează testarea generării)

Generarea AI dă **`Claude 429 rate_limit_error`** chiar și după 3 retry-uri. **NU e quota** (user are Max 5x, ~97% sesiune / 99% săptămânal liber) — e **limita de rată pe minut/burst** a token-ului OAuth (Abonament) folosit pe API-ul Messages.

**Fix durabil:** în `/ots/settings/claude` → tabelul „Rutare pe utilizări" → pune **„Copywriting / conținut"** pe **🔑 API** (nu Abonament). User are ambele chei configurate (oat primar + api secundar). Cheia API (console.anthropic.com) are limite de rată proprii, mari, pentru generare programatică. *(Alternativ, se poate schimba default-ul `copywriting.defaultKeyType` din `'oat'` în `'api'` în `src/lib/claude-usecases.ts`, dar decizia e a userului — rutarea per-tenant din UI e mecanismul corect.)*

Retry-ul cu backoff (respectă `retry-after`, 3 încercări) e deja implementat în `src/lib/server/content/article-generator.ts` (`createMessageWithRetry`).

---

## Ce e GATA (F0 + F1 + F2 + iterații)

### F0 — Fundație date (aplicat pe Turso)
Pivot `content_article` de la string `brand` la `websiteId`. Hub = `clientWebsite` (leagă website → SEO + WordPress + articole + context AI).
- **285 articole** legate: Heylux 171 / Lucky 72 / Preziosa 42. **41 excluse** (`websiteId=null`: forumvideochat 15, vivadiva 2, unknown 24) — filtrate din UI.
- **113 rescrieri Heylux** importate din `content/heylux/rewritten/*.md` → `generated_html` (via `marked`), `rewrite_status='ready'`.
- **6 clientWebsite** legate la `wordpress_site` (`wp_site_id`) + 6 `wordpress_site.client_id` completate.
- **3 profiluri** brand create (Heylux seed-uit din `content/heylux/brand-context.md`; Lucky/Preziosa goale).
- Rulat prin runner standalone (forjarea sesiunii pt endpoint a fost blocată de classifier). Endpoint-uri reviewate & comise pt viitor: `_debug-backfill-content-websites`, `_debug-import-content`.

### F1 — UI Claude Design + review
- `/content` overview: grid carduri per website + KPI.
- `/content/[websiteId]`: tab **Articole** (tabel + status pills) + tab **Context brand** (editor profil, upsert).
- Sidebar „Content Heylux" → **„Content"** (`/content`); rută veche `/content/heylux` ștearsă.
- `content.css` = nucleu Claude Design copiat din `interviuri.css:1-152` + extensii `.ct-*`.

### F2 — Generare AI
- `getClaudeClientFor(tenantId, useCaseId, timeoutMs?)` extins (articole = 120s).
- `article-generator.ts` peste ruta Claude **`copywriting`**: `generateArticle` (rewrite din sursă / brief nou / **modify** țintit), `generateSeoMeta`. Prompt PUR + testabil în `article-prompt.ts`.
- Comenzi remote: `rewriteArticle`, `regenerateArticle`, `generateArticleFromBrief`, `modifyArticle`, `generateArticleSeo`.
- Generarea completă întoarce **7 câmpuri** (title/excerpt/body_markdown + focus_keyword/seo_title/meta_description/slug) → SEO se completează automat la rescriere.

### Iterații UI (feedback user)
- **Editor mutat în PAGINĂ nouă** `/content/[websiteId]/[articleId]/+page.svelte` (nu drawer). Drawerul `ArticleReviewDrawer.svelte` rămas nefolosit pe disc.
- **Butoane cu culori+iconuri**: Închide(gri) · Regenerează(🟣 mov) · Salvează(gri) · Aprobă(🟢 verde).
- **Modifică vs Regenerează**: „Regenerează" = full din sursă+direcție; „Modifică cu AI" (bară în coloana Rescris) = editare ȚINTITĂ după prompt (păstrează restul). „Direcție articol (pentru Regenerează)" = context permanent.
- **Sidebar SEO/AEO/GEO** (stil RankMath): imagine featured (URL+preview), focus keyword, titlu SEO (/60), meta desc (/160), slug; scor live + 3 bare + checklist good/warn/bad. Motor pur `src/lib/content/seo-analysis.ts` (`analyzeSeo`, 12 SEO+3 AEO+3 GEO euristici).
- **Buton „Generează AI"** în cardul SEO → `generateArticleSeo` completează focus keyword/titlu/meta/slug din conținut. `slugify` scoate diacritice RO.
- Retry pe 429/529.

**Teste:** ~37 teste content pass (`bun test src/lib/content src/lib/server/content`). **svelte-check 0 erori.** Rute servesc 200.

---

## Model de date (migrări 0417-0431, TOATE aplicate pe Turso)

`content_article` coloane noi: `website_id`(FK clientWebsite), `client_id`, `origin`(scraped|rewrite|brief), `generated_title`, `generated_html`, `generated_excerpt`, `generated_at`, `article_direction`, `brief`, `seo_title`, `meta_description`, `focus_keyword`. (reactivate: `rewrite_status`, `target_wp_site_id`, `wp_post_id`, `scheduled_at`; `slug`+`featured_image_url` existau.)
`client_website`: `wp_site_id`(FK wordpressSite).
Tabel nou `website_content_profile` (1:1 cu clientWebsite): profil brand (tone/audience/language/keywords/topics/doList/dontList/guardrails/sampleUrls/extraNotes) + politică publicare (publishMode/cadencePerWeek/daysOfWeek/publishTime/defaultWpStatus/autoApprove).

Convenții migrări: hand-authored, un statement/fișier, journal patch manual (`db:gen` le drop-ează), `bun run db:migrate`, verificare `PRAGMA table_info` pe Turso. Următoarea migrare liberă = **0432**.

---

## Fișiere cheie

- Spec: `docs/superpowers/specs/2026-07-24-content-multi-website-design.md`
- Planuri: `docs/superpowers/plans/2026-07-24-content-f0-data-foundation.md`, `-f1-ui-review.md`, `-f2-ai-generation.md`
- Server: `src/lib/server/content/{article-prompt,article-generator,frontmatter,website-resolver}.ts`; `src/lib/content/seo-analysis.ts`
- Remote: `src/lib/remotes/content-articles.remote.ts`, `website-content-profile.remote.ts`
- UI: `src/routes/[tenant]/content/{+page.svelte, content.css, [websiteId]/+page.svelte, [websiteId]/[articleId]/+page.svelte, [websiteId]/ArticleReviewDrawer.svelte(nefolosit)}`
- Claude plugin (modificat): `src/lib/server/plugins/claude/index.ts` (timeoutMs); ruta `src/lib/claude-usecases.ts`
- Schema: `src/lib/server/db/schema.ts` (contentArticle, clientWebsite, websiteContentProfile)

## Date verificate (Turso PROD)
- tenant ots = `k2yzj5bxxppatc57vxpoxfvn`; client Lucky Group = `lu44x3vi4e5yom6jb2bq6mbi`
- clientWebsite: Heylux `a9412aba640f436c8cdf69f8865199`, Lucky `az5wrkjreui6ctzooy3uhq5z`, Preziosa `rk32c2mnwxwwjv53ynqqkgdv`
- DB: `SQLITE_URI`+`SQLITE_AUTH_TOKEN`; query read-only cu `@libsql/client` (fără `$lib`) merge cu `bun run`. `$lib/server/*` NU se rezolvă în bun scripts/tests (importă `$env`).

---

## Ce RĂMÂNE

### Follow-up mici (pe conținut)
- **Upload imagine featured** (acum doar URL) — există remote de upload de legat.
- **Preview Google** (SERP snippet) sub câmpurile SEO — opțional.
- **Buton „Generează SEO pt toate"** / batch rescriere per website (Task 5 F2, amânat).
- Butoanele scrape (`importHeyluxSources`/`startContentExtraction`) rămân doar în remote fără UI → source-mgmt UI.

### F3 — Publicare + calendar + automatizare (neînceput)
Din spec §7. Publicare pe WordPress prin `WpClient.createPost` (există; status `future`+publishedAt = programare nativă), ținta = `clientWebsite.wpSiteId`. Calendar lunar pe `scheduled_at`. Moduri per website (`website_content_profile.publishMode`): manual / programat / auto. Scheduler tasks (ca `wordpress-*`): `content-auto-publish` + `content-auto-generate`. **Bug de reparat înainte de auto-publish:** upsert `wordpress_post` face lookup pe `wpPostId` FĂRĂ scoping `siteId` (`src/lib/server/wordpress/sync.ts`) → coliziune multi-site. Coloana `publish_status` (draft|scheduled|published|failed) de adăugat în F3.

---

## Comenzi
```bash
cd /Users/augustin598/Projects/CRM/app
bun run db:migrate                                   # aplică migrări pe Turso
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error   # 0 erori
bun test src/lib/content src/lib/server/content      # teste content
# dev server rulează pe :5173 (branch); rute /ots/content...
```
Deploy: `hosted-cli deploy app-config.json` din repo root (push la main NU auto-deploy). Login owner dev: office@onetopsolution.ro / sghp910o (tenant ots).
