import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkTenantSitesHealth } from '$lib/server/wordpress/site-admin';

/**
 * POST — live signed /health on every unpaused site of the tenant. The
 * WordPress list calls it when it opens, so the badges reflect the
 * connection right now rather than the last cron run. Results are persisted
 * on each row; the client reloads the list afterwards.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await checkTenantSitesHealth(locals.tenant.id);
	return json(result);
};
