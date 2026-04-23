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

/** `postId` in our URL is the WP post ID (integer). */
function parseWpPostId(raw: string): number | null {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET — single post straight from the plugin. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) return json({ error: 'Unauthorized' }, { status: 401 });
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const wpPostId = parseWpPostId(params.postId);
	if (!wpPostId) return json({ error: 'ID invalid' }, { status: 400 });

	try {
		const post = await ctx.client.getPost(wpPostId, { siteId: ctx.site.id });
		return json({ post });
	} catch (err) {
		const { message } = serializeError(err);
		return json({ error: message }, { status: 502 });
	}
};

/** PUT — update. Same inline-image rewrite flow as POST /posts. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) return json({ error: 'Unauthorized' }, { status: 401 });
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const wpPostId = parseWpPostId(params.postId);
	if (!wpPostId) return json({ error: 'ID invalid' }, { status: 400 });

	const body = (await request.json().catch(() => null)) as WpPostPayload | null;
	if (!body || typeof body.title !== 'string' || typeof body.contentHtml !== 'string') {
		return json({ error: 'title și contentHtml sunt obligatorii' }, { status: 400 });
	}

	try {
		const { html: finalHtml, attachmentIds } = await extractAndUploadInlineImages(
			ctx.client,
			body.contentHtml,
			{ siteId: ctx.site.id, filenamePrefix: `post-${wpPostId}` }
		);

		const payload: WpPostPayload = {
			title: body.title,
			contentHtml: finalHtml,
			excerpt: body.excerpt,
			slug: body.slug,
			status: body.status,
			publishedAt: body.publishedAt,
			featuredMediaId: body.featuredMediaId
		};

		const updated = await ctx.client.updatePost(wpPostId, payload, { siteId: ctx.site.id });

		syncPosts(ctx.site.id).catch(() => undefined);

		logInfo('wordpress', `Post ${wpPostId} updated on ${ctx.site.siteUrl}`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, wpPostId, uploadedAttachments: attachmentIds.length }
		});

		return json({ post: updated, uploadedAttachments: attachmentIds.length });
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `Post update failed for ${ctx.site.siteUrl}: ${code}`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, wpPostId, code }
		});
		return json({ error: message }, { status: 502 });
	}
};

/** DELETE — trashes the post on the WP side. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) return json({ error: 'Unauthorized' }, { status: 401 });
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const wpPostId = parseWpPostId(params.postId);
	if (!wpPostId) return json({ error: 'ID invalid' }, { status: 400 });

	try {
		await ctx.client.deletePost(wpPostId, { siteId: ctx.site.id });
		// Drop from cache too — if the user pulls the list again we'd rather
		// it be absent than incorrectly marked `publish` from the cache.
		await db
			.delete(table.wordpressPost)
			.where(
				and(
					eq(table.wordpressPost.siteId, ctx.site.id),
					eq(table.wordpressPost.wpPostId, wpPostId)
				)
			);
		return json({ success: true });
	} catch (err) {
		const { message } = serializeError(err);
		return json({ error: message }, { status: 502 });
	}
};
