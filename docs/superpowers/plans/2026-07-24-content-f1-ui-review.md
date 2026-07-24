# Content F1 — UI `/content` în Claude Design + review articol (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. UI tasks: use the `svelte:svelte-file-editor` agent + `svelte-autofixer` MCP on every `.svelte` file. Steps use checkbox (`- [ ]`).

**Goal:** Înlocuiește pagina mono-brand `/content/heylux` cu un UI multi-website în Claude Design: overview cu carduri per website (3 active) + KPI, detaliu website cu tab **Articole** și **editor de review** (sursă ↔ rescris, direcție per articol, aprobă) + tab **Context brand** (editor profil general).

**Architecture:** Reutilizează stratul remote existent (extins) + Claude Design (`content.css` copiat din `interviuri.css`) + `RichEditor` (TipTap) existent. Fără AI (F2), fără publicare WP/calendar (F3). Read-only + edit/save/approve pe date.

**Tech Stack:** SvelteKit 5 (runes, remote functions), Drizzle/Turso, Claude Design cl-* CSS, `@lucide/svelte`, `svelte-sonner`.

**Referință spec:** `docs/superpowers/specs/2026-07-24-content-multi-website-design.md` §8. **F0 e aplicat** (websiteId/generated_* pe Turso; 3 profiluri; 113 heylux ready).

**Date reale:** tenant ots `k2yzj5bxxppatc57vxpoxfvn`; websites active: Heylux `a9412aba640f436c8cdf69f8865199`, Lucky `az5wrkjreui6ctzooy3uhq5z`, Preziosa `rk32c2mnwxwwjv53ynqqkgdv`. Sidebar la `src/lib/config/sidebar-nav.ts:236`. RichEditor: `src/lib/components/RichEditor/RichEditor.svelte`.

**Convenții:** `[tenant]/+layout.svelte` pune `p-6` → `.cl-wrap` face breakout `margin:-1.5rem` (NU adăuga padding exterior). Remote: `query`/`command` cu `requireStaff(event)` + tenant scoping + valibot. UI: `$derived(await query(args))` + `.updates()` + `<svelte:boundary>`. Rulează `svelte-autofixer` pe fiecare componentă. Type-check baseline: 0 erori.

---

## File Structure

- `drizzle/0427_content_article_article_direction.sql` — Create (migrare)
- `drizzle/meta/_journal.json` — Modify (idx 427)
- `src/lib/server/db/schema.ts` — Modify (`contentArticle.articleDirection`)
- `src/routes/[tenant]/content/content.css` — Create (Claude Design core, copiat din interviuri.css:1-152)
- `src/lib/remotes/content-articles.remote.ts` — Modify (adaugă getContentWebsites, getWebsiteArticles, getContentArticle, updateContentArticle)
- `src/lib/remotes/website-content-profile.remote.ts` — Create (get/update profil)
- `src/routes/[tenant]/content/+page.svelte` — Create (overview multi-website)
- `src/routes/[tenant]/content/[websiteId]/+page.svelte` — Create (detaliu: tab Articole + Context brand)
- `src/routes/[tenant]/content/[websiteId]/ArticleReviewDrawer.svelte` — Create (editor review)
- `src/routes/[tenant]/content/heylux/` — Delete (înlocuit); ops de scrape mutate în overview
- `src/lib/config/sidebar-nav.ts:236` — Modify (Content Heylux → Content, href /content)

---

## Task 1: Migrare `article_direction` + schema

**Files:** Create `drizzle/0427_content_article_article_direction.sql`; Modify `drizzle/meta/_journal.json`, `src/lib/server/db/schema.ts`

- [ ] **Step 1: `drizzle/0427_content_article_article_direction.sql`**
```sql
ALTER TABLE `content_article` ADD COLUMN `article_direction` text;
```

- [ ] **Step 2: journal idx 427** (după 426):
```json
    { "idx": 427, "version": "6", "when": 1779916800027537, "tag": "0427_content_article_article_direction", "breakpoints": true }
```
(adaugă virgulă după blocul 426)

