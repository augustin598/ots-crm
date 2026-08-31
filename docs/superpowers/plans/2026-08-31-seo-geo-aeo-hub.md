# SEO & GEO & AEO Hub — Plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) — sesiunea curentă execută task-urile în ordine, cu checkpoint-uri.

**Goal:** Pagină-umbrelă `/[tenant]/seo` care agregă modulele Linkuri SEO, PageSpeed Insights și Content la nivel de website/client, plus regruparea lor în sidebar sub „SEO & GEO & AEO".

**Architecture:** Scorurile SEO/AEO/GEO devin coloane persistate pe `content_article` (sursa: `analyzeSeo()` — deja expune subscoruri + overall 50/25/25), scrise la fiecare mutație de conținut printr-un helper unic `refreshArticleScores()` și backfill-uite printr-un script + comanda „Recalculează scoruri". Pagina hub are UN singur load server (`+page.server.ts`, Promise.all pe ~6 agregări SQL, fără N+1). UI-ul refolosește integral vocabularul PageSpeed (`pagespeed.css`, `cl-*`/`psi-*`, PsiDonut/PsiSpark/PsiDelta/PsiFav/PsiLine, psiScoreLevel) + un CSS mic `sh-*` pentru elemente noi (bare triple, gauge, legendă).

**Tech Stack:** SvelteKit 5 (runes), Drizzle + libSQL/Turso, valibot, bun run test.

