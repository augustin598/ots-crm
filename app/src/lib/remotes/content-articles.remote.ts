import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { HEYLUX_SOURCE_URLS } from '$lib/server/content/heylux-sources';
import { launchContentExtractionJob } from '$lib/server/content/content-pipeline';
import { generateArticle } from '$lib/server/content/article-generator';

function genId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
}

export const getContentArticles = query(
	v.optional(
		v.object({
			brand: v.optional(v.string()),
			status: v.optional(v.string())
		}),
		{}
	),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			svelteError(401, 'Unauthorized');
		}
		await requireStaff(event);

		const conds = [eq(table.contentArticle.tenantId, event.locals.tenant.id)];
		if (filters.brand) conds.push(eq(table.contentArticle.brand, filters.brand));
		if (filters.status) conds.push(eq(table.contentArticle.extractStatus, filters.status));

		return db
			.select({
				id: table.contentArticle.id,
				brand: table.contentArticle.brand,
				sourceUrl: table.contentArticle.sourceUrl,
				title: table.contentArticle.title,
				wordCount: table.contentArticle.wordCount,
				extractStatus: table.contentArticle.extractStatus,
				extractError: table.contentArticle.extractError,
				publishedAt: table.contentArticle.publishedAt,
				featuredImageUrl: table.contentArticle.featuredImageUrl
			})
			.from(table.contentArticle)
			.where(and(...conds))
			.orderBy(desc(table.contentArticle.updatedAt))
			.limit(400);
	}
);

export const getContentImportJob = query(v.optional(v.string()), async (_jobId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		svelteError(401, 'Unauthorized');
	}
	await requireStaff(event);

	const rows = await db
		.select()
		.from(table.contentImportJob)
		.where(eq(table.contentImportJob.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.contentImportJob.createdAt))
		.limit(1);

	return rows[0] ?? null;
});

/** Seed the 326 source URLs as pending rows; idempotent (skips existing sourceUrls). */
export const importHeyluxSources = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		svelteError(401, 'Unauthorized');
	}
	await requireStaff(event);

	const tenantId = event.locals.tenant.id;

	const existing = await db
		.select({ sourceUrl: table.contentArticle.sourceUrl })
		.from(table.contentArticle)
		.where(eq(table.contentArticle.tenantId, tenantId));
	const seen = new Set(existing.map((r) => r.sourceUrl));

	const now = new Date();
	const rows = HEYLUX_SOURCE_URLS.filter((u) => !seen.has(u)).map((u) => ({
		id: genId(),
		tenantId,
		sourceUrl: u,
		sourceDomain: domainOf(u),
		brand: 'unknown',
		extractStatus: 'pending',
		createdAt: now,
		updatedAt: now
	}));

	for (let i = 0; i < rows.length; i += 100) {
		await db.insert(table.contentArticle).values(rows.slice(i, i + 100));
	}

	return { inserted: rows.length, total: HEYLUX_SOURCE_URLS.length };
});

export const startContentExtraction = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		svelteError(401, 'Unauthorized');
	}
	await requireStaff(event);

	const tenantId = event.locals.tenant.id;
	const jobId = genId();
	const now = new Date();

	await db.insert(table.contentImportJob).values({
		id: jobId,
		tenantId,
		userId: event.locals.user.id,
		status: 'pending',
		createdAt: now,
		updatedAt: now
	});

	launchContentExtractionJob(jobId, tenantId);

	return { jobId };
});

// ===== F1: multi-website UI =====

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
		.leftJoin(
			table.websiteContentProfile,
			eq(table.websiteContentProfile.websiteId, table.clientWebsite.id)
		)
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
		.where(
			and(
				eq(table.contentArticle.id, id),
				eq(table.contentArticle.tenantId, event.locals.tenant.id)
			)
		)
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
		seoTitle: v.optional(v.string()),
		metaDescription: v.optional(v.string()),
		focusKeyword: v.optional(v.string()),
		slug: v.optional(v.string()),
		featuredImageUrl: v.optional(v.string()),
		rewriteStatus: v.optional(v.picklist(['none', 'queued', 'drafting', 'ready', 'failed']))
	}),
	async (input) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const patch: Record<string, unknown> = { updatedAt: new Date() };
		for (const k of [
			'generatedTitle',
			'generatedExcerpt',
			'generatedHtml',
			'articleDirection',
			'seoTitle',
			'metaDescription',
			'focusKeyword',
			'slug',
			'featuredImageUrl',
			'rewriteStatus'
		] as const) {
			if (input[k] !== undefined) patch[k] = input[k];
		}
		await db
			.update(table.contentArticle)
			.set(patch)
			.where(
				and(
					eq(table.contentArticle.id, input.id),
					eq(table.contentArticle.tenantId, event.locals.tenant.id)
				)
			);
		return { ok: true };
	}
);