- [ ] **Step 3: `bun run db:migrate`** — Expected: aplicat.

- [ ] **Step 4: schema.ts** — în `contentArticle`, după `generatedAt`:
```ts
	articleDirection: text('article_direction'), // direcție/context per articol (override profil general)
```

- [ ] **Step 5: Verifică PRAGMA + type-check**
Run: `bun -e "const {createClient}=require('@libsql/client');const db=createClient({url:process.env.SQLITE_URI,authToken:process.env.SQLITE_AUTH_TOKEN});db.execute('PRAGMA table_info(content_article)').then(r=>console.log(r.rows.some(x=>x.name==='article_direction')))"`
Expected: `true`. Apoi `NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error` → 0 erori.

- [ ] **Step 6: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add app/drizzle/0427_*.sql app/drizzle/meta/_journal.json app/src/lib/server/db/schema.ts
git commit -m "feat(content): content_article.article_direction (F1)"
```

---

## Task 2: `content.css` (Claude Design core)

**Files:** Create `src/routes/[tenant]/content/content.css`

- [ ] **Step 1: Copiază nucleul cl-* din interviuri**
Run: `sed -n '1,152p' "src/routes/[tenant]/interviuri/interviuri.css" > "src/routes/[tenant]/content/content.css"`
Aceste 152 de linii sunt nucleul brand-agnostic (tokens light/dark + `.cl-wrap`, `.cl-crumbs`, `.cl-hero`, `.cl-search`, `.cl-btn-*`, `.cl-tabs`/`.cl-tab`, `.cl-select`, `.cl-kpis`/`.cl-kpi*`, `.cl-section*`, `.cl-list-wrap`/`.cl-list-table`, `.cl-field`/`.cl-input`/`.cl-textarea`, `.cl-empty`). Reutilizabile ca-atare.

- [ ] **Step 2: Adaugă la finalul `content.css` extensii specifice /content** (carduri website + status pills + drawer):
```css
/* ===== /content extensii ===== */
.ct-web-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin: 0 28px 28px; }
.ct-web-card { background: var(--cl-surface); border: 1px solid var(--cl-border); border-radius: 12px; padding: 16px 18px; cursor: pointer; transition: all .12s; display: flex; flex-direction: column; gap: 12px; }
.ct-web-card:hover { border-color: var(--cl-accent); box-shadow: 0 0 0 3px var(--cl-accent-50); }
.ct-web-head { display: flex; align-items: center; gap: 10px; }
.ct-web-fav { width: 32px; height: 32px; border-radius: 8px; object-fit: contain; background: var(--cl-surface-2); }
.ct-web-name { font-size: 13.5px; font-weight: 700; color: var(--cl-text); }
.ct-web-url { font-size: 11.5px; color: var(--cl-text-3); }
.ct-web-stats { display: flex; gap: 16px; }
.ct-web-stat-v { font-size: 17px; font-weight: 800; color: var(--cl-text); font-variant-numeric: tabular-nums; }
.ct-web-stat-l { font-size: 10.5px; font-weight: 600; color: var(--cl-text-3); text-transform: uppercase; letter-spacing: .05em; }
.ct-web-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.ct-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
.ct-badge.on { background: var(--cl-success-50); color: #047857; }
.ct-badge.off { background: var(--cl-surface-2); color: var(--cl-text-3); }
:global(.dark) .ct-badge.on { color: #34d399; }
/* status pills articol */
.ct-st { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
.ct-st .dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.ct-st.ready { background: var(--cl-success-50); color: #047857; }
.ct-st.draft { background: var(--cl-warn-50); color: #b45309; }
.ct-st.source { background: var(--cl-surface-2); color: var(--cl-text-3); }
:global(.dark) .ct-st.ready { color: #34d399; }
/* drawer editor review */
.ct-drawer-back { position: fixed; inset: 0; background: rgba(15,23,42,.45); backdrop-filter: blur(2px); z-index: 50; }
.ct-drawer { position: fixed; top: 0; right: 0; height: 100dvh; width: min(920px, 96vw); background: var(--cl-bg); border-left: 1px solid var(--cl-border); z-index: 51; display: flex; flex-direction: column; overflow: hidden; }
.ct-drawer-head { display: flex; align-items: center; gap: 12px; padding: 16px 22px; border-bottom: 1px solid var(--cl-border); background: var(--cl-surface); }
.ct-drawer-body { flex: 1; overflow-y: auto; padding: 20px 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.ct-drawer-col h4 { margin: 0 0 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--cl-text-3); }
.ct-source-box { background: var(--cl-surface-2); border: 1px solid var(--cl-border); border-radius: 10px; padding: 14px; font-size: 13px; color: var(--cl-text-2); line-height: 1.6; max-height: 60vh; overflow-y: auto; }
.ct-drawer-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 22px; border-top: 1px solid var(--cl-border); background: var(--cl-surface); }
@media (max-width: 800px) { .ct-drawer-body { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Commit**
```bash
cd /Users/augustin598/Projects/CRM
git add "app/src/routes/[tenant]/content/content.css"
git commit -m "feat(content): content.css — Claude Design core + extensii /content"
```

---

## Task 3: Remote functions (websites + article detail/update)

**Files:** Modify `src/lib/remotes/content-articles.remote.ts`; Create `src/lib/remotes/website-content-profile.remote.ts`

- [ ] **Step 1: Adaugă în `content-articles.remote.ts`** (după importurile existente adaugă `import { sql } from 'drizzle-orm';` dacă lipsește). Adaugă la final:

```ts
/** Website-uri cu conținut (doar cele cu articole legate) + statistici pt overview. */
export const getContentWebsites = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const rows = await db
		.select({
			id: table.clientWebsite.id,
			name: table.clientWebsite.name,
			url: table.clientWebsite.url,
			clientId: table.clientWebsite.clientId,
			clientName: table.client.name,
			wpSiteId: table.clientWebsite.wpSiteId,
			profileId: table.websiteContentProfile.id,
			total: sql<number>`count(${table.contentArticle.id})`,
			ready: sql<number>`sum(case when ${table.contentArticle.rewriteStatus} = 'ready' then 1 else 0 end)`
		})
		.from(table.clientWebsite)
		.innerJoin(table.contentArticle, eq(table.contentArticle.websiteId, table.clientWebsite.id))
		.leftJoin(table.client, eq(table.client.id, table.clientWebsite.clientId))
		.leftJoin(table.websiteContentProfile, eq(table.websiteContentProfile.websiteId, table.clientWebsite.id))
		.where(eq(table.clientWebsite.tenantId, tenantId))
		.groupBy(table.clientWebsite.id);
	return rows;
});

/** Articolele unui website (cu output generat + status). */
export const getWebsiteArticles = query(
	v.object({ websiteId: v.string(), status: v.optional(v.string()) }),
	async ({ websiteId, status }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const conds = [
			eq(table.contentArticle.tenantId, event.locals.tenant.id),
			eq(table.contentArticle.websiteId, websiteId)
		];
		if (status) conds.push(eq(table.contentArticle.rewriteStatus, status));
		return db
			.select({
				id: table.contentArticle.id,
				title: table.contentArticle.title,
				generatedTitle: table.contentArticle.generatedTitle,
				rewriteStatus: table.contentArticle.rewriteStatus,
				origin: table.contentArticle.origin,
				wordCount: table.contentArticle.wordCount,
				publishedAt: table.contentArticle.publishedAt,
				sourceUrl: table.contentArticle.sourceUrl
			})
			.from(table.contentArticle)
			.where(and(...conds))
			.orderBy(desc(table.contentArticle.updatedAt))
			.limit(500);
	}
);

/** Un articol complet (sursă + generat + direcție) pt editor. */
export const getContentArticle = query(v.string(), async (id) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const rows = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, id), eq(table.contentArticle.tenantId, event.locals.tenant.id)))
		.limit(1);
	return rows[0] ?? null;
});

/** Salvează editările pe output-ul generat + direcția + status. */
export const updateContentArticle = command(
	v.object({
		id: v.string(),
		generatedTitle: v.optional(v.string()),
		generatedExcerpt: v.optional(v.string()),
		generatedHtml: v.optional(v.string()),
		articleDirection: v.optional(v.string()),
		rewriteStatus: v.optional(v.picklist(['none', 'queued', 'drafting', 'ready', 'failed']))
	}),
	async (input) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const patch: Record<string, unknown> = { updatedAt: new Date() };
		for (const k of ['generatedTitle', 'generatedExcerpt', 'generatedHtml', 'articleDirection', 'rewriteStatus'] as const) {
			if (input[k] !== undefined) patch[k] = input[k];
		}
		await db
			.update(table.contentArticle)
			.set(patch)
			.where(and(eq(table.contentArticle.id, input.id), eq(table.contentArticle.tenantId, event.locals.tenant.id)));
		return { ok: true };
	}
);
```

- [ ] **Step 2: Create `src/lib/remotes/website-content-profile.remote.ts`**
```ts
import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const getWebsiteContentProfile = query(v.string(), async (websiteId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const rows = await db
		.select()
		.from(table.websiteContentProfile)
		.where(
			and(
				eq(table.websiteContentProfile.websiteId, websiteId),
				eq(table.websiteContentProfile.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	return rows[0] ?? null;
});

const PROFILE_FIELDS = [
	'tone', 'audience', 'language', 'keywords', 'topics',
	'doList', 'dontList', 'guardrails', 'sampleUrls', 'extraNotes'
] as const;

export const updateWebsiteContentProfile = command(
	v.object({
		websiteId: v.string(),
		tone: v.optional(v.string()),
		audience: v.optional(v.string()),
		language: v.optional(v.string()),
		keywords: v.optional(v.string()),
		topics: v.optional(v.string()),
		doList: v.optional(v.string()),
		dontList: v.optional(v.string()),
		guardrails: v.optional(v.string()),
		sampleUrls: v.optional(v.string()),
		extraNotes: v.optional(v.string())
	}),
	async (input) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;
		const patch: Record<string, unknown> = { updatedAt: new Date() };
		for (const k of PROFILE_FIELDS) if (input[k] !== undefined) patch[k] = input[k];
		await db
			.update(table.websiteContentProfile)
			.set(patch)
			.where(
				and(
					eq(table.websiteContentProfile.websiteId, input.websiteId),
					eq(table.websiteContentProfile.tenantId, tenantId)
				)
			);
		return { ok: true };
	}
);
```

- [ ] **Step 3: Type-check + commit**
Run type-check (0 erori). Then:
```bash
cd /Users/augustin598/Projects/CRM
git add app/src/lib/remotes/content-articles.remote.ts app/src/lib/remotes/website-content-profile.remote.ts
git commit -m "feat(content): remote-uri websites+articole+profil pt UI F1"
```

---

## Task 4: Pagina overview `/content`

**Files:** Create `src/routes/[tenant]/content/+page.svelte`

Structură Claude Design (mirror `interviuri/+page.svelte`): `import './content.css'`; `.cl-wrap` > `.cl-crumbs` (Content) > `.cl-hero` (h1 „Content" + p cu numărători, `.cl-hero-actions` cu buton „Refresh") > bandă KPI (`.cl-hero` wrapper padding 0 > `.cl-kpis` cu 4-5 KPI: total articole / ready / websites / ...) > `.ct-web-grid` cu `.ct-web-card` per website.

- [ ] **Step 1: Implementează pagina** (folosește `svelte:svelte-file-editor` agent). Cerințe:
  - `import { getContentWebsites } from '$lib/remotes/content-articles.remote';`
  - `const websites = $derived(await getContentWebsites());` în `<svelte:boundary>` cu skeleton.
  - KPI band: total = sum(total), ready = sum(ready), websites = websites.length.
  - Fiecare card `.ct-web-card`: favicon via `getFaviconUrl(url)` din `$lib/utils`, `.ct-web-name` = name ?? domeniu, `.ct-web-url`, clientName; `.ct-web-stats` (total articole, ready); `.ct-web-badges`: „WP legat" (`.ct-badge.on` dacă wpSiteId else `.off`), „Profil" (on dacă profileId). Click pe card → `goto('/'+tenant+'/content/'+website.id)` (ia `page.params.tenant`).
  - Empty state `.cl-empty` dacă 0 websites.
  - Titlu `<svelte:head><title>Content · CRM</title>`.
  - Fără padding exterior (`.cl-wrap` gestionează).
- [ ] **Step 2: `svelte-autofixer` pe pagină** (MCP) → fix până e curat.
- [ ] **Step 3: Type-check + commit** (`feat(content): pagina overview /content (Claude Design)`).

---

## Task 5: Pagina detaliu `/content/[websiteId]` (tab Articole + Context brand)

**Files:** Create `src/routes/[tenant]/content/[websiteId]/+page.svelte`

- [ ] **Step 1: Implementează** (svelte-file-editor). Cerințe:
  - `websiteId = page.params.websiteId`.
  - `.cl-wrap` > `.cl-crumbs` (Content › nume website) > `.cl-hero` (h1 nume website) > `.cl-tabs` cu 2 taburi: **Articole**, **Context brand** (`activeTab = $state('articole')`).
  - **Tab Articole:** `const articles = $derived(await getWebsiteArticles({ websiteId, status: statusFilter || undefined }));` în boundary. Filtru status `.cl-select` (toate/ready/none). Tabel `.cl-list-wrap`+`.cl-list-table`: coloane Titlu (generatedTitle ?? title), Status (`.ct-st`: ready/draft/source din rewriteStatus/origin), Cuvinte, Data, Sursă (link). Rând click → deschide `ArticleReviewDrawer` cu `articleId`.
  - **Tab Context brand:** `const profile = $derived(await getWebsiteContentProfile(websiteId));` în boundary. Form `.cl-field`/`.cl-input`/`.cl-textarea` pt: tone, audience, language, keywords, topics, doList, dontList, guardrails, sampleUrls, extraNotes. Buton „Salvează" → `updateWebsiteContentProfile({ websiteId, ...values }).updates(getWebsiteContentProfile(websiteId))`; toast.
  - status pill helper: rewriteStatus==='ready' → `ct-st ready` „Ready"; origin==='rewrite' && !ready → `ct-st draft` „Draft"; else `ct-st source` „Sursă".
- [ ] **Step 2: `svelte-autofixer`** → curat.
- [ ] **Step 3: Type-check + commit** (`feat(content): detaliu website — tab Articole + Context brand`).

---

## Task 6: Editor review articol (`ArticleReviewDrawer.svelte`)

**Files:** Create `src/routes/[tenant]/content/[websiteId]/ArticleReviewDrawer.svelte`

- [ ] **Step 1: Implementează** (svelte-file-editor). Props: `articleId: string`, `onClose: () => void`. Cerințe:
  - `const article = $derived(await getContentArticle(articleId));` în boundary.
  - `.ct-drawer-back` (click → onClose) + `.ct-drawer`.
  - `.ct-drawer-head`: titlu editabil `.cl-input` (generatedTitle), buton X (onClose).
  - `.ct-drawer-body` (2 coloane): 
    - Col stânga „Sursă": `.ct-source-box` cu `{@html article.bodyHtml}` (sau bodyText). „Direcție articol" `.cl-textarea` (articleDirection) sub sursă.
    - Col dreapta „Rescris": `RichEditor` (`import RichEditor from '$lib/components/RichEditor/RichEditor.svelte'`) bind pe `generatedHtml`; câmp excerpt `.cl-textarea` (generatedExcerpt).
  - `.ct-drawer-foot`: „Salvează" (`updateContentArticle({ id, generatedTitle, generatedExcerpt, generatedHtml, articleDirection })`), „Aprobă" (`updateContentArticle({ id, rewriteStatus: 'ready' })` + save), „Închide". `.updates(getWebsiteArticles(...))` unde e relevant; toast.
  - Verifică semnătura reală a `RichEditor` (props: probabil `content`/`value` + `onChange` sau `bind:`). Citește `RichEditor.svelte` înainte și adaptează bind-ul.
- [ ] **Step 2: `svelte-autofixer`** → curat.
- [ ] **Step 3: Type-check + commit** (`feat(content): editor review articol (drawer + RichEditor)`).

---

## Task 7: Sidebar rename + cleanup rută veche

**Files:** Modify `src/lib/config/sidebar-nav.ts:236`; Delete `src/routes/[tenant]/content/heylux/`

- [ ] **Step 1: Sidebar** — schimbă linia 236:
```ts
			{ id: 'content', label: 'Content', icon: 'seo-links', href: '/content' },
```

- [ ] **Step 2: Mută ops de scrape** (importHeyluxSources/startContentExtraction/retry) — pentru F1, păstrează-le accesibile printr-un buton „Surse / Import" în hero-ul overview-ului (`/content/+page.svelte`) care deschide un mic dialog cu cele 3 butoane + job status (refolosește `getContentImportJob`). *(Dacă e prea mult pt F1, notează DONE_WITH_CONCERNS și lasă un buton simplu „Importă surse"/„Extrage" în hero.)*

- [ ] **Step 3: Șterge ruta veche** `src/routes/[tenant]/content/heylux/+page.svelte` (nu mai e linkată; `/content/[websiteId]` o înlocuiește — 'heylux' nu se ciocnește fiindcă website-urile folosesc id-uri base32).
```bash
cd /Users/augustin598/Projects/CRM
git rm "app/src/routes/[tenant]/content/heylux/+page.svelte"
```

- [ ] **Step 4: Type-check + commit** (`feat(content): sidebar Content + cleanup rută heylux`).

---

## Task 8: Verificare finală (build-check + vizual)

- [ ] **Step 1: build-check** — Run: `cd app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error` → 0 erori.
- [ ] **Step 2: Vizual pe :5173** — dev server-ul rulează branch-ul. Navighează `/ots/content` → overview 3 carduri; click Heylux → tab Articole (113 ready); deschide un articol → drawer sursă↔rescris; tab Context brand → profilul heylux cu brand-context.md în extraNotes. Verifică light+dark.
- [ ] **Step 3: Commit final** dacă e nevoie de ajustări.

---

## Self-Review (acoperire spec §8)

- §8.1 overview multi-website + KPI + carduri → Task 4 ✓
- §8.2 detaliu website, tab Articole (tabel + status pills + filtre) + tab Context brand (editor profil) → Task 5 ✓
- §8.3 editor review (sursă↔rescris, direcție articol, aprobă) → Task 6 ✓
- §8.4 reutilizare remote + `$derived`/`.updates()`/`<svelte:boundary>` + Claude Design → Tasks 3-6 ✓
- Redenumire rută + sidebar → Task 7 ✓
- Calendar + publicare WP + moduri = **F3** (nu F1). Generare/Regenerează AI = **F2** (nu F1). Butonul „Aprobă" doar setează `rewrite_status='ready'` (fără WP).

**Amânări documentate:** tab Calendar + tab Setări (WP link/mod publicare) → F3; butoane „Rescrie din sursă"/„Articol nou"/„Regenerează" (AI) → F2. F1 = vizualizare + review + edit + context brand.
