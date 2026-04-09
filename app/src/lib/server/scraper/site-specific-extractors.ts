/**
 * Site-specific extractors for RO news sites.
 *
 * Ported from scripts/tampermonkey/news-article-extractor.user.js.
 * Uses node-html-parser (querySelector support without full DOM).
 *
 * Each extractor knows:
 *  - Which host(s) it applies to
 *  - How to extract articles from a listing / search results page
 *  - How to find the "next page" URL for pagination
 *
 * Articles returned carry { title, url, publishedAt (ISO or null), rawDate, category }.
 * The caller is responsible for fetching subsequent pages via `nextPage`.
 */

import { parse, type HTMLElement } from 'node-html-parser';

export interface ExtractedArticle {
	title: string;
	url: string;
	rawDate: string;
	publishedAt: string | null; // ISO 8601
	category: string | null;
	pattern: string;
}

export interface SiteExtractor {
	name: string;
	matchHost: (host: string) => boolean;
	extractArticles: (html: string, baseUrl: string) => ExtractedArticle[];
	nextPage: (html: string, baseUrl: string) => string | null;
	/**
	 * Build a search URL for the site's built-in search.
	 * Returns null if the site doesn't support URL-based pagination for that page.
	 * When not provided, the caller falls back to the WordPress default (`/?s=keyword`).
	 */
	searchUrl?: (keyword: string, page: number) => string | null;
}

// ---------- Romanian date parsing ----------

const RO_MONTHS: Record<string, number> = {
	ianuarie: 0, ian: 0,
	februarie: 1, feb: 1,
	martie: 2, mar: 2,
	aprilie: 3, apr: 3,
	mai: 4,
	iunie: 5, iun: 5,
	iulie: 6, iul: 6,
	august: 7, aug: 7,
	septembrie: 8, sept: 8, sep: 8,
	octombrie: 9, oct: 9,
	noiembrie: 10, noi: 10, nov: 10,
	decembrie: 11, dec: 11
};

function resolveMonth(raw: string): number | null {
	const k = raw.toLowerCase().replace('.', '');
	if (RO_MONTHS[k] !== undefined) return RO_MONTHS[k];
	for (const key of Object.keys(RO_MONTHS)) {
		if (key.startsWith(k) || k.startsWith(key)) return RO_MONTHS[key];
	}
	return null;
}

export function parseRoDate(text: string): Date | null {
	if (!text) return null;
	const clean = text.replace(/\.+/g, '.').replace(/\s+/g, ' ').trim().toLowerCase();

	// Variant 1: "22 sept. 25, 13:54" / "22 sept 2025 13:54"
	let m = clean.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s*(\d{2,4})[, ]+\s*(\d{1,2}):(\d{2})/i);
	if (m) {
		const [, d, monRaw, yRaw, h, min] = m;
		const mon = resolveMonth(monRaw);
		if (mon === null) return null;
		const year = yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
		return new Date(year, mon, +d, +h, +min);
	}

	// Variant 2: "30 iunie, 2023"
	m = clean.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?,?\s*(\d{4})/i);
	if (m) {
		const [, d, monRaw, y] = m;
		const mon = resolveMonth(monRaw);
		if (mon === null) return null;
		return new Date(+y, mon, +d);
	}

	return null;
}

function toIso(date: Date | null): string | null {
	if (!date || isNaN(date.getTime())) return null;
	return date.toISOString();
}

// ---------- Utility ----------

function resolveHref(href: string | undefined, baseUrl: string): string {
	if (!href) return '';
	try {
		return new URL(href, baseUrl).href;
	} catch {
		return href;
	}
}

function text(el: HTMLElement | null): string {
	return el ? el.text.trim().replace(/\s+/g, ' ') : '';
}

// ---------- Patterns ----------

