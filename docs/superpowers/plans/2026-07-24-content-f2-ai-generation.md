# Content F2 — Generare AI (rescriere + brief) (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. UI → `svelte:svelte-file-editor` + autofixer. Server helper → TDD (bun:test). Steps use checkbox (`- [ ]`).

**Goal:** Conectează articolele la pluginul Claude: un helper `article-generator` peste `getClaudeClientFor(tenantId,'copywriting')` care rescrie un advertorial-sursă sau scrie unul nou dintr-un brief, folosind profilul brand (general) + direcția per articol. Butoane în UI: „Rescrie din sursă", „Regenerează", „Articol nou din brief".

**Architecture:** Prompt = system(profil brand + guardrails + direcție articol) + user(sursă SAU brief). Claude întoarce JSON `{title, excerpt, body_markdown}`; `renderMarkdown`→HTML se salvează în `generated_*`, `rewrite_status='ready'`. On-demand prin remote `command` (un articol/apel, timeout client mărit la 120s). Batch (rescriere în masă per website) = task opțional, worker-pool ca `content-pipeline.ts`.

**Tech Stack:** Claude Messages API (via plugin), `marked`, valibot, bun:test.

**Referință:** spec §6; F0+F1 aplicate. Ruta `copywriting` (Sonnet 5) e configurată în `/settings/claude`. Plugin API: `getClaudeClientFor(tenantId, useCaseId) → ClaudeClient|null`; `createClaudeClient({apiKey,keyType,defaultModel,timeoutMs?})` (default 20s); `client.createMessage({model,max_tokens,system?,messages}) → Response` (raw; parsează `json.content[0].text`). `renderMarkdown` din `$lib/utils/markdown`.

**Date:** website-uri cu surse nerescrise: Lucky 72, Preziosa 42, + 58 heylux (171-113). Profiluri: heylux (brand-context.md), lucky/preziosa goale (utilizatorul le completează în tab Context brand).

---

## File Structure

