import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encryptVerified } from '$lib/server/plugins/smartbill/crypto';
import { syncHealth } from '$lib/server/wordpress/sync';

/**
 * POST — replace the HMAC secret stored for this site. Used when the CRM's
 * secret and the plugin's secret get out of sync (e.g. the user hit the
 * "let the CRM generate" path but couldn't paste the result into the plugin).
 *
 * Body: `{ secret: string }` — 64 hex chars. We validate, encrypt with the
 * tenant-scoped key, then immediately run a health check so the user sees
 * "connected" in the UI instead of having to click Refresh.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as { secret?: string } | null;
	const secret = body?.secret?.trim() ?? '';

	if (secret.length !== 64 || !/^[0-9a-f]+$/i.test(secret)) {
		return json(
			{ error: 'Secretul trebuie să aibă exact 64 de caractere hex (0-9, a-f)' },
			{ status: 400 }
		);
	}

	const [site] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, params.siteId),
				eq(table.wordpressSite.tenantId, locals.tenant.id)
			)
		)
		.limit(1);

	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const encrypted = encryptVerified(locals.tenant.id, secret.toLowerCase());

	await db
		.update(table.wordpressSite)
		.set({
			secretKey: encrypted,
			status: 'pending',
			lastError: null,
			consecutiveFailures: 0,
			updatedAt: new Date()
		})
		.where(eq(table.wordpressSite.id, site.id));

	// Run a health check right away so the UI reflects reality.
	const result = await syncHealth(site.id);

	return json({ success: result.ok, error: result.error });
};