const bziExtractor: SiteExtractor = {
	name: 'bzi.ro',
	matchHost: (host) => /(^|\.)bzi\.ro$/.test(host),
	extractArticles: (html, baseUrl) => {
		const root = parse(html);
		const out: ExtractedArticle[] = [];
		for (const el of root.querySelectorAll('div.article')) {
			const linkEl =
				el.querySelector('h3 a') || el.querySelector('.article__media a');
			if (!linkEl) continue;
			const dateEl = el.querySelector('.article__eyebrow > div:nth-child(2)');
			const categoryEl = el.querySelector('.article__eyebrow > div:nth-child(1)');
			const rawDate = text(dateEl);
			out.push({
				title: text(linkEl),
				url: resolveHref(linkEl.getAttribute('href'), baseUrl),
				rawDate,
				publishedAt: toIso(parseRoDate(rawDate)),
				category: categoryEl ? text(categoryEl) : null,
				pattern: 'bzi.ro'
			});
		}
		return out;
	},
	nextPage: (html, baseUrl) => findNextPageLink(html, baseUrl)
};

/**
 * Generic "next page" link detection.
 * Tries multiple strategies used across WordPress themes + RO news sites.
 * Returns absolute URL or null.
 */
export function findNextPageLink(html: string, baseUrl: string): string | null {
	const root = parse(html);

	// Strategy 1: rel="next" (most reliable, HTML standard)
	const relNext =
		root.querySelector('link[rel="next"]') ||
		root.querySelector('a[rel="next"]');
	if (relNext) {
		const href = relNext.getAttribute('href');
		if (href) return resolveHref(href, baseUrl);
	}

	// Strategy 2: WP-PageNavi plugin
	const wpPagenavi = root.querySelector('.wp-pagenavi a.nextpostslink');
	if (wpPagenavi) {
		const href = wpPagenavi.getAttribute('href');
		if (href) return resolveHref(href, baseUrl);
	}

	// Strategy 3: generic class names commonly used
	const genericSelectors = [
		'a.next.page-numbers',
		'a.next',
		'.pagination a.next',
		'.nav-links a.next',
		'.page-numbers a.next',
		'.pagenavi a.next'
	];
	for (const sel of genericSelectors) {
		const el = root.querySelector(sel);
		if (el) {
			const href = el.getAttribute('href');
			if (href) return resolveHref(href, baseUrl);
		}
	}

	// Strategy 4: text-based scan — look for "Următor", "Next", "»" in anchor text
	const allAnchors = root.querySelectorAll('a');
	for (const a of allAnchors) {
		const txt = (a.text || '').trim().toLowerCase();
		const cls = (a.getAttribute('class') || '').toLowerCase();
		if (
			txt === 'next' ||
			txt === 'următor' ||
			txt === 'următoarea' ||
			txt === '»' ||
			txt === '>' ||
			/\bnext\b/.test(cls)
		) {
			const href = a.getAttribute('href');
			if (href) return resolveHref(href, baseUrl);
		}
	}

	return null;
}

const bzcExtractor: SiteExtractor = {
	name: 'bzc.ro',
	matchHost: (host) => /(^|\.)bzc\.ro$/.test(host),
	extractArticles: (html, baseUrl) => {
		const root = parse(html);
		const out: ExtractedArticle[] = [];
		const articleBlocks = [
			...root.querySelectorAll('article.post'),
			...root.querySelectorAll('article[class*="post-"]')
		];
		const seen = new Set<HTMLElement>();
		for (const el of articleBlocks) {
			if (seen.has(el)) continue;
			seen.add(el);
			const linkEl =
				el.querySelector('h2.title a') || el.querySelector('.featured-image a');
			if (!linkEl) continue;
			const timeEl = el.querySelector('.meta time[datetime]');
			const categoryEl = el.querySelector('.tags a[rel*="category"]');
			const iso = timeEl?.getAttribute('datetime');
			const rawDate = text(timeEl);
			let publishedAt: string | null = null;
			if (iso) {
				const d = new Date(iso);
				publishedAt = isNaN(d.getTime()) ? toIso(parseRoDate(rawDate)) : d.toISOString();
			} else {
				publishedAt = toIso(parseRoDate(rawDate));
			}
			out.push({
				title: text(linkEl),
				url: resolveHref(linkEl.getAttribute('href'), baseUrl),
				rawDate,
				publishedAt,
				category: categoryEl ? text(categoryEl) : null,
				pattern: 'bzc.ro'
			});
		}
		return out;
	},
	nextPage: (html, baseUrl) => findNextPageLink(html, baseUrl)
};

