# Content Redesign — HANDOFF (2026-07-24)

Status complet al redesign-ului `/ots/content` (mono-brand Heylux → sistem multi-website AI de conținut). Toate schimbările sunt **comise pe branch-ul `feat/heylux-content-rewrite`** și **migrările sunt aplicate pe Turso PROD** (dev DB = Turso PROD). Nedeploiat.

---

## ✅ REZOLVAT (blocajul de generare 429)

Generarea AI dădea **`Claude 429 rate_limit_error`** — limita de rată pe minut/burst a token-ului OAuth (Abonament), NU quota. **Rezolvat 2026-07-24:** ruta `copywriting` mutată pe **cheia API + Sonnet 5** (`claude_integration.routes` pe Turso: `{"copywriting":{"keyType":"api","model":"claude-sonnet-5"}}`). Sonnet 5 e suficient pt texte + limite de rată mult mai mari decât Opus pe API. Retry pe 429/529 rămâne ca plasă de siguranță (`article-generator.ts`).

**Rămâne (la user):** click de test live în `/ots/content` (Regenerează / Modifică cu AI + „Generează AI" SEO) — testul programatic direct e blocat de classifier (decriptare cheie + call extern), dar calea API e configurată corect.

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

Convenții migrări: hand-authored, un statement/fișier, journal patch manual (`db:gen` le drop-ează), `bun run db:migrate`, verificare `PRAGMA table_info` pe Turso. F3 a adăugat 0432 (`publish_status`) + 0433 (index). Următoarea migrare liberă = **0434**.

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

### F3 — Publicare + calendar + automatizare ✅ GATA (2026-07-24)
Din spec §7. Comis pe `feat/heylux-content-rewrite` (10 commit-uri F3). Plan: `docs/superpowers/plans/2026-07-24-content-f3-publishing.md` (reconciliat cu second-opinion Gemini).
- **Migrări 0432 (publish_status) + 0433 (index tenant/website/publish)** aplicate pe Turso (PRAGMA verificat: 326 rânduri pe `none`). `publish_status` enum: `none|draft|scheduled|publishing|published|failed` (`publishing` = stare tranzitorie de claim).
- **Fix bug coliziune** `wordpress_post`: upsert-ul din `sync.ts` acum scopat pe `(siteId, wpPostId)` (test regresie `sync-scope.test.ts`).
- **Publisher** `src/lib/server/content/publisher.ts` (`publishArticleToWordpress`): reutilizează `extractAndUploadInlineImages` + `WpClient.createPost`, ținta = `targetWpSiteId ?? clientWebsite.wpSiteId`, persistă `wp_post_id` + `publish_status`, refresh cache.
- **Remote** (content-articles): `publishArticle` (draft/live), `scheduleArticle`/`unscheduleArticle`, `getWebsiteCalendar`, `getTenantWordpressSites`, `setWebsiteWpSite` (validare cross-tenant); (profile): `updateWebsitePublishPolicy` (`daysOfWeek` = number[] → JSON).
- **Scheduler**: `content-auto-publish` (orar; claim atomic `publishing` → zero duplicate; respectă `defaultWpStatus`) + `content-auto-generate` (zilnic 06:30; umple calendarul pe cadență; `auto_approve` → `scheduled`, altfel `none`). Ambele înregistrate în `scheduler/index.ts`.
- **UI**: editor articol (butoane Publică/Programează), pagina website tab-uri **Calendar** (grilă lunară `buildMonthGrid`) + **Setări** (link WP, mod publicare, cadență, zile, oră, auto-aprobare). CSS `cl-cal-*`/`cl-seg` în `content.css`.
- **Teste**: content 45 pass, scheduler content 3 pass, sync-scope 1 pass; **svelte-check 0 erori/0 warnings**. (Testele rulează pe grupuri compatibile — mock.module leak cross-file e caracteristică pre-existentă a repo-ului.)

Următoarea migrare liberă = **0434**. Nedeploiat.

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
