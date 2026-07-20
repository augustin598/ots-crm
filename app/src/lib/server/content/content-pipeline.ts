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
		logError('server', `Extraction job ${jobId} crashed: ${msg}`);
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
	logInfo('server', `Extraction job ${jobId} done: ${ok} ok / ${thin} thin / ${failed} failed of ${processed}`);
}