const bzvExtractor: SiteExtractor = {
	name: 'bzv.ro',
	matchHost: (host) => /(^|\.)bzv\.ro$/.test(host),
	extractArticles: (html, baseUrl) => {
		const root = parse(html);
		const out: ExtractedArticle[] = [];
		for (const el of root.querySelectorAll('div.td-module-container')) {
			const linkEl =
				el.querySelector('h3.entry-title a') || el.querySelector('.td-module-thumb a');
			if (!linkEl) continue;
			const timeEl = el.querySelector('time.entry-date');
			const categoryEl = el.querySelector('.td-post-category');
			const iso = timeEl?.getAttribute('datetime');
			const rawDate = text(timeEl);
			const title =
				(linkEl.getAttribute('title') || linkEl.text || '').trim().replace(/\s+/g, ' ');
			out.push({
				title,
				url: resolveHref(linkEl.getAttribute('href'), baseUrl),
				rawDate,
				publishedAt: iso ?? toIso(parseRoDate(rawDate)),
				category: categoryEl ? text(categoryEl) : null,
				pattern: 'bzv.ro'
			});
		}
		return out;
	},
	nextPage: (html, baseUrl) => {
		const root = parse(html);
		const a = root.querySelector('.page-nav a[aria-label="next-page"]');
		if (a) {
			const href = a.getAttribute('href');
			if (href) return resolveHref(href, baseUrl);
		}
		return findNextPageLink(html, baseUrl);
	}
};

const bztExtractor: SiteExtractor = {
	name: 'bzt.ro',
	matchHost: (host) => /(^|\.)bzt\.ro$/.test(host),
	extractArticles: (html, baseUrl) => {
		const root = parse(html);
		const out: ExtractedArticle[] = [];
		// bzt.ro search results use a custom listing structure. Try multiple
		// selectors because the same site may use different markup on search
		// results vs. category/archive pages.
		const candidates = [
			...root.querySelectorAll('div.item'),
			...root.querySelectorAll('article'),
			...root.querySelectorAll('.search-result, .result, .post')
		];
		const seen = new Set<HTMLElement>();
		for (const el of candidates) {
			if (seen.has(el)) continue;
			seen.add(el);
			const linkEl =
				el.querySelector('.content a.header') ||
				el.querySelector('h2 a') ||
				el.querySelector('h3 a') ||
				el.querySelector('.title a') ||
				el.querySelector('a.header') ||
				el.querySelector('a');
			if (!linkEl) continue;
			const href = linkEl.getAttribute('href');
			if (!href) continue;
			// Filter out nav/category links
			try {
				const resolved = resolveHref(href, baseUrl);
				const u = new URL(resolved);
				if (u.pathname === '/' || /\/(search|category|tag|author|page)\//i.test(u.pathname)) {
					continue;
				}
			} catch {
				continue;
			}
			const dateEl =
				el.querySelector('.content .meta') ||
				el.querySelector('.meta') ||
				el.querySelector('time');
			const rawDate = text(dateEl);
			out.push({
				title: text(linkEl),
				url: resolveHref(href, baseUrl),
				rawDate,
				publishedAt: toIso(parseRoDate(rawDate)),
				category: null,
				pattern: 'bzt.ro'
			});
		}
		return out;
	},
	nextPage: (html, baseUrl) => findNextPageLink(html, baseUrl),
	// bzt.ro uses path-based search: /search/{keyword}
	// Pagination URL format is unknown — rely on nextPage() to follow actual links.
	searchUrl: (keyword, page) => {
		if (page !== 1) return null; // Let nextPage() handle pagination from HTML
		return `https://www.bzt.ro/search/${encodeURIComponent(keyword)}`;
	}
};

const EXTRACTORS: SiteExtractor[] = [bziExtractor, bzcExtractor, bzvExtractor, bztExtractor];

/** Find a site-specific extractor for the given host, or null. */
export function findSiteExtractor(host: string): SiteExtractor | null {
	const normalized = host.replace(/^www\./, '').toLowerCase();
	return EXTRACTORS.find((e) => e.matchHost(normalized)) ?? null;
}

/** Returns true if we have a tuned extractor for this domain. */
export function hasSiteExtractor(host: string): boolean {
	return findSiteExtractor(host) !== null;
}
