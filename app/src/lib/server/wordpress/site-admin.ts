import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { syncHealth } from './sync';

/**
 * Remove a WordPress site from the CRM (the WP install itself is untouched).
 *
 * Pending updates, jobs, backups and posts go with it via ON DELETE CASCADE.
 * `client_website.wp_site_id` and `content_article.target_wp_site_id` have no
 * FK in the database (added by ALTER TABLE), so they are unlinked explicitly —
 * otherwise the SEO hub keeps reporting "WP connected" and the publisher
 * targets a site that no longer exists.
 *
 * Returns false when the site does not belong to this tenant.
 */
export async function deleteWordpressSite(tenantId: string, siteId: string): Promise<boolean> {
	const [site] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) return false;

	const now = new Date();
	await db
		.update(table.clientWebsite)
		.set({ wpSiteId: null, updatedAt: now })
		.where(and(eq(table.clientWebsite.tenantId, tenantId), eq(table.clientWebsite.wpSiteId, site.id)));
	await db
		.update(table.contentArticle)
		.set({ targetWpSiteId: null })
		.where(
			and(eq(table.contentArticle.tenantId, tenantId), eq(table.contentArticle.targetWpSiteId, site.id))
		);
	await db.delete(table.wordpressSite).where(eq(table.wordpressSite.id, site.id));
	return true;
}

/**
 * Live signed `/health` on every unpaused site of the tenant, so the list
 * shows the connection as it is now instead of whatever the last cron or
 * manual refresh left in the row. `syncHealth` persists the outcome (status,
 * versions, lastError, lastHealthCheckAt). Small batches keep shared hosting
 * happy; each call is bounded by the client's 10s health timeout.
 */
export async function checkTenantSitesHealth(
	tenantId: string,
	concurrency = 4
): Promise<{ checked: number; ok: number; failed: number }> {
	const sites = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.tenantId, tenantId), eq(table.wordpressSite.paused, 0)));

	let ok = 0;
	let failed = 0;
	for (let i = 0; i < sites.length; i += concurrency) {
		const batch = sites.slice(i, i + concurrency);
		const results = await Promise.allSettled(batch.map((s) => syncHealth(s.id)));
		for (const r of results) {
			if (r.status === 'fulfilled' && r.value.ok) ok++;
			else failed++;
		}
	}
	return { checked: sites.length, ok, failed };
}
