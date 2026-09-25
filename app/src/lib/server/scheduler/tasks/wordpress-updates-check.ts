import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { syncHealth, syncUpdates } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Daily check (04:00) for every unpaused WordPress site:
 *   1. signed `/health` → refreshes status, versions and `lastHealthCheckAt`
 *      (`syncHealth` flips to `disconnected` when the HMAC is rejected or the
 *      connector is gone, `connected` again when it recovers);
 *   2. only when health passed: pending core/plugin/theme updates into
 *      `wordpress_pending_update`.
 *
 * Until 2026-09-25 this job ran step 2 only, and only for sites already
 * marked `connected`, so nothing ever re-verified a site after it was added:
 * Meduza showed "connected" for weeks with its signature rejected, and the
 * other sites carried health checks from May/July.
 *
 * Runs sequentially per site to avoid hammering shared hosting. Per-site
 * failures are swallowed — one bad site doesn't poison the batch.
 */
export async function processWordpressUpdatesCheck(_params: Record<string, unknown> = {}) {
	const sites = await db
		.select({ id: table.wordpressSite.id, siteUrl: table.wordpressSite.siteUrl, tenantId: table.wordpressSite.tenantId })
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.paused, 0));

	if (sites.length === 0) {
		return { success: true, checked: 0, healthy: 0, unhealthy: 0, totalUpdates: 0 };
	}

	let checked = 0;
	let healthy = 0;
	let unhealthy = 0;
	let totalUpdates = 0;
	let totalSecurity = 0;
	let failures = 0;

	for (const site of sites) {
		try {
			checked++;
			const health = await syncHealth(site.id);
			if (!health.ok) {
				unhealthy++;
				continue;
			}
			healthy++;
			const result = await syncUpdates(site.id);
			if (result.ok) {
				totalUpdates += result.core + result.plugins + result.themes;
				totalSecurity += result.security;
			} else {
				failures++;
			}
		} catch (err) {
			failures++;
			const { message, stack } = serializeError(err);
			logWarning('wordpress', `Updates check threw for ${site.siteUrl}: ${message}`, {
				tenantId: site.tenantId,
				metadata: { siteId: site.id },
				stackTrace: stack
			});
		}
	}

	logInfo(
		'wordpress',
		`Updates check completed: ${checked} sites (${healthy} healthy, ${unhealthy} unhealthy), ${totalUpdates} updates (${totalSecurity} security)`,
		{ metadata: { checked, healthy, unhealthy, totalUpdates, totalSecurity, failures } }
	);

	return { success: true, checked, healthy, unhealthy, totalUpdates, totalSecurity, failures };
}
