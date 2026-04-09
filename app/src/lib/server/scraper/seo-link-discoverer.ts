/**
 * SEO Link Discoverer — core pipeline.
 *
 * Given a source site and a list of target client domains, crawl the source's sitemap
 * (dynamically classifying sub-sitemap groups), fetch candidate articles, and extract
 * any backlinks to the target domains. Results are persisted incrementally into
 * `seo_link_discovery_result` for cursor-based polling from the UI.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { fetchWithCloudflareFallback } from './cloudflare-bypass';
import {
	discoverSitemapUrls,
	fetchSitemapContent,
	parseSitemap,
	toDomain,
	type SitemapIndexEntry,
	type SitemapUrlEntry
} from './sitemap-parser';
import { fetchSitemapCached } from './sitemap-cache';
import { withDomainSlot } from './domain-rate-limiter';
import { findSiteExtractor, type ExtractedArticle } from './site-specific-extractors';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveryConfig {
	mode: 'recent' | 'date-range' | 'full' | 'search';
	// Recent mode: number of top sub-sitemaps (by lastmod desc) to scan
	recentSitemapCount?: number;
	// Date range mode: ISO dates (yyyy-mm-dd), sub-sitemaps are included if
	// their lastmod falls within the range.
	dateFrom?: string;
	dateTo?: string;
	// Search mode: keywords to query via the site's built-in search
	searchKeywords?: string[];
	maxSearchPages?: number;
	// Hard caps
	maxArticles: number;
	maxSitemaps: number;
	articleConcurrency: number;
	// Targets
	clientIds: string[];
	extraTargetDomains: string[]; // additional raw domains user wants to scan for
	// Selected group keys from preview (empty = auto-selected = all ARTICLE-classified)
	selectedGroupKeys?: string[];
	forceRescanExisting: boolean;
}

export interface SitemapGroup {
	key: string;
	prefix: string;
	count: number;
	lastmodMin: string | null;
	lastmodMax: string | null;
	classification: 'ARTICLE' | 'TAXONOMY' | 'MEDIA' | 'UNKNOWN';
	articleScore: number;
	sampleUrls: string[];
	entries: SitemapIndexEntry[];
}

export interface PreviewResult {
	sourceDomain: string;
	rootSitemapUrls: string[];
	groups: SitemapGroup[];
	// If the root sitemap is a urlset (not an index), these are the URLs directly.
	directUrls: SitemapUrlEntry[];
}

export interface TargetDomain {
	domain: string;
	clientId?: string;
	websiteId?: string;
}

// ============================================================================
// Preview phase — discover and classify
// ============================================================================

/**
 * Phase 1: discover root sitemap URLs, parse the index, group sub-sitemaps
 * by filename pattern, sample-fetch one file per group, score each group.
 */
export async function previewDiscovery(
	sourceDomain: string,
	opts?: { signal?: AbortSignal }
): Promise<PreviewResult> {
	const domain = toDomain(sourceDomain);
	if (!domain) throw new Error('Invalid source domain');

	const roots = await discoverSitemapUrls(domain, { signal: opts?.signal });
	if (roots.length === 0) {
		throw new Error(
			`Nu s-a găsit niciun sitemap pentru ${domain}. Verifică că site-ul are /robots.txt sau /sitemap.xml.`
		);
	}

	// Parse each root
	const allIndexEntries: SitemapIndexEntry[] = [];
	const directUrls: SitemapUrlEntry[] = [];

	for (const rootUrl of roots) {
		if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		let xml = '';
		try {
			xml = await withDomainSlot(domain, 'sitemap', () =>
				fetchSitemapCached(rootUrl, { signal: opts?.signal, timeoutMs: 60_000 })
			);
		} catch (err) {
			console.warn(`[discover] root fetch failed ${rootUrl}:`, err instanceof Error ? err.message : err);
			continue;
		}
		if (!xml) continue;
		const parsed = parseSitemap(xml);
		if (parsed.type === 'index') {
			allIndexEntries.push(...parsed.entries);
		} else {
			directUrls.push(...parsed.entries);
		}
	}

	// Group entries by filename prefix
	const groupsMap = new Map<string, SitemapIndexEntry[]>();
	for (const entry of allIndexEntries) {
		const key = extractGroupKey(entry.url);
		const list = groupsMap.get(key) ?? [];
		list.push(entry);
		groupsMap.set(key, list);
	}

	// Classify each group (sample-fetch + score)
	const groups: SitemapGroup[] = [];
	for (const [key, entries] of groupsMap.entries()) {
		if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		const lastmods = entries
			.map((e) => e.lastmod)
			.filter((x): x is string => !!x)
			.sort();
		const lastmodMin = lastmods[0] ?? null;
		const lastmodMax = lastmods[lastmods.length - 1] ?? null;

		// Pick smallest/oldest sample to avoid timing out on multi-MB files
		const sampleEntry = entries[0];
		let sampleUrls: string[] = [];
		try {
			const sampleXml = await withDomainSlot(domain, 'sitemap', () =>
				fetchSitemapCached(sampleEntry.url, {
					signal: opts?.signal,
					lastmod: sampleEntry.lastmod,
					timeoutMs: 120_000
				})
			);
			const sampleParsed = parseSitemap(sampleXml);
			if (sampleParsed.type === 'urlset') {
				sampleUrls = sampleParsed.entries.slice(0, 10).map((e) => e.url);
			}
		} catch (err) {
			console.warn(`[discover] sample fetch failed ${sampleEntry.url}:`, err);
		}

		const { classification, score } = classifyGroup(key, sampleUrls);
		groups.push({
			key,
			prefix: key,
			count: entries.length,
			lastmodMin,
			lastmodMax,
			classification,
			articleScore: score,
			sampleUrls,
			entries
		});
	}

	// Sort groups so ARTICLE groups appear first, then by lastmodMax desc
	groups.sort((a, b) => {
		const classOrder = { ARTICLE: 0, UNKNOWN: 1, TAXONOMY: 2, MEDIA: 3 } as const;
		if (classOrder[a.classification] !== classOrder[b.classification]) {
			return classOrder[a.classification] - classOrder[b.classification];
		}
		return (b.lastmodMax ?? '').localeCompare(a.lastmodMax ?? '');
	});

	return {
		sourceDomain: domain,
		rootSitemapUrls: roots,
		groups,
		directUrls
	};
}

