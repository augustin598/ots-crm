import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncHealth, pingUptime, syncUpdates } from '$lib/server/wordpress/sync';

/**
 * POST /refresh — force an immediate uptime ping + authenticated /health
 * call against the plugin, then sync updates. Returns the resulting site row
 * plus a summary of pending updates so the UI can update without extra GETs.
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

	// Uptime ping is cheap; run it in parallel with the authenticated health check.
	const [, healthResult] = await Promise.all([
		pingUptime(site.id).catch(() => 'down' as const),
		syncHealth(site.id)
	]);

	// Updates refresh runs only when health succeeded, to avoid compounding failures.
	let updatesResult: Awaited<ReturnType<typeof syncUpdates>> | null = null;
	if (healthResult.ok) {
		updatesResult = await syncUpdates(site.id).catch((err) => ({
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			core: 0,
			plugins: 0,
			themes: 0,
			security: 0
		}));
	}

	const [updated] = await db
		.select()
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, site.id))
		.limit(1);

	return json({
		success: healthResult.ok,
		site: updated,
		error: healthResult.error,
		updates: updatesResult
	});
};
