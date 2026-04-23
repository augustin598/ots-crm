import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { syncUpdates } from '$lib/server/wordpress/sync';

async function ensureSiteAccess(siteId: string, tenantId: string) {
	const [site] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, siteId),
				eq(table.wordpressSite.tenantId, tenantId)
			)
		)
		.limit(1);
	return site;
}

/** GET — return cached pending updates for this site, ordered by type. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const site = await ensureSiteAccess(params.siteId, locals.tenant.id);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const updates = await db
		.select({
			id: table.wordpressPendingUpdate.id,
			type: table.wordpressPendingUpdate.type,
			slug: table.wordpressPendingUpdate.slug,
			name: table.wordpressPendingUpdate.name,
			currentVersion: table.wordpressPendingUpdate.currentVersion,
			newVersion: table.wordpressPendingUpdate.newVersion,
			securityUpdate: table.wordpressPendingUpdate.securityUpdate,
			autoUpdate: table.wordpressPendingUpdate.autoUpdate,
			detectedAt: table.wordpressPendingUpdate.detectedAt
		})
		.from(table.wordpressPendingUpdate)
		.where(eq(table.wordpressPendingUpdate.siteId, site.id))
		.orderBy(asc(table.wordpressPendingUpdate.type), asc(table.wordpressPendingUpdate.name));

	return json({ updates });
};

/** POST — force refresh the cache by calling the plugin's /updates endpoint. */
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const site = await ensureSiteAccess(params.siteId, locals.tenant.id);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const result = await syncUpdates(site.id);
	return json(result);
};
