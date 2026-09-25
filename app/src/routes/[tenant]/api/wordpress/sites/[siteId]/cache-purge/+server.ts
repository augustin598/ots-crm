import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStaff } from '$lib/server/get-actor';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { purgeSiteCache } from '$lib/server/wordpress/cache-purge';

/**
 * POST `{ scope?: 'update' | 'restore' }` — empty the site's caches
 * (LiteSpeed, WP Rocket, Perfmatters, Elementor CSS, …). The browser calls it
 * once per site after a batch of updates and after a restore. Always answers
 * 200 with the outcome (`purged` / `nothing` / `unsupported` / `failed`); the
 * updates or the restore already ran either way.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await event.request.json().catch(() => null)) as { scope?: unknown } | null;
	const scope = body?.scope === 'restore' ? 'restore' : 'update';
	const outcome = await purgeSiteCache({
		client: ctx.client,
		site: ctx.site,
		userId: locals.user.id,
		scope
	});
	return json(outcome);
};
