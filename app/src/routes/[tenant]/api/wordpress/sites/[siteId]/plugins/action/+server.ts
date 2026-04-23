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
 * POST — body `{ action: 'activate' | 'deactivate' | 'delete', plugin: "<slug>/<file>.php" }`.
 * Consolidated into a single endpoint because the three actions are
 * symmetric (same inputs, same error shape). The plugin-side endpoints
 * handle them separately for HTTP-method cleanliness.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => null)) as {
		action?: string;
		plugin?: string;
	} | null;
	if (!body?.action || !body.plugin) {
		return json({ error: 'action și plugin sunt obligatorii' }, { status: 400 });
	}

	try {
		let result: { success: boolean };
		if (body.action === 'activate') {
			result = await ctx.client.activatePlugin(body.plugin, { siteId: ctx.site.id });
		} else if (body.action === 'deactivate') {
			result = await ctx.client.deactivatePlugin(body.plugin, { siteId: ctx.site.id });
		} else if (body.action === 'delete') {
			result = await ctx.client.deletePlugin(body.plugin, { siteId: ctx.site.id });
		} else {
			return json({ error: `Acțiune necunoscută: ${body.action}` }, { status: 400 });
		}

		logInfo('wordpress', `Plugin ${body.action}: ${body.plugin} on ${ctx.site.siteUrl}`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, plugin: body.plugin, action: body.action }
		});

		return json(result);
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `Plugin ${body.action} failed: ${body.plugin} on ${ctx.site.siteUrl}: ${code}`, {
			tenantId: ctx.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, plugin: body.plugin, action: body.action, code }
		});
		return json({ error: `${code}: ${message}` }, { status: 502 });
	}
};
