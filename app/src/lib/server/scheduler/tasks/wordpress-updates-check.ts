import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncUpdates } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Daily check that asks every connected WordPress site for its pending
 * core/plugin/theme updates and caches them in `wordpress_pending_update`.
 * Runs sequentially per-site to avoid hammering shared hosting. Per-site
 * failures are swallowed — one bad site doesn't poison the batch.
 */
export async function processWordpressUpdatesCheck(_params: Record<string, unknown> = {}) {
	const sites = await db
		.select({ id: table.wordpressSite.id, siteUrl: table.wordpressSite.siteUrl, tenantId: table.wordpressSite.tenantId })
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.status, 'connected'),
				eq(table.wordpressSite.paused, 0)
			)
		);

	if (sites.length === 0) {
		return { success: true, checked: 0, totalUpdates: 0 };
	}

	let checked = 0;
	let totalUpdates = 0;
	let totalSecurity = 0;
	let failures = 0;

	for (const site of sites) {
		try {
			const result = await syncUpdates(site.id);
			checked++;
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

	logInfo('wordpress', `Updates check completed: ${checked}/${sites.length} sites, ${totalUpdates} updates (${totalSecurity} security)`, {
		metadata: { checked, sites: sites.length, totalUpdates, totalSecurity, failures }
	});

	return { success: true, checked, totalUpdates, totalSecurity, failures };
}
