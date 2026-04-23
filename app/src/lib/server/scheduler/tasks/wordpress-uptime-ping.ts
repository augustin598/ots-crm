import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { ne } from 'drizzle-orm';
import { pingUptime } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Ping every WordPress site's root URL with a HEAD request to detect
 * outages independently of the plugin's `/health` endpoint. Runs every
 * 5 minutes. Failures in individual pings are swallowed per-site so one
 * bad site doesn't poison the batch.
 */
export async function processWordpressUptimePing(_params: Record<string, unknown> = {}) {
	const sites = await db
		.select({
			id: table.wordpressSite.id,
			tenantId: table.wordpressSite.tenantId,
			siteUrl: table.wordpressSite.siteUrl
		})
		.from(table.wordpressSite)
		.where(ne(table.wordpressSite.status, 'disconnected'));

	if (sites.length === 0) {
		return { success: true, checked: 0, up: 0, down: 0 };
	}

	// Fire the pings in parallel but with a modest cap so we don't run away
	// on a tenant with hundreds of sites.
	const CONCURRENCY = 10;
	let up = 0;
	let down = 0;

	for (let i = 0; i < sites.length; i += CONCURRENCY) {
		const batch = sites.slice(i, i + CONCURRENCY);
		const results = await Promise.allSettled(batch.map((s) => pingUptime(s.id)));
		results.forEach((r, idx) => {
			const site = batch[idx];
			if (r.status === 'fulfilled') {
				if (r.value === 'up') up++;
				else down++;
			} else {
				down++;
				const { message } = serializeError(r.reason);
				logWarning('wordpress', `Uptime ping errored for ${site.siteUrl}: ${message}`, {
					tenantId: site.tenantId,
					metadata: { siteId: site.id }
				});
			}
		});
	}

	logInfo('wordpress', `Uptime ping: ${sites.length} checked (${up} up, ${down} down)`, {
		metadata: { checked: sites.length, up, down }
	});

	return { success: true, checked: sites.length, up, down };
}
