import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, asc, or, isNull, isNotNull, inArray, like, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import XLSX from 'xlsx';
import { fetchWithCloudflareFallback } from '$lib/server/scraper/cloudflare-bypass';

function generateSeoLinkId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateSeoLinkCheckId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const seoLinkSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1, 'Client is required')),
	websiteId: v.optional(v.string()),
	pressTrust: v.optional(v.string()),
	month: v.pipe(v.string(), v.minLength(1, 'Luna este obligatorie')), // YYYY-MM
	keyword: v.pipe(v.string(), v.minLength(1, 'Cuvântul cheie este obligatoriu')),
	linkType: v.optional(v.picklist(['article', 'guest-post', 'press-release', 'directory', 'other'])),
	linkAttribute: v.optional(v.picklist(['dofollow', 'nofollow'])),
	status: v.optional(v.picklist(['pending', 'submitted', 'published', 'rejected'])),
	articleUrl: v.optional(v.string()),
	articlePublishedAt: v.optional(v.string()),
	targetUrl: v.optional(v.string()),
	price: v.optional(v.number()),
	currency: v.optional(v.string()),
	anchorText: v.optional(v.string()),
	projectId: v.optional(v.string()),
	notes: v.optional(v.string()),
	extractedLinks: v.optional(v.string()),
	articleType: v.optional(v.picklist(['gdrive', 'press-article', 'seo-article'])),
	gdriveUrl: v.optional(v.string())
});

/** Schema for partial updates - all fields optional except seoLinkId */
const updateSeoLinkSchema = v.object({
	seoLinkId: v.pipe(v.string(), v.minLength(1)),
	clientId: v.optional(v.pipe(v.string(), v.minLength(1))),
	websiteId: v.optional(v.nullable(v.string())),
	pressTrust: v.optional(v.string()),
	month: v.optional(v.pipe(v.string(), v.minLength(1))),
	keyword: v.optional(v.pipe(v.string(), v.minLength(1))),
	linkType: v.optional(v.picklist(['article', 'guest-post', 'press-release', 'directory', 'other'])),
	linkAttribute: v.optional(v.picklist(['dofollow', 'nofollow'])),
	status: v.optional(v.picklist(['pending', 'submitted', 'published', 'rejected'])),
	articleUrl: v.optional(v.pipe(v.string(), v.minLength(1))),
	articlePublishedAt: v.optional(v.nullable(v.string())),
	targetUrl: v.optional(v.string()),
	price: v.optional(v.nullable(v.number())),
	currency: v.optional(v.string()),
	anchorText: v.optional(v.string()),
	projectId: v.optional(v.string()),
	notes: v.optional(v.string()),
	extractedLinks: v.optional(v.nullable(v.string())),
	articleType: v.optional(v.nullable(v.picklist(['gdrive', 'press-article', 'seo-article']))),
	gdriveUrl: v.optional(v.nullable(v.string()))
});

export const getSeoLinks = query(
	v.object({
		clientId: v.optional(v.string()),
		clientIds: v.optional(v.array(v.string())),
		websiteId: v.optional(v.string()),
		month: v.optional(v.string()),
		status: v.optional(v.string()),
		checkStatus: v.optional(v.string()), // 'ok' | 'problem' | 'never'
		linkType: v.optional(v.string()),    // 'article' | 'guest-post' | 'press-release' | 'directory' | 'other'
		linkAttribute: v.optional(v.string()), // 'dofollow' | 'nofollow'
		pressTrust: v.optional(v.string()),  // partial match pe platforma de presă
		search: v.optional(v.string())       // căutare în keyword, anchorText, articleUrl
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.seoLink.tenantId, event.locals.tenant.id);

		// Client portal: force filter by client
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(conditions, eq(table.seoLink.clientId, event.locals.client.id)) as typeof conditions;
		} else if (filters.clientIds && filters.clientIds.length > 0) {
			conditions = and(conditions, inArray(table.seoLink.clientId, filters.clientIds)) as typeof conditions;
		} else if (filters.clientId) {
			conditions = and(conditions, eq(table.seoLink.clientId, filters.clientId)) as typeof conditions;
		}
		// Filtru după website
		if (filters.websiteId) {
			conditions = and(conditions, eq(table.seoLink.websiteId, filters.websiteId)) as typeof conditions;
		}
		// Filtru după data publicării - articlePublishedAt sau month (fallback)
		if (filters.month) {
			const monthPrefix = filters.month + '%';
			conditions = and(
				conditions,
				or(
					and(isNotNull(table.seoLink.articlePublishedAt), like(table.seoLink.articlePublishedAt, monthPrefix)),
					and(isNull(table.seoLink.articlePublishedAt), eq(table.seoLink.month, filters.month))
				)!
			) as typeof conditions;
		}
		if (filters.status) {
			conditions = and(conditions, eq(table.seoLink.status, filters.status)) as typeof conditions;
		}
		if (filters.checkStatus === 'problem') {
			conditions = and(
				conditions,
				or(
					eq(table.seoLink.lastCheckStatus, 'unreachable'),
					eq(table.seoLink.lastCheckStatus, 'timeout'),
					eq(table.seoLink.lastCheckStatus, 'error')
				)!
			) as typeof conditions;
		} else if (filters.checkStatus === 'never') {
			conditions = and(conditions, isNull(table.seoLink.lastCheckedAt)) as typeof conditions;
		} else if (filters.checkStatus === 'ok') {
			conditions = and(conditions, eq(table.seoLink.lastCheckStatus, 'ok')) as typeof conditions;
		}
		// Filtru tip link
		if (filters.linkType) {
			conditions = and(conditions, eq(table.seoLink.linkType, filters.linkType)) as typeof conditions;
		}
		// Filtru dofollow/nofollow
		if (filters.linkAttribute) {
			conditions = and(conditions, eq(table.seoLink.linkAttribute, filters.linkAttribute)) as typeof conditions;
		}
		// Filtru platformă presă (partial match, case-insensitive via LIKE)
		if (filters.pressTrust?.trim()) {
			conditions = and(conditions, like(table.seoLink.pressTrust, `%${filters.pressTrust.trim()}%`)) as typeof conditions;
		}
		// Căutare text în keyword, anchorText, articleUrl
		if (filters.search?.trim()) {
			const s = `%${filters.search.trim()}%`;
			conditions = and(
				conditions,
				or(
					like(table.seoLink.keyword, s),
					like(table.seoLink.anchorText, s),
					like(table.seoLink.articleUrl, s)
				)!
			) as typeof conditions;
		}

		const links = await db
			.select()
			.from(table.seoLink)
			.where(conditions)
			.orderBy(
				asc(sql`CASE WHEN ${table.seoLink.status} = 'pending' THEN 0 ELSE 1 END`),
				desc(table.seoLink.month),
				desc(table.seoLink.createdAt)
			);

		return links;
	}
);

/** Returnează luna (YYYY-MM) a primului articol publicat pentru un client, fără filtru de lună.
 * Folosește articlePublishedAt; dacă lipsește, folosește câmpul month ca fallback. */
export const getFirstPublishedMonthForClient = query(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const conditions = and(
			eq(table.seoLink.tenantId, event.locals.tenant.id),
			eq(table.seoLink.clientId, clientId)
		);

		const links = await db
			.select({
				articlePublishedAt: table.seoLink.articlePublishedAt,
				month: table.seoLink.month
			})
			.from(table.seoLink)
			.where(conditions);

		const months: string[] = [];
		for (const l of links) {
			if (l.articlePublishedAt) months.push(l.articlePublishedAt.slice(0, 7));
			else if (l.month) months.push(l.month);
		}
		if (months.length === 0) return null;

		return months.reduce((a, b) => (a < b ? a : b));
	}
);

export const createSeoLink = command(seoLinkSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';

	const seoLinkId = generateSeoLinkId();

	// Auto-assign websiteId dacă avem targetUrl dar nu websiteId
	let resolvedWebsiteId = data.websiteId || null;
	if (!resolvedWebsiteId && data.targetUrl) {
		const websites = await db
			.select()
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.clientId, data.clientId));
		const targetDomain = extractDomainFromUrl(data.targetUrl);
		if (targetDomain) {
			const match = websites.find((w) => extractDomainFromUrl(w.url) === targetDomain);
			if (match) resolvedWebsiteId = match.id;
		}
	}

	await db.insert(table.seoLink).values({
		id: seoLinkId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		websiteId: resolvedWebsiteId,
		pressTrust: data.pressTrust || null,
		month: data.month,
		keyword: data.keyword,
		linkType: data.linkType || null,
		linkAttribute: data.linkAttribute || 'dofollow',
		status: data.status || 'pending',
		articleUrl: data.articleUrl || '',
		articlePublishedAt: data.articlePublishedAt || null,
		targetUrl: data.targetUrl || null,
		price: data.price != null ? Math.round(data.price * 100) : null,
		currency,
		anchorText: data.anchorText || null,
		projectId: data.projectId || null,
		notes: data.notes || null,
		extractedLinks: data.extractedLinks || null,
		articleType: data.articleType || null,
		gdriveUrl: data.articleType === 'gdrive' ? (data.gdriveUrl || null) : null
	});

	return { success: true, seoLinkId };
});

const createSeoLinksBulkSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1, 'Client is required')),
	websiteId: v.optional(v.string()),
	pressTrust: v.optional(v.string()),
	month: v.pipe(v.string(), v.minLength(1, 'Luna este obligatorie')),
	keyword: v.pipe(v.string(), v.minLength(1, 'Cuvântul cheie este obligatoriu')),
	linkType: v.optional(v.picklist(['article', 'guest-post', 'press-release', 'directory', 'other'])),
	linkAttribute: v.optional(v.picklist(['dofollow', 'nofollow'])),
	status: v.optional(v.picklist(['pending', 'submitted', 'published', 'rejected'])),
	articleUrls: v.pipe(
		v.array(v.pipe(v.string(), v.minLength(1))),
		v.minLength(1, 'Introduceți cel puțin un URL articol')
	),
	targetUrl: v.optional(v.string()),
	articlePublishedAt: v.optional(v.string()),
	price: v.optional(v.number()),
	currency: v.optional(v.string()),
	anchorText: v.optional(v.string()),
	projectId: v.optional(v.string()),
	notes: v.optional(v.string())
});

export const createSeoLinksBulk = command(createSeoLinksBulkSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';

	// Auto-assign websiteId dacă avem targetUrl dar nu websiteId
	let resolvedWebsiteId = data.websiteId || null;
	if (!resolvedWebsiteId && data.targetUrl) {
		const websites = await db
			.select()
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.clientId, data.clientId));
		const targetDomain = extractDomainFromUrl(data.targetUrl);
		if (targetDomain) {
			const match = websites.find((w) => extractDomainFromUrl(w.url) === targetDomain);
			if (match) resolvedWebsiteId = match.id;
		}
	}

	const values = data.articleUrls.map((articleUrl) => ({
		id: generateSeoLinkId(),
		tenantId: event.locals.tenant!.id,
		clientId: data.clientId,
		websiteId: resolvedWebsiteId,
		pressTrust: data.pressTrust || null,
		month: data.month,
		keyword: data.keyword,
		linkType: data.linkType || null,
		linkAttribute: data.linkAttribute || 'dofollow',
		status: data.status || 'pending',
		articleUrl,
		articlePublishedAt: data.articlePublishedAt || null,
		targetUrl: data.targetUrl || null,
		price: data.price != null ? Math.round(data.price * 100) : null,
		currency,
		anchorText: data.anchorText || null,
		projectId: data.projectId || null,
		notes: data.notes || null
	}));

	await db.insert(table.seoLink).values(values);

	return { success: true, created: values.length, seoLinkIds: values.map((v) => v.id) };
});

export const getSeoLink = query(
	v.pipe(v.string(), v.minLength(1)),
	async (seoLinkId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [link] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!link) {
			throw new Error('Link SEO nu a fost găsit');
		}

		return link;
	}
);

export const updateSeoLink = command(updateSeoLinkSchema,
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { seoLinkId, ...updateData } = data;

		const [existing] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Link SEO nu a fost găsit');
		}

		await db
			.update(table.seoLink)
			.set({
				clientId: updateData.clientId ?? existing.clientId,
				websiteId: updateData.websiteId !== undefined ? updateData.websiteId : existing.websiteId,
				pressTrust: updateData.pressTrust !== undefined ? updateData.pressTrust : existing.pressTrust,
				month: updateData.month ?? existing.month,
				keyword: updateData.keyword ?? existing.keyword,
				linkType: updateData.linkType !== undefined ? updateData.linkType : existing.linkType,
				linkAttribute: updateData.linkAttribute ?? existing.linkAttribute,
				status: updateData.status ?? existing.status,
				articleUrl: updateData.articleUrl ?? existing.articleUrl,
				articlePublishedAt:
					updateData.articlePublishedAt !== undefined ? updateData.articlePublishedAt || null : existing.articlePublishedAt,
				targetUrl: updateData.targetUrl !== undefined ? updateData.targetUrl || null : existing.targetUrl,
				price:
					updateData.price !== undefined
						? updateData.price != null
							? Math.round(updateData.price * 100)
							: null
						: existing.price,
				currency: updateData.currency ?? existing.currency,
				anchorText:
					updateData.anchorText !== undefined ? updateData.anchorText : existing.anchorText,
				projectId: updateData.projectId !== undefined ? updateData.projectId : existing.projectId,
				notes: updateData.notes !== undefined ? updateData.notes : existing.notes,
				extractedLinks: updateData.extractedLinks !== undefined ? updateData.extractedLinks || null : existing.extractedLinks,
				articleType: updateData.articleType !== undefined ? updateData.articleType || null : existing.articleType,
				gdriveUrl: updateData.articleType !== undefined
					? (updateData.articleType === 'gdrive' ? (updateData.gdriveUrl || null) : null)
					: (updateData.gdriveUrl !== undefined ? updateData.gdriveUrl : existing.gdriveUrl),
				updatedAt: new Date()
			})
			.where(eq(table.seoLink.id, seoLinkId));

		// Cleanup marketing material when articleType changes away from press/seo
		const newArticleType = updateData.articleType !== undefined ? updateData.articleType : existing.articleType;
		const oldArticleType = existing.articleType;
		const wasMarketingType = oldArticleType === 'press-article' || oldArticleType === 'seo-article';
		const isStillMarketingType = newArticleType === 'press-article' || newArticleType === 'seo-article';

		if (wasMarketingType && !isStillMarketingType) {
			await db.delete(table.marketingMaterial)
				.where(eq(table.marketingMaterial.seoLinkId, seoLinkId));
		}

		return { success: true };
	}
);

export const deleteSeoLink = command(
	v.pipe(v.string(), v.minLength(1)),
	async (seoLinkId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [existing] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Link SEO nu a fost găsit');
		}

		await db.delete(table.seoLink).where(eq(table.seoLink.id, seoLinkId));

		return { success: true };
	}
);

export const deleteSeoLinksBulk = command(
	v.array(v.pipe(v.string(), v.minLength(1))),
	async (ids) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		if (ids.length === 0) return { deleted: 0 };

		await db.delete(table.seoLink).where(
			and(
				inArray(table.seoLink.id, ids),
				eq(table.seoLink.tenantId, event.locals.tenant.id)
			)
		);

		return { deleted: ids.length };
	}
);

const EXTRACT_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const EXTRACT_HEADERS: Record<string, string> = {
	'User-Agent': EXTRACT_USER_AGENT,
	'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
	'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
	'Accept-Encoding': 'gzip, deflate, br',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'none',
	'Sec-Fetch-User': '?1',
	'Upgrade-Insecure-Requests': '1',
	'Cache-Control': 'max-age=0',
	'Connection': 'keep-alive'
};