/** Extract a group key from a sitemap URL (strip trailing digits + .xml). */
function extractGroupKey(url: string): string {
	try {
		const u = new URL(url);
		const basename = u.pathname.split('/').pop() ?? u.pathname;
		// sitemap-2024.xml, post-sitemap189.xml, post_tag-sitemap.xml, etc.
		const cleaned = basename
			.replace(/\.xml(\.gz)?$/i, '')
			.replace(/\d+$/, '')
			.replace(/-\d{4}$/, '');
		return cleaned || basename;
	} catch {
		return url;
	}
}

/** Heuristic scoring for a sitemap group based on naming + sample URLs. */
function classifyGroup(
	groupKey: string,
	sampleUrls: string[]
): { classification: SitemapGroup['classification']; score: number } {
	let score = 0;

	const keyLower = groupKey.toLowerCase();

	// Name hints — soft signals, not hard rules
	if (/(category|cat|tag|label|author|archive|taxonomy)/.test(keyLower)) score -= 4;
	if (/(post|article|news|story|sitemap-\d{0,4}$|^sitemap$)/.test(keyLower)) score += 2;
	if (/(image|video|attachment|media|upload)/.test(keyLower)) score -= 5;
	if (/cross|misc/.test(keyLower)) score -= 1;

	if (sampleUrls.length > 0) {
		let articleSignals = 0;
		let taxonomySignals = 0;
		let mediaSignals = 0;
		const pathSegments: string[][] = [];

		for (const u of sampleUrls) {
			let parsed: URL;
			try {
				parsed = new URL(u);
			} catch {
				continue;
			}
			const path = parsed.pathname;
			const segs = path.split('/').filter(Boolean);
			pathSegments.push(segs);

			// Article signals
			if (/\/\d{4}\/\d{1,2}\//.test(path)) articleSignals += 2;
			if (/\/\d{4}-\d{1,2}-\d{1,2}/.test(path)) articleSignals += 1;
			if (segs.length >= 3) articleSignals += 1;
			const lastSeg = segs[segs.length - 1] ?? '';
			if (lastSeg.split('-').length >= 4) articleSignals += 2;
			if (/\d{3,}/.test(lastSeg)) articleSignals += 1;

			// Taxonomy signals
			if (/^\/(category|cat|tag|label|author|archive|topics?)\//i.test(path)) taxonomySignals += 3;
			if (segs.length <= 2 && lastSeg.split('-').length <= 2) taxonomySignals += 1;

			// Media
			if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|pdf)($|\?)/i.test(path)) mediaSignals += 5;
			if (/\/(uploads|wp-content|media)\//.test(path)) mediaSignals += 3;
		}

		// Common-prefix detection: taxonomy pages tend to share a long prefix
		if (pathSegments.length >= 3) {
			const firstSeg = pathSegments[0]?.[0];
			const allShareFirst = firstSeg && pathSegments.every((s) => s[0] === firstSeg);
			if (allShareFirst && pathSegments.every((s) => s.length <= 2)) {
				taxonomySignals += 3;
			}
		}

		score += Math.min(5, articleSignals);
		score -= Math.min(5, taxonomySignals);
		score -= Math.min(5, mediaSignals);
	}

	let classification: SitemapGroup['classification'];
	if (score >= 2) classification = 'ARTICLE';
	else if (score <= -3) {
		// Hard skip media vs taxonomy
		if (/image|video|media|upload/.test(keyLower)) classification = 'MEDIA';
		else classification = 'TAXONOMY';
	} else classification = 'UNKNOWN';

	return { classification, score };
}

// ============================================================================
// Scan phase — fetch articles and extract backlinks
// ============================================================================

/** Normalize a URL for deduplication: strip utm/fbclid, trailing slash, lowercase host. */
export function normalizeUrl(raw: string): string {
	try {
		const u = new URL(raw);
		u.hostname = u.hostname.toLowerCase();
		// Strip tracking params
		const toDelete: string[] = [];
		u.searchParams.forEach((_, key) => {
			if (/^utm_/i.test(key) || key === 'fbclid' || key === 'gclid' || key === 'mc_cid') {
				toDelete.push(key);
			}
		});
		for (const k of toDelete) u.searchParams.delete(k);
		let str = u.toString();
		// Remove trailing slash (but not if path is empty)
		if (u.pathname !== '/' && str.endsWith('/')) str = str.slice(0, -1);
		return str;
	} catch {
		return raw;
	}
}

/** Host-matches a target root: host === root OR host ends with `.root`. */
function hostMatches(host: string, root: string): boolean {
	const h = host.replace(/^www\./, '').toLowerCase();
	const r = root.replace(/^www\./, '').toLowerCase();
	return h === r || h.endsWith('.' + r);
}

export interface ExtractedBacklink {
	targetDomain: string;
	targetUrl: string;
	anchorText: string;
	linkAttribute: 'dofollow' | 'nofollow' | 'sponsored' | 'ugc';
}

/**
 * Extract backlinks pointing to any of `targets` from `html`.
 * Returns one entry per unique (targetUrl) found.
 */
export function extractBacklinksToTargets(
	html: string,
	articleUrl: string,
	targets: string[]
): ExtractedBacklink[] {
	const targetRoots = targets.map((t) => toDomain(t)).filter(Boolean);
	if (targetRoots.length === 0) return [];

	const results = new Map<string, ExtractedBacklink>();
	const aRe = /<a\s+([^>]*?)>([\s\S]*?)<\/a\s*>/gi;
	let m: RegExpExecArray | null;
	while ((m = aRe.exec(html)) !== null) {
		const attrs = m[1];
		const inner = m[2];
		const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
		if (!hrefMatch) continue;
		let href = hrefMatch[1].trim();

		// Resolve relative URLs
		if (href.startsWith('//')) href = 'https:' + href;
		else if (href.startsWith('/')) {
			try {
				href = new URL(href, articleUrl).href;
			} catch {
				continue;
			}
		} else if (!href.startsWith('http')) {
			try {
				href = new URL(href, articleUrl).href;
			} catch {
				continue;
			}
		}

		let hrefHost: string;
		try {
			hrefHost = new URL(href).hostname;
		} catch {
			continue;
		}

		const matchedRoot = targetRoots.find((root) => hostMatches(hrefHost, root));
		if (!matchedRoot) continue;

		// Determine rel attribute
		const relMatch = attrs.match(/rel\s*=\s*["']([^"']*)["']/i);
		const rel = (relMatch?.[1] ?? '').toLowerCase();
		let linkAttribute: ExtractedBacklink['linkAttribute'] = 'dofollow';
		if (rel.includes('sponsored')) linkAttribute = 'sponsored';
		else if (rel.includes('ugc')) linkAttribute = 'ugc';
		else if (rel.includes('nofollow')) linkAttribute = 'nofollow';

		const anchorText = inner
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 300);

		const normalizedTarget = normalizeUrl(href);
		if (results.has(normalizedTarget)) continue;
		results.set(normalizedTarget, {
			targetDomain: matchedRoot,
			targetUrl: normalizedTarget,
			anchorText,
			linkAttribute
		});
	}

	return Array.from(results.values());
}

