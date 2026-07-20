# Heylux Content Parse (Faza 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape the 326 advertorial URLs in `app/Heylux_pars.md`, extract title/body/date/images/brand for each, and store them in a new `content_article` table, monitored from a new `/ots/content/heylux` page.

**Architecture:** Reuse the existing Cloudflare-bypass scraper (`fetchWithCloudflareFallback`) for fetching. Add pure extraction modules (`article-extractor`, `brand-detector`) and a shared date module refactored out of `seo-links.remote.ts`. Ingestion runs as an **in-process background job** (mirroring `launchDiscoveryJob`, NOT the BullMQ scheduler) driven by staff-gated remote functions, with a `content_import_job` progress row and resume-on-retry.

**Tech Stack:** SvelteKit 5 remote functions, Drizzle ORM + libSQL (Turso), `@mozilla/readability` + `linkedom` (new deps), `node-html-parser` (existing, heuristic fallback), `bun:test`.

> **Deviation from spec (approved pattern choice):** The spec said "scheduler task (`registerTask`)". During planning we confirmed the direct analog — `seoLinkDiscovery` — uses an **in-process launcher** (`launchDiscoveryJob`), not the BullMQ queue. The scheduler worker runs at concurrency 1, so a 10-15 min batch over 326 URLs would block all other cron jobs. We therefore mirror the discovery pattern: in-process launcher + `content_import_job` status row + "mark interrupted on restart". User-facing behavior is unchanged.

---

## File Structure

**New files:**
- `src/lib/server/scraper/article-date.ts` — date-extraction helpers moved out of `seo-links.remote.ts` (shared).
- `src/lib/server/content/brand-detector.ts` — pure brand detection.
- `src/lib/server/content/article-extractor.ts` — pure content extraction (title/body/images/wordCount).
- `src/lib/server/content/heylux-sources.ts` — generated array of the 326 source URLs.
- `src/lib/server/content/content-pipeline.ts` — fetch→extract→persist for one row + in-process batch launcher.
- `src/lib/remotes/content-articles.remote.ts` — staff-gated query/command remote functions.
- `src/routes/[tenant]/content/heylux/+page.svelte` — monitoring UI.
- Tests: `src/lib/server/scraper/__tests__/article-date.test.ts`, `src/lib/server/content/__tests__/brand-detector.test.ts`, `src/lib/server/content/__tests__/article-extractor.test.ts`.

**Modified files:**
- `src/lib/remotes/seo-links.remote.ts` — import date helpers from the new shared module (delete local copies).
- `src/lib/server/db/schema.ts` — add `contentArticle` + `contentImportJob` tables.
- `src/lib/server/scheduler/index.ts` — mark in-flight content jobs interrupted on restart.
- `src/lib/config/sidebar-nav.ts` — add nav entry.
- `package.json` — add `@mozilla/readability`, `linkedom`.
- One new migration folder under `drizzle/`.

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm branch**

Run: `git branch --show-current`
Expected: `feat/heylux-content-parse` (already created during brainstorming). If not, `git checkout -b feat/heylux-content-parse`.

- [ ] **Step 2: Install deps**

Run: `bun add @mozilla/readability linkedom`
Expected: both added to `dependencies`.

- [ ] **Step 3: Verify import resolves**

Run: `bun -e "const {parseHTML}=require('linkedom'); const {Readability}=require('@mozilla/readability'); const {document}=parseHTML('<html><body><article><p>hello world this is a test paragraph with enough words to matter</p></article></body></html>'); console.log(typeof Readability, !!document)"`
Expected: prints `function true`.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(content): add @mozilla/readability + linkedom for article extraction"
```

---

## Task 2: Refactor date helpers into a shared module

Move the article-date helpers out of `seo-links.remote.ts` (currently private functions at lines ~841-987) into a shared module, with tests. **No behavior change.**

**Files:**
- Create: `src/lib/server/scraper/article-date.ts`
- Create: `src/lib/server/scraper/__tests__/article-date.test.ts`
- Modify: `src/lib/remotes/seo-links.remote.ts`

- [ ] **Step 1: Create the shared module (verbatim move)**

Create `src/lib/server/scraper/article-date.ts` with the four functions exactly as they exist today in `seo-links.remote.ts` (`extractArticlePublishedDate`, `parseDateToIso`, `parseRomanianRelativeDate`, `parseRomanianAbsoluteDate`), now `export`ed:

```ts
/** Article publish-date extraction from raw HTML. Moved from seo-links.remote.ts (no behavior change). */