/** Fetch article HTML with automatic Cloudflare bypass fallback. */
async function fetchArticleHtml(url: string, opts?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<string> {
	const { html } = await fetchWithCloudflareFallback(url, {
		headers: opts?.headers ?? EXTRACT_HEADERS,
		timeoutMs: opts?.timeoutMs ?? 15000
	});
	return html;
}

function extractDomainFromUrl(url: string): string {
	try {
		const u = new URL(url.startsWith('http') ? url : `https://${url}`);
		return u.hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase() || '';
	}
}

/** Verifică dacă href aparține root-ului (domeniu + orice subdomeniu/pagină) */
function hrefBelongsToRoot(href: string, rootDomain: string): boolean {
	try {
		if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:'))
			return false;
		const full = href.startsWith('http') ? href : href.startsWith('//') ? `https:${href}` : null;
		if (!full) return false;
		const u = new URL(full);
		const host = u.hostname.toLowerCase();
		const root = rootDomain.replace(/^www\./, '').toLowerCase();
		return host === root || host === 'www.' + root || host.endsWith('.' + root);
	} catch {
		return false;
	}
}

function normalizeHref(href: string): string {
	if (href.startsWith('http')) return href;
	if (href.startsWith('//')) return `https:${href}`;
	return `https://${href}`;
}

interface ExtractedLink {
	url: string;
	anchorText: string;
}

/** Extrage textul vizibil din HTML (elimină tag-uri, colapsează spații) */
function extractVisibleText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Extrage toate linkurile către root (domeniu + subdomenii + pagini) și returnează cel mai specific */
function extractLinksToRootFromHtml(html: string, rootDomain: string): ExtractedLink[] {
	const results: ExtractedLink[] = [];
	// href poate fi oriunde în tag, conținut poate avea tag-uri nested (ex: <strong>LiveJasmin</strong>)
	const linkRegex = /<a\s[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
	let match: RegExpExecArray | null;
	while ((match = linkRegex.exec(html)) !== null) {
		const href = match[1];
		const inner = match[2];
		if (href && hrefBelongsToRoot(href, rootDomain)) {
			results.push({
				url: normalizeHref(href),
				anchorText: extractVisibleText(inner)
			});
		}
	}
	// Fallback: linkuri cu conținut simplu (fără tag-uri nested)
	if (results.length === 0) {
		const altRegex = /<a[^>]+href=["']([^"']*)["'][^>]*>([^<]+)<\/a\s*>/gi;
		let altMatch: RegExpExecArray | null;
		while ((altMatch = altRegex.exec(html)) !== null) {
			const href = altMatch[1];
			if (href && hrefBelongsToRoot(href, rootDomain)) {
				results.push({
					url: normalizeHref(href),
					anchorText: altMatch[2].replace(/\s+/g, ' ').trim()
				});
			}
		}
	}
	return results;
}

/** Alege cel mai specific URL și cuvântul cheie - preferă linkuri cu anchor text semnificativ */
function pickBestTargetUrl(links: ExtractedLink[]): { url: string; keyword: string } {
	if (links.length === 0) return { url: '', keyword: '' };
	const hasGoodAnchor = (l: ExtractedLink) =>
		l.anchorText && l.anchorText.length > 2 && l.anchorText.length < 200;
	// Preferă linkuri cu anchor text semnificativ (ex: "LiveJasmin" în <a><strong>LiveJasmin</strong></a>)
	const withKeyword = links.filter(hasGoodAnchor);
	const toSort = withKeyword.length > 0 ? withKeyword : links;
	const sorted = [...toSort].sort((a, b) => {
		try {
			const pathA = new URL(a.url).pathname.length;
			const pathB = new URL(b.url).pathname.length;
			return pathB - pathA;
		} catch {
			return 0;
		}
	});
	const best = sorted[0];
	const keyword = hasGoodAnchor(best)
		? best.anchorText
		: sorted.find(hasGoodAnchor)?.anchorText || '';
	return { url: best.url, keyword };
}

function extractPressTrustFromUrl(articleUrl: string): string {
	try {
		const host = new URL(articleUrl).hostname.replace(/^www\./, '');
		const base = host.split('.')[0] || '';
		if (base.length <= 3) return base.toUpperCase();
		return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
	} catch {
		return '';
	}
}

/** Extrage data publicării articolului din HTML (meta tags, time, JSON-LD) */
function extractArticlePublishedDate(html: string): string | null {
	// 1. Meta article:published_time / og:published_time
	const metaMatch = html.match(
		/<meta[^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["'][^>]*content=["']([^"']+)["']/i
	) || html.match(
		/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["']/i
	);
	if (metaMatch?.[1]) {
		const d = parseDateToIso(metaMatch[1]);
		if (d) return d;
	}
	// 2. <time datetime="...">
	const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
	if (timeMatch?.[1]) {
		const d = parseDateToIso(timeMatch[1]);
		if (d) return d;
	}
	// 3. JSON-LD datePublished
	const jsonLdMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
	if (jsonLdMatch?.[1]) {
		const d = parseDateToIso(jsonLdMatch[1]);
		if (d) return d;
	}
	// 4. Meta dc.date / publication
	const dcMatch = html.match(/<meta[^>]*(?:name|property)=["'](?:dc\.date|date|publication_date)["'][^>]*content=["']([^"']+)["']/i)
		|| html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:dc\.date|date)["']/i);
	if (dcMatch?.[1]) {
		const d = parseDateToIso(dcMatch[1]);
		if (d) return d;
	}
	// 5. <dt>Publicat</dt><dd>...</dd> (pattern CMS românesc)
	const dtPublicatMatch = html.match(/<dt[^>]*>\s*Publicat\s*<\/dt>\s*<dd[^>]*>([^<]+)/i);
	if (dtPublicatMatch?.[1]) {
		const raw = dtPublicatMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	// 6. <dt>Modificat</dt><dd>...</dd> (fallback când nu există dată publicare)
	const dtModificatMatch = html.match(/<dt[^>]*>\s*Modific[aă]t\s*<\/dt>\s*<dd[^>]*>([^<]+)/i);
	if (dtModificatMatch?.[1]) {
		const raw = dtModificatMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	// 7. Elemente cu class date/time/posted ce conțin text cu dată
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

function parseDateToIso(val: string): string | null {
	try {
		const d = new Date(val);
		if (isNaN(d.getTime())) return null;
		return d.toISOString().slice(0, 19) + 'Z';
	} catch {
		return null;
	}
}

/** Parsează o dată relativă în română ("acum 3 ani si 1 luna", "acum 2 luni" etc.) */
function parseRomanianRelativeDate(val: string): string | null {
	const s = val.trim();
	const now = new Date();

	// "acum X ani si/și Y luni/luna/lună"
	const m1 = s.match(/acum\s+(\d+)\s+ani?\s+(?:si|și)\s+(\d+)\s+lun[aăi]/i);
	if (m1) {
		const d = new Date(now);
		d.setFullYear(d.getFullYear() - parseInt(m1[1]));
		d.setMonth(d.getMonth() - parseInt(m1[2]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X ani"
	const m2 = s.match(/acum\s+(\d+)\s+ani?(?:\s|$)/i);
	if (m2) {
		const d = new Date(now);
		d.setFullYear(d.getFullYear() - parseInt(m2[1]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X luni/luna/lună"
	const m3 = s.match(/acum\s+(\d+)\s+lun[aăi]/i);
	if (m3) {
		const d = new Date(now);
		d.setMonth(d.getMonth() - parseInt(m3[1]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X săptămâni/saptamani"
	const m4 = s.match(/acum\s+(\d+)\s+s[aă]pt[aă]m[aâ]ni?/i);
	if (m4) {
		const d = new Date(now);
		d.setDate(d.getDate() - parseInt(m4[1]) * 7);
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X zile"
	const m5 = s.match(/acum\s+(\d+)\s+zile?/i);
	if (m5) {
		const d = new Date(now);
		d.setDate(d.getDate() - parseInt(m5[1]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum o zi"
	if (/acum\s+o\s+zi/i.test(s)) {
		const d = new Date(now);
		d.setDate(d.getDate() - 1);
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	return null;
}

/** Parsează o dată absolută în română ("25 mai 2023", "mai 2023", "25.05.2023") */
function parseRomanianAbsoluteDate(val: string): string | null {
	const MONTHS: Record<string, number> = {
		ian: 1, feb: 2, mar: 3, apr: 4, mai: 5, iun: 6,
		iul: 7, aug: 8, sep: 9, oct: 10, noi: 11, dec: 12
	};
	const MON_PAT =
		'(ian(?:uarie)?|feb(?:ruarie)?|mar(?:tie)?|apr(?:ilie)?|mai|iun(?:ie)?|iul(?:ie)?|aug(?:ust)?|sep(?:tembrie)?|oct(?:ombrie)?|noi(?:embrie)?|dec(?:embrie)?)';

	// "25 mai 2023" / "25 mai, 2023"
	const m1 = val.match(new RegExp(`(\\d{1,2})\\s+${MON_PAT}[.,]?\\s*(\\d{4})`, 'i'));
	if (m1) {
		const key = m1[2].toLowerCase().slice(0, 3);
		const month = MONTHS[key];
		if (month) {
			const d = new Date(parseInt(m1[3]), month - 1, parseInt(m1[1]));
			return d.toISOString().slice(0, 10) + 'T00:00:00Z';
		}
	}
	// "mai 2023" (lună + an)
	const m2 = val.match(new RegExp(`${MON_PAT}\\s+(\\d{4})`, 'i'));
	if (m2) {
		const key = m2[1].toLowerCase().slice(0, 3);
		const month = MONTHS[key];
		if (month) {
			const d = new Date(parseInt(m2[2]), month - 1, 1);
			return d.toISOString().slice(0, 10) + 'T00:00:00Z';
		}
	}
	return null;
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export const extractSeoLinkData = command(
	v.object({
		articleUrl: v.pipe(v.string(), v.minLength(1)),
		clientUrl: v.optional(v.string()),
		websiteId: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			svelteError(401, 'Unauthorized');
		}

		// Determină clientUrl din websiteId dacă e furnizat
		let resolvedClientUrl = data.clientUrl || '';
		if (data.websiteId) {
			const [website] = await db
				.select()
				.from(table.clientWebsite)
				.where(
					and(
						eq(table.clientWebsite.id, data.websiteId),
						eq(table.clientWebsite.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);
			if (website) resolvedClientUrl = website.url;
		}

		if (!resolvedClientUrl) {
			svelteError(400, 'Furnizați un URL de client sau un websiteId valid');
		}

		const clientDomain = extractDomainFromUrl(resolvedClientUrl);
		if (!clientDomain) {
			svelteError(400, 'URL client invalid');
		}

		let html: string;
		try {
			html = await fetchArticleHtml(data.articleUrl);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Nu s-a putut încărca articolul';
			console.error(`[SEO] fetchArticleHtml failed for ${data.articleUrl}:`, msg);
			svelteError(502, `Eroare la încărcarea articolului: ${msg}`);
		}

		const links = extractLinksToRootFromHtml(html, clientDomain);
		const { url: extractedTargetUrl, keyword: extractedKeyword } = pickBestTargetUrl(links);
		const keyword = extractedKeyword;
		const anchorText = extractedKeyword;

		const pressTrust = extractPressTrustFromUrl(data.articleUrl);
		const linkType = 'article';
		const articlePublishedAt = extractArticlePublishedDate(html);

		// Deduplicate links by URL
		const seen = new Set<string>();
		const allLinks = links
			.filter((l) => {
				const key = l.url.toLowerCase().replace(/\/$/, '');
				if (seen.has(key)) return false;
				seen.add(key);
				return l.anchorText && l.anchorText.length > 1;
			})
			.map((l) => ({ url: l.url, keyword: l.anchorText }));

		return {
			keyword: keyword || '',
			anchorText: anchorText || keyword,
			pressTrust,
			linkType,
			targetUrl: extractedTargetUrl || (resolvedClientUrl.startsWith('http') ? resolvedClientUrl : `https://${resolvedClientUrl}`),
			articlePublishedAt: articlePublishedAt || undefined,
			allLinks: allLinks.length > 1 ? allLinks : undefined
		};
	}
);

function inferClientDomainFromName(name: string): string {
	const n = name.trim();
	if (!n) return '';
	if (/\.(ro|com|net|org|eu)\b/i.test(n)) {
		const match = n.match(/([a-z0-9-]+\.[a-z]{2,})/i);
		return match ? match[1].toLowerCase() : '';
	}
	return `${n.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9-]/g, '')}.ro`;
}

export const extractTargetUrlForSeoLink = command(
	v.pipe(v.string(), v.minLength(1)),
	async (seoLinkId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [link] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!link) {
			throw new Error('Link SEO nu a fost găsit');
		}

		const [clientRow] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, link.clientId))
			.limit(1);

		if (!clientRow) {
			throw new Error('Clientul nu a fost găsit');
		}

		const clientDomain = clientRow.website
			? extractDomainFromUrl(clientRow.website)
			: inferClientDomainFromName(clientRow.name);

		if (!clientDomain) {
			throw new Error('Adăugați website-ul clientului (ex: glemis.ro) în profilul clientului');
		}

		let html: string;
		try {
			html = await fetchArticleHtml(link.articleUrl);
		} catch (e) {
			throw new Error(
				e instanceof Error ? e.message : 'Nu s-a putut încărca articolul. Verificați URL-ul.'
			);
		}

		const links = extractLinksToRootFromHtml(html, clientDomain);
		const { url: extractedTargetUrl, keyword: extractedKeyword } = pickBestTargetUrl(links);
		const articlePublishedAt = extractArticlePublishedDate(html);

		if (!extractedTargetUrl) {
			throw new Error(`Nu s-a găsit niciun link către ${clientDomain} în articol`);
		}

		await db
			.update(table.seoLink)
			.set({
				targetUrl: extractedTargetUrl,
				...(extractedKeyword && {
					keyword: extractedKeyword,
					anchorText: extractedKeyword
				}),
				...(articlePublishedAt && { articlePublishedAt }),
				updatedAt: new Date()
			})
			.where(eq(table.seoLink.id, seoLinkId));

		return { success: true, targetUrl: extractedTargetUrl, keyword: extractedKeyword, articlePublishedAt };
	}
);

const extractTargetUrlBatchSchema = v.object({
	clientId: v.optional(v.string()),
	month: v.optional(v.string()),
	seoLinkIds: v.optional(v.array(v.string()))
});

export const extractTargetUrlBatch = command(extractTargetUrlBatchSchema, async (filters) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Când seoLinkIds e setat (selectare explicită), procesăm doar acele linkuri – ca la Verifică
	const hasExplicitSelection = (filters.seoLinkIds?.length ?? 0) > 0;
	let conditions: ReturnType<typeof and>;
	if (hasExplicitSelection) {
		conditions = and(
			eq(table.seoLink.tenantId, event.locals.tenant.id),
			inArray(table.seoLink.id, filters.seoLinkIds!)
		) as ReturnType<typeof and>;
	} else {
		conditions = and(
			eq(table.seoLink.tenantId, event.locals.tenant.id),
			isNull(table.seoLink.targetUrl)
		) as ReturnType<typeof and>;
		if (filters.clientId) {
			conditions = and(conditions, eq(table.seoLink.clientId, filters.clientId)) as typeof conditions;
		}
		// Filtru după data publicării — articlePublishedAt dacă există, altfel câmpul month
		if (filters.month) {
			const monthPrefix = filters.month + '%';
			conditions = and(
				conditions,
				or(
					and(isNotNull(table.seoLink.articlePublishedAt), like(table.seoLink.articlePublishedAt, monthPrefix)),
					and(isNull(table.seoLink.articlePublishedAt), eq(table.seoLink.month, filters.month))
				)!
			) as typeof conditions;
		}
	}

	const links = await db
		.select()
		.from(table.seoLink)
		.where(conditions);

	const results: { id: string; targetUrl: string }[] = [];
	const errors: { id: string; error: string }[] = [];

	for (let i = 0; i < links.length; i++) {
		if (i > 0) {
			await new Promise((r) => setTimeout(r, 800));
		}
		const link = links[i];
		try {
			const [clientRow] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, link.clientId))
				.limit(1);

			if (!clientRow) {
				errors.push({ id: link.id, error: 'Clientul nu a fost găsit' });
				continue;
			}

			// Determină domeniul clientului: targetUrl > websiteId > client.website > infer din nume
			let clientDomain = '';
			if (link.targetUrl) {
				clientDomain = extractDomainFromUrl(link.targetUrl);
			}
			if (!clientDomain && link.websiteId) {
				const [website] = await db
					.select()
					.from(table.clientWebsite)
					.where(eq(table.clientWebsite.id, link.websiteId))
					.limit(1);
				if (website) clientDomain = extractDomainFromUrl(website.url);
			}
			if (!clientDomain && clientRow.website) {
				clientDomain = extractDomainFromUrl(clientRow.website);
			}
			if (!clientDomain) {
				clientDomain = inferClientDomainFromName(clientRow.name);
			}

			if (!clientDomain) {
				errors.push({
					id: link.id,
					error: 'Adăugați website-ul clientului (ex: glemis.ro) în profilul clientului'
				});
				continue;
			}

			let html: string;
			try {
				html = await fetchArticleHtml(link.articleUrl);
			} catch (e) {
				errors.push({
					id: link.id,
					error: e instanceof Error ? e.message : 'Nu s-a putut încărca articolul'
				});
				continue;
			}

			const extractedLinks = extractLinksToRootFromHtml(html, clientDomain);
			const { url: extractedTargetUrl, keyword: extractedKeyword } = pickBestTargetUrl(extractedLinks);
			const articlePublishedAt = extractArticlePublishedDate(html);

			if (!extractedTargetUrl && !extractedKeyword) {
				errors.push({ id: link.id, error: `Nu s-a găsit link către ${clientDomain} în articol` });
				continue;
			}

			const updates: Record<string, unknown> = { updatedAt: new Date() };
			if (extractedTargetUrl) updates.targetUrl = extractedTargetUrl;
			if (extractedKeyword) {
				updates.keyword = extractedKeyword;
				updates.anchorText = extractedKeyword;
			}
			if (articlePublishedAt) updates.articlePublishedAt = articlePublishedAt;
			// Extrage pressTrust dacă lipsește
			if (!link.pressTrust) {
				const pressTrust = extractPressTrustFromUrl(link.articleUrl);
				if (pressTrust) updates.pressTrust = pressTrust;
			}

			await db
				.update(table.seoLink)
				.set(updates)
				.where(eq(table.seoLink.id, link.id));

			results.push({ id: link.id, targetUrl: extractedTargetUrl || link.targetUrl || '' });
		} catch (e) {
			errors.push({
				id: link.id,
				error: e instanceof Error ? e.message : 'Eroare neașteptată'
			});
		}
	}

	return { success: true, extracted: results.length, failed: errors.length, errors };
});

const LINK_CHECK_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const LINK_CHECK_HEADERS: Record<string, string> = {
	'User-Agent': LINK_CHECK_USER_AGENT,
	'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
	'Accept-Encoding': 'gzip, deflate, br',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'none',
	'Upgrade-Insecure-Requests': '1',
	'Connection': 'keep-alive'
};

/** Extrage atributul dofollow/nofollow dintr-un HTML deja încărcat. */
function extractDofollowFromHtml(
	html: string,
	targetUrl: string,
	articleUrl: string
): 'dofollow' | 'nofollow' | null {
	// Parse target URL for proper domain+path matching
	let targetHost: string;
	let targetPath: string;
	try {
		const tUrl = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
		targetHost = tUrl.hostname.replace(/^www\./, '').toLowerCase();
		targetPath = tUrl.pathname.replace(/\/+$/, '').toLowerCase();
	} catch {
		targetHost = targetUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.toLowerCase() || '';
		targetPath = '';
	}

	const linkRegex = /<a\s+([^>]*)>/gi;
	let m: RegExpExecArray | null;
	while ((m = linkRegex.exec(html)) !== null) {
		const attrs = m[1];
		const hrefM = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
		if (!hrefM) continue;
		let href = hrefM[1].trim();
		if (href.startsWith('//')) href = 'https:' + href;
		else if (href.startsWith('/')) {
			try {
				const base = new URL(articleUrl);
				href = base.origin + href;
			} catch { continue; }
		} else if (!href.startsWith('http')) {
			try {
				href = new URL(href, articleUrl).href;
			} catch { continue; }
		}

		// Proper domain matching instead of loose includes()
		let hrefHost: string;
		let hrefPath: string;
		try {
			const hUrl = new URL(href);
			hrefHost = hUrl.hostname.replace(/^www\./, '').toLowerCase();
			hrefPath = hUrl.pathname.replace(/\/+$/, '').toLowerCase();
		} catch { continue; }

		const domainMatch = hrefHost === targetHost || hrefHost.endsWith('.' + targetHost);
		if (!domainMatch) continue;
		if (targetPath && targetPath !== '/' && !hrefPath.startsWith(targetPath)) continue;

		const relM = attrs.match(/rel\s*=\s*["']([^"']*)["']/i);
		const rel = (relM ? relM[1] : '').toLowerCase();
		return rel.includes('nofollow') ? 'nofollow' : 'dofollow';
	}
	return null;
}

/** Verifică dacă linkul către targetUrl din articol are rel="nofollow". Returnează 'dofollow'|'nofollow' sau null dacă nu s-a găsit. */
async function verifyDofollowFromPage(
	articleUrl: string,
	targetUrl: string
): Promise<'dofollow' | 'nofollow' | null> {
	try {
		const html = await fetchArticleHtml(articleUrl, { headers: LINK_CHECK_HEADERS });
		const result = extractDofollowFromHtml(html, targetUrl, articleUrl);
		console.log(`[SEO-CHECK] verifyDofollow ${articleUrl} → ${targetUrl}: ${result}`);
		return result;
	} catch (e) {
		console.warn(`[SEO-CHECK] verifyDofollow failed for ${articleUrl}:`, e instanceof Error ? e.message : e);
		return null;
	}
}

async function performLinkCheck(articleUrl: string): Promise<{
	status: 'ok' | 'unreachable' | 'timeout' | 'redirect' | 'error';
	httpCode: number | null;
	responseTimeMs: number | null;
	errorMessage: string | null;
	cloudflareSuspected: boolean;
}> {
	const start = Date.now();
	try {
		// Step 1: HEAD with redirect: 'manual' so we detect 3xx codes
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000);
		const res = await fetch(articleUrl, {
			method: 'HEAD',
			redirect: 'manual',
			signal: controller.signal,
			headers: LINK_CHECK_HEADERS
		});
		clearTimeout(timeoutId);
		const responseTimeMs = Date.now() - start;
		const httpCode = res.status;

		console.log(`[SEO-CHECK] HEAD ${articleUrl} → ${httpCode} (${responseTimeMs}ms)`);

		if (httpCode >= 200 && httpCode < 300) {
			return { status: 'ok', httpCode, responseTimeMs, errorMessage: null, cloudflareSuspected: false };
		}
		if (httpCode >= 300 && httpCode < 400) {
			return { status: 'redirect', httpCode, responseTimeMs, errorMessage: null, cloudflareSuspected: false };
		}
		// Detect Cloudflare JS Challenge at HEAD level
		const cfMitigatedHead = res.headers.get('cf-mitigated');
		if (cfMitigatedHead === 'challenge') {
			console.log(`[SEO-CHECK] Cloudflare JS Challenge detected at HEAD for ${articleUrl} — treating as OK`);
			return { status: 'ok', httpCode, responseTimeMs, errorMessage: 'Cloudflare JS Challenge', cloudflareSuspected: true };
		}
		if (httpCode === 404 || httpCode === 410) {
			return { status: 'unreachable', httpCode, responseTimeMs, errorMessage: null, cloudflareSuspected: false };
		}

		// Step 2: HEAD returned non-2xx/non-3xx/non-404 — many sites block HEAD, retry with GET
		console.log(`[SEO-CHECK] HEAD blocked (${httpCode}), retrying with GET: ${articleUrl}`);
		const getController = new AbortController();
		const getTimeoutId = setTimeout(() => getController.abort(), 8000);
		const getRes = await fetch(articleUrl, {
			method: 'GET',
			redirect: 'follow',
			signal: getController.signal,
			headers: LINK_CHECK_HEADERS
		});
		clearTimeout(getTimeoutId);
		const getResponseTimeMs = Date.now() - start;
		const getHttpCode = getRes.status;

		// Detect Cloudflare JS Challenge — site is accessible in browser, just blocks bots
		const cfMitigated = getRes.headers.get('cf-mitigated');
		if (cfMitigated === 'challenge') {
			getRes.body?.cancel();
			console.log(`[SEO-CHECK] Cloudflare JS Challenge detected for ${articleUrl} — treating as OK`);
			return { status: 'ok', httpCode: getHttpCode, responseTimeMs: getResponseTimeMs, errorMessage: 'Cloudflare JS Challenge', cloudflareSuspected: true };
		}

		// Cancel body reading to avoid downloading the entire page
		getRes.body?.cancel();
		console.log(`[SEO-CHECK] GET fallback ${articleUrl} → ${getHttpCode} (${getResponseTimeMs}ms)`);

		if (getHttpCode >= 200 && getHttpCode < 300) {
			return { status: 'ok', httpCode: getHttpCode, responseTimeMs: getResponseTimeMs, errorMessage: null, cloudflareSuspected: false };
		}
		if (getHttpCode === 404 || getHttpCode === 410) {
			return { status: 'unreachable', httpCode: getHttpCode, responseTimeMs: getResponseTimeMs, errorMessage: null, cloudflareSuspected: false };
		}
		return {
			status: 'error',
			httpCode: getHttpCode,
			responseTimeMs: getResponseTimeMs,
			errorMessage: `HTTP ${getHttpCode}`,
			cloudflareSuspected: false
		};
	} catch (e) {
		const responseTimeMs = Date.now() - start;
		const err = e instanceof Error ? e : new Error(String(e));
		const isTimeout = err.name === 'AbortError';
		console.warn(`[SEO-CHECK] ${isTimeout ? 'TIMEOUT' : 'ERROR'} ${articleUrl}: ${err.message}`);
		return {
			status: isTimeout ? 'timeout' : 'error',
			httpCode: null,
			responseTimeMs,
			errorMessage: err.message,
			cloudflareSuspected: false
		};
	}
}

export const checkSeoLink = command(
	v.pipe(v.string(), v.minLength(1)),
	async (seoLinkId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Client users cannot run link checks');
		}

		const [link] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!link) {
			throw new Error('Link SEO nu a fost găsit');
		}

		console.log(`[SEO-CHECK] Checking link ${link.id}: ${link.articleUrl}`);
		const result = await performLinkCheck(link.articleUrl);
		const now = new Date();

		let lastCheckDofollow: 'dofollow' | 'nofollow' | null = null;
		let newArticlePublishedAt: string | null = null;
		let extractedKeyword: string | null = null;
		let extractedTargetUrl: string | null = null;
		let allExtractedLinks: { url: string; keyword: string }[] | null = null;
		const needsKeyword = !link.keyword || link.keyword === '—' || link.keyword === '-';

		// Dacă linkul e accesibil și avem nevoie de HTML (dofollow, dată publicare lipsă, keyword lipsă, sau targetUrl lipsă),
		// facem un singur GET request cu Cloudflare bypass în loc de mai multe separate.
		const needsTargetUrl = !link.targetUrl;
		if (result.status === 'ok' && (link.targetUrl || needsTargetUrl || !link.articlePublishedAt || needsKeyword)) {
			try {
				const html = await fetchArticleHtml(link.articleUrl);
				if (link.targetUrl) {
					lastCheckDofollow = extractDofollowFromHtml(html, link.targetUrl, link.articleUrl);
					console.log(`[SEO-CHECK] Dofollow for ${link.articleUrl} → ${link.targetUrl}: ${lastCheckDofollow}`);
				}
				if (!link.articlePublishedAt) {
					newArticlePublishedAt = extractArticlePublishedDate(html);
				}
				// Extrage toate linkurile + keyword/anchorText/targetUrl dacă lipsesc
				{
					// Determină domeniul clientului
					const [clientRow] = await db
						.select()
						.from(table.client)
						.where(eq(table.client.id, link.clientId))
						.limit(1);
					let clientDomain = '';
					if (link.targetUrl) {
						clientDomain = extractDomainFromUrl(link.targetUrl);
					} else if (link.websiteId) {
						const [website] = await db
							.select()
							.from(table.clientWebsite)
							.where(eq(table.clientWebsite.id, link.websiteId))
							.limit(1);
						if (website) clientDomain = extractDomainFromUrl(website.url);
					}
					if (!clientDomain && clientRow?.website) {
						clientDomain = extractDomainFromUrl(clientRow.website);
					}
					if (!clientDomain && clientRow?.name) {
						clientDomain = inferClientDomainFromName(clientRow.name);
					}
					if (clientDomain) {
						const extractedLinks = extractLinksToRootFromHtml(html, clientDomain);
						const best = pickBestTargetUrl(extractedLinks);
						if (best.keyword && needsKeyword) extractedKeyword = best.keyword;
						if (best.url && !link.targetUrl) extractedTargetUrl = best.url;
						if (extractedKeyword || extractedTargetUrl) {
							console.log(`[SEO-CHECK] Extracted keyword: ${extractedKeyword}, targetUrl: ${extractedTargetUrl}`);
						}
						// Verifică dofollow pe noul targetUrl extras
						if (extractedTargetUrl && !lastCheckDofollow) {
							lastCheckDofollow = extractDofollowFromHtml(html, extractedTargetUrl, link.articleUrl);
							console.log(`[SEO-CHECK] Dofollow for ${link.articleUrl} → ${extractedTargetUrl}: ${lastCheckDofollow}`);
						}
						// Salvează toate linkurile extrase (deduplicate)
						const seen = new Set<string>();
						const deduped = extractedLinks
							.filter((l) => {
								const key = l.url.toLowerCase().replace(/\/$/, '');
								if (seen.has(key)) return false;
								seen.add(key);
								return l.anchorText && l.anchorText.length > 1;
							})
							.map((l) => ({ url: l.url, keyword: l.anchorText }));
						if (deduped.length > 0) {
							allExtractedLinks = deduped;
						}
					}
				}
			} catch (e) {
				console.warn(`[SEO-CHECK] HTML extraction failed for ${link.articleUrl}:`, e instanceof Error ? e.message : e);
			}
		}

		// Don't overwrite richer extractedLinks with fewer results (e.g. non-Puppeteer fetch finding fewer links)
		let finalExtractedLinks = allExtractedLinks;
		if (allExtractedLinks && link.extractedLinks) {
			try {
				const existing = JSON.parse(link.extractedLinks);
				if (Array.isArray(existing) && existing.length > allExtractedLinks.length) {
					finalExtractedLinks = null;
				}
			} catch { /* parse error — overwrite is fine */ }
		}

		// Auto-assign websiteId dacă lipsește dar avem targetUrl
		let extractedWebsiteId: string | null = null;
		const finalTargetUrl = extractedTargetUrl || link.targetUrl;
		if (!link.websiteId && finalTargetUrl) {
			const websites = await db
				.select()
				.from(table.clientWebsite)
				.where(eq(table.clientWebsite.clientId, link.clientId));
			const domain = extractDomainFromUrl(finalTargetUrl);
			if (domain) {
				const match = websites.find((w) => extractDomainFromUrl(w.url) === domain);
				if (match) {
					extractedWebsiteId = match.id;
					console.log(`[SEO-CHECK] Auto-assigned websiteId ${match.id} for ${link.articleUrl}`);
				}
			}
		}

		await db
			.update(table.seoLink)
			.set({
				lastCheckedAt: now,
				lastCheckStatus: result.status,
				lastCheckHttpCode: result.httpCode,
				lastCheckError: result.errorMessage,
				lastCheckDofollow: lastCheckDofollow,
				// Sincronizează linkAttribute (tip dofollow/nofollow) cu rezultatul verificării
				...(lastCheckDofollow && { linkAttribute: lastCheckDofollow }),
				// Actualizează data publicării dacă lipsea și am reușit să o extragem
				...(newArticlePublishedAt && { articlePublishedAt: newArticlePublishedAt }),
				// Actualizează keyword/anchorText dacă lipseau și am reușit să le extragem
				...(extractedKeyword && { keyword: extractedKeyword, anchorText: extractedKeyword }),
				...(extractedTargetUrl && { targetUrl: extractedTargetUrl }),
				...(extractedWebsiteId && { websiteId: extractedWebsiteId }),
				...(finalExtractedLinks && { extractedLinks: JSON.stringify(finalExtractedLinks) }),
				updatedAt: now
			})
			.where(eq(table.seoLink.id, seoLinkId));

		const checkId = generateSeoLinkCheckId();
		await db.insert(table.seoLinkCheck).values({
			id: checkId,
			seoLinkId: link.id,
			checkedAt: now,
			status: result.status,
			httpCode: result.httpCode,
			responseTimeMs: result.responseTimeMs,
			errorMessage: result.errorMessage
		});

		return { success: true, status: result.status, httpCode: result.httpCode };
	}
);

const checkSeoLinksBatchSchema = v.object({
	clientId: v.optional(v.string()),
	month: v.optional(v.string()),
	seoLinkIds: v.optional(v.array(v.string()))
});

export const checkSeoLinksBatch = command(checkSeoLinksBatchSchema, async (filters) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Client users cannot run link checks');
	}

	let conditions = eq(table.seoLink.tenantId, event.locals.tenant.id);
	if (filters.clientId) {
		conditions = and(conditions, eq(table.seoLink.clientId, filters.clientId)) as typeof conditions;
	}
	// Filtru după lună — folosește articlePublishedAt dacă există, altfel câmpul month
	if (filters.month) {
		const monthPrefix = filters.month + '%';
		conditions = and(
			conditions,
			or(
				and(isNotNull(table.seoLink.articlePublishedAt), like(table.seoLink.articlePublishedAt, monthPrefix)),
				and(isNull(table.seoLink.articlePublishedAt), eq(table.seoLink.month, filters.month))
			)!
		) as typeof conditions;
	}
	if (filters.seoLinkIds?.length) {
		conditions = and(conditions, inArray(table.seoLink.id, filters.seoLinkIds)) as typeof conditions;
	}

	const links = await db
		.select()
		.from(table.seoLink)
		.where(conditions);

	console.log(`[SEO-CHECK] Batch check starting: ${links.length} links`);
	const results: { id: string; status: string; httpCode: number | null }[] = [];
	for (let i = 0; i < links.length; i++) {
		if (i > 0) {
			// 3s between requests to avoid rate limiting (429)
			await new Promise((r) => setTimeout(r, 3000));
		}
		const link = links[i];
		console.log(`[SEO-CHECK] Batch ${i + 1}/${links.length}: ${link.articleUrl}`);
		const result = await performLinkCheck(link.articleUrl);
		const now = new Date();

		let lastCheckDofollow: 'dofollow' | 'nofollow' | null = null;
		let batchExtractedLinks: { url: string; keyword: string }[] | null = null;
		let batchExtractedKeyword: string | null = null;
		let batchExtractedTargetUrl: string | null = null;
		let batchArticlePublishedAt: string | null = null;

		if (result.status === 'ok') {
			try {
				const html = await fetchArticleHtml(link.articleUrl);
				if (link.targetUrl) {
					lastCheckDofollow = extractDofollowFromHtml(html, link.targetUrl, link.articleUrl);
				}
				if (!link.articlePublishedAt) {
					batchArticlePublishedAt = extractArticlePublishedDate(html);
				}
				// Extract all links to client domain
				const needsKeyword = !link.keyword || link.keyword === '—' || link.keyword === '-';
				const needsTargetUrl = !link.targetUrl;
				const [clientRow] = await db.select().from(table.client).where(eq(table.client.id, link.clientId)).limit(1);
				let clientDomain = '';
				if (link.targetUrl) clientDomain = extractDomainFromUrl(link.targetUrl);
				else if (link.websiteId) {
					const [w] = await db.select().from(table.clientWebsite).where(eq(table.clientWebsite.id, link.websiteId)).limit(1);
					if (w) clientDomain = extractDomainFromUrl(w.url);
				}
				if (!clientDomain && clientRow?.website) clientDomain = extractDomainFromUrl(clientRow.website);
				if (!clientDomain && clientRow?.name) clientDomain = inferClientDomainFromName(clientRow.name);
				if (clientDomain) {
					const allLinks = extractLinksToRootFromHtml(html, clientDomain);
					const best = pickBestTargetUrl(allLinks);
					if (best.keyword && needsKeyword) batchExtractedKeyword = best.keyword;
					if (best.url && needsTargetUrl) batchExtractedTargetUrl = best.url;
					if (batchExtractedTargetUrl && !lastCheckDofollow) {
						lastCheckDofollow = extractDofollowFromHtml(html, batchExtractedTargetUrl, link.articleUrl);
					}
					// Deduplicate and save all links
					const seen = new Set<string>();
					const deduped = allLinks
						.filter((l) => { const key = l.url.toLowerCase().replace(/\/$/, ''); if (seen.has(key)) return false; seen.add(key); return l.anchorText && l.anchorText.length > 1; })
						.map((l) => ({ url: l.url, keyword: l.anchorText }));
					if (deduped.length > 0) batchExtractedLinks = deduped;
				}
			} catch (e) {
				console.warn(`[SEO-CHECK] Batch HTML extraction failed for ${link.articleUrl}:`, e instanceof Error ? e.message : e);
			}
		}

		// Don't overwrite richer extractedLinks with fewer results
		let finalBatchExtractedLinks = batchExtractedLinks;
		if (batchExtractedLinks && link.extractedLinks) {
			try {
				const existing = JSON.parse(link.extractedLinks);
				if (Array.isArray(existing) && existing.length > batchExtractedLinks.length) {
					finalBatchExtractedLinks = null;
				}
			} catch { /* parse error — overwrite is fine */ }
		}

		// Auto-assign websiteId
		let batchWebsiteId: string | null = null;
		const finalTarget = batchExtractedTargetUrl || link.targetUrl;
		if (!link.websiteId && finalTarget) {
			const websites = await db.select().from(table.clientWebsite).where(eq(table.clientWebsite.clientId, link.clientId));
			const domain = extractDomainFromUrl(finalTarget);
			if (domain) {
				const match = websites.find((w) => extractDomainFromUrl(w.url) === domain);
				if (match) batchWebsiteId = match.id;
			}
		}

		await db
			.update(table.seoLink)
			.set({
				lastCheckedAt: now,
				lastCheckStatus: result.status,
				lastCheckHttpCode: result.httpCode,
				lastCheckError: result.errorMessage,
				lastCheckDofollow: lastCheckDofollow,
				...(lastCheckDofollow && { linkAttribute: lastCheckDofollow }),
				...(batchArticlePublishedAt && { articlePublishedAt: batchArticlePublishedAt }),
				...(batchExtractedKeyword && { keyword: batchExtractedKeyword, anchorText: batchExtractedKeyword }),
				...(batchExtractedTargetUrl && { targetUrl: batchExtractedTargetUrl }),
				...(batchWebsiteId && { websiteId: batchWebsiteId }),
				...(finalBatchExtractedLinks && { extractedLinks: JSON.stringify(finalBatchExtractedLinks) }),
				updatedAt: now
			})
			.where(eq(table.seoLink.id, link.id));

		const checkId = generateSeoLinkCheckId();
		await db.insert(table.seoLinkCheck).values({
			id: checkId,
			seoLinkId: link.id,
			checkedAt: now,
			status: result.status,
			httpCode: result.httpCode,
			responseTimeMs: result.responseTimeMs,
			errorMessage: result.errorMessage
		});

		results.push({ id: link.id, status: result.status, httpCode: result.httpCode });
	}

	const okCount = results.filter((r) => r.status === 'ok' || r.status === 'redirect').length;
	console.log(`[SEO-CHECK] Batch complete: ${results.length} checked, ${okCount} OK, ${results.length - okCount} problems`);
	return { success: true, checked: results.length, results };
});

const MONTH_NAMES: Record<string, string> = {
	ianuarie: '01',
	februarie: '02',
	martie: '03',
	aprilie: '04',
	mai: '05',
	iunie: '06',
	iulie: '07',
	august: '08',
	septembrie: '09',
	octombrie: '10',
	noiembrie: '11',
	decembrie: '12'
};

function parseMonth(value: string): string | null {
	if (!value || typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	// Already YYYY-MM
	if (/^\d{4}-\d{2}$/.test(v)) return v;
	// Month name - use current year
	const monthNum = MONTH_NAMES[v];
	if (monthNum) {
		const year = new Date().getFullYear();
		return `${year}-${monthNum}`;
	}
	return null;
}

function parseStatus(value: string): string {
	if (!value) return 'pending';
	const v = value.trim().toLowerCase();
	if (v.includes('publicat') || v === 'published') return 'published';
	if (v.includes('trimis') || v === 'submitted') return 'submitted';
	if (v.includes('refuzat') || v === 'rejected') return 'rejected';
	return 'pending';
}

function parseLinkAttribute(value: string): string {
	if (!value) return 'dofollow';
	const v = value.trim().toLowerCase();
	if (v.includes('nofollow')) return 'nofollow';
	return 'dofollow';
}

export const importSeoLinksFromFile = command(
	v.object({
		fileData: v.string(),
		fileName: v.string(),
		defaultClientId: v.optional(v.string()) // Când clientul din fișier nu există, folosește acest client
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const base64Data = data.fileData.replace(/^data:.*;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		let rows: Record<string, unknown>[] = [];

		const parseSheet = (sheet: XLSX.WorkSheet, opts?: { header?: number; defval?: string }) => {
			return XLSX.utils.sheet_to_json(sheet, { defval: '', ...opts }) as Record<string, unknown>[];
		};

		const hasValidHeaders = (r: Record<string, unknown>) => {
			const keys = Object.keys(r).filter((k) => k && k.trim());
			if (keys.length === 0 || keys.some((k) => k.startsWith('__EMPTY'))) return false;
			const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
			return keys.some(
				(k) =>
					norm(k).includes('luna') ||
					norm(k).includes('trust') ||
					norm(k).includes('keyword') ||
					norm(k).includes('link') ||
					norm(k).includes('pentru') ||
					norm(k).includes('cuvant')
			);
		};

		const parseFile = (sheet: XLSX.WorkSheet) => {
			rows = parseSheet(sheet);
			if (rows.length > 0 && hasValidHeaders(rows[0])) return;
			for (let h = 1; h <= 5; h++) {
				rows = parseSheet(sheet, { header: h });
				if (rows.length > 0 && hasValidHeaders(rows[0])) return;
			}
			// Folosește litere coloane (A, B, C...) - ignoră header-ul
			rows = parseSheet(sheet, { header: 0 });
		};

		if (data.fileName.match(/\.(xls|xlsx)$/i)) {
			const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
			// Importă TOATE sheet-urile (nu doar primul)
			const allRows: Record<string, unknown>[] = [];
			for (const sheetName of workbook.SheetNames) {
				rows = [];
				parseFile(workbook.Sheets[sheetName]);
				allRows.push(...rows);
			}
			rows = allRows;
		} else if (data.fileName.match(/\.csv$/i)) {
			const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
			const lines = text.split(/\r?\n/).filter((l) => l.trim());
			if (lines.length >= 2) {
				const delim = text.includes(';') ? ';' : text.includes('\t') ? '\t' : ',';
				const parseCsvLine = (line: string): string[] => {
					const result: string[] = [];
					let current = '';
					let inQuotes = false;
					for (let i = 0; i < line.length; i++) {
						const c = line[i];
						if (c === '"') {
							inQuotes = !inQuotes;
						} else if (!inQuotes && c === delim) {
							result.push(current.trim());
							current = '';
						} else {
							current += c;
						}
					}
					result.push(current.trim());
					return result;
				};
				const rawRows = lines.map(parseCsvLine);
				const colCount = Math.max(...rawRows.map((r) => r.length));
				const headers = rawRows[0];
				const hasHeaders = headers.some(
					(h) =>
						/luna|trust|keyword|link|pentru|cuvant/i.test(
							h.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
						)
				);
				const dataStart = hasHeaders ? 1 : 0;
				rows = rawRows.slice(dataStart).map((cells) => {
					const obj: Record<string, unknown> = {};
					for (let i = 0; i < colCount; i++) {
						const h = hasHeaders && headers[i] ? String(headers[i]).trim() : '';
						const key = h || `__EMPTY${i === 0 ? '' : '_' + i}`;
						obj[key] = cells[i] ?? '';
					}
					return obj;
				});
			}
			if (rows.length === 0) {
				const workbook = XLSX.read(text, { type: 'string', raw: true });
				parseFile(workbook.Sheets[workbook.SheetNames[0]]);
			}
		} else {
			throw new Error('Fișier acceptat: Excel (.xlsx, .xls) sau CSV (.csv)');
		}

		if (rows.length === 0) {
			throw new Error('Fișierul nu conține date');
		}

		const clients = await db
			.select()
			.from(table.client)
			.where(eq(table.client.tenantId, event.locals.tenant.id));
		const clientByName = new Map(clients.map((c) => [c.name.toLowerCase().trim(), c.id]));

		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);
		const defaultCurrency = invoiceSettings?.defaultCurrency || 'RON';

		// Construiește harta domain → {clientId, websiteId} pentru auto-detectare
		const allWebsites = await db
			.select()
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.tenantId, event.locals.tenant.id));
		const domainToWebsite = new Map<string, { clientId: string; websiteId: string }>();
		for (const w of allWebsites) {
			const domain = extractDomainFromUrl(w.url);
			if (domain && (!domainToWebsite.has(domain) || w.isDefault)) {
				domainToWebsite.set(domain, { clientId: w.clientId, websiteId: w.id });
			}
		}

		let imported = 0;
		let skipped = 0;
		let autoDetected = 0;

		const normalize = (s: string) =>
			s
				.toLowerCase()
				.trim()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '');

		// Mapare: col 0 gol, Luna(1), NR(2), TRUST(3), PENTRU(4), CUVANT CHEIE(5), LINK(6)=targetUrl, Tip(7), STATUS(8), LINK ARTICOL(9)=articleUrl
		const COL_INDEX_TO_FIELD: Record<number, string> = {
			0: 'empty',
			1: 'month',
			2: 'nr',
			3: 'pressTrust',
			4: 'clientName',
			5: 'keyword',
			6: 'targetUrl',
			7: 'linkAttr',
			8: 'status',
			9: 'articleUrl'
		};
		const COL_LETTER_TO_FIELD: Record<string, string> = {
			A: 'empty',
			B: 'month',
			C: 'nr',
			D: 'pressTrust',
			E: 'clientName',
			F: 'keyword',
			G: 'targetUrl',
			H: 'linkAttr',
			I: 'status',
			J: 'articleUrl'
		};
		const POSITIONAL_MAP: Record<string, string> = {
			__EMPTY: 'empty',
			__EMPTY_1: 'month',
			__EMPTY_2: 'nr',
			__EMPTY_3: 'pressTrust',
			__EMPTY_4: 'clientName',
			__EMPTY_5: 'keyword',
			__EMPTY_6: 'targetUrl',
			__EMPTY_7: 'linkAttr',
			__EMPTY_8: 'status',
			__EMPTY_9: 'articleUrl',
			__EMPTY_10: 'articleUrl2',
			__EMPTY_11: 'articleUrl3'
		};

		const findCol = (row: Record<string, unknown>, possibleNames: string[]) => {
			const rowKeys = Object.keys(row);
			const rowKeysNorm = new Map(rowKeys.map((k) => [normalize(k), k]));
			for (const name of possibleNames) {
				const exact = row[name];
				if (exact != null && String(exact).trim()) return String(exact).trim();
				const norm = normalize(name);
				const found = rowKeysNorm.get(norm) ?? rowKeys.find((k) => normalize(k) === norm);
				if (found) {
					const v = row[found];
					if (v != null && String(v).trim()) return String(v).trim();
				}
			}
			return '';
		};

		const getVal = (row: Record<string, unknown>, field: string) => {
			const keys = Object.keys(row);
			const key = keys.find((k) => POSITIONAL_MAP[k] === field);
			if (key) {
				const v = row[key];
				if (v != null && String(v).trim()) return String(v).trim();
			}
			const colLetter = keys.find((k) => COL_LETTER_TO_FIELD[k] === field);
			if (colLetter) {
				const v = row[colLetter];
				if (v != null && String(v).trim()) return String(v).trim();
			}
			const idx = Object.entries(COL_INDEX_TO_FIELD).find(([, f]) => f === field)?.[0];
			if (idx != null && row[idx] != null) {
				const v = row[idx];
				if (v != null && String(v).trim()) return String(v).trim();
			}
			return '';
		};

		const usePositional =
			rows[0] &&
			(Object.keys(rows[0]).some((k) => k.startsWith('__EMPTY')) ||
				Object.keys(rows[0]).some((k) => /^[A-Z]$/.test(k)) ||
				Object.keys(rows[0]).every((k) => !k || !k.trim()));
		const columnsFound = rows[0] ? Object.keys(rows[0]) : [];

		for (const row of rows) {
			const clientName = usePositional
				? getVal(row, 'clientName')
				: findCol(row, ['PENTRU', 'For', 'Client', 'client', 'pentru']);
			const month = usePositional
				? parseMonth(getVal(row, 'month'))
				: parseMonth(findCol(row, ['Luna', 'Lună', 'Month', 'month', 'luna']));
			const pressTrust = usePositional
				? getVal(row, 'pressTrust')
				: findCol(row, ['TRUST', 'Trust', 'trust', 'PRESS', 'Press']);
			const keyword = usePositional
				? getVal(row, 'keyword')
				: findCol(row, [
						'CUVANT CHEIE',
						'Cuvânt cheie',
						'Cuvant cheie',
						'Keyword',
						'keyword',
						'CUVANT_CHEIE'
					]);
			const articleUrl = usePositional
				? getVal(row, 'articleUrl') ||
					getVal(row, 'articleUrl2') ||
					getVal(row, 'articleUrl3')
				: findCol(row, ['LINK ARTICOL', 'Link articol', 'articleUrl', 'LINK_ARTICOL']);
			const rawLinkCatre = usePositional
				? getVal(row, 'targetUrl')
				: findCol(row, ['LINK CATRE', 'LINK', 'Link', 'targetUrl', 'URL țină']);
			// LINK CATRE poate fi text de ancoră (nu URL) — folosim doar dacă e URL real
			const targetUrl = rawLinkCatre?.startsWith('http') ? rawLinkCatre : null;
			const linkAttr = usePositional
				? parseLinkAttribute(getVal(row, 'linkAttr'))
				: parseLinkAttribute(findCol(row, ['Tip', 'Type', 'tip', 'DoFollow', 'Dofollow']));
			const status = usePositional
				? parseStatus(getVal(row, 'status'))
				: parseStatus(findCol(row, ['STATUS', 'Status', 'status']));

			if (!keyword || !articleUrl) {
				skipped++;
				continue;
			}
			// Sari peste rânduri header (articleUrl trebuie să fie URL)
			if (!articleUrl.startsWith('http://') && !articleUrl.startsWith('https://')) {
				skipped++;
				continue;
			}

			// Când defaultClientId e setat, folosește-l; altfel detectează din PENTRU sau articol
			let clientId: string | null | undefined = data.defaultClientId
				? data.defaultClientId
				: clientName
					? clientByName.get(clientName.toLowerCase().trim())
					: null;

			let websiteId: string | null = null;
			let resolvedTargetUrl: string | null = targetUrl;
			let resolvedAnchorText: string | null = null;
			let wasAutoDetected = false;

			// Auto-detectare websiteId (și clientId dacă lipsește) din articol
			try {
				const html = await fetchArticleHtml(articleUrl, { timeoutMs: 12000 });
				const linkRegex = /<a\s[^>]*href=["'](https?:[^"'\s#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
				let m: RegExpExecArray | null;
				while ((m = linkRegex.exec(html)) !== null) {
					const href = m[1];
					const anchorText = m[2].replace(/<[^>]+>/g, '').trim();
					if (!anchorText) continue;
					const domain = extractDomainFromUrl(href);
					const found = domainToWebsite.get(domain);
					if (found) {
						// Potrivire cu clientul cunoscut (sau orice client dacă clientId lipsește)
						const clientMatches = !clientId || found.clientId === clientId;
						if (clientMatches) {
							if (!clientId) { clientId = found.clientId; wasAutoDetected = true; }
							websiteId = found.websiteId;
							if (!resolvedTargetUrl) resolvedTargetUrl = href;
							resolvedAnchorText = anchorText;
							break;
						}
					}
				}
			} catch { /* fetch eșuat — continuă cu datele din Excel */ }

			if (!clientId || !clients.some((c) => c.id === clientId)) {
				skipped++;
				continue;
			}

			const monthVal = month || new Date().toISOString().slice(0, 7);

			const seoLinkId = generateSeoLinkId();
			await db.insert(table.seoLink).values({
				id: seoLinkId,
				tenantId: event.locals.tenant.id,
				clientId,
				websiteId: websiteId || null,
				pressTrust: pressTrust || null,
				month: monthVal,
				keyword,
				linkType: null,
				linkAttribute: linkAttr as 'dofollow' | 'nofollow',
				status: status as 'pending' | 'submitted' | 'published' | 'rejected',
				articleUrl,
				targetUrl: resolvedTargetUrl || null,
				anchorText: resolvedAnchorText || null,
				price: null,
				currency: defaultCurrency,
				projectId: null,
				notes: null
			});
			if (wasAutoDetected) autoDetected++;
			imported++;
		}

		return {
			success: true,
			imported,
			skipped,
			autoDetected,
			columnsFound: imported === 0 && skipped > 0 ? columnsFound : undefined
		};
	}
);