/** Extract canonical URL from HTML, if present. */
export function extractCanonicalUrl(html: string, articleUrl: string): string | null {
	const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
		|| html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
	if (!m) return null;
	try {
		return new URL(m[1], articleUrl).href;
	} catch {
		return m[1];
	}
}

/** Extract <title>. */
export function extractArticleTitle(html: string): string | null {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!m) return null;
	return m[1].replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}

/** Extract article published date (ISO string) from common meta tags. */
export function extractPublishedAt(html: string): string | null {
	const patterns = [
		/<meta[^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["'][^>]*content=["']([^"']+)["']/i,
		/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["']/i,
		/<time[^>]*datetime=["']([^"']+)["']/i,
		/"datePublished"\s*:\s*"([^"]+)"/
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			const d = new Date(m[1]);
			if (!isNaN(d.getTime())) return d.toISOString();
		}
	}
	return null;
}

/** Short press-trust label from the hostname (capitalized first word before dot). */
export function extractPressTrustFromUrl(articleUrl: string): string {
	try {
		const host = new URL(articleUrl).hostname.replace(/^www\./, '');
		const base = host.split('.')[0] || '';
		if (base.length <= 3) return base.toUpperCase();
		return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
	} catch {
		return '';
	}
}

// ============================================================================
// Search-based discovery — use the site's built-in search page
// ============================================================================

/**
 * Discover article URLs by querying the source site's built-in search.
 *
 * Uses a site-specific extractor when available (bzi.ro, bzv.ro, bzc.ro, bzt.ro)
 * with tuned selectors + pagination link detection. Falls back to a generic
 * WordPress pattern (`/page/N/?s=keyword`) + heuristic link extraction otherwise.
 *
 * Returns detected articles as ExtractedArticle when possible (preserving title,
 * date, category) so callers can reuse this metadata without refetching.
 */
