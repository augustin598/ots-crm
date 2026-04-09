/**
 * Sitemap parser — handles sitemap-index (nested) and urlset.
 *
 * Supports:
 *  - <sitemapindex> with nested <sitemap><loc><lastmod>
 *  - <urlset> with <url><loc><lastmod>
 *  - Gzipped sitemaps (.xml.gz) via CompressionStream
 *  - robots.txt discovery
 */

export interface SitemapIndexEntry {
	url: string;
	lastmod: string | null;
}

export interface SitemapUrlEntry {
	url: string;
	lastmod: string | null;
}

export type ParsedSitemap =
	| { type: 'index'; entries: SitemapIndexEntry[] }
	| { type: 'urlset'; entries: SitemapUrlEntry[] };

const SITEMAP_FETCH_HEADERS: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
	Accept: 'application/xml,text/xml,*/*;q=0.8',
	'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
	'Accept-Encoding': 'gzip, deflate, br'
};

/** Ensure URL has a protocol and is absolute. */
export function normalizeSitemapUrl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
	if (trimmed.startsWith('//')) return `https:${trimmed}`;
	return `https://${trimmed.replace(/^\/+/, '')}`;
}

/** Extract canonical domain from a URL or hostname-like string. */
export function toDomain(input: string): string {
	try {
		const u = new URL(input.startsWith('http') ? input : `https://${input}`);
		return u.hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return input.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase() || '';
	}
}

/**
 * Fetch raw sitemap XML with plain fetch only.
 *
 * Sitemaps are XML — Puppeteer fallback provides zero benefit and wastes browser
 * resources. If the upstream server returns 429, we retry once after a backoff.
 */
export async function fetchSitemapContent(
	url: string,
	opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
	const timeoutMs = opts?.timeoutMs ?? 120_000;

	async function attempt(): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const onExternalAbort = () => controller.abort();
		opts?.signal?.addEventListener('abort', onExternalAbort, { once: true });
		try {
			return await fetch(url, {
				method: 'GET',
				redirect: 'follow',
				signal: controller.signal,
				headers: SITEMAP_FETCH_HEADERS
			});
		} finally {
			clearTimeout(timer);
			opts?.signal?.removeEventListener('abort', onExternalAbort);
		}
	}

	let res: Response;
	try {
		res = await attempt();
	} catch (err) {
		console.warn(`[sitemap] fetch failed ${url}:`, err instanceof Error ? err.message : err);
		return '';
	}

	// Retry once on 429 after a short backoff
	if (res.status === 429) {
		res.body?.cancel();
		await new Promise((r) => setTimeout(r, 3000));
		if (opts?.signal?.aborted) return '';
		try {
			res = await attempt();
		} catch {
			return '';
		}
	}

	if (!res.ok) {
		console.warn(`[sitemap] non-OK ${res.status} for ${url}`);
		return '';
	}

	const text = await res.text();
	if (!text) return '';
	if (text.startsWith('<?xml') || text.includes('<sitemapindex') || text.includes('<urlset')) {
		return text;
	}
	if (url.endsWith('.gz')) {
		try {
			return await decompressGzipString(text);
		} catch {
			return text;
		}
	}
	return text;
}

/** Decompress a gzip-encoded string (best-effort). */
async function decompressGzipString(input: string): Promise<string> {
	const bytes = new Uint8Array(input.length);
	for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
	const stream = new Response(bytes).body?.pipeThrough(new DecompressionStream('gzip'));
	if (!stream) return input;
	const decompressed = await new Response(stream).text();
	return decompressed;
}

/** Parse sitemap XML content into either an index or urlset. */
export function parseSitemap(xml: string): ParsedSitemap {
	// Detect root element.
	const isIndex = /<sitemapindex[\s>]/i.test(xml);
	if (isIndex) {
		return { type: 'index', entries: parseIndexEntries(xml) };
	}
	return { type: 'urlset', entries: parseUrlsetEntries(xml) };
}

function parseIndexEntries(xml: string): SitemapIndexEntry[] {
	const entries: SitemapIndexEntry[] = [];
	const blockRe = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
	let m: RegExpExecArray | null;
	while ((m = blockRe.exec(xml)) !== null) {
		const block = m[1];
		const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1]?.trim();
		const lastmod = block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1]?.trim() ?? null;
		if (loc) entries.push({ url: decodeXmlEntities(loc), lastmod });
	}
	return entries;
}