- `src/lib/server/plugins/claude/index.ts` — Modify (`getClaudeClientFor`/`getClaudeClient` acceptă `timeoutMs?`)
- `src/lib/server/content/article-generator.ts` — Create (buildSystemPrompt + parseGeneration + generateArticle)
- `src/lib/server/content/__tests__/article-generator.test.ts` — Create (teste pt buildSystemPrompt + parseGeneration)
- `src/lib/remotes/content-articles.remote.ts` — Modify (rewriteArticle, regenerateArticle, generateArticleFromBrief)
- `src/routes/[tenant]/content/[websiteId]/ArticleReviewDrawer.svelte` — Modify (butoane Rescrie/Regenerează)
- `src/routes/[tenant]/content/[websiteId]/+page.svelte` — Modify (buton „Articol nou din brief" + dialog)

---

## Task 1: `getClaudeClientFor` acceptă `timeoutMs`

**Files:** Modify `src/lib/server/plugins/claude/index.ts`

- [ ] **Step 1:** Adaugă param opțional `timeoutMs` la ambele funcții, pasat la `createClaudeClient`.

În `getClaudeClient`: schimbă semnătura în
```ts
export async function getClaudeClient(
	tenantId: string,
	keyType?: ClaudeKeyType,
	timeoutMs?: number
): Promise<ClaudeClient | null> {
```
și la `createClaudeClient({...})` adaugă `timeoutMs`.

În `getClaudeClientFor`:
```ts
export async function getClaudeClientFor(
	tenantId: string,
	useCaseId: ClaudeUseCaseId,
	timeoutMs?: number
): Promise<ClaudeClient | null> {
```
și la `createClaudeClient({ apiKey: ..., keyType: ..., defaultModel: ..., timeoutMs })`.

(`ClaudeClientOptions` are deja `timeoutMs?` — nicio schimbare în client.ts.)

- [ ] **Step 2:** Type-check (0 erori) + commit `feat(content): getClaudeClientFor acceptă timeoutMs`.

---

## Task 2: `article-generator.ts` (helper + TDD)

**Files:** Create `src/lib/server/content/article-generator.ts`; Test `src/lib/server/content/__tests__/article-generator.test.ts`

Contract:
- `buildSystemPrompt(profile, direction)` — string pur din profil + direcție.
- `parseGeneration(text)` — extrage `{title, excerpt, bodyMarkdown}` din răspunsul Claude (JSON tolerant: acceptă fenced ```json, sau obiect brut; fallback: tot textul = bodyMarkdown).
- `generateArticle(tenantId, opts)` — orchestrare: `getClaudeClientFor(tenantId,'copywriting',120_000)` → `createMessage` → `parseGeneration` → `{ title, html, excerpt, model }` (html = `renderMarkdown(bodyMarkdown)`). Aruncă cu mesaj clar dacă plugin inactiv / `!res.ok`.

- [ ] **Step 1: Teste (bun:test) pt părțile pure** — `article-generator.test.ts`:
```ts
import { describe, it, expect } from 'bun:test';
import { buildSystemPrompt, parseGeneration } from '../article-generator';

describe('buildSystemPrompt', () => {
	it('include profilul + guardrails + direcția', () => {
		const s = buildSystemPrompt(
			{ tone: 'cald', audience: 'femei 18+', language: 'ro', keywords: 'videochat, Iași', guardrails: 'doar claim-uri din sursă', doList: null, dontList: null, topics: null, sampleUrls: null, extraNotes: null },
			'focus pe program flexibil'
		);
		expect(s).toContain('cald');
		expect(s).toContain('femei 18+');
		expect(s).toContain('doar claim-uri din sursă');
		expect(s).toContain('focus pe program flexibil');
	});
	it('merge și cu profil null', () => {
		const s = buildSystemPrompt(null, null);
		expect(typeof s).toBe('string');
		expect(s.length).toBeGreaterThan(0);
	});
});

describe('parseGeneration', () => {
	it('parsează JSON fenced', () => {
		const r = parseGeneration('```json\n{"title":"T","excerpt":"E","body_markdown":"## H\\ntext"}\n```');
		expect(r.title).toBe('T');
		expect(r.excerpt).toBe('E');
		expect(r.bodyMarkdown).toContain('## H');
	});
	it('parsează JSON brut', () => {
		const r = parseGeneration('{"title":"A","excerpt":"B","body_markdown":"C"}');
		expect(r.title).toBe('A');
	});
	it('fallback: text simplu → bodyMarkdown', () => {
		const r = parseGeneration('doar niște text fără json');
		expect(r.bodyMarkdown).toContain('doar niște text');
		expect(r.title).toBe('');
	});
});
```

- [ ] **Step 2: Rulează → FAIL.** `cd app && bun test src/lib/server/content/__tests__/article-generator.test.ts`

- [ ] **Step 3: Implementează** `article-generator.ts`:
```ts
import { getClaudeClientFor } from '$lib/server/plugins/claude';
import { renderMarkdown } from '$lib/utils/markdown';

export interface ContentProfileLike {
	tone: string | null;
	audience: string | null;
	language: string | null;
	keywords: string | null;
	topics: string | null;
	doList: string | null;
	dontList: string | null;
	guardrails: string | null;
	sampleUrls: string | null;
	extraNotes: string | null;
}

/** System prompt din profilul brand (general) + direcția per articol. */
export function buildSystemPrompt(profile: ContentProfileLike | null, direction: string | null): string {
	const lines: string[] = [
		'Ești copywriter SEO/GEO pentru un brand. Scrii în limba română, cu diacritice, ton profesional și onest.',
		'REGULĂ SUPREMĂ: folosește DOAR fapte/claim-uri prezente în materialul-sursă sau în brief. Nu inventa cifre, procente, garanții.'
	];
	if (profile) {
		if (profile.language) lines.push(`Limbă: ${profile.language}.`);
		if (profile.tone) lines.push(`Ton: ${profile.tone}.`);
		if (profile.audience) lines.push(`Public-țintă: ${profile.audience}.`);
		if (profile.keywords) lines.push(`Cuvinte-cheie SEO: ${profile.keywords}.`);
		if (profile.topics) lines.push(`Subiecte relevante: ${profile.topics}.`);
		if (profile.doList) lines.push(`De făcut: ${profile.doList}.`);
		if (profile.dontList) lines.push(`De evitat: ${profile.dontList}.`);
		if (profile.guardrails) lines.push(`Mesaje INTERZISE / guardrails: ${profile.guardrails}.`);
		if (profile.extraNotes) lines.push(`Context brand suplimentar:\n${profile.extraNotes}`);
	}
	if (direction && direction.trim()) lines.push(`Direcție specifică pentru ACEST articol: ${direction.trim()}.`);
	lines.push(
		'Răspunde DOAR cu un obiect JSON valid, fără text în plus, de forma: {"title": "...", "excerpt": "...", "body_markdown": "..."}. body_markdown folosește ## pentru subtitluri și poate include o secțiune de Întrebări frecvente.'
	);
	return lines.join('\n');
}

export interface Generated {
	title: string;
	excerpt: string;
	bodyMarkdown: string;
}

/** Parsează răspunsul Claude — JSON fenced / brut / fallback text. */
export function parseGeneration(text: string): Generated {
	const t = (text ?? '').trim();
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
	const candidate = fenced ? fenced[1].trim() : t;
	try {
		const start = candidate.indexOf('{');
		const end = candidate.lastIndexOf('}');
		if (start !== -1 && end > start) {
			const obj = JSON.parse(candidate.slice(start, end + 1));
			return {
				title: typeof obj.title === 'string' ? obj.title : '',
				excerpt: typeof obj.excerpt === 'string' ? obj.excerpt : '',
				bodyMarkdown: typeof obj.body_markdown === 'string' ? obj.body_markdown : ''
			};
		}
	} catch {
		/* fallthrough */
	}
	return { title: '', excerpt: '', bodyMarkdown: t };
}

export interface GenerateOpts {
	profile: ContentProfileLike | null;
	direction: string | null;
	mode: 'rewrite' | 'brief';
	sourceText?: string; // pt rewrite
	brief?: string; // pt brief
}

export interface GenerateResult {
	title: string;
	html: string;
	excerpt: string;
	model: string;
}

/** Generează un articol (rescriere sau brief) prin ruta Claude 'copywriting'. */
export async function generateArticle(tenantId: string, opts: GenerateOpts): Promise<GenerateResult> {
	const client = await getClaudeClientFor(tenantId, 'copywriting', 120_000);
	if (!client) throw new Error('Pluginul Claude nu e configurat (adaugă o cheie în Settings → Claude).');

	const system = buildSystemPrompt(opts.profile, opts.direction);
	const userMsg =
		opts.mode === 'rewrite'
			? `Rescrie următorul advertorial ca articol de blog SEO/GEO on-brand, păstrând faptele. Material-sursă:\n\n${opts.sourceText ?? ''}`
			: `Scrie un articol nou de blog SEO/GEO on-brand pe subiectul: ${opts.brief ?? ''}`;

	const res = await client.createMessage({
		model: client.defaultModel,
		max_tokens: 4000,
		system,
		messages: [{ role: 'user', content: userMsg }]
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
	}
	const json = (await res.json()) as { content?: Array<{ text?: string }> };
	const text = json.content?.[0]?.text ?? '';
	const parsed = parseGeneration(text);
	return {
		title: parsed.title,
		excerpt: parsed.excerpt,
		html: renderMarkdown(parsed.bodyMarkdown),
		model: client.defaultModel
	};
}
```

- [ ] **Step 4: Rulează → PASS** (7 teste). **Step 5: Commit** `feat(content): article-generator (Claude copywriting) + teste`.

---

## Task 3: Remote commands (rewrite / regenerate / brief)

**Files:** Modify `src/lib/remotes/content-articles.remote.ts` (import `generateArticle`; adaugă helper intern de încărcare profil + 3 comenzi)

- [ ] **Step 1: Adaugă** (după `updateContentArticle`):
```ts
import { generateArticle } from '$lib/server/content/article-generator';

// helper: profilul website-ului (sau null)
async function loadProfile(tenantId: string, websiteId: string) {
	const rows = await db
		.select()
		.from(table.websiteContentProfile)
		.where(
			and(
				eq(table.websiteContentProfile.websiteId, websiteId),
				eq(table.websiteContentProfile.tenantId, tenantId)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

/** Rescrie un articol-sursă existent cu AI (păstrează direcția per articol). */
export const rewriteArticle = command(v.string(), async (articleId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const rows = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
		.limit(1);
	const a = rows[0];
	if (!a) svelteError(404, 'Articol negăsit');
	if (!a.websiteId) svelteError(400, 'Articolul nu e legat de un website');

	await db.update(table.contentArticle).set({ rewriteStatus: 'drafting', updatedAt: new Date() }).where(eq(table.contentArticle.id, articleId));
	try {
		const profile = await loadProfile(tenantId, a.websiteId);
		const gen = await generateArticle(tenantId, {
			profile,
			direction: a.articleDirection,
			mode: 'rewrite',
			sourceText: a.bodyText || a.bodyHtml || a.title || ''
		});
		await db
			.update(table.contentArticle)
			.set({
				generatedTitle: gen.title || a.generatedTitle,
				generatedExcerpt: gen.excerpt || a.generatedExcerpt,
				generatedHtml: gen.html,
				origin: 'rewrite',
				rewriteStatus: 'ready',
				generatedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.contentArticle.id, articleId));
		return { ok: true };
	} catch (e) {
		await db.update(table.contentArticle).set({ rewriteStatus: 'failed', updatedAt: new Date() }).where(eq(table.contentArticle.id, articleId));
		svelteError(500, e instanceof Error ? e.message : 'Generare eșuată');
	}
});

/** Alias explicit „Regenerează" (identic cu rewrite; direcția curentă e deja în DB). */
export const regenerateArticle = command(v.string(), async (articleId) => {
	// refolosește logica rewriteArticle prin apel intern nu e posibil (remote); duplicăm apelul minimal:
	return rewriteArticle(articleId);
});

/** Articol nou dintr-un brief (subiect/keyword) pt un website. */
export const generateArticleFromBrief = command(
	v.object({ websiteId: v.string(), brief: v.pipe(v.string(), v.minLength(3)) }),
	async ({ websiteId, brief }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const ws = await db
			.select({ id: table.clientWebsite.id, clientId: table.clientWebsite.clientId })
			.from(table.clientWebsite)
			.where(and(eq(table.clientWebsite.id, websiteId), eq(table.clientWebsite.tenantId, tenantId)))
			.limit(1);
		if (!ws[0]) svelteError(404, 'Website negăsit');

		const profile = await loadProfile(tenantId, websiteId);
		const gen = await generateArticle(tenantId, { profile, direction: null, mode: 'brief', brief });

		const id = genId();
		const now = new Date();
		await db.insert(table.contentArticle).values({
			id,
			tenantId,
			websiteId,
			clientId: ws[0].clientId,
			brand: 'unknown',
			origin: 'brief',
			sourceUrl: `brief:${id}`,
			sourceDomain: 'brief',
			brief,
			generatedTitle: gen.title,
			generatedExcerpt: gen.excerpt,
			generatedHtml: gen.html,
			rewriteStatus: 'ready',
			extractStatus: 'ok',
			generatedAt: now,
			createdAt: now,
			updatedAt: now
		});
		return { ok: true, id };
	}
);
```
NOTĂ: `content_article.brief` + `content_article.publish_status` NU există încă în schema (au fost amânate în F0). **Adaugă în Task 3 o migrare 0428 pt `brief`** (publish_status rămâne F3):
- `drizzle/0428_content_article_brief.sql`: `ALTER TABLE \`content_article\` ADD COLUMN \`brief\` text;`
- journal idx 428; `db:migrate`; în schema.ts adaugă `brief: text('brief'),` după `origin`. (regenerateArticle care „reapelează" rewriteArticle: în remote functions nu poți apela altă remote direct — în loc, extrage logica în `async function doRewrite(articleId, event)` și cheam-o din ambele comenzi. Refactorează astfel.)

- [ ] **Step 2:** Refactor: extrage corpul rewrite într-o funcție internă `doRewrite(tenantId, articleId)` apelată de `rewriteArticle` și `regenerateArticle` (evită apelul remote→remote).
- [ ] **Step 3:** migrare 0428 brief + schema + `db:migrate` + PRAGMA.
- [ ] **Step 4:** Type-check (0 erori) + commit `feat(content): comenzi rewrite/regenerate/brief + migrare brief`.

---

## Task 4: UI — butoane generare în drawer + „Articol nou din brief"

**Files:** Modify `ArticleReviewDrawer.svelte`, `[websiteId]/+page.svelte`

- [ ] **Step 1 (drawer):** În `.ct-drawer-foot` (sau lângă col „Rescris"), adaugă butoane:
  - „Rescrie din sursă" (`.cl-btn-secondary`): `await rewriteArticle(articleId).updates(getContentArticle(articleId), getWebsiteArticles({websiteId, status: status||undefined}))`; pe succes, drawerul re-citește articolul (generated_* actualizate) — RichEditor re-mount pe `{#key}` sau setează `gHtml` din noul `article`. Spinner „Se generează…" în timpul apelului (`let generating = $state(false)`).
  - „Regenerează" (`.cl-btn-secondary`): `regenerateArticle(articleId)` (folosește direcția curentă — salveaz-o întâi cu `updateContentArticle` dacă s-a modificat).
  - Ambele: `import { rewriteArticle, regenerateArticle, getContentArticle, getWebsiteArticles } from '$lib/remotes/content-articles.remote';` toast succes/eroare; disabled în timpul `generating`.
  - IMPORTANT re-sync RichEditor: după generare, `loadedId` trebuie resetat ca `$effect`-ul să re-sincronizeze `gHtml` din noul `article`, SAU folosește `{#key article.generatedAt}` pe RichEditor. Alege una și documentează.
- [ ] **Step 2 (Articole tab):** buton „+ Articol nou" în hero/toolbar → mic dialog (`.iv-modal`-style sau un simplu `.cl-section` inline) cu `.cl-textarea` pt brief + „Generează"; `await generateArticleFromBrief({websiteId, brief}).updates(getWebsiteArticles({websiteId}))`; pe succes deschide drawerul pe noul id. Spinner în timpul generării.
- [ ] **Step 3:** `svelte-autofixer` pe ambele; type-check; commit `feat(content): butoane Rescrie/Regenerează/Articol nou (UI F2)`.

---

## Task 5 (OPȚIONAL — batch): rescriere în masă per website

Amânat dacă timpul e scurt. Task/worker-pool ca `content-pipeline.ts`: comandă `startWebsiteRewrite(websiteId)` care lansează fire-and-forget peste articolele `origin!='brief' && rewriteStatus IN ('none')` ale website-ului, apelând `doRewrite` cu CONCURRENCY=2 (rate-limit Claude). UI: buton „Rescrie toate" + progres (refolosește `content_import_job` sau un contor simplu). **Documentează dacă e sărit.**

---

## Task 6: Verificare

- [ ] build-check (0 erori) + `bun test` (generator pass).
- [ ] Pe :5173: deschide un articol Lucky/Preziosa (sursă) → „Rescrie din sursă" → apare draft în RichEditor → Aprobă. Completează întâi profilul Lucky în tab Context brand pt output on-brand.
- [ ] „+ Articol nou" cu un brief → articol generat apare în listă.

---

## Self-Review (acoperire spec §6)

- §6.1 helper generateArticle peste getClaudeClientFor('copywriting') + timeout mărit → Task 1, 2 ✓
- §6.2 system prompt = profil general + direcție articol → buildSystemPrompt (Task 2) ✓
- §6.3 două intrări: rescriere din sursă + brief nou → Task 3 (rewriteArticle, generateArticleFromBrief) ✓ + Regenerează ✓
- UI wiring → Task 4 ✓
- Batch (masă) → Task 5 opțional (spec: „job de generare … on-demand + batch")

**Amânări:** publicare WP + calendar + moduri auto = F3. `publish_status` = F3. Batch = Task 5 opțional.