export async function discoverUrlsViaSearch(
	domain: string,
	keywords: string[],
	maxPages: number,
	opts: {
		signal?: AbortSignal;
		onPageProcessed?: (info: { keyword: string; page: number; found: number; total: number }) => void;
	} = {}
): Promise<{ urls: string[]; metaByUrl: Map<string, ExtractedArticle> }> {
	const host = toDomain(domain);
	if (!host) return { urls: [], metaByUrl: new Map() };
	const normalized = keywords.map((k) => k.trim()).filter(Boolean);
	if (normalized.length === 0) return { urls: [], metaByUrl: new Map() };

	const extractor = findSiteExtractor(host);
	const allUrls = new Set<string>();
	const metaByUrl = new Map<string, ExtractedArticle>();

	async function fetchPage(url: string): Promise<string> {
		try {
			return await withDomainSlot(
				host,
				'article',
				() => fetchArticleHtmlSafe(url, { timeoutMs: 20_000, signal: opts.signal }),
				opts.signal
			);
		} catch (err) {
			if (opts.signal?.aborted) throw err;
			console.warn(`[discover] search fetch failed ${url}:`, err instanceof Error ? err.message : err);
			return '';
		}
	}

	// Most RO news sites serve their canonical version on www.<host>.
	// Start with the www prefix so relative URLs resolve correctly and
	// pagination links are built against the right origin.
	const startHost = `www.${host}`;

	for (const keyword of normalized) {
		if (opts.signal?.aborted) break;
		const perKeywordSeen = new Set<string>();
		const visited = new Set<string>();

		// Page 1 URL — prefer site-specific searchUrl() if defined (e.g. bzt.ro
		// uses /search/{keyword}, not the WordPress ?s= query). Otherwise fall
		// back to the WordPress default with www prefix.
		let currentUrl: string | null =
			extractor?.searchUrl?.(keyword, 1) ??
			`https://${startHost}/?s=${encodeURIComponent(keyword)}`;
		let page = 1;
		let authoritativeNextPage = true; // Whether extractor should be trusted

		while (currentUrl && page <= maxPages) {
			if (opts.signal?.aborted) break;
			if (visited.has(currentUrl)) break;
			visited.add(currentUrl);

			const html = await fetchPage(currentUrl);
			if (!html) {
				// No more pages (404) or fetch failed — stop pagination for this keyword
				break;
			}

			// Extract articles — site-specific when available
			let articles: ExtractedArticle[];
			if (extractor) {
				articles = extractor.extractArticles(html, currentUrl);
			} else {
				articles = extractArticleLinksFromSearchPage(html, host).map((u) => ({
					title: '',
					url: u,
					rawDate: '',
					publishedAt: null,
					category: null,
					pattern: 'generic'
				}));
				authoritativeNextPage = false;
			}

			let newCount = 0;
			for (const art of articles) {
				if (!art.url) continue;
				const norm = normalizeUrl(art.url);
				if (perKeywordSeen.has(norm)) continue;
				perKeywordSeen.add(norm);
				if (!allUrls.has(norm)) {
					allUrls.add(norm);
					metaByUrl.set(norm, { ...art, url: norm });
					newCount++;
				}
			}

			opts.onPageProcessed?.({
				keyword,
				page,
				found: newCount,
				total: allUrls.size
			});

			// Stop immediately if a page returned zero new articles — pagination
			// is exhausted (either no more results or dedupe-only content).
			if (newCount === 0) break;

			// Determine next page URL — trust the extractor's nextPage as
			// authoritative for known sites (it reads the actual pagination link
			// from HTML, which handles custom URL patterns correctly).
			let nextUrl: string | null = null;
			if (extractor && typeof extractor.nextPage === 'function') {
				nextUrl = extractor.nextPage(html, currentUrl);
				if (nextUrl && visited.has(nextUrl)) nextUrl = null;
				// Authoritative: if extractor returns null, there are no more pages.
				// Do NOT fall back to constructed URLs (would hit 404s).
			} else if (!authoritativeNextPage) {
				// Generic fallback: only when no site-specific extractor.
				// Use www prefix to match the redirect target of most WP sites.
				const nextN = page + 1;
				if (nextN <= maxPages) {
					nextUrl = `https://${startHost}/page/${nextN}/?s=${encodeURIComponent(keyword)}`;
				}
			}

			currentUrl = nextUrl;
			page++;
		}
	}

	return { urls: Array.from(allUrls), metaByUrl };
}

/**
 * Extract candidate article URLs from a WordPress-style search results page.
 * Strategy:
 *  1. Prefer links inside <article>, <h2>, <h3> tags (typical for WP themes)
 *  2. Fallback: all same-domain <a> links filtered via shouldSkipArticleUrl
 */
export function extractArticleLinksFromSearchPage(html: string, host: string): string[] {
	const results = new Set<string>();

	// Strategy 1: links inside h2/h3/article tags (most WP themes)
	const headingRe = /<(?:h2|h3|article)[^>]*>([\s\S]*?)<\/(?:h2|h3|article)>/gi;
	let hm: RegExpExecArray | null;
	while ((hm = headingRe.exec(html)) !== null) {
		const block = hm[1];
		const aRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
		let am: RegExpExecArray | null;
		while ((am = aRe.exec(block)) !== null) {
			const resolved = resolveSameDomainUrl(am[1], host);
			if (resolved && !shouldSkipArticleUrl(resolved) && !isListingUrl(resolved, host)) {
				results.add(resolved);
			}
		}
	}

	// Strategy 2: if strategy 1 found very few, fall back to all links
	if (results.size < 3) {
		const aRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
		let am: RegExpExecArray | null;
		while ((am = aRe.exec(html)) !== null) {
			const resolved = resolveSameDomainUrl(am[1], host);
			if (resolved && !shouldSkipArticleUrl(resolved) && !isListingUrl(resolved, host)) {
				results.add(resolved);
			}
		}
	}

	return Array.from(results);
}

