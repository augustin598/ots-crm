import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { logInfo, logWarning } from '$lib/server/logger';
import { checkSiteOnline } from '$lib/server/wordpress/site-check';

/**
 * POST — open the site's homepage and first product pages like a visitor,
 * after updates / a cache purge / a restore. Answers 200 with
 * `{ ok, pages }` whatever the site does; a site in trouble is logged.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);

	const [site] = await db
		.select({ id: table.wordpressSite.id, siteUrl: table.wordpressSite.siteUrl })
		.from(table.wordpressSite)
		.where(
			and(eq(table.wordpressSite.id, params.siteId), eq(table.wordpressSite.tenantId, locals.tenant.id))
		)
		.limit(1);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const outcome = await checkSiteOnline(site.siteUrl);
	const summary = outcome.pages.map((p) => `${p.url}=${p.status ?? 'x'}${p.problem ? ` (${p.problem})` : ''}`).join(', ');
	const log = outcome.ok ? logInfo : logWarning;
	log('wordpress', `Site check ${outcome.ok ? 'OK' : 'FAILED'} for ${site.siteUrl}: ${summary}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		metadata: { siteId: site.id, pages: outcome.pages }
	});
	return json(outcome);
};
