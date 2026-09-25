import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from './client';

export type WordpressSiteRow = typeof table.wordpressSite.$inferSelect;

/**
 * Load a WordPress site (tenant-scoped) and an authenticated connector
 * client for it. Same logic the per-site API routes inline: a truncated
 * Turso read can make `decrypt` fail once, so retry after a short pause
 * with a fresh row before giving up.
 *
 * Returns null when the site does not exist for this tenant — callers
 * answer 404 without leaking whether the id exists elsewhere.
 */
export async function loadSiteAndClient(
	siteId: string,
	tenantId: string
): Promise<{ site: WordpressSiteRow; client: WpClient } | null> {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) return null;
	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (err instanceof DecryptionError) {
			await new Promise((r) => setTimeout(r, 1000));
			const [fresh] = await db
				.select()
				.from(table.wordpressSite)
				.where(
					and(eq(table.wordpressSite.id, site.id), eq(table.wordpressSite.tenantId, tenantId))
				)
				.limit(1);
			if (!fresh) return null;
			secret = decrypt(fresh.tenantId, fresh.secretKey);
		} else {
			throw err;
		}
	}
	return { site, client: new WpClient(site.siteUrl, secret) };
}