/** Resolve an href to an absolute URL on the same host; return null if different host. */
function resolveSameDomainUrl(href: string, host: string): string | null {
	if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
		return null;
	}
	let absolute: string;
	try {
		if (href.startsWith('//')) absolute = 'https:' + href;
		else if (href.startsWith('/')) absolute = `https://${host}${href}`;
		else if (href.startsWith('http')) absolute = href;
		else absolute = `https://${host}/${href}`;
		const u = new URL(absolute);
		const h = u.hostname.replace(/^www\./, '').toLowerCase();
		if (h !== host && !h.endsWith('.' + host)) return null;
		return u.href;
	} catch {
		return null;
	}
}

/** Heuristic: is this URL a listing/taxonomy page (to exclude from scan targets)? */
function isListingUrl(url: string, host: string): boolean {
	try {
		const u = new URL(url);
		const path = u.pathname;
		if (u.search.includes('?s=') || u.search.includes('s=')) return true;
		if (/^\/page\/\d+\/?/.test(path)) return true;
		if (/^\/(category|cat|tag|label|author|archive|search)\//i.test(path)) return true;
		if (path === '/' || path === '') return true;
		// Same host but very short path (likely homepage/category root)
		const segs = path.split('/').filter(Boolean);
		if (segs.length === 0) return true;
		return false;
	} catch {
		return true;
	}
}

// ============================================================================
// Main pipeline — runDiscoveryJob
// ============================================================================

interface RunOpts {
	jobId: string;
	signal: AbortSignal;
}

/**
 * Main pipeline. Expects the job row to already exist with status='running'
 * and a parsed config. Persists results incrementally. Updates progress counters.
 */
export async function runDiscoveryJob({ jobId, signal }: RunOpts): Promise<void> {
	const [job] = await db
		.select()
		.from(table.seoLinkDiscoveryJob)
		.where(eq(table.seoLinkDiscoveryJob.id, jobId))
		.limit(1);
	if (!job) throw new Error(`Job ${jobId} not found`);

	const cfg = JSON.parse(job.config) as DiscoveryConfig;
	const domain = job.sourceDomain;

	// Resolve target domains from selected clients + extras
	const targets = await resolveTargets(job.tenantId, cfg);
	if (targets.length === 0) {
		await failJob(jobId, 'Niciun domeniu țintă selectat');
		return;
	}

	// Preload existing seoLink rows so already-tracked URLs can be surfaced as
	// read-only results (with target/anchor already known) instead of being
	// silently skipped. Keyed by normalized articleUrl — one URL can have multiple
	// entries (same article tracked for different clients).
	const existingByUrl = new Map<
		string,
		Array<{
			id: string;
			clientId: string;
			websiteId: string | null;
			targetUrl: string | null;
			targetDomain: string;
			anchorText: string | null;
			linkAttribute: string | null;
			articlePublishedAt: string | null;
			pressTrust: string | null;
		}>
	>();
	if (!cfg.forceRescanExisting) {
		const existingRows = await db
			.select({
				id: table.seoLink.id,
				articleUrl: table.seoLink.articleUrl,
				clientId: table.seoLink.clientId,
				websiteId: table.seoLink.websiteId,
				targetUrl: table.seoLink.targetUrl,
				anchorText: table.seoLink.anchorText,
				linkAttribute: table.seoLink.linkAttribute,
				articlePublishedAt: table.seoLink.articlePublishedAt,
				pressTrust: table.seoLink.pressTrust
			})
			.from(table.seoLink)
			.where(eq(table.seoLink.tenantId, job.tenantId));
		for (const row of existingRows) {
			if (!row.articleUrl) continue;
			const norm = normalizeUrl(row.articleUrl);
			const list = existingByUrl.get(norm) ?? [];
			list.push({
				id: row.id,
				clientId: row.clientId,
				websiteId: row.websiteId,
				targetUrl: row.targetUrl,
				targetDomain: toDomain(row.targetUrl ?? ''),
				anchorText: row.anchorText,
				linkAttribute: row.linkAttribute,
				articlePublishedAt: row.articlePublishedAt,
				pressTrust: row.pressTrust
			});
			existingByUrl.set(norm, list);
		}
	}

	// ==========================================================================
	// Search mode — skip sitemap entirely
	// ==========================================================================
	if (cfg.mode === 'search') {
		const keywords = cfg.searchKeywords ?? [];
		if (keywords.length === 0) {
			await failJob(jobId, 'Niciun keyword de căutare specificat');
			return;
		}

		await db
			.update(table.seoLinkDiscoveryJob)
			.set({
				phase: 'scanning',
				totalSitemaps: keywords.length,
				startedAt: job.startedAt ?? new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.seoLinkDiscoveryJob.id, jobId));

		const maxPages = Math.max(1, Math.min(cfg.maxSearchPages ?? 10, 50));
		const { urls: discoveredUrls, metaByUrl } = await discoverUrlsViaSearch(
			domain,
			keywords,
			maxPages,
			{
				signal,
				onPageProcessed: async ({ keyword, page, total }) => {
					await updateProgress(jobId, {
						totalArticles: total
					});
					await db
						.update(table.seoLinkDiscoveryJob)
						.set({
							currentSitemapUrl: `${keyword} → page ${page}`,
							updatedAt: new Date()
						})
						.where(eq(table.seoLinkDiscoveryJob.id, jobId));
				}
			}
		);

		if (signal.aborted) {
			await db
				.update(table.seoLinkDiscoveryJob)
				.set({ status: 'cancelled', phase: 'done', finishedAt: new Date(), updatedAt: new Date() })
				.where(eq(table.seoLinkDiscoveryJob.id, jobId));
			return;
		}

		// Apply hard cap
		const toScan = discoveredUrls.slice(0, cfg.maxArticles);
		// metaByUrl holds title/publishedAt/category extracted from listing pages.
		// We still must fetch each article HTML to check for backlinks, but can use
		// this metadata as a fallback when the article itself lacks meta tags.
		void metaByUrl;

		await db
			.update(table.seoLinkDiscoveryJob)
			.set({
				totalArticles: toScan.length,
				processedSitemaps: keywords.length,
				updatedAt: new Date()
			})
			.where(eq(table.seoLinkDiscoveryJob.id, jobId));

		let processedArticlesS = 0;
		let matchCountS = 0;
		let errorCountS = 0;

		await scanArticleBatch(
			job,
			toScan,
			targets,
			existingByUrl,
			cfg,
			signal,
			() => processedArticlesS,
			(n) => (processedArticlesS += n),
			() => matchCountS,
			(n) => (matchCountS += n),
			() => errorCountS,
			(n) => (errorCountS += n)
		);

		await updateProgress(jobId, {
			processedArticles: processedArticlesS,
			matchCount: matchCountS,
			errorCount: errorCountS,
			totalArticles: toScan.length
		});

		await db
			.update(table.seoLinkDiscoveryJob)
			.set({
				status: 'completed',
				phase: 'done',
				finishedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.seoLinkDiscoveryJob.id, jobId));
		return;
	}

	// ==========================================================================
	// Sitemap-based modes (recent / date-range / full)
	// ==========================================================================

	// Phase 1 (re)preview — we need grouped entries to scan
	const preview = await previewDiscovery(domain, { signal });

	// Resolve which sub-sitemaps to scan based on mode and user selection
	const candidates = selectSitemapsToScan(preview, cfg);
	const totalCandidates = candidates.length;

	// Also include direct URLs (urlset root) as an implicit group
	const directUrls = preview.directUrls;

	// Apply hard cap (maxSitemaps)
	const capped = candidates.slice(0, cfg.maxSitemaps);

	await db
		.update(table.seoLinkDiscoveryJob)
		.set({
			phase: 'scanning',
			totalSitemaps: capped.length,
			startedAt: job.startedAt ?? new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.seoLinkDiscoveryJob.id, jobId));

	let processedArticles = 0;
	let matchCount = 0;
	let errorCount = 0;

	// Process direct URLs first if any
	if (directUrls.length > 0) {
		const stats = await scanArticleBatch(
			job,
			directUrls.map((e) => e.url),
			targets,
			existingByUrl,
			cfg,
			signal,
			() => processedArticles,
			(n) => (processedArticles += n),
			() => matchCount,
			(n) => (matchCount += n),
			() => errorCount,
			(n) => (errorCount += n)
		);
		await updateProgress(jobId, {
			processedArticles,
			matchCount,
			errorCount,
			totalArticles: stats.totalArticlesSeen
		});
	}

	// Process candidate sub-sitemaps sequentially
	for (let i = 0; i < capped.length; i++) {
		if (signal.aborted) {
			await db
				.update(table.seoLinkDiscoveryJob)
				.set({
					status: 'cancelled',
					phase: 'done',
					finishedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(table.seoLinkDiscoveryJob.id, jobId));
			return;
		}

		const entry = capped[i];
		await db
			.update(table.seoLinkDiscoveryJob)
			.set({
				currentSitemapUrl: entry.url,
				currentSitemapIndex: i,
				processedSitemaps: i,
				updatedAt: new Date()
			})
			.where(eq(table.seoLinkDiscoveryJob.id, jobId));

		// Fetch + parse sub-sitemap
		let urlsetEntries: SitemapUrlEntry[] = [];
		try {
			const xml = await withDomainSlot(domain, 'sitemap', () =>
				fetchSitemapCached(entry.url, {
					signal,
					lastmod: entry.lastmod,
					timeoutMs: 120_000
				})
			);
			if (xml) {
				const parsed = parseSitemap(xml);
				if (parsed.type === 'urlset') {
					urlsetEntries = parsed.entries;
				}
			}
		} catch (err) {
			console.warn(`[discover] sub-sitemap failed ${entry.url}:`, err instanceof Error ? err.message : err);
			errorCount++;
		}

		// Scan articles from this sub-sitemap
		const urls = urlsetEntries.map((e) => e.url);
		const remainingBudget = Math.max(0, cfg.maxArticles - processedArticles);
		const toScan = urls.slice(0, remainingBudget);

		const stats = await scanArticleBatch(
			job,
			toScan,
			targets,
			existingByUrl,
			cfg,
			signal,
			() => processedArticles,
			(n) => (processedArticles += n),
			() => matchCount,
			(n) => (matchCount += n),
			() => errorCount,
			(n) => (errorCount += n)
		);

		await updateProgress(jobId, {
			processedArticles,
			matchCount,
			errorCount,
			totalArticles: Math.max(stats.totalArticlesSeen, processedArticles)
		});

		// Hit article budget? Stop scanning more sub-sitemaps.
		if (processedArticles >= cfg.maxArticles) break;
	}

	await db
		.update(table.seoLinkDiscoveryJob)
		.set({
			status: 'completed',
			phase: 'done',
			processedSitemaps: Math.min(capped.length, totalCandidates),
			finishedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.seoLinkDiscoveryJob.id, jobId));
}

/** Select which sub-sitemaps to scan given the discovered groups and config. */
export function selectSitemapsToScan(
	preview: PreviewResult,
	cfg: DiscoveryConfig
): SitemapIndexEntry[] {
	// Pick groups: if user selected specific keys, use those; otherwise auto-pick ARTICLE-classified.
	const selectedKeys = cfg.selectedGroupKeys?.length
		? new Set(cfg.selectedGroupKeys)
		: new Set(preview.groups.filter((g) => g.classification === 'ARTICLE').map((g) => g.key));

	let entries: SitemapIndexEntry[] = [];
	for (const g of preview.groups) {
		if (!selectedKeys.has(g.key)) continue;
		entries.push(...g.entries);
	}

	// Sort by lastmod DESC (newest first)
	entries.sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''));

	// Apply mode filters
	if (cfg.mode === 'recent') {
		const n = cfg.recentSitemapCount ?? 5;
		entries = entries.slice(0, n);
	} else if (cfg.mode === 'date-range') {
		const from = cfg.dateFrom ?? '';
		const to = cfg.dateTo ?? '';
		entries = entries.filter((e) => {
			if (!e.lastmod) return false;
			const d = e.lastmod.slice(0, 10);
			if (from && d < from) return false;
			if (to && d > to) return false;
			return true;
		});
	}
	// 'full' = no filter

	return entries;
}

