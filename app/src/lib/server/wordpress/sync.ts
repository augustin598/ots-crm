import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from './client';
import { WpError } from './errors';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

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
