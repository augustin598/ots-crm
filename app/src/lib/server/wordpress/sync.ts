import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient, type WpUpdateItem } from './client';
import { WpError } from './errors';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Fetch a WordPress site row, decrypt its secret (retrying once on transient
 * decrypt failures per the Turso truncated-read pattern), and return a
 * ready-to-use HTTP client plus the row.
 */
async function loadSiteAndClient(siteId: string) {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, siteId))
		.limit(1);

	if (!site) {
		throw new Error(`WordPress site not found: ${siteId}`);
	}

	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (err instanceof DecryptionError) {
			// Retry once with a fresh DB read (Turso transient truncated reads).
			await new Promise((r) => setTimeout(r, 1000));
			const [freshSite] = await db
				.select()
				.from(table.wordpressSite)
				.where(eq(table.wordpressSite.id, siteId))
				.limit(1);
			if (!freshSite) {
				throw new Error(`WordPress site disappeared during decrypt retry: ${siteId}`);
			}
			secret = decrypt(freshSite.tenantId, freshSite.secretKey);
		} else {
			throw err;
		}
	}

	const client = new WpClient(site.siteUrl, secret);
	return { site, client };
}

/**
 * Call the plugin's /health endpoint and update the row with the returned
 * metadata. Marks the site `connected` on success, `error` after 3
 * consecutive failures. Returns a result summary suitable for UI/scheduler.
 */
export async function syncHealth(siteId: string): Promise<{
	ok: boolean;
	error?: string;
	health?: Awaited<ReturnType<WpClient['health']>>;
}> {
	const { site, client } = await loadSiteAndClient(siteId);

	try {
		const health = await client.health({ siteId });
		const now = new Date();

		await db
			.update(table.wordpressSite)
			.set({
				connectorVersion: health.connectorVersion,
				wpVersion: health.wpVersion,
				phpVersion: health.phpVersion,
				sslExpiresAt: health.sslExpiresAt ? new Date(health.sslExpiresAt) : null,
				lastHealthCheckAt: now,
				status: 'connected',
				lastError: null,
				consecutiveFailures: 0,
				updatedAt: now
			})
			.where(eq(table.wordpressSite.id, siteId));

		logInfo('wordpress', `Health check OK: ${site.siteUrl}`, {
			tenantId: site.tenantId,
			metadata: {
				siteId,
				wpVersion: health.wpVersion,
				phpVersion: health.phpVersion
			}
		});

		return { ok: true, health };
	} catch (err) {
		const { message, stack } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		const nextFailures = (site.consecutiveFailures ?? 0) + 1;
		const nextStatus = nextFailures >= 3 ? 'error' : site.status ?? 'pending';
		const now = new Date();

		await db
			.update(table.wordpressSite)
			.set({
				lastHealthCheckAt: now,
				status: nextStatus,
				lastError: `${code}: ${message}`.slice(0, 500),
				consecutiveFailures: nextFailures,
				updatedAt: now
			})
			.where(eq(table.wordpressSite.id, siteId));

		logWarning('wordpress', `Health check failed for ${site.siteUrl}: ${code}`, {
			tenantId: site.tenantId,
			metadata: { siteId, code, failures: nextFailures },
			stackTrace: stack
		});

		return { ok: false, error: message };
	}
}

/**
 * Fetch the plugin's /updates response and replace the site's cached pending
 * updates with the fresh set. Deletion + insert happens in a single logical
 * pass — we don't try to diff, because WP update transients are fully
 * authoritative (updates applied elsewhere disappear from the response).
 *
 * Returns the count of pending updates, broken down by type.
 */
export async function syncUpdates(siteId: string): Promise<{
	ok: boolean;
	error?: string;
	core: number;
	plugins: number;
	themes: number;
	security: number;
}> {
	const { site, client } = await loadSiteAndClient(siteId);

	let response: Awaited<ReturnType<WpClient['listUpdates']>>;
	try {
		response = await client.listUpdates({ siteId });
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `listUpdates failed for ${site.siteUrl}: ${code}`, {
			tenantId: site.tenantId,
			metadata: { siteId, code }
		});
		await db
			.update(table.wordpressSite)
			.set({ lastUpdatesCheckAt: new Date(), updatedAt: new Date() })
			.where(eq(table.wordpressSite.id, siteId));
		return { ok: false, error: message, core: 0, plugins: 0, themes: 0, security: 0 };
	}

	// Replace the cached set atomically: delete old rows, insert new ones.
	// We do it in a transaction so a crash mid-way doesn't leave us with an
	// empty cache that the UI interprets as "no updates pending".
	const now = new Date();
	const items: WpUpdateItem[] = response.items ?? [];

	await db.transaction(async (tx) => {
		await tx
			.delete(table.wordpressPendingUpdate)
			.where(eq(table.wordpressPendingUpdate.siteId, siteId));

		if (items.length > 0) {
			await tx.insert(table.wordpressPendingUpdate).values(
				items.map((item) => ({
					id: newId(),
					tenantId: site.tenantId,
					siteId,
					type: item.type,
					slug: item.slug,
					name: item.name || item.slug,
					currentVersion: item.currentVersion,
					newVersion: item.newVersion,
					securityUpdate: item.securityUpdate ? 1 : 0,
					autoUpdate: item.autoUpdate ? 1 : 0,
					detectedAt: now
				}))
			);
		}

		await tx
			.update(table.wordpressSite)
			.set({ lastUpdatesCheckAt: now, updatedAt: now })
			.where(eq(table.wordpressSite.id, siteId));
	});

	const core = items.filter((i) => i.type === 'core').length;
	const plugins = items.filter((i) => i.type === 'plugin').length;
	const themes = items.filter((i) => i.type === 'theme').length;
	const security = items.filter((i) => i.securityUpdate).length;

	logInfo('wordpress', `Updates synced for ${site.siteUrl}`, {
		tenantId: site.tenantId,
		metadata: { siteId, core, plugins, themes, security }
	});

	return { ok: true, core, plugins, themes, security };
}

/**
 * Lightweight uptime ping: HEAD on the site root, no plugin required. Updates
 * `uptimeStatus` and `lastUptimePingAt`. This runs on a tight cadence (every
 * 5 min) and is independent from the authenticated /health endpoint — so
 * we still surface outages even if the plugin is disabled.
 */
export async function pingUptime(siteId: string): Promise<'up' | 'down'> {
	const [site] = await db
		.select({
			id: table.wordpressSite.id,
			tenantId: table.wordpressSite.tenantId,
			siteUrl: table.wordpressSite.siteUrl
		})
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, siteId))
		.limit(1);

	if (!site) {
		throw new Error(`WordPress site not found: ${siteId}`);
	}

	let status: 'up' | 'down' = 'down';
	try {
		const response = await fetch(site.siteUrl, {
			method: 'HEAD',
			signal: AbortSignal.timeout(10_000),
			redirect: 'follow'
		});
		// 2xx/3xx/401/403 all mean the server is responding; only 5xx or
		// network errors count as "down".
		status = response.status < 500 ? 'up' : 'down';
	} catch {
		status = 'down';
	}

	const now = new Date();
	await db
		.update(table.wordpressSite)
		.set({
			uptimeStatus: status,
			lastUptimePingAt: now,
			updatedAt: now
		})
		.where(eq(table.wordpressSite.id, siteId));

	return status;
}