/** Resolve target domains + metadata from config. */
async function resolveTargets(
	tenantId: string,
	cfg: DiscoveryConfig
): Promise<TargetDomain[]> {
	const map = new Map<string, TargetDomain>();

	if (cfg.clientIds.length > 0) {
		const websites = await db
			.select()
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.tenantId, tenantId),
					inArray(table.clientWebsite.clientId, cfg.clientIds)
				)
			);
		for (const w of websites) {
			const d = toDomain(w.url);
			if (d && !map.has(d)) {
				map.set(d, { domain: d, clientId: w.clientId, websiteId: w.id });
			}
		}
		// Also fall back to client.website when there are no clientWebsite rows
		const clients = await db
			.select({ id: table.client.id, website: table.client.website })
			.from(table.client)
			.where(
				and(eq(table.client.tenantId, tenantId), inArray(table.client.id, cfg.clientIds))
			);
		for (const c of clients) {
			if (!c.website) continue;
			const d = toDomain(c.website);
			if (d && !map.has(d)) {
				map.set(d, { domain: d, clientId: c.id });
			}
		}
	}

	for (const raw of cfg.extraTargetDomains) {
		const d = toDomain(raw);
		if (d && !map.has(d)) {
			map.set(d, { domain: d });
		}
	}

	return Array.from(map.values());
}

