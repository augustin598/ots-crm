import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import { serializeError } from '$lib/server/logger';

/**
 * POST — proxy for a single media upload. Primarily used by the post-editor
 * UI to set a featured image without needing to embed it as base64 in the
 * post payload itself. Body: { filename, mimeType, dataBase64 }.
 *
 * Returns the WP attachment `{ id, url }` — the frontend then passes `id`
 * to POST /posts as `featuredMediaId`.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, params.siteId),
				eq(table.wordpressSite.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => null)) as {
		filename?: string;
		mimeType?: string;
		dataBase64?: string;
	} | null;
	if (!body?.filename || !body?.mimeType || !body?.dataBase64) {
		return json({ error: 'filename, mimeType și dataBase64 sunt obligatorii' }, { status: 400 });
	}

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

	const client = new WpClient(site.siteUrl, secret);
	try {
		const result = await client.uploadMedia(
			{
				filename: body.filename,
				mimeType: body.mimeType,
				dataBase64: body.dataBase64
			},
			{ siteId: site.id }
		);
		return json(result);
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		return json({ error: `${code}: ${message}` }, { status: 502 });
	}
};
