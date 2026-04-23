import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
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
 * POST — install a plugin ZIP on the WP site. The UI iterates sequentially
 * over multiple files (one POST per file) so it can surface per-file
 * progress to the user; this endpoint handles exactly one.
 *
 * Body: { filename, mimeType, dataBase64, activate }
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => null)) as {
		filename?: string;
		mimeType?: string;
		dataBase64?: string;
		activate?: boolean;
	} | null;

	if (!body?.filename || !body?.dataBase64) {
		return json({ error: 'filename și dataBase64 sunt obligatorii' }, { status: 400 });
	}

	try {
		const result = await ctx.client.installPlugin(
			{
				filename: body.filename,
				mimeType: body.mimeType || 'application/zip',
				dataBase64: body.dataBase64,
				activate: body.activate ?? true
			},
			{ siteId: ctx.site.id }
		);
		logInfo('wordpress', `Plugin installed on ${ctx.site.siteUrl}: ${result.plugin} (activated=${result.activated})`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: {
				siteId: ctx.site.id,
				plugin: result.plugin,
				filename: body.filename,
				sizeBytes: result.sizeBytes,
				activated: result.activated
			}
		});
		return json(result);
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `Plugin install failed on ${ctx.site.siteUrl}: ${body.filename}: ${code}`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, filename: body.filename, code }
		});
		return json({ error: `${code}: ${message}` }, { status: 502 });
	}
};