/** Existing seoLink data keyed by normalized article URL. */
type ExistingByUrl = Map<
	string,
	Array<{
		id: string;
		clientId: string;
		websiteId: string | null;
		targetUrl: string | null;
		targetDomain: string;
		anchorText: string | null;
		linkAttribute: string | null;
		articlePublishedAt: string | null;
		pressTrust: string | null;
	}>
>;

/** Scan a batch of article URLs in parallel, persisting matches immediately. */
async function scanArticleBatch(
	job: { id: string; tenantId: string; sourceDomain: string },
	urls: string[],
	targets: TargetDomain[],
	existingByUrl: ExistingByUrl,
	cfg: DiscoveryConfig,
	signal: AbortSignal,
	_getProcessed: () => number,
	addProcessed: (n: number) => void,
	_getMatch: () => number,
	addMatch: (n: number) => void,
	_getError: () => number,
	addError: (n: number) => void
): Promise<{ totalArticlesSeen: number }> {
	if (urls.length === 0) return { totalArticlesSeen: 0 };
	const targetRoots = targets.map((t) => t.domain);
	const targetRootSet = new Set(targetRoots);

	// Pre-filter: skip obviously non-article URLs
	const filtered = urls.filter((u) => !shouldSkipArticleUrl(u));

	let idx = 0;
	const concurrency = Math.max(1, Math.min(cfg.articleConcurrency, 16));

	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (!signal.aborted) {
				const i = idx++;
				if (i >= filtered.length) return;
				const articleUrl = filtered[i];
				const normalized = normalizeUrl(articleUrl);

				// Already-tracked short-circuit: surface existing entries as results
				// (with alreadyTracked=true) instead of silently skipping them.
				const existing = existingByUrl.get(normalized);
				if (!cfg.forceRescanExisting && existing && existing.length > 0) {
					// Filter to entries whose targetDomain is in the current scan targets
					const relevant = existing.filter((e) => targetRootSet.has(e.targetDomain));
					if (relevant.length > 0) {
						for (const e of relevant) {
							try {
								await db.insert(table.seoLinkDiscoveryResult).values({
									jobId: job.id,
									tenantId: job.tenantId,
									articleUrl: normalized,
									canonicalUrl: null,
									articleTitle: null,
									articlePublishedAt: e.articlePublishedAt,
									pressTrust: e.pressTrust ?? extractPressTrustFromUrl(articleUrl),
									targetDomain: e.targetDomain,
									targetUrl: e.targetUrl ?? '',
									anchorText: e.anchorText,
									linkAttribute: e.linkAttribute,
									matchedClientId: e.clientId,
									matchedWebsiteId: e.websiteId,
									alreadyTracked: true,
									// savedAsSeoLinkId is reserved for rows newly saved via this session;
									// pre-existing tracked links get only alreadyTracked=true
									foundAt: new Date()
								});
								addMatch(1);
							} catch (err) {
								console.warn('[discover] insert tracked result failed:', err);
							}
						}
						addProcessed(1);
						continue;
					}
					// existing entries exist but none for current targets → scan normally
				}

				try {
					const html = await withDomainSlot(
						job.sourceDomain,
						'article',
						() =>
							fetchArticleHtmlSafe(articleUrl, {
								timeoutMs: 15_000,
								signal
							}),
						signal
					);
					addProcessed(1);

					if (!html) continue;

					const backlinks = extractBacklinksToTargets(html, articleUrl, targetRoots);
					if (backlinks.length === 0) continue;

					// Persist results — one row per unique targetUrl
					const canonical = extractCanonicalUrl(html, articleUrl);
					const title = extractArticleTitle(html);
					const publishedAt = extractPublishedAt(html);
					const pressTrust = extractPressTrustFromUrl(articleUrl);

					for (const bl of backlinks) {
						const matched = targets.find((t) => t.domain === bl.targetDomain);
						try {
							await db.insert(table.seoLinkDiscoveryResult).values({
								jobId: job.id,
								tenantId: job.tenantId,
								articleUrl: normalized,
								canonicalUrl: canonical,
								articleTitle: title,
								articlePublishedAt: publishedAt,
								pressTrust,
								targetDomain: bl.targetDomain,
								targetUrl: bl.targetUrl,
								anchorText: bl.anchorText,
								linkAttribute: bl.linkAttribute,
								matchedClientId: matched?.clientId ?? null,
								matchedWebsiteId: matched?.websiteId ?? null,
								alreadyTracked: false,
								foundAt: new Date()
							});
							addMatch(1);
						} catch (err) {
							console.warn('[discover] insert result failed:', err);
						}
					}
				} catch (err) {
					if (signal.aborted) return;
					addError(1);
					addProcessed(1);
					console.warn(`[discover] article fetch failed ${articleUrl}:`, err instanceof Error ? err.message : err);
				}
			}
		})
	);

	return { totalArticlesSeen: filtered.length };
}

