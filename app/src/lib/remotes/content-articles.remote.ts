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
