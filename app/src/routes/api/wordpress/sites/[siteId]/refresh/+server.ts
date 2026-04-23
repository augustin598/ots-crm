import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncHealth, pingUptime } from '$lib/server/wordpress/sync';

/**
 * POST /refresh — force an immediate uptime ping + authenticated /health
 * call against the plugin. Returns the resulting site row so the UI can
 * update without a separate GET.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
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

	// Uptime ping is cheap and unauthenticated; run it in parallel with the
	// authenticated health check so the UI gets both pieces at once.
	const [, healthResult] = await Promise.all([
		pingUptime(site.id).catch(() => 'down' as const),
		syncHealth(site.id)
	]);

	const [updated] = await db
		.select()
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, site.id))
		.limit(1);

	return json({ success: healthResult.ok, site: updated, error: healthResult.error });
};