**Constatări-cheie din explorare (nu re-verifica):**
- `analyzeSeo()` ([seo-analysis.ts](app/src/lib/content/seo-analysis.ts)) returnează `{overall, seo:{score}, aeo:{score}, geo:{score}}` cu ponderea exactă din spec — nu se duplică logica.
- `content_article` NU are coloane de scor → migrare aditivă necesară (3 coloane nullable). `drizzle-kit generate` e STRICAT → SQL scris manual + `_journal.json` editat manual. Un statement per fișier. Coloanele intră în `schema.ts` DOAR după aplicarea migrării.
- `rewrite_status` real: `none|queued|drafting|ready|failed` (spec-ul zice „source" → mapare: „source" = `none` cu origin `scraped`; „analizat" = are `seo_score NOT NULL`).
- `seo_link.status` real: `pending|submitted|published|rejected` (spec „sent/refused" → `submitted`/`rejected`; etichete RO existente: În așteptare/Trimis/Publicat/Refuzat).
- Clientul NU are câmp „owner" → coloana „responsabil" din recomandări = numele clientului.
- PageSpeed match pe website: `pagespeed_site.domain` vs hostname din `client_website.url` (normalizat fără www), stitch în JS.
- Ruta /content ascunde topbar-ul global (breadcrumb propriu `cl-crumbs` în content-hub-view) → crumb-ul hub se adaugă acolo manual.
- Sidebar + breadcrumbs: config unic [sidebar-nav.ts](app/src/lib/config/sidebar-nav.ts); `buildBreadcrumbs` nu pune eticheta grupului → flag nou `groupCrumb` pe item.
- `createClientWebsite` există deja în [client-websites.remote.ts](app/src/lib/remotes/client-websites.remote.ts) → butonul „Adaugă website" îl refolosește.
- Migrarea următoare liberă: **0505** (ultima în jurnal: 0504).

---

### Task 1: Migrări — coloane scor pe `content_article`

**Files:**
- Create: `app/drizzle/0505_content_article_seo_score.sql`
- Create: `app/drizzle/0506_content_article_aeo_score.sql`
- Create: `app/drizzle/0507_content_article_geo_score.sql`
- Modify: `app/drizzle/meta/_journal.json` (3 entries noi, `when` crescător)
- Modify (DOAR după aplicare): `app/src/lib/server/db/schema.ts` — `contentArticle`

- [x] Grep numele coloanelor în `app/drizzle/*.sql` (nu trebuie să existe deja).
- [x] SQL (un statement per fișier, fără IF NOT EXISTS):
```sql
ALTER TABLE `content_article` ADD `seo_score` integer;
ALTER TABLE `content_article` ADD `aeo_score` integer;
ALTER TABLE `content_article` ADD `geo_score` integer;
```
- [x] Verifică jurnalul remote (`__drizzle_migrations` max created_at ≥ when-ul lui 0504) înainte de `bun run db:migrate`.
- [x] Aplică migrarea + verifică pe remote `PRAGMA table_info(content_article)` conține cele 3 coloane.
- [x] Abia apoi: adaugă în `schema.ts` la `contentArticle`, după `focusKeyword`:
```ts
seoScore: integer('seo_score'),
aeoScore: integer('aeo_score'),
geoScore: integer('geo_score'),
```
- [x] Commit: `feat(seo-hub): coloane seo/aeo/geo_score pe content_article (migrări 0505–0507)`

### Task 2: Helper scoruri `seo-score.ts` (TDD)

**Files:**
- Create: `app/src/lib/content/seo-score.ts`
- Test: `app/src/lib/content/__tests__/seo-score.test.ts`

- [x] Test întâi: `computeArticleScores` întoarce null-uri fără conținut generat; scoruri 0..100 pe articol complet; `seoOverall(90,80,70)===83` (rotunjire 0.5·90+0.25·80+0.25·70=82.5→83); `weekKeyOf` folosește isoWeekKey.
- [x] Implementare:
```ts
import { analyzeSeo } from './seo-analysis';

export interface ArticleScoreInput {
	generatedHtml: string | null; generatedTitle: string | null;
	seoTitle: string | null; metaDescription: string | null;
	focusKeyword: string | null; slug: string | null; featuredImageUrl: string | null;
}
export interface ArticleScores { seoScore: number | null; aeoScore: number | null; geoScore: number | null }

export function computeArticleScores(a: ArticleScoreInput): ArticleScores {
	if (!a.generatedHtml) return { seoScore: null, aeoScore: null, geoScore: null };
	const r = analyzeSeo({
		html: a.generatedHtml,
		title: a.seoTitle || a.generatedTitle || '',
		metaDescription: a.metaDescription || '',
		focusKeyword: a.focusKeyword || '',
		slug: a.slug || '',
		featuredImageUrl: a.featuredImageUrl
	});
	return { seoScore: r.seo.score, aeoScore: r.aeo.score, geoScore: r.geo.score };
}
export function seoOverall(seo: number, aeo: number, geo: number): number {
	return Math.round(seo * 0.5 + aeo * 0.25 + geo * 0.25);
}
```
- [x] `bun run test seo-score` verde. Commit.

### Task 3: Persistarea scorurilor la scriere + backfill

**Files:**
- Modify: `app/src/lib/remotes/content-articles.remote.ts` — helper `refreshArticleScores(tenantId, articleId)` apelat după: updateContentArticle, finalul rewrite (ready), generateArticleFromBrief, modifyArticle, humanizeArticle, generateArticleSeo. + command nou `recalculateContentScores` (batch pe tot tenantul, întoarce {updated}).
- Create: `app/scripts/backfill-content-scores.ts` (o singură rulare locală; citește toate articolele cu generated_html, scrie scorurile).

- [x] Helper: re-selectează rândul, `computeArticleScores`, `update ... set` scoruri (fără updatedAt — nu e o editare de conținut).
- [x] Rulează backfill-ul local, raportează câte articole au primit scor.
- [x] Commit.

### Task 4: Reguli recomandări `seo-recommendations.ts` (TDD)

**Files:**
- Create: `app/src/lib/content/seo-recommendations.ts`
- Test: `app/src/lib/content/__tests__/seo-recommendations.test.ts`

Funcție pură `buildSeoRecommendations(input, now)` → `SeoRecommendation[]`; input = agregatele din load. Reguli (spec §5):

| Regulă | prioritate | tip |
|---|---|---|
| website fără profil brand | mare | Content |
| website fără WordPress conectat | mare | Tehnic |
| publicări eșuate > 0 pe website | mare | Tehnic |
| seo_link pending/submitted > 14 zile (per client) | medie | Linkuri |
| rezultate discovery netrackate (ultimul job terminat) | medie | Linkuri |
| > 50 articole sursă neredactate (per website) | medie | Content |
| PageSpeed mobil < 50 sau CWV fail | medie | PageSpeed |
| check AEO „faq" picat (medie aeoScore < 100 și articole analizate > 0 → aproximat: aeoFaqMissing count per website) | mică | AEO |

`SeoRecommendation = { id, websiteId|null, websiteLabel, clientName|null, title, type: 'Content'|'Tehnic'|'Linkuri'|'PageSpeed'|'AEO', priority: 'mare'|'medie'|'mică', impact: string, owner: string ('—' fallback), due: Date }`; `due` = now + 7/14/30 zile după prioritate. Sortare: prioritate desc, apoi tip.

- [x] Teste pe fiecare regulă (pozitiv + negativ) + sortare + due. Implementare. Verde. Commit.

### Task 5: Load-ul serverului `/[tenant]/seo`

**Files:**
- Create: `app/src/routes/[tenant]/seo/+page.server.ts`
- Create: `app/src/routes/[tenant]/seo/+page.svelte` (subțire, montează SeoHubView)

Guard: `locals.user`+`locals.tenant` altfel redirect /login; `requireStaff(event)`. `Promise.all` pe:
1. **websites**: clientWebsite LEFT JOIN client, websiteContentProfile, agregat contentArticle (count total, ready, published, scheduled, failed, sourcePending=`rewrite_status='none'`, avg seo/aeo/geo pe `seo_score IS NOT NULL`, count analizate) — `groupBy(clientWebsite.id)`.
2. **seria 6 săptămâni**: select (websiteId, seoScore, aeoScore, geoScore, generatedAt) din articolele cu scor + generatedAt ≥ now-42d; gruparea pe isoWeekKey în JS (chei identice cu PageSpeed).
3. **seoLinks per client**: count, published, submitted, pending, rejected, sum(price), count(pending/submitted cu createdAt < now-14d).
4. **discovery**: ultimul job `status='completed'` + count rezultate cu `savedAsSeoLinkId IS NULL AND alreadyTracked=0`.
5. **pagespeed**: siteurile tenantului + ultimele 2 măsurători ok mobile per site (aceeași tehnică din pagespeed.remote: select desc + grupare JS) + cwvPass pe field data; match pe domain la websites.
6. **clients** (id, name) pt filtru.

Returnează obiect serializabil: `{ websites, weekly, links, discovery, pagespeed, clients, generatedAt }`. Recomandările se derivă din aceleași date cu `buildSeoRecommendations` (server, ca tab-ul „Necesită atenție" și KPI-ul să folosească EXACT aceleași reguli — criteriu de acceptare).

- [x] Commit.

### Task 6: UI — componente hub

**Files:**
- Create: `app/src/lib/components/seo-hub/SeoHubView.svelte` (importă `../pagespeed/pagespeed.css` + `./seo-hub.css`)
- Create: `app/src/lib/components/seo-hub/seo-hub.css` (doar clase `sh-*`: gauge semicerc, bare triple SEO/AEO/GEO, legendă, carduri modul, bare orizontale, listă recomandări)
- Create: `app/src/lib/components/seo-hub/ShGauge.svelte`, `ShBars.svelte`, `ShAddWebsiteModal.svelte`

Layout (spec §4, de sus în jos): hero (titlu+sumar+căutare+Export raport CSV+Recalculează scoruri+Adaugă website) → 6 KPI (`cl-kpis`) → legendă compactă → 3 carduri modul cu statistici live + link → tabel Website-uri (tabs Toate/Necesită atenție/Cu articole; filtru client; sortare; coloane per spec; PsiFav, ShBars, ShGauge, PsiDonut, PsiSpark; „—" pt scor null) → 2 panouri (PsiLine 3 serii SEO #1877F2 / AEO #06b6d4 / GEO #8b5cf6 + bare orizontale articole pe stare) → 2 panouri (Recomandări deschise + Linkuri de presă pe status cu buget RON) → tabel Ultimele scanări PageSpeed.

Culori: SEO albastru `var(--cl-accent)`, AEO cyan #06b6d4, GEO violet #8b5cf6 — consecvent bare/grafic/legendă. Praguri identice PageSpeed via `psiScoreLevel`. Numere: `Intl.NumberFormat('ro-RO')`. Toate textele RO cu diacritice. Stări: empty per secțiune; eroare → pagina de eroare SvelteKit (load server); „Recalculează scoruri" cu spinner + toast + `invalidateAll()`.

- [x] `data-screen-label="SEO & GEO & AEO"`, fără breadcrumb propriu (topbar-ul global îl are).
- [x] svelte-autofixer pe fiecare componentă. Commit.

### Task 7: Sidebar + breadcrumbs + crumb Content

**Files:**
- Modify: `app/src/lib/config/sidebar-nav.ts` — item nou `seo` (label „SEO & GEO & AEO", href `/seo`, `groupCrumb: true`) cu children: Linkuri SEO `/seo-links`, PageSpeed Insights `/seo-links/pagespeed`, Content `/content`; se ELIMINĂ itemele vechi `seo-links` (cu copilul pagespeed) și `content` din listă. `buildBreadcrumbs`: dacă primul crumb provine dintr-un item cu `groupCrumb` (el însuși sau părintele), unshift `{ label: groupLabel }`.
- Modify: `app/src/lib/components/ots-sidebar/NavIcon.svelte` — icon key `seo` nou (Sparkles/TrendingUp) dacă e nevoie de diferențiere.
- Modify: `app/src/lib/components/content/content-hub-view.svelte` (+ pagina admin care îl montează) — crumb `Home › SEO & GEO & AEO › Content` prin prop opțional `seoHubHref` (doar admin, nu portal client).
- Test: `app/src/lib/config/__tests__/sidebar-nav.test.ts` — buildBreadcrumbs pt `/ots/seo`, `/ots/seo-links`, `/ots/seo-links/pagespeed`, `/ots/content`; isGroupActive/isItemActive pe cele 4 rute.

- [x] Teste întâi, apoi implementare. Notă asumată: pe `/seo-links/pagespeed` breadcrumb-ul are și nivelul „Linkuri SEO" (nesting fizic al rutei) — deviație acceptată de la spec, documentată în raportul final.
- [x] Commit.

### Task 8: Design flow + verificare

- [x] Audit design-auditor + web-design-guidelines pe SeoHubView (contrast, aria, focus, states, dark mode, overflow cu texte lungi); fix Critical/High.
- [x] `bun run test` (toate), svelte-autofixer, `/build-check` (baseline 16 err/56 warn).
- [x] testermcp: login dev, `/ots/seo` golden path (tabs, filtru, sortare, linkuri module, recalculare), screenshot light/dark; verifică sidebar activ pe cele 4 rute + breadcrumbs.
- [x] Criterii de acceptare (spec §7) bifate una câte una.
- [x] Review (superpowers:requesting-code-review), fix, commit final, push. Propune deploy și AȘTEAPTĂ „go".
- [x] `graphify . --update`.
