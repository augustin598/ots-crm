import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient, type WpPostPayload } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import { extractAndUploadInlineImages } from '$lib/server/wordpress/media';
import { syncPosts } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

async function loadSiteAndClient(siteId: string, tenantId: string) {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, siteId),
				eq(table.wordpressSite.tenantId, tenantId)
			)
		)
		.limit(1);
	if (!site) return null;

	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (err instanceof DecryptionError) {
			await new Promise((r) => setTimeout(r, 1000));
			const [fresh] = await db
				.select()
				.from(table.wordpressSite)
				.where(eq(table.wordpressSite.id, site.id))
				.limit(1);
			secret = decrypt(fresh!.tenantId, fresh!.secretKey);
		} else {
			throw err;
		}
	}
	return { site, client: new WpClient(site.siteUrl, secret) };
}

/**
 * GET — list posts. Forces a sync against the WP plugin so the UI always
 * sees current data (filtering/searching happens on the WP side).
 *
 * Query params: `status` (any WP status or 'any'), `search`, `page`, `perPage`.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const status = url.searchParams.get('status') || 'any';
	const search = url.searchParams.get('search') || '';
	const page = Number(url.searchParams.get('page') || '1');
	const perPage = Number(url.searchParams.get('perPage') || '20');

	try {
		const response = await ctx.client.listPosts(
			{ status, search, page, perPage },
			{ siteId: ctx.site.id }
		);
		// Fire-and-forget DB cache update for the first page.
		if (page === 1) {
			syncPosts(ctx.site.id, { status, search, perPage }).catch(() => undefined);
		}
		return json(response);
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `listPosts failed for ${ctx.site.siteUrl}: ${code}`, {
			tenantId: ctx.site.tenantId,
			metadata: { siteId: ctx.site.id, code }
		});
		return json({ error: message }, { status: 502 });
	}
};

/**
 * POST — create a new post. Accepts the TipTap HTML and, before pushing,
 * materializes any inline base64 images by uploading them to WP's media
 * library and rewriting the src URLs in the HTML. If the user didn't set
 * a featured image explicitly, we use the first uploaded inline image.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => null)) as WpPostPayload | null;
	if (!body || typeof body.title !== 'string' || typeof body.contentHtml !== 'string') {
		return json({ error: 'title și contentHtml sunt obligatorii' }, { status: 400 });
	}

	try {
		const { html: finalHtml, attachmentIds, firstUrl } = await extractAndUploadInlineImages(
			ctx.client,
			body.contentHtml,
			{ siteId: ctx.site.id, filenamePrefix: 'post' }
		);

		const payload: WpPostPayload = {
			title: body.title,
			contentHtml: finalHtml,
			excerpt: body.excerpt,
			slug: body.slug,
			status: body.status ?? 'draft',
			publishedAt: body.publishedAt,
			featuredMediaId:
				body.featuredMediaId !== undefined
					? body.featuredMediaId
					: attachmentIds.length > 0
						? attachmentIds[0]
						: undefined
		};

		const created = await ctx.client.createPost(payload, { siteId: ctx.site.id });

		// Refresh cache for the first page.
		syncPosts(ctx.site.id).catch(() => undefined);

		logInfo('wordpress', `Post created on ${ctx.site.siteUrl}: "${created.title}" (${created.status})`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: {
				siteId: ctx.site.id,
				wpPostId: created.id,
				uploadedAttachments: attachmentIds.length,
				firstInlineUrl: firstUrl
			}
		});

		return json({ post: created, uploadedAttachments: attachmentIds.length }, { status: 201 });
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `Post create failed for ${ctx.site.siteUrl}: ${code}`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, code }
		});
		return json({ error: message }, { status: 502 });
	}
};