/** Extrage data publicării articolului din HTML (meta tags, time, JSON-LD, CMS RO). */
export function extractArticlePublishedDate(html: string): string | null {
	const metaMatch = html.match(
		/<meta[^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["'][^>]*content=["']([^"']+)["']/i
	) || html.match(
		/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["']/i
	);
	if (metaMatch?.[1]) { const d = parseDateToIso(metaMatch[1]); if (d) return d; }

	const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
	if (timeMatch?.[1]) { const d = parseDateToIso(timeMatch[1]); if (d) return d; }

	const jsonLdMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
	if (jsonLdMatch?.[1]) { const d = parseDateToIso(jsonLdMatch[1]); if (d) return d; }

	const dcMatch = html.match(/<meta[^>]*(?:name|property)=["'](?:dc\.date|date|publication_date)["'][^>]*content=["']([^"']+)["']/i)
		|| html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:dc\.date|date)["']/i);
	if (dcMatch?.[1]) { const d = parseDateToIso(dcMatch[1]); if (d) return d; }

	const dtPublicatMatch = html.match(/<dt[^>]*>\s*Publicat\s*<\/dt>\s*<dd[^>]*>([^<]+)/i);
	if (dtPublicatMatch?.[1]) {
		const raw = dtPublicatMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	const dtModificatMatch = html.match(/<dt[^>]*>\s*Modific[aă]t\s*<\/dt>\s*<dd[^>]*>([^<]+)/i);
	if (dtModificatMatch?.[1]) {
		const raw = dtModificatMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	const classDateMatch = html.match(
		/class=["'][^"']*(?:dat[ae]|entry-date|post(?:ed|date|ing)|creat|public)[^"']*["'][^>]*>\s*([^<]{5,60})/i
	);
	if (classDateMatch?.[1]) {
		const raw = classDateMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	return null;
}

export function parseDateToIso(val: string): string | null {
	try {
		const d = new Date(val);
		if (isNaN(d.getTime())) return null;
		return d.toISOString().slice(0, 19) + 'Z';
	} catch { return null; }
}

/** Parsează o dată relativă în română ("acum 3 ani si 1 luna", "acum 2 luni" etc.). */
export function parseRomanianRelativeDate(val: string): string | null {
	const s = val.trim();
	const now = new Date();
	const m1 = s.match(/acum\s+(\d+)\s+ani?\s+(?:si|și)\s+(\d+)\s+lun[aăi]/i);
	if (m1) { const d = new Date(now); d.setFullYear(d.getFullYear() - parseInt(m1[1])); d.setMonth(d.getMonth() - parseInt(m1[2])); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; }
	const m2 = s.match(/acum\s+(\d+)\s+ani?(?:\s|$)/i);
	if (m2) { const d = new Date(now); d.setFullYear(d.getFullYear() - parseInt(m2[1])); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; }
	const m3 = s.match(/acum\s+(\d+)\s+lun[aăi]/i);
	if (m3) { const d = new Date(now); d.setMonth(d.getMonth() - parseInt(m3[1])); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; }
	const m4 = s.match(/acum\s+(\d+)\s+s[aă]pt[aă]m[aâ]ni?/i);
	if (m4) { const d = new Date(now); d.setDate(d.getDate() - parseInt(m4[1]) * 7); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; }
	const m5 = s.match(/acum\s+(\d+)\s+zile?/i);
	if (m5) { const d = new Date(now); d.setDate(d.getDate() - parseInt(m5[1])); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; }
	if (/acum\s+o\s+zi/i.test(s)) { const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; }
	return null;
}

/** Parsează o dată absolută în română ("25 mai 2023", "mai 2023"). */
export function parseRomanianAbsoluteDate(val: string): string | null {
	const MONTHS: Record<string, number> = { ian: 1, feb: 2, mar: 3, apr: 4, mai: 5, iun: 6, iul: 7, aug: 8, sep: 9, oct: 10, noi: 11, dec: 12 };
	const MON_PAT = '(ian(?:uarie)?|feb(?:ruarie)?|mar(?:tie)?|apr(?:ilie)?|mai|iun(?:ie)?|iul(?:ie)?|aug(?:ust)?|sep(?:tembrie)?|oct(?:ombrie)?|noi(?:embrie)?|dec(?:embrie)?)';
	const m1 = val.match(new RegExp(`(\\d{1,2})\\s+${MON_PAT}[.,]?\\s*(\\d{4})`, 'i'));
	if (m1) { const key = m1[2].toLowerCase().slice(0, 3); const month = MONTHS[key]; if (month) { const d = new Date(parseInt(m1[3]), month - 1, parseInt(m1[1])); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; } }
	const m2 = val.match(new RegExp(`${MON_PAT}\\s+(\\d{4})`, 'i'));
	if (m2) { const key = m2[1].toLowerCase().slice(0, 3); const month = MONTHS[key]; if (month) { const d = new Date(parseInt(m2[2]), month - 1, 1); return d.toISOString().slice(0, 10) + 'T00:00:00Z'; } }
	return null;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/server/scraper/__tests__/article-date.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
	extractArticlePublishedDate,
	parseRomanianAbsoluteDate
} from '../article-date';

describe('extractArticlePublishedDate', () => {
	test('reads og:published_time meta', () => {
		const html = `<meta property="article:published_time" content="2024-07-25T10:00:00+03:00">`;
		expect(extractArticlePublishedDate(html)).toBe('2024-07-25T07:00:00Z');
	});
	test('reads JSON-LD datePublished', () => {
		const html = `<script type="application/ld+json">{"datePublished":"2018-12-03"}</script>`;
		expect(extractArticlePublishedDate(html)).toBe('2018-12-03T00:00:00Z');
	});
	test('returns null when no date present', () => {
		expect(extractArticlePublishedDate('<p>no date here</p>')).toBeNull();
	});
});

describe('parseRomanianAbsoluteDate', () => {
	test('parses "25 mai 2023"', () => {
		expect(parseRomanianAbsoluteDate('25 mai 2023')).toBe('2023-05-25T00:00:00Z');
	});
});
```

- [ ] **Step 3: Run test — expect PASS (functions moved verbatim)**

Run: `TZ=UTC bun test src/lib/server/scraper/__tests__/article-date.test.ts`
Expected: 4 pass. **`TZ=UTC` is required** — `parseRomanianAbsoluteDate` builds dates with `new Date(year, month-1, day)` (local time) then `.toISOString()`, so `'25 mai 2023'` yields `2023-05-24` in a UTC+n zone and `2023-05-25` under UTC. This is pre-existing behavior moved verbatim; we simply pin the test TZ. (These are pure functions moved unchanged; the test locks in behavior before we delete the originals.)

- [ ] **Step 4: Delete the local copies in seo-links.remote.ts and import from the shared module**

In `src/lib/remotes/seo-links.remote.ts`:
1. Delete the four local function definitions (`extractArticlePublishedDate`, `parseDateToIso`, `parseRomanianRelativeDate`, `parseRomanianAbsoluteDate`).
2. Add to the import block near the top:

```ts
import {
	extractArticlePublishedDate,
	parseDateToIso,
	parseRomanianRelativeDate,
	parseRomanianAbsoluteDate
} from '$lib/server/scraper/article-date';
```

(If `parseDateToIso` / the two RO parsers are only used inside `extractArticlePublishedDate`, import only the names still referenced elsewhere in the file — check with `grep -n 'parseDateToIso\|parseRomanianRelativeDate\|parseRomanianAbsoluteDate' src/lib/remotes/seo-links.remote.ts` and import exactly those still called.)

- [ ] **Step 5: Typecheck the touched file**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx --bun svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -A2 -i 'seo-links\|article-date' | head`
Expected: no NEW errors referencing these files (baseline is 16 err/56 warn per project memory).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/scraper/article-date.ts src/lib/server/scraper/__tests__/article-date.test.ts src/lib/remotes/seo-links.remote.ts
git commit -m "refactor(scraper): extract article-date helpers into shared module"
```

---

## Task 3: Brand detector

Pure function: given source URL + title + body text, return the studio brand. Priority: slug beats content; resolution order handles the "forumvideochat mentions heylux" ambiguity.

**Files:**
- Create: `src/lib/server/content/brand-detector.ts`
- Create: `src/lib/server/content/__tests__/brand-detector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/content/__tests__/brand-detector.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { detectBrand } from '../brand-detector';

describe('detectBrand', () => {
	test('heylux slug on third-party press domain', () => {
		expect(detectBrand('https://www.bzi.ro/heylux-e-cel-mai-serios-studio-605728', '', '')).toBe('heylux');
	});
	test('lucky studio via slug', () => {
		expect(detectBrand('https://www.iasi4u.ro/lucky-studio-angajeaza-imediat/', '', '')).toBe('luckystudio');
	});
	test('fetele-norocoase maps to luckystudio', () => {
		expect(detectBrand('https://www.iasi4u.ro/2011-interviu-cu-erika-de-la-video-chat-fetelenorocoase/', '', '')).toBe('luckystudio');
	});
	test('preziosa via slug', () => {
		expect(detectBrand('https://love21.ro/ce-ti-doresti-de-la-viata-cu-jobul-in-videochat-la-preziosa/', '', '')).toBe('preziosa');
	});
	test('forumvideochat slug wins even when body mentions heylux', () => {
		expect(detectBrand('https://www.wowbiz.ro/forumvideochat-com-iti-da-toate-informatiile-18241593', 'ForumVideochat', 'heylux este cel mai bun studio')).toBe('forumvideochat');
	});
	test('vivadiva franchise', () => {
		expect(detectBrand('https://www.ziaruldeiasi.ro/stiri/castiga-multi-bani-franciza-vivadiva-1705553.html', '', '')).toBe('vivadiva');
	});
	test('own-domain preziosa.ro', () => {
		expect(detectBrand('https://preziosa.ro/explorarea-orgasmului-feminin/', '', '')).toBe('preziosa');
	});
	test('own-domain heylux.ro', () => {
		expect(detectBrand('https://www.heylux.ro/ce-este-un-trainer/', '', '')).toBe('heylux');
	});
	test('falls back to content when slug has no brand', () => {
		expect(detectBrand('https://www.ziaruldeiasi.ro/local/cine-castiga-cei-mai-multi-bani~ni96sj', 'Videochat', 'la Heylux studio faci bani')).toBe('heylux');
	});
	test('unknown when nothing matches', () => {
		expect(detectBrand('https://example.ro/random-article', 'Random', 'nothing relevant here')).toBe('unknown');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/content/__tests__/brand-detector.test.ts`
Expected: FAIL — "Cannot find module '../brand-detector'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/content/brand-detector.ts`:

```ts
export type Brand =
	| 'heylux'
	| 'luckystudio'
	| 'preziosa'
	| 'forumvideochat'
	| 'vivadiva'
	| 'unknown';

/**
 * Detect the studio brand for an advertorial.
 *
 * Priority: the URL host+path (slug) is authoritative; page title/body are a
 * fallback only when the slug carries no brand token. Resolution order matters
 * because comparison / "forumvideochat" articles mention Heylux without being
 * Heylux — so Heylux is resolved LAST among the specific brands.
 */
export function detectBrand(sourceUrl: string, title: string, bodyText: string): Brand {
	let hay = sourceUrl.toLowerCase();
	try {
		const u = new URL(sourceUrl);
		hay = (u.hostname + ' ' + decodeURIComponent(u.pathname)).toLowerCase();
	} catch {
		/* keep raw url */
	}

	const fromSlug = matchBrand(hay);
	if (fromSlug) return fromSlug;

	const content = `${title} ${bodyText}`.toLowerCase().slice(0, 4000);
	const fromContent = matchBrand(content);
	return fromContent ?? 'unknown';
}

/** Ordered brand matcher — most-specific first, heylux last. */
function matchBrand(text: string): Brand | null {
	if (/preziosa/.test(text)) return 'preziosa';
	if (/vivadiva|viva[\s-]?diva/.test(text)) return 'vivadiva';
	if (/lucky[\s-]?studio|luckystudio|fetele?[\s-]?norocoase|fetelenorocoase/.test(text)) return 'luckystudio';
	if (/forum[\s-]?videochat|forumvideochat/.test(text)) return 'forumvideochat';
	if (/heylux/.test(text)) return 'heylux';
	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/server/content/__tests__/brand-detector.test.ts`
Expected: 10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/content/brand-detector.ts src/lib/server/content/__tests__/brand-detector.test.ts
git commit -m "feat(content): brand detector for advertorial URLs"
```

---

## Task 4: Article extractor

Pure function: given raw HTML + source URL, return `{ title, bodyHtml, bodyText, excerpt, wordCount, featuredImageUrl, images, publishedAt }`. Uses `@mozilla/readability` over a `linkedom` DOM, with a `node-html-parser` heuristic fallback when Readability yields nothing. Metadata (og:title/og:image) read via regex on the raw HTML **before** Readability mutates the DOM.

**Files:**
- Create: `src/lib/server/content/article-extractor.ts`
- Create: `src/lib/server/content/__tests__/article-extractor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/content/__tests__/article-extractor.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { extractArticle } from '../article-extractor';

const SAMPLE = `<!doctype html><html><head>
<title>Site Name - Heylux studio</title>
<meta property="og:title" content="Heylux e cel mai bun studio de videochat din Iași">
<meta property="og:image" content="https://cdn.example.ro/heylux-cover.jpg">
<meta property="article:published_time" content="2024-07-25T10:00:00+03:00">
</head><body>
<nav>menu one two three</nav>
<article>
<h1>Heylux e cel mai bun studio de videochat din Iași</h1>
<p>Heylux este studioul care oferă cele mai bune condiții de muncă pentru modelele de videochat din Iași, cu training gratuit și bonusuri lunare consistente.</p>
<p>Fiecare model beneficiază de asistență psihologică, program flexibil și comisioane dintre cele mai avantajoase de pe piață, ceea ce face din Heylux liderul incontestabil.</p>
<img src="https://cdn.example.ro/inline.jpg" alt="inline">
</article>
<footer>copyright junk</footer>
</body></html>`;

describe('extractArticle', () => {
	test('extracts title from og:title', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.title).toBe('Heylux e cel mai bun studio de videochat din Iași');
	});
	test('extracts body text and word count', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.bodyText).toContain('training gratuit');
		expect(r.bodyText).not.toContain('copyright junk');
		expect(r.wordCount).toBeGreaterThan(30);
	});
	test('extracts featured image from og:image', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.featuredImageUrl).toBe('https://cdn.example.ro/heylux-cover.jpg');
	});
	test('extracts published date', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.publishedAt).toBe('2024-07-25T07:00:00Z');
	});
	test('flags thin content', () => {
		const r = extractArticle('<html><body><p>too short</p></body></html>', 'https://x.ro/y');
		expect(r.wordCount).toBeLessThan(250);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/content/__tests__/article-extractor.test.ts`
Expected: FAIL — "Cannot find module '../article-extractor'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/content/article-extractor.ts`:

```ts
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { parse as parseNode } from 'node-html-parser';
import { extractArticlePublishedDate } from '$lib/server/scraper/article-date';

export interface ExtractedArticle {
	title: string;
	bodyHtml: string;
	bodyText: string;
	excerpt: string;
	wordCount: number;
	featuredImageUrl: string | null;
	images: string[];
	publishedAt: string | null;
}

/** Read a meta tag's content by property/name, tolerant of attribute order. */
function metaContent(html: string, key: string): string | null {
	const a = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'));
	if (a?.[1]) return decodeEntities(a[1].trim());
	const b = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, 'i'));
	if (b?.[1]) return decodeEntities(b[1].trim());
	return null;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ');
}

function textToWords(text: string): number {
	const t = text.trim();
	return t ? t.split(/\s+/).length : 0;
}

function absolutize(src: string, base: string): string | null {
	try { return new URL(src, base).href; } catch { return null; }
}

/** Extract a clean article from raw HTML. Pure — no network, no DB. */
export function extractArticle(html: string, sourceUrl: string): ExtractedArticle {
	// 1. Metadata first (regex on raw HTML — Readability mutates the DOM).
	const ogTitle = metaContent(html, 'og:title');
	const rawTitleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const titleTag = rawTitleTag ? decodeEntities(rawTitleTag).replace(/\s+/g, ' ').trim() : '';
	const publishedAt = extractArticlePublishedDate(html);
	const ogImage = metaContent(html, 'og:image');

	// 2. Readability over linkedom.
	let bodyHtml = '';
	let bodyText = '';
	let readTitle = '';
	let excerpt = '';
	try {
		const { document } = parseHTML(html);
		const reader = new Readability(document as unknown as Document, { charThreshold: 200 });
		const parsed = reader.parse();
		if (parsed) {
			bodyHtml = parsed.content ?? '';
			bodyText = (parsed.textContent ?? '').replace(/\s+/g, ' ').trim();
			readTitle = (parsed.title ?? '').trim();
			excerpt = (parsed.excerpt ?? '').trim();
		}
	} catch {
		/* fall through to heuristic */
	}

	// 3. Heuristic fallback when Readability produced too little.
	if (textToWords(bodyText) < 40) {
		const root = parseNode(html);
		const container = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('body');
		if (container) {
			const ps = container.querySelectorAll('p').map((p) => p.toString());
			if (ps.length) {
				bodyHtml = ps.join('\n');
				bodyText = container.querySelectorAll('p').map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
			}
		}
	}

	// 4. Images from the extracted body, absolutized.
	const images: string[] = [];
	const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
	let m: RegExpExecArray | null;
	while ((m = imgRe.exec(bodyHtml)) !== null) {
		const abs = absolutize(m[1], sourceUrl);
		if (abs && !images.includes(abs)) images.push(abs);
	}

	const title = ogTitle || readTitle || titleTag || '';
	if (!excerpt) excerpt = bodyText.slice(0, 200);
	const featuredImageUrl = (ogImage && absolutize(ogImage, sourceUrl)) || images[0] || null;

	return {
		title,
		bodyHtml,
		bodyText,
		excerpt,
		wordCount: textToWords(bodyText),
		featuredImageUrl,
		images,
		publishedAt
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/server/content/__tests__/article-extractor.test.ts`
Expected: 5 pass. (If linkedom↔Readability throws on this input, the heuristic fallback still satisfies the body/wordCount assertions; the og:* assertions never depend on Readability.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/content/article-extractor.ts src/lib/server/content/__tests__/article-extractor.test.ts
git commit -m "feat(content): article extractor (Readability + heuristic fallback)"
```

---

## Task 5: DB schema — content_article + content_import_job

**Files:**
- Modify: `src/lib/server/db/schema.ts`
- Create: migration under `drizzle/` (via `db:gen`)

- [ ] **Step 1: Add the two tables to schema.ts**

Append near the `seoLink` block in `src/lib/server/db/schema.ts` (uses the file's existing `timestamp`, `boolean`, `jsonb` custom types and `sql`):

```ts
export const contentArticle = sqliteTable('content_article', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').notNull().references(() => tenant.id),
	brand: text('brand').notNull().default('unknown'), // heylux|luckystudio|preziosa|forumvideochat|vivadiva|unknown
	sourceUrl: text('source_url').notNull(),
	sourceDomain: text('source_domain').notNull(),
	title: text('title'),
	slug: text('slug'),
	excerpt: text('excerpt'),
	bodyHtml: text('body_html'),
	bodyText: text('body_text'),
	wordCount: integer('word_count').notNull().default(0),
	featuredImageUrl: text('featured_image_url'),
	images: text('images'), // JSON string[]
	publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
	extractStatus: text('extract_status').notNull().default('pending'), // pending|ok|failed|thin
	extractError: text('extract_error'),
	usedPuppeteer: boolean('used_puppeteer').notNull().default(false),
	extractedAt: timestamp('extracted_at', { withTimezone: true, mode: 'date' }),
	// Phase 2-3 placeholders (inactive in phase 1):
	rewriteStatus: text('rewrite_status').notNull().default('none'), // none|drafting|ready
	targetWpSiteId: text('target_wp_site_id'),
	wpPostId: integer('wp_post_id'),
	scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`)
}, (t) => [
	uniqueIndex('content_article_tenant_source_idx').on(t.tenantId, t.sourceUrl),
	index('content_article_tenant_status_idx').on(t.tenantId, t.extractStatus),
	index('content_article_tenant_brand_idx').on(t.tenantId, t.brand)
]);

export const contentImportJob = sqliteTable('content_import_job', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').notNull().references(() => tenant.id),
	userId: text('user_id').notNull(),
	status: text('status').notNull().default('pending'), // pending|running|completed|failed|interrupted|cancelled
	totalArticles: integer('total_articles').notNull().default(0),
	processedArticles: integer('processed_articles').notNull().default(0),
	okCount: integer('ok_count').notNull().default(0),
	failedCount: integer('failed_count').notNull().default(0),
	thinCount: integer('thin_count').notNull().default(0),
	error: text('error'),
	startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
	finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`current_timestamp`)
});
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:gen`
Expected: creates a new folder/SQL under `drizzle/` with `CREATE TABLE content_article` + `CREATE TABLE content_import_job`, and `fix-migrations.ts` reconciles the journal.

- [ ] **Step 3: Verify journal matches SQL and single-statement rule**

Run: `ls -t drizzle/*.sql 2>/dev/null | head; ls -t drizzle/**/*.sql 2>/dev/null | head; cat drizzle/meta/_journal.json | tail -20`
Verify: the newest migration SQL contains exactly the two CREATE TABLEs, `_journal.json` references it, and no unrelated tables were dropped. If drizzle-kit emitted the two tables in one file and Turso rejects multi-statement, split into two files (per project memory — one statement per file) and re-check the journal.

- [ ] **Step 4: Apply the migration (local)**

Run: `bun run db:migrate`
Expected: migration applies without error.

- [ ] **Step 5: Verify the tables exist on the DB**

Run: `bun -e "const {createClient}=require('@libsql/client'); const c=createClient({url:process.env.DATABASE_URL||'file:local-ots.db'}); c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('content_article','content_import_job')\").then(r=>{console.log(r.rows); process.exit(0)})"`
Expected: both table names printed. (Adjust the DB URL to match `drizzle.config.ts` — check it first with `grep -i url drizzle.config.ts`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat(content): content_article + content_import_job tables"
```

---

## Task 6: Generate the source-URL list

Embed the 326 URLs as a TS array so ingestion doesn't depend on runtime filesystem/cwd.

**Files:**
- Create: `src/lib/server/content/heylux-sources.ts`

- [ ] **Step 1: Generate the module from Heylux_pars.md**

Run (from `app/`):
```bash
bun -e "
const fs=require('fs');
const lines=fs.readFileSync('Heylux_pars.md','utf8').split('\n');
const urls=[];
for(const l of lines){const m=l.match(/https?:\/\/\S+/); if(m){urls.push(m[0].trim());}}
const uniq=[...new Set(urls)];
const body='// AUTO-GENERATED from app/Heylux_pars.md — do not edit by hand.\n'+
  'export const HEYLUX_SOURCE_URLS: string[] = [\n'+uniq.map(u=>'\t'+JSON.stringify(u)).join(',\n')+'\n];\n';
fs.writeFileSync('src/lib/server/content/heylux-sources.ts', body);
console.log('wrote', uniq.length, 'urls');
"
```
Expected: prints `wrote 326 urls` (or close — dedup may drop exact duplicates).

- [ ] **Step 2: Sanity-check the count**

Run: `grep -c 'https' src/lib/server/content/heylux-sources.ts`
Expected: ~326.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/content/heylux-sources.ts
git commit -m "feat(content): embed 326 Heylux advertorial source URLs"
```

---

## Task 7: Content pipeline (single-row + in-process batch launcher)

**Files:**
- Create: `src/lib/server/content/content-pipeline.ts`

- [ ] **Step 1: Write the single-row processor + launcher**

Create `src/lib/server/content/content-pipeline.ts`:

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { fetchWithCloudflareFallback } from '$lib/server/scraper/cloudflare-bypass';
import { extractArticle } from './article-extractor';
import { detectBrand } from './brand-detector';
import { logError, logInfo } from '$lib/server/logger';

const THIN_WORDS = 250;
const CONCURRENCY = 4;
const EXTRACT_HEADERS: Record<string, string> = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8'
};

/** Fetch + extract + persist a single content_article row. Never throws. */
export async function processContentArticle(articleId: string): Promise<'ok' | 'thin' | 'failed'> {
	const [row] = await db.select().from(table.contentArticle).where(eq(table.contentArticle.id, articleId)).limit(1);
	if (!row) return 'failed';
	const now = new Date();
	try {
		const { html, usedPuppeteer } = await fetchWithCloudflareFallback(row.sourceUrl, {
			headers: EXTRACT_HEADERS,
			timeoutMs: 20000
		});
		if (!html || html.length < 200) {
			await db.update(table.contentArticle).set({
				extractStatus: 'failed', extractError: 'Empty/blocked response', usedPuppeteer, extractedAt: now, updatedAt: now
			}).where(eq(table.contentArticle.id, articleId));
			return 'failed';
		}
		const a = extractArticle(html, row.sourceUrl);
		const brand = detectBrand(row.sourceUrl, a.title, a.bodyText);
		const status = a.wordCount >= THIN_WORDS ? 'ok' : 'thin';
		await db.update(table.contentArticle).set({
			brand,
			title: a.title || null,
			excerpt: a.excerpt || null,
			bodyHtml: a.bodyHtml || null,
			bodyText: a.bodyText || null,
			wordCount: a.wordCount,
			featuredImageUrl: a.featuredImageUrl,
			images: a.images.length ? JSON.stringify(a.images) : null,
			publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
			extractStatus: status,
			extractError: null,
			usedPuppeteer,
			extractedAt: now,
			updatedAt: now
		}).where(eq(table.contentArticle.id, articleId));
		return status;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await db.update(table.contentArticle).set({
			extractStatus: 'failed', extractError: msg.slice(0, 500), extractedAt: now, updatedAt: now
		}).where(eq(table.contentArticle.id, articleId));
		return 'failed';
	}
}

/**
 * Launch an in-process background extraction over all `pending` rows for the
 * tenant tied to this job. Mirrors seoLinkDiscovery's launchDiscoveryJob:
 * fire-and-forget, updates the job row, dies on server restart (resumed by
 * re-running via the remote command, which re-selects pending rows).
 */
export function launchContentExtractionJob(jobId: string, tenantId: string): void {
	void runJob(jobId, tenantId).catch((e) => {
		const msg = e instanceof Error ? e.message : String(e);
		logError('content', `Extraction job ${jobId} crashed: ${msg}`);
	});
}

async function runJob(jobId: string, tenantId: string): Promise<void> {
	const pending = await db.select({ id: table.contentArticle.id })
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.tenantId, tenantId), eq(table.contentArticle.extractStatus, 'pending')));

	await db.update(table.contentImportJob).set({
		status: 'running', totalArticles: pending.length, startedAt: new Date(), updatedAt: new Date()
	}).where(eq(table.contentImportJob.id, jobId));

	let processed = 0, ok = 0, failed = 0, thin = 0;
	const queue = [...pending];

	async function worker() {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const result = await processContentArticle(next.id);
			processed++;
			if (result === 'ok') ok++; else if (result === 'thin') thin++; else failed++;
			if (processed % 5 === 0 || queue.length === 0) {
				await db.update(table.contentImportJob).set({
					processedArticles: processed, okCount: ok, failedCount: failed, thinCount: thin, updatedAt: new Date()
				}).where(eq(table.contentImportJob.id, jobId));
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, () => worker()));

	await db.update(table.contentImportJob).set({
		status: 'completed', processedArticles: processed, okCount: ok, failedCount: failed, thinCount: thin,
		finishedAt: new Date(), updatedAt: new Date()
	}).where(eq(table.contentImportJob.id, jobId));
	logInfo('content', `Extraction job ${jobId} done: ${ok} ok / ${thin} thin / ${failed} failed of ${processed}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx --bun svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -A2 content-pipeline | head`
Expected: no errors referencing `content-pipeline.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/content/content-pipeline.ts
git commit -m "feat(content): fetch→extract→persist pipeline + in-process batch launcher"
```

---

## Task 8: Remote functions

**Files:**
- Create: `src/lib/remotes/content-articles.remote.ts`

- [ ] **Step 1: Write the remote functions**

Create `src/lib/remotes/content-articles.remote.ts` (mirror the auth + valibot patterns from `seo-links.remote.ts`; every export gates on `requireStaff`):

```ts
import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { HEYLUX_SOURCE_URLS } from '$lib/server/content/heylux-sources';
import { launchContentExtractionJob } from '$lib/server/content/content-pipeline';

function genId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}
function domainOf(url: string): string {
	try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export const getContentArticles = query(
	v.optional(v.object({
		brand: v.optional(v.string()),
		status: v.optional(v.string())
	}), {}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const conds = [eq(table.contentArticle.tenantId, event.locals.tenant.id)];
		if (filters.brand) conds.push(eq(table.contentArticle.brand, filters.brand));
		if (filters.status) conds.push(eq(table.contentArticle.extractStatus, filters.status));
		return db.select({
			id: table.contentArticle.id,
			brand: table.contentArticle.brand,
			sourceUrl: table.contentArticle.sourceUrl,
			title: table.contentArticle.title,
			wordCount: table.contentArticle.wordCount,
			extractStatus: table.contentArticle.extractStatus,
			extractError: table.contentArticle.extractError,
			publishedAt: table.contentArticle.publishedAt,
			featuredImageUrl: table.contentArticle.featuredImageUrl
		}).from(table.contentArticle).where(and(...conds)).orderBy(desc(table.contentArticle.updatedAt)).limit(400);
	}
);

export const getContentImportJob = query(
	v.optional(v.string()),
	async (jobId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const rows = await db.select().from(table.contentImportJob)
			.where(eq(table.contentImportJob.tenantId, event.locals.tenant.id))
			.orderBy(desc(table.contentImportJob.createdAt)).limit(1);
		return rows[0] ?? null;
	}
);

/** Seed the 326 source URLs as pending rows; idempotent (skips existing sourceUrls). */
export const importHeyluxSources = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;
	const existing = await db.select({ sourceUrl: table.contentArticle.sourceUrl })
		.from(table.contentArticle).where(eq(table.contentArticle.tenantId, tenantId));
	const seen = new Set(existing.map((r) => r.sourceUrl));
	const now = new Date();
	const rows = HEYLUX_SOURCE_URLS.filter((u) => !seen.has(u)).map((u) => ({
		id: genId(), tenantId, sourceUrl: u, sourceDomain: domainOf(u),
		brand: 'unknown', extractStatus: 'pending', createdAt: now, updatedAt: now
	}));
	// Chunked insert (libSQL param limit safety).
	for (let i = 0; i < rows.length; i += 100) {
		await db.insert(table.contentArticle).values(rows.slice(i, i + 100));
	}
	return { inserted: rows.length, total: HEYLUX_SOURCE_URLS.length };
});

export const startContentExtraction = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;
	const jobId = genId();
	const now = new Date();
	await db.insert(table.contentImportJob).values({
		id: jobId, tenantId, userId: event.locals.user.id, status: 'pending', createdAt: now, updatedAt: now
	});
	launchContentExtractionJob(jobId, tenantId);
	return { jobId };
});

/** Reset failed/thin rows back to pending, then relaunch. */
export const retryFailedExtractions = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;
	await db.update(table.contentArticle)
		.set({ extractStatus: 'pending', updatedAt: new Date() })
		.where(and(eq(table.contentArticle.tenantId, tenantId), inArray(table.contentArticle.extractStatus, ['failed', 'thin'])));
	const jobId = genId();
	const now = new Date();
	await db.insert(table.contentImportJob).values({
		id: jobId, tenantId, userId: event.locals.user.id, status: 'pending', createdAt: now, updatedAt: now
	});
	launchContentExtractionJob(jobId, tenantId);
	return { jobId };
});
```

> **Confirmed patterns** (verified against the codebase, no action needed): `requireStaff` is exported from `$lib/server/get-actor`; `command(async () => …)` with no schema is used widely (anaf-spv, banking, bnr, email-settings, …); `query(schema, handler)` and no-arg commands match the SvelteKit version in use.

- [ ] **Step 2: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx --bun svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -A2 content-articles | head`
Expected: no errors referencing `content-articles.remote.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/remotes/content-articles.remote.ts
git commit -m "feat(content): staff-gated remote functions (import/start/retry/query)"
```

---

## Task 9: Mark in-flight content jobs interrupted on restart

Mirror the existing SEO-discovery restart handling so a server restart mid-run leaves the job in a re-runnable state.

**Files:**
- Modify: `src/lib/server/scheduler/index.ts` (near lines ~270-290, the discovery `interrupted` block)

- [ ] **Step 1: Add the interrupted-marking block**

Immediately after the existing "Mark any in-flight SEO link discovery jobs as interrupted" block, add:

```ts
	// Mark any in-flight content extraction jobs as interrupted — in-process
	// launcher does not survive restart; user re-runs via "Reîncearcă".
	try {
		const res = await db
			.update(table.contentImportJob)
			.set({ status: 'interrupted', updatedAt: new Date() })
			.where(sql`${table.contentImportJob.status} IN ('running','pending')`);
		const count = (res as { rowsAffected?: number }).rowsAffected ?? 0;
		if (count) logWarning('scheduler', `Marked ${count} content import job(s) as interrupted after restart`);
	} catch (e) {
		const { message } = serializeError(e);
		logWarning('scheduler', `Failed to mark interrupted content jobs: ${message}`);
	}
```

(`table`, `sql`, `logWarning`, `serializeError` are already imported in this file — confirm with `grep -n "serializeError\|logWarning\|import.*schema" src/lib/server/scheduler/index.ts`.)

- [ ] **Step 2: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx --bun svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -A2 'scheduler/index' | head`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/scheduler/index.ts
git commit -m "feat(content): mark in-flight content jobs interrupted on restart"
```

---

## Task 10: Monitoring UI + sidebar entry

**Files:**
- Create: `src/routes/[tenant]/content/heylux/+page.svelte`
- Modify: `src/lib/config/sidebar-nav.ts`

- [ ] **Step 1: Add the sidebar entry**

In `src/lib/config/sidebar-nav.ts`, in the `'Marketing & Ads'` section, immediately after the existing `{ id: 'seo-links', label: 'Linkuri SEO', icon: 'seo-links', href: '/seo-links' },` line, add:

```ts
			{ id: 'content-heylux', label: 'Content Heylux', icon: 'seo-links', href: '/content/heylux' },
```

(Reuses the existing `'seo-links'` IconKey — no new icon needed. If `NavItem.id` is a typed union rather than `string`, add `'content-heylux'` to that union too.)

- [ ] **Step 2: Write the page**

Create `src/routes/[tenant]/content/heylux/+page.svelte` (uses the remote-functions-in-Svelte pattern from the project: `$derived(await query())`, `<svelte:boundary>`, `svelte-sonner` toast). No `+page.ts` needed. **Do not add outer padding** — the `[tenant]/+layout.svelte` already wraps pages in `p-6` (project memory).

```svelte
<script lang="ts">
	import {
		getContentArticles,
		getContentImportJob,
		importHeyluxSources,
		startContentExtraction,
		retryFailedExtractions
	} from '$lib/remotes/content-articles.remote';
	import { toast } from 'svelte-sonner';

	let brandFilter = $state('');
	let statusFilter = $state('');
	let busy = $state(false);

	const articles = $derived(await getContentArticles({ brand: brandFilter || undefined, status: statusFilter || undefined }));
	const job = $derived(await getContentImportJob());

	async function doImport() {
		busy = true;
		try { const r = await importHeyluxSources(); toast.success(`Importate ${r.inserted} surse (din ${r.total})`); await getContentArticles({}).refresh(); }
		catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare import'); }
		finally { busy = false; }
	}
	async function doStart() {
		busy = true;
		try { await startContentExtraction(); toast.success('Extracție pornită'); await getContentImportJob().refresh(); }
		catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare pornire'); }
		finally { busy = false; }
	}
	async function doRetry() {
		busy = true;
		try { await retryFailedExtractions(); toast.success('Reîncercare pornită'); await getContentImportJob().refresh(); }
		catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare retry'); }
		finally { busy = false; }
	}
</script>

<div class="flex items-center justify-between mb-4">
	<h1 class="text-xl font-semibold">Content Heylux — Parsare advertoriale</h1>
	<div class="flex gap-2">
		<button class="btn" disabled={busy} onclick={doImport}>Importă surse</button>
		<button class="btn" disabled={busy} onclick={doStart}>Pornește extracția</button>
		<button class="btn" disabled={busy} onclick={doRetry}>Reîncearcă eșecuri</button>
	</div>
</div>

<svelte:boundary>
	{#if job}
		<div class="rounded border p-3 mb-4 text-sm">
			Job: <b>{job.status}</b> — {job.processedArticles}/{job.totalArticles}
			(ok {job.okCount} · thin {job.thinCount} · fail {job.failedCount})
			<button class="ml-2 underline" onclick={() => getContentImportJob().refresh()}>Refresh</button>
		</div>
	{/if}

	<div class="flex gap-2 mb-3">
		<select bind:value={brandFilter} class="border rounded px-2 py-1">
			<option value="">Toate brandurile</option>
			<option value="heylux">Heylux</option>
			<option value="luckystudio">Lucky Studio</option>
			<option value="preziosa">Preziosa</option>
			<option value="forumvideochat">ForumVideochat</option>
			<option value="vivadiva">VivaDiva</option>
			<option value="unknown">Necunoscut</option>
		</select>
		<select bind:value={statusFilter} class="border rounded px-2 py-1">
			<option value="">Toate statusurile</option>
			<option value="pending">Pending</option>
			<option value="ok">OK</option>
			<option value="thin">Thin</option>
			<option value="failed">Failed</option>
		</select>
	</div>

	<table class="w-full text-sm">
		<thead><tr class="text-left border-b">
			<th class="py-2">Brand</th><th>Titlu</th><th>Cuvinte</th><th>Status</th><th>Data</th><th>Sursă</th>
		</tr></thead>
		<tbody>
			{#each articles as a (a.id)}
				<tr class="border-b">
					<td class="py-1">{a.brand}</td>
					<td class="max-w-md truncate">{a.title ?? '—'}</td>
					<td>{a.wordCount}</td>
					<td>{a.extractStatus}{#if a.extractError} <span class="text-red-500" title={a.extractError}>⚠</span>{/if}</td>
					<td>{a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : '—'}</td>
					<td class="max-w-xs truncate"><a href={a.sourceUrl} target="_blank" rel="noopener" class="underline">link</a></td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#snippet failed(err)}
		<p class="text-red-500">Eroare: {err instanceof Error ? err.message : String(err)}</p>
	{/snippet}
</svelte:boundary>
```

- [ ] **Step 3: Validate the Svelte component**

Run the Svelte MCP `svelte-autofixer` on `src/routes/[tenant]/content/heylux/+page.svelte` (project rule: always autofix new components). Apply fixes, re-run until clean. Then match `.btn`/class styling to a neighboring page (e.g. `seo-links/+page.svelte`) — replace placeholder `class="btn"` with the real button classes used there.

- [ ] **Step 4: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bunx --bun svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -A2 'content/heylux' | head`
Expected: no errors referencing the new page.

- [ ] **Step 5: Commit**

```bash
git add src/routes/[tenant]/content/heylux/+page.svelte src/lib/config/sidebar-nav.ts
git commit -m "feat(content): /ots/content/heylux monitoring page + sidebar entry"
```

---

## Task 11: End-to-end verification (verify skill)

**Files:** none (manual verification).

- [ ] **Step 1: Run the unit suite**

Run: `TZ=UTC bun test src/lib/server/content/ src/lib/server/scraper/__tests__/article-date.test.ts`
Expected: all green (brand-detector 10, article-extractor 5, article-date 4). `TZ=UTC` pins the RO-absolute-date assertion (see Task 2 Step 3).

- [ ] **Step 2: Start dev server on main-visible workspace**

Per project memory, the user's localhost runs from `main`. Merge this branch to `main` (or have the user pull the branch) before manual UI verification. Then: `bun run dev` and open `/ots/content/heylux`.

- [ ] **Step 3: Drive the flow**

1. Click **Importă surse** → expect toast "Importate 326 surse", table fills with `pending` rows.
2. Click **Pornește extracția** → job badge shows `running`, counters climb on Refresh.
3. Let it run to `completed`. Spot-check: several rows `ok` with real titles + word counts, brands look right (heylux/lucky/preziosa), a few `thin`/`failed` on dead 2011-era domains.
4. Filter by brand=heylux and status=failed to confirm filters work.
5. Click **Reîncearcă eșecuri** → failed/thin reset to pending and re-run.

- [ ] **Step 4: Verify extraction quality with the `verify` skill**

Invoke the project `verify` skill to confirm the change works end-to-end (drives the real flow, observes DB rows populated with title/body/brand — not just tests). Record: how many of 326 landed `ok` vs `thin` vs `failed`.

- [ ] **Step 5: Update memory + docs**

- Add a project memory noting Phase 1 shipped (table names, page route, brand-detector priority rule, `thin` threshold).
- Note the ok/thin/failed split for Phase-2 planning (how much manual review the corpus needs).

- [ ] **Step 6: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to choose merge/PR. Suggest deploy per project convention (wait for user "deploy" go-ahead).

---

## Self-Review notes (author)

- **Spec coverage:** every spec component maps to a task — extractor (T4), brand-detector (T3), fetch reuse (T7 via `fetchWithCloudflareFallback`), remote functions (T8), ingestion job (T7+T9, in-process instead of scheduler — documented deviation), schema (T5), UI (T10), date-helper refactor (T2), deps (T1). Seed source list (T6) added for robust ingestion.
- **Simplification vs spec:** the separate `fetch-article.ts` component was dropped — `fetchWithCloudflareFallback` already does the Puppeteer fallback internally and returns `usedPuppeteer`; thin content is just flagged, no second explicit Puppeteer entry point. This removes a component without losing capability.
- **Type consistency:** `Brand` union (T3) reused in pipeline (T7); `ExtractedArticle` shape (T4) consumed in T7; job counters (`okCount/failedCount/thinCount`) consistent across schema (T5), pipeline (T7), remote (T8), UI (T10).
- **Open implementer confirmations flagged inline:** logger import path (T7), `requireStaff` export + `command` no-schema signature (T8), migration single-statement split (T5), `NavItem.id` union vs string (T10).