function parseUrlsetEntries(xml: string): SitemapUrlEntry[] {
	const entries: SitemapUrlEntry[] = [];
	const blockRe = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
	let m: RegExpExecArray | null;
	while ((m = blockRe.exec(xml)) !== null) {
		const block = m[1];
		const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1]?.trim();
		const lastmod = block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1]?.trim() ?? null;
		if (loc) entries.push({ url: decodeXmlEntities(loc), lastmod });
	}
	return entries;
}

function decodeXmlEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

/** Discover sitemap URLs for a given domain via robots.txt + common fallbacks. */
export async function discoverSitemapUrls(
	domain: string,
	opts?: { signal?: AbortSignal }
): Promise<string[]> {
	const host = toDomain(domain);
	if (!host) return [];
	const candidates: string[] = [];

	// 1. Try robots.txt
	const robotsUrls = [`https://${host}/robots.txt`, `https://www.${host}/robots.txt`];
	for (const robotsUrl of robotsUrls) {
		try {
			const res = await fetch(robotsUrl, {
				signal: AbortSignal.timeout(10_000),
				headers: { 'User-Agent': SITEMAP_FETCH_HEADERS['User-Agent'] }
			});
			if (!res.ok) continue;
			const txt = await res.text();
			const sitemapLines = txt
				.split(/\r?\n/)
				.map((l) => l.match(/^\s*Sitemap:\s*(.+)$/i)?.[1]?.trim())
				.filter((x): x is string => !!x);
			for (const url of sitemapLines) {
				if (!candidates.includes(url)) candidates.push(url);
			}
			if (candidates.length > 0) break;
		} catch {
			// continue to next
		}
		if (opts?.signal?.aborted) return candidates;
	}

	// 2. Common fallbacks if robots.txt didn't yield anything
	if (candidates.length === 0) {
		const fallbacks = [
			`https://${host}/sitemap_index.xml`,
			`https://${host}/sitemap-index.xml`,
			`https://${host}/wp-sitemap.xml`,
			`https://${host}/sitemap.xml`,
			`https://${host}/sitemaps/sitemap-index.xml`,
			`https://${host}/post-sitemap.xml`,
			`https://${host}/news-sitemap.xml`,
			`https://www.${host}/sitemap_index.xml`,
			`https://www.${host}/sitemap.xml`
		];
		for (const fb of fallbacks) {
			try {
				const res = await fetch(fb, {
					method: 'HEAD',
					signal: AbortSignal.timeout(10_000),
					headers: { 'User-Agent': SITEMAP_FETCH_HEADERS['User-Agent'] }
				});
				if (res.ok) {
					candidates.push(fb);
					break;
				}
			} catch {
				// try next
			}
			if (opts?.signal?.aborted) return candidates;
		}
	}

	return candidates;
}

/** Resolve a sitemap root into a flat list of urlset entries by recursively expanding indices. */
export async function expandSitemapToUrls(
	rootUrl: string,
	opts: {
		signal?: AbortSignal;
		allowedSubSitemaps?: (entry: SitemapIndexEntry) => boolean;
		fetcher?: (url: string) => Promise<string>;
		maxDepth?: number;
	} = {}
): Promise<SitemapUrlEntry[]> {
	const maxDepth = opts.maxDepth ?? 3;
	const fetcher = opts.fetcher ?? ((u) => fetchSitemapContent(u, { signal: opts.signal }));
	const seen = new Set<string>();
	const out: SitemapUrlEntry[] = [];

	async function visit(url: string, depth: number) {
		if (depth > maxDepth) return;
		if (seen.has(url)) return;
		seen.add(url);
		if (opts.signal?.aborted) return;

		let xml = '';
		try {
			xml = await fetcher(url);
		} catch {
			return;
		}
		if (!xml) return;

		const parsed = parseSitemap(xml);
		if (parsed.type === 'urlset') {
			out.push(...parsed.entries);
			return;
		}
		for (const entry of parsed.entries) {
			if (opts.allowedSubSitemaps && !opts.allowedSubSitemaps(entry)) continue;
			await visit(entry.url, depth + 1);
		}
	}

	await visit(rootUrl, 0);
	return out;
}
