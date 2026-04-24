import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { WpClient } from '$lib/server/wordpress/client';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import {
	compareConnectorVersions,
	fetchConnectorRelease,
	getLatestConnectorRelease,
	updateConnectorVersionIfNewer
} from '$lib/server/wordpress/connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Push the latest OTS Connector release to every unpaused, reachable
 * WordPress site whose connector version is older than the release on
 * MinIO. Runs daily via the scheduler.
 *
 * Why daily (not hourly):
 *   - The connector is infrastructure for *other* operations on the
 *     site (updates, uptime pings). We don't want to self-update
 *     during business hours if a new release has a regression.
 *   - Operators still have the manual "Update connector" button per
 *     site for urgent rollouts.
 *
 * Per-site isolation: each site runs in its own try/catch. One bad
 * site never blocks the rest of the batch. A site that 502s three
 * runs in a row gets logged but isn't removed from the queue — the
 * consecutive-failures counter on the site row is a separate concern.
 *
 * Skip conditions:
 *   - `status = 'disconnected'`: site's secret rotated or connector
 *     missing; self-update won't work without a working connector.
 *   - `paused = 1`: operator explicitly opted out of scheduler runs
 *     for this site.
 */
export async function processWordpressConnectorAutoUpdate(
	_params: Record<string, unknown> = {}
) {
	// Fetch the latest release pointer once per run.
	const latest = await getLatestConnectorRelease();
	if (!latest) {
		logInfo(
			'wordpress',
			'Connector auto-update: no releases published yet; nothing to do'
		);
		return { success: true, checked: 0, updated: 0, skipped: 0, failed: 0 };
	}

	// Pre-fetch the ZIP buffer once. Saves one MinIO round-trip per site
	// and guarantees all sites in this run get the exact same bytes
	// (protects against a mid-run `latest` rollover).
	let zipBuffer: Buffer;
	try {
		const fetched = await fetchConnectorRelease(latest.version);
		zipBuffer = fetched.buffer;
	} catch (err) {
		const { message } = serializeError(err);
		logWarning(
			'wordpress',
			`Connector auto-update: could not fetch release v${latest.version}: ${message}`
		);
		return { success: false, checked: 0, updated: 0, skipped: 0, failed: 0 };
	}
	const dataBase64 = zipBuffer.toString('base64');

	const sites = await db
		.select({
			id: table.wordpressSite.id,
			tenantId: table.wordpressSite.tenantId,
			siteUrl: table.wordpressSite.siteUrl,
			secretKey: table.wordpressSite.secretKey,
			connectorVersion: table.wordpressSite.connectorVersion
		})
		.from(table.wordpressSite)
		.where(
			and(
				ne(table.wordpressSite.status, 'disconnected'),
				eq(table.wordpressSite.paused, 0)
			)
		);

	if (sites.length === 0) {
		return { success: true, checked: 0, updated: 0, skipped: 0, failed: 0 };
	}

	let updated = 0;
	let skipped = 0;
	let failed = 0;

	// Run in small concurrent batches. Higher concurrency would let one
	// slow shared-hosting site dominate the run; 4 is the goldilocks
	// for a fleet of ~20 sites (full run under ~45s in practice).
	const CONCURRENCY = 4;

	for (let i = 0; i < sites.length; i += CONCURRENCY) {
		const batch = sites.slice(i, i + CONCURRENCY);
		await Promise.all(
			batch.map(async (site) => {
				let secret: string;
				try {
					secret = decrypt(site.tenantId, site.secretKey);
				} catch (err) {
					// Retry once on the Turso truncated-read pattern.
					if (err instanceof DecryptionError) {
						await new Promise((r) => setTimeout(r, 1000));
						const [fresh] = await db
							.select({ secretKey: table.wordpressSite.secretKey })
							.from(table.wordpressSite)
							.where(eq(table.wordpressSite.id, site.id))
							.limit(1);
						if (!fresh) {
							failed++;
							return;
						}
						try {
							secret = decrypt(site.tenantId, fresh.secretKey);
						} catch {
							failed++;
							return;
						}
					} else {
						failed++;
						return;
					}
				}

				const client = new WpClient(site.siteUrl, secret);

				// Probe /health to learn the actual version on disk. The
				// wordpress_site.connectorVersion column is our cached guess,
				// refreshed by the updates-check task — but it might be stale
				// if the user uploaded the plugin manually.
				let currentVersion: string | null = null;
				try {
					const health = await client.health({ siteId: site.id });
					currentVersion = health.connectorVersion ?? null;
				} catch (err) {
					failed++;
					logWarning(
						'wordpress',
						`Auto-update: health check failed for ${site.siteUrl}`,
						{
							tenantId: site.tenantId,
							metadata: {
								siteId: site.id,
								reason: err instanceof Error ? err.message : 'unknown'
							}
						}
					);
					return;
				}

				if (
					currentVersion &&
					compareConnectorVersions(currentVersion, latest.version) >= 0
				) {
					skipped++;
					return;
				}

				// Push the update.
				try {
					await client.installPlugin(
						{
							filename: `ots-wp-connector-v${latest.version}.zip`,
							mimeType: 'application/zip',
							dataBase64,
							activate: false
						},
						{ siteId: site.id, timeoutMs: 120_000 }
					);
					// Persist the new version so subsequent runs can short-circuit.
					// Optimistic write — a concurrent manual update fires the
					// same helper and only the strictly-newer write wins.
					await updateConnectorVersionIfNewer(site.id, latest.version);
					updated++;
					logInfo(
						'wordpress',
						`Auto-update: ${site.siteUrl} ${currentVersion ?? '?'} → ${latest.version}`,
						{
							tenantId: site.tenantId,
							metadata: { siteId: site.id, from: currentVersion, to: latest.version }
						}
					);
				} catch (err) {
					failed++;
					const { message } = serializeError(err);
					logWarning(
						'wordpress',
						`Auto-update: push failed for ${site.siteUrl}: ${message}`,
						{
							tenantId: site.tenantId,
							metadata: { siteId: site.id, to: latest.version }
						}
					);
				}
			})
		);
	}

	logInfo(
		'wordpress',
		`Connector auto-update sweep: ${sites.length} checked, ${updated} updated, ${skipped} already current, ${failed} failed`,
		{ metadata: { target: latest.version, updated, skipped, failed } }
	);

	return {
		success: failed === 0,
		checked: sites.length,
		updated,
		skipped,
		failed,
		targetVersion: latest.version
	};
}
