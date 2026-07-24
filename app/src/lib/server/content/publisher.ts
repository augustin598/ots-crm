import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { extractAndUploadInlineImages } from '$lib/server/wordpress/media';
import { syncPosts } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

export type PublishWpStatus = 'draft' | 'publish' | 'future';

export interface PublishResult {
	ok: true;
	wpPostId: number;
	link: string | null;
	publishStatus: 'draft' | 'published';
}

/** Încarcă un site WP (tenant-scoped) + decriptează secretul (retry 1× pe Turso transient). */
async function loadSiteAndClient(tenantId: string, siteId: string) {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) throw new Error(`Site WordPress negăsit: ${siteId}`);
	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (!(err instanceof DecryptionError)) throw err;
		await new Promise((r) => setTimeout(r, 1000));
		const [fresh] = await db.select().from(table.wordpressSite).where(eq(table.wordpressSite.id, siteId)).limit(1);
		if (!fresh) throw new Error(`Site WordPress dispărut la retry decrypt: ${siteId}`);
		secret = decrypt(fresh.tenantId, fresh.secretKey);
	}
	return { site, client: new WpClient(site.siteUrl, secret) };
}

/**
 * Publică un articol de conținut pe WordPress. Ținta = article.targetWpSiteId
 * ?? clientWebsite.wpSiteId. Urcă imaginile inline, createPost, persistă
 * wp_post_id + publish_status, refresh cache (syncPosts, fire-and-forget).
 * `status`: 'draft' (ciornă) | 'publish' (live) | 'future' (necesită publishedAt).
 */
export async function publishArticleToWordpress(
	tenantId: string,
	articleId: string,
	opts: { status: PublishWpStatus; publishedAt?: Date }
): Promise<PublishResult> {
	const [article] = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
		.limit(1);
	if (!article) throw new Error('Articol negăsit');

	const html = article.generatedHtml;
	if (!html) throw new Error('Articolul nu are conținut generat — generează întâi articolul.');

	// Rezolvă ținta WP: override per-articol, altfel wpSiteId al website-ului.
	let targetSiteId = article.targetWpSiteId ?? null;
	if (!targetSiteId && article.websiteId) {
		const [ws] = await db
			.select({ wpSiteId: table.clientWebsite.wpSiteId })
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.id, article.websiteId))
			.limit(1);
		targetSiteId = ws?.wpSiteId ?? null;
	}
	if (!targetSiteId) throw new Error('Website-ul nu e legat de un site WordPress — leagă WP în Setări întâi.');

	try {
		const { site, client } = await loadSiteAndClient(tenantId, targetSiteId);
		const { html: finalHtml, attachmentIds } = await extractAndUploadInlineImages(client, html, {
			siteId: site.id,
			filenamePrefix: 'content'
		});

		const created = await client.createPost(
			{
				title: article.generatedTitle || article.title || 'Fără titlu',
				contentHtml: finalHtml,
				excerpt: article.generatedExcerpt ?? undefined,
				slug: article.slug ?? undefined,
				status: opts.status,
				publishedAt: opts.status === 'future' ? opts.publishedAt?.toISOString() : undefined,
				featuredMediaId: attachmentIds.length > 0 ? attachmentIds[0] : undefined
			},
			{ siteId: site.id }
		);

		const publishStatus: 'draft' | 'published' = opts.status === 'draft' ? 'draft' : 'published';
		await db
			.update(table.contentArticle)
			.set({
				wpPostId: created.id,
				targetWpSiteId: article.targetWpSiteId ?? site.id, // păstrează ținta explicită dacă exista
				publishStatus,
				publishedAt: created.publishedAt ? new Date(created.publishedAt) : new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.contentArticle.id, articleId));

		syncPosts(site.id).catch((err) => {
			const { message } = serializeError(err);
			logWarning('content', `[publish] syncPosts refresh a eșuat pt ${site.id}: ${message}`, { tenantId, metadata: { siteId: site.id } });
		});

		logInfo('content', `Articol publicat pe ${site.siteUrl}: "${created.title}" (${created.status})`, {
			tenantId,
			metadata: { articleId, siteId: site.id, wpPostId: created.id, status: created.status }
		});
		return { ok: true, wpPostId: created.id, link: created.link ?? null, publishStatus };
	} catch (err) {
		const { message, stack } = serializeError(err);
		await db
			.update(table.contentArticle)
			.set({ publishStatus: 'failed', updatedAt: new Date() })
			.where(eq(table.contentArticle.id, articleId));
		logWarning('content', `Publicare eșuată pentru articol ${articleId}: ${message}`, {
			tenantId,
			metadata: { articleId },
			stackTrace: stack
		});
		throw new Error(message);
	}
}