/** Quick filter: skip URLs that clearly aren't articles. */
function shouldSkipArticleUrl(url: string): boolean {
	try {
		const u = new URL(url);
		const path = u.pathname.toLowerCase();
		if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|pdf|zip|xml|css|js)($|\?)/.test(path)) return true;
		if (/\/(wp-content|uploads|media|static|assets)\//.test(path)) return true;
		return false;
	} catch {
		return true;
	}
}

/** Wrap fetchWithCloudflareFallback to always return a string (empty on error). */
async function fetchArticleHtmlSafe(
	url: string,
	opts: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
	try {
		const { html } = await fetchWithCloudflareFallback(url, {
			timeoutMs: opts.timeoutMs ?? 15_000,
			signal: opts.signal,
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
			}
		});
		return html ?? '';
	} catch {
		return '';
	}
}

async function updateProgress(
	jobId: string,
	delta: Partial<{
		processedArticles: number;
		matchCount: number;
		errorCount: number;
		totalArticles: number;
	}>
): Promise<void> {
	try {
		await db
			.update(table.seoLinkDiscoveryJob)
			.set({ ...delta, updatedAt: new Date() })
			.where(eq(table.seoLinkDiscoveryJob.id, jobId));
	} catch (err) {
		console.warn('[discover] progress update failed:', err);
	}
}

async function failJob(jobId: string, error: string): Promise<void> {
	await db
		.update(table.seoLinkDiscoveryJob)
		.set({
			status: 'failed',
			phase: 'done',
			error,
			finishedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.seoLinkDiscoveryJob.id, jobId));
}

// ============================================================================
// Job coordinator — in-memory AbortController registry
// ============================================================================

const jobControllers = new Map<string, AbortController>();

/** Start a discovery job: launch the pipeline asynchronously. */
export function launchDiscoveryJob(jobId: string): void {
	if (jobControllers.has(jobId)) return; // Already running
	const controller = new AbortController();
	jobControllers.set(jobId, controller);

	queueMicrotask(async () => {
		try {
			await runDiscoveryJob({ jobId, signal: controller.signal });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[discover] job ${jobId} crashed:`, msg);
			try {
				await failJob(jobId, msg);
			} catch {
				/* noop */
			}
		} finally {
			jobControllers.delete(jobId);
		}
	});
}

/** Request graceful abort of a running job. */
export function abortDiscoveryJob(jobId: string): boolean {
	const ctrl = jobControllers.get(jobId);
	if (!ctrl) return false;
	ctrl.abort();
	jobControllers.delete(jobId);
	return true;
}

/** Is a job currently executing in this process? */
export function isJobRunning(jobId: string): boolean {
	return jobControllers.has(jobId);
}