// ===== F2: generare AI =====

/** Profilul de conținut al unui website (sau null). */
async function loadContentProfile(tenantId: string, websiteId: string) {
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

/** Logica de rescriere a unui articol-sursă (partajată de rewrite + regenerate). */
async function doRewrite(tenantId: string, articleId: string) {
	const rows = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
		.limit(1);
	const a = rows[0];
	if (!a) svelteError(404, 'Articol negăsit');
	if (!a.websiteId) svelteError(400, 'Articolul nu e legat de un website');

	await db
		.update(table.contentArticle)
		.set({ rewriteStatus: 'drafting', updatedAt: new Date() })
		.where(eq(table.contentArticle.id, articleId));
	try {
		const profile = await loadContentProfile(tenantId, a.websiteId);
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
		await db
			.update(table.contentArticle)
			.set({ rewriteStatus: 'failed', updatedAt: new Date() })
			.where(eq(table.contentArticle.id, articleId));
		svelteError(500, e instanceof Error ? e.message : 'Generare eșuată');
	}
}

/** Rescrie un articol-sursă cu AI (folosește direcția per articol dacă e setată). */
export const rewriteArticle = command(v.string(), async (articleId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	return doRewrite(event.locals.tenant.id, articleId);
});

/** „Regenerează" — rerulează generarea cu direcția curentă din DB. */
export const regenerateArticle = command(v.string(), async (articleId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	return doRewrite(event.locals.tenant.id, articleId);
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

		const profile = await loadContentProfile(tenantId, websiteId);
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

/** Modificare ȚINTITĂ: aplică o instrucțiune pe textul rescris CURENT (nu regenerează tot). */
export const modifyArticle = command(
	v.object({ articleId: v.string(), instruction: v.pipe(v.string(), v.minLength(2)) }),
	async ({ articleId, instruction }) => {
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
		const current = a.generatedHtml || a.bodyHtml || '';
		if (!current) svelteError(400, 'Nu există text de modificat — generează întâi articolul.');

		await db
			.update(table.contentArticle)
			.set({ rewriteStatus: 'drafting', updatedAt: new Date() })
			.where(eq(table.contentArticle.id, articleId));
		try {
			const profile = a.websiteId ? await loadContentProfile(tenantId, a.websiteId) : null;
			const gen = await generateArticle(tenantId, {
				profile,
				direction: a.articleDirection,
				mode: 'modify',
				currentText: current,
				instruction
			});
			await db
				.update(table.contentArticle)
				.set({
					generatedTitle: gen.title || a.generatedTitle,
					generatedExcerpt: gen.excerpt || a.generatedExcerpt,
					generatedHtml: gen.html,
					rewriteStatus: 'ready',
					generatedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(table.contentArticle.id, articleId));
			return { ok: true };
		} catch (e) {
			await db
				.update(table.contentArticle)
				.set({ rewriteStatus: 'ready', updatedAt: new Date() })
				.where(eq(table.contentArticle.id, articleId));
			svelteError(500, e instanceof Error ? e.message : 'Modificare eșuată');
		}
	}
);

/** Reset failed/thin rows back to pending, then relaunch. */
export const retryFailedExtractions = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		svelteError(401, 'Unauthorized');
	}
	await requireStaff(event);

	const tenantId = event.locals.tenant.id;

	await db
		.update(table.contentArticle)
		.set({ extractStatus: 'pending', updatedAt: new Date() })
		.where(
			and(
				eq(table.contentArticle.tenantId, tenantId),
				inArray(table.contentArticle.extractStatus, ['failed', 'thin'])
			)
		);

	const jobId = genId();
	const now = new Date();

	await db.insert(table.contentImportJob).values({
		id: jobId,
		tenantId,
		userId: event.locals.user.id,
		status: 'pending',
		createdAt: now,
		updatedAt: now
	});

	launchContentExtractionJob(jobId, tenantId);

	return { jobId };
});
