import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { desc, eq, inArray } from 'drizzle-orm';
import { fetchPagespeed } from '$lib/server/pagespeed/client';
import { getScanProgress } from '$lib/server/pagespeed/scan';
import { serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Sondă operațională pentru modulul PageSpeed (admin-only, tenant-scoped).
 *
 *   GET                — starea configurației: cheia API prezentă (NU valoarea),
 *                        nr. site-uri, ultima măsurătoare, scanare activă.
 *   GET ?probe=1       — un apel PSI real pe https://example.com/ (mobile) ca să
 *                        valideze cheia și conectivitatea (durează ~15-30 s).
 *
 * Cheia API nu apare niciodată în răspuns (criteriul de acceptanță 4).
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);

	const hasApiKey = !!env.PSI_API_KEY;
	const sites = await db
		.select({ id: table.pagespeedSite.id, active: table.pagespeedSite.active })
		.from(table.pagespeedSite)
		.where(eq(table.pagespeedSite.tenantId, tenantId));
	const siteIds = sites.map((s) => s.id);
	const [lastMeasurement] = siteIds.length
		? await db
				.select({
					measuredAt: table.pagespeedMeasurement.measuredAt,
					status: table.pagespeedMeasurement.status,
					strategy: table.pagespeedMeasurement.strategy
				})
				.from(table.pagespeedMeasurement)
				.where(inArray(table.pagespeedMeasurement.siteId, siteIds))
				.orderBy(desc(table.pagespeedMeasurement.measuredAt))
				.limit(1)
		: [];

	const result: Record<string, unknown> = {
		hasApiKey,
		siteCount: sites.length,
		activeSiteCount: sites.filter((s) => s.active).length,
		lastMeasurement: lastMeasurement ?? null,
		activeScan: await getScanProgress(tenantId)
	};

	if (event.url.searchParams.get('probe') === '1') {
		if (!hasApiKey) {
			result.probe = { ok: false, error: 'PSI_API_KEY lipsește din mediu' };
		} else {
			const startedAt = Date.now();
			try {
				const probe = await fetchPagespeed('https://example.com/', 'mobile');
				result.probe = {
					ok: true,
					durationMs: Date.now() - startedAt,
					performance: probe.performance
				};
			} catch (probeError) {
				result.probe = {
					ok: false,
					durationMs: Date.now() - startedAt,
					error: serializeError(probeError).message
				};
			}
		}
	}

	return json(result);
};
