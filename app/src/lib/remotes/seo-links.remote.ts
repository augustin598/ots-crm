import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, or, isNull, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import XLSX from 'xlsx';

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
	pressTrust: v.optional(v.string()),
	month: v.pipe(v.string(), v.minLength(1, 'Luna este obligatorie')), // YYYY-MM
	keyword: v.pipe(v.string(), v.minLength(1, 'Cuvântul cheie este obligatoriu')),
	linkType: v.optional(v.picklist(['article', 'guest-post', 'press-release', 'directory', 'other'])),
	linkAttribute: v.optional(v.picklist(['dofollow', 'nofollow'])),
	status: v.optional(v.picklist(['pending', 'submitted', 'published', 'rejected'])),
	articleUrl: v.pipe(v.string(), v.minLength(1, 'Linkul articolului este obligatoriu')),
	targetUrl: v.optional(v.string()),
	price: v.optional(v.number()),
	currency: v.optional(v.string()),
	anchorText: v.optional(v.string()),
	projectId: v.optional(v.string()),
	notes: v.optional(v.string())
});

export const getSeoLinks = query(
	v.object({
		clientId: v.optional(v.string()),
		month: v.optional(v.string()),
		status: v.optional(v.string()),
		checkStatus: v.optional(v.string()) // 'ok' | 'problem' | 'never' - for filtering by link check result
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
		} else if (filters.clientId) {
			conditions = and(conditions, eq(table.seoLink.clientId, filters.clientId)) as typeof conditions;
		}
		if (filters.month) {
			conditions = and(conditions, eq(table.seoLink.month, filters.month)) as typeof conditions;
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

		const links = await db
			.select()
			.from(table.seoLink)
			.where(conditions)
			.orderBy(desc(table.seoLink.month), desc(table.seoLink.createdAt));

		return links;
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

	await db.insert(table.seoLink).values({
		id: seoLinkId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		pressTrust: data.pressTrust || null,
		month: data.month,
		keyword: data.keyword,
		linkType: data.linkType || null,
		linkAttribute: data.linkAttribute || 'dofollow',
		status: data.status || 'pending',
		articleUrl: data.articleUrl,
		targetUrl: data.targetUrl || null,
		price: data.price != null ? Math.round(data.price * 100) : null,
		currency,
		anchorText: data.anchorText || null,
		projectId: data.projectId || null,
		notes: data.notes || null
	});

	return { success: true, seoLinkId };
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

export const updateSeoLink = command(
	v.object({
		seoLinkId: v.pipe(v.string(), v.minLength(1)),
		...seoLinkSchema.entries
	}),
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
				pressTrust: updateData.pressTrust !== undefined ? updateData.pressTrust : existing.pressTrust,
				month: updateData.month ?? existing.month,
				keyword: updateData.keyword ?? existing.keyword,
				linkType: updateData.linkType !== undefined ? updateData.linkType : existing.linkType,
				linkAttribute: updateData.linkAttribute ?? existing.linkAttribute,
				status: updateData.status ?? existing.status,
				articleUrl: updateData.articleUrl ?? existing.articleUrl,
				targetUrl: updateData.targetUrl !== undefined ? updateData.targetUrl || null : existing.targetUrl,
				price:
					updateData.price != null
						? Math.round(updateData.price * 100)
						: existing.price,
				currency: updateData.currency ?? existing.currency,
				anchorText:
					updateData.anchorText !== undefined ? updateData.anchorText : existing.anchorText,
				projectId: updateData.projectId !== undefined ? updateData.projectId : existing.projectId,
				notes: updateData.notes !== undefined ? updateData.notes : existing.notes,
				updatedAt: new Date()
			})
			.where(eq(table.seoLink.id, seoLinkId));

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

const EXTRACT_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

/** Extrage toate linkurile către root (domeniu + subdomenii + pagini) și returnează cel mai specific */
function extractLinksToRootFromHtml(html: string, rootDomain: string): ExtractedLink[] {
	const results: ExtractedLink[] = [];
	const linkRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
	let match: RegExpExecArray | null;
	while ((match = linkRegex.exec(html)) !== null) {
		const href = match[1];
		const inner = match[2];
		if (href && hrefBelongsToRoot(href, rootDomain)) {
			results.push({
				url: normalizeHref(href),
				anchorText: stripHtml(inner)
			});
		}
	}
	if (results.length === 0) {
		const altRegex = /<a[^>]+href=["']([^"']*)["'][^>]*>([^<]+)<\/a>/gi;
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

/** Alege cel mai specific URL (cea mai lungă cale) din lista de linkuri */
function pickBestTargetUrl(links: ExtractedLink[]): { url: string; keyword: string } {
	if (links.length === 0) return { url: '', keyword: '' };
	const sorted = [...links].sort((a, b) => {
		try {
			const pathA = new URL(a.url).pathname.length;
			const pathB = new URL(b.url).pathname.length;
			return pathB - pathA;
		} catch {
			return 0;
		}
	});
	const best = sorted[0];
	const keyword =
		best.anchorText && best.anchorText.length > 2 && best.anchorText.length < 200
			? best.anchorText
			: sorted.find((l) => l.anchorText && l.anchorText.length > 2)?.anchorText || '';
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

function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export const extractSeoLinkData = command(
	v.object({
		articleUrl: v.pipe(v.string(), v.minLength(1)),
		clientUrl: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const clientDomain = extractDomainFromUrl(data.clientUrl);
		if (!clientDomain) {
			throw new Error('URL client invalid');
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);
		let html: string;
		try {
			const res = await fetch(data.articleUrl, {
				method: 'GET',
				redirect: 'follow',
				signal: controller.signal,
				headers: { 'User-Agent': EXTRACT_USER_AGENT }
			});
			clearTimeout(timeoutId);
			if (!res.ok) {
				throw new Error(`Pagina nu a putut fi accesată (${res.status})`);
			}
			html = await res.text();
		} catch (e) {
			clearTimeout(timeoutId);
			throw new Error(
				e instanceof Error ? e.message : 'Nu s-a putut încărca articolul. Verificați URL-ul.'
			);
		}

		const links = extractLinksToRootFromHtml(html, clientDomain);
		const { url: extractedTargetUrl, keyword: extractedKeyword } = pickBestTargetUrl(links);
		const keyword = extractedKeyword;
		const anchorText = extractedKeyword;

		const pressTrust = extractPressTrustFromUrl(data.articleUrl);
		const linkType = 'article';

		return {
			keyword: keyword || '',
			anchorText: anchorText || keyword,
			pressTrust,
			linkType,
			targetUrl: extractedTargetUrl || (data.clientUrl.startsWith('http') ? data.clientUrl : `https://${data.clientUrl}`)
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

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);
		let html: string;
		try {
			const res = await fetch(link.articleUrl, {
				method: 'GET',
				redirect: 'follow',
				signal: controller.signal,
				headers: { 'User-Agent': EXTRACT_USER_AGENT }
			});
			clearTimeout(timeoutId);
			if (!res.ok) {
				throw new Error(`Pagina nu a putut fi accesată (${res.status})`);
			}
			html = await res.text();
		} catch (e) {
			clearTimeout(timeoutId);
			throw new Error(
				e instanceof Error ? e.message : 'Nu s-a putut încărca articolul. Verificați URL-ul.'
			);
		}

		const links = extractLinksToRootFromHtml(html, clientDomain);
		const { url: extractedTargetUrl } = pickBestTargetUrl(links);

		if (!extractedTargetUrl) {
			throw new Error(`Nu s-a găsit niciun link către ${clientDomain} în articol`);
		}

		await db
			.update(table.seoLink)
			.set({ targetUrl: extractedTargetUrl, updatedAt: new Date() })
			.where(eq(table.seoLink.id, seoLinkId));

		return { success: true, targetUrl: extractedTargetUrl };
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
		if (filters.month) {
			conditions = and(conditions, eq(table.seoLink.month, filters.month)) as typeof conditions;
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

			const clientDomain = clientRow.website
				? extractDomainFromUrl(clientRow.website)
				: inferClientDomainFromName(clientRow.name);

			if (!clientDomain) {
				errors.push({
					id: link.id,
					error: 'Adăugați website-ul clientului (ex: glemis.ro) în profilul clientului'
				});
				continue;
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 15000);
			let html: string;
			try {
				const res = await fetch(link.articleUrl, {
					method: 'GET',
					redirect: 'follow',
					signal: controller.signal,
					headers: { 'User-Agent': EXTRACT_USER_AGENT }
				});
				clearTimeout(timeoutId);
				if (!res.ok) {
					throw new Error(`Pagina nu a putut fi accesată (${res.status})`);
				}
				html = await res.text();
			} catch (e) {
				clearTimeout(timeoutId);
				errors.push({
					id: link.id,
					error: e instanceof Error ? e.message : 'Nu s-a putut încărca articolul'
				});
				continue;
			}

			const links = extractLinksToRootFromHtml(html, clientDomain);
			const { url: extractedTargetUrl } = pickBestTargetUrl(links);

			if (!extractedTargetUrl) {
				errors.push({ id: link.id, error: `Nu s-a găsit link către ${clientDomain} în articol` });
				continue;
			}

			await db
				.update(table.seoLink)
				.set({ targetUrl: extractedTargetUrl, updatedAt: new Date() })
				.where(eq(table.seoLink.id, link.id));

			results.push({ id: link.id, targetUrl: extractedTargetUrl });
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
	'Mozilla/5.0 (compatible; SEOBacklinkChecker/1.0; +https://example.com)';

async function performLinkCheck(articleUrl: string): Promise<{
	status: 'ok' | 'unreachable' | 'timeout' | 'redirect' | 'error';
	httpCode: number | null;
	responseTimeMs: number | null;
	errorMessage: string | null;
}> {
	const start = Date.now();
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000);
		const res = await fetch(articleUrl, {
			method: 'HEAD',
			redirect: 'follow',
			signal: controller.signal,
			headers: { 'User-Agent': LINK_CHECK_USER_AGENT }
		});
		clearTimeout(timeoutId);
		const responseTimeMs = Date.now() - start;
		const httpCode = res.status;

		if (httpCode >= 200 && httpCode < 300) {
			return { status: 'ok', httpCode, responseTimeMs, errorMessage: null };
		}
		if (httpCode === 301 || httpCode === 302) {
			return { status: 'redirect', httpCode, responseTimeMs, errorMessage: null };
		}
		if (httpCode === 404 || httpCode === 410) {
			return { status: 'unreachable', httpCode, responseTimeMs, errorMessage: null };
		}
		return {
			status: 'error',
			httpCode,
			responseTimeMs,
			errorMessage: `HTTP ${httpCode}`
		};
	} catch (e) {
		const responseTimeMs = Date.now() - start;
		const err = e instanceof Error ? e : new Error(String(e));
		const isTimeout = err.name === 'AbortError';
		return {
			status: isTimeout ? 'timeout' : 'error',
			httpCode: null,
			responseTimeMs,
			errorMessage: err.message
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

		const result = await performLinkCheck(link.articleUrl);
		const now = new Date();

		await db
			.update(table.seoLink)
			.set({
				lastCheckedAt: now,
				lastCheckStatus: result.status,
				lastCheckHttpCode: result.httpCode,
				lastCheckError: result.errorMessage,
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
	if (filters.month) {
		conditions = and(conditions, eq(table.seoLink.month, filters.month)) as typeof conditions;
	}
	if (filters.seoLinkIds?.length) {
		conditions = and(conditions, inArray(table.seoLink.id, filters.seoLinkIds)) as typeof conditions;
	}

	const links = await db
		.select()
		.from(table.seoLink)
		.where(conditions);

	const results: { id: string; status: string; httpCode: number | null }[] = [];
	for (let i = 0; i < links.length; i++) {
		if (i > 0) {
			await new Promise((r) => setTimeout(r, 1500));
		}
		const link = links[i];
		const result = await performLinkCheck(link.articleUrl);
		const now = new Date();

		await db
			.update(table.seoLink)
			.set({
				lastCheckedAt: now,
				lastCheckStatus: result.status,
				lastCheckHttpCode: result.httpCode,
				lastCheckError: result.errorMessage,
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
			parseFile(workbook.Sheets[workbook.SheetNames[0]]);
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

		let imported = 0;
		let skipped = 0;

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
			const targetUrl = usePositional
				? getVal(row, 'targetUrl')
				: findCol(row, ['LINK', 'Link', 'targetUrl', 'URL țintă']);
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

			// Când defaultClientId e setat, folosește-l pentru toate rândurile
			let clientId = data.defaultClientId
				? data.defaultClientId
				: clientName
					? clientByName.get(clientName.toLowerCase())
					: null;
			if (!clientId) {
				skipped++;
				continue;
			}

			// Verifică că clientul există
			if (!clients.some((c) => c.id === clientId)) {
				skipped++;
				continue;
			}

			const monthVal = month || new Date().toISOString().slice(0, 7);

			const seoLinkId = generateSeoLinkId();
			await db.insert(table.seoLink).values({
				id: seoLinkId,
				tenantId: event.locals.tenant.id,
				clientId,
				pressTrust: pressTrust || null,
				month: monthVal,
				keyword,
				linkType: null,
				linkAttribute: linkAttr as 'dofollow' | 'nofollow',
				status: status as 'pending' | 'submitted' | 'published' | 'rejected',
				articleUrl,
				targetUrl: targetUrl || null,
				price: null,
				currency: defaultCurrency,
				anchorText: null,
				projectId: null,
				notes: null
			});
			imported++;
		}

		return {
			success: true,
			imported,
			skipped,
			columnsFound: imported === 0 && skipped > 0 ? columnsFound : undefined
		};
	}
);
