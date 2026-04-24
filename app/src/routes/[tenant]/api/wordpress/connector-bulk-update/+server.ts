import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import {
	compareConnectorVersions,
	fetchConnectorRelease,
	getLatestConnectorRelease,
	updateConnectorVersionIfNewer
} from '$lib/server/wordpress/connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

type PerSiteResult = {
	siteId: string;
	name: string;
	url: string;
	status: 'updated' | 'already_current' | 'failed' | 'skipped_paused' | 'skipped_disconnected';
	fromVersion?: string | null;
	toVersion?: string | null;
	error?: string;
};

/**
 * POST — run the "push latest OTS Connector to every eligible site"
 * sweep on demand. Same logic as the daily cron
 * (`wordpress-connector-auto-update.ts`) but triggered by the operator
 * via the "Update connector" button.
 *
 * Eligibility: tenant-scoped, status ≠ 'disconnected', paused = 0.
 *
 * Returns a structured per-site list so the UI can render a summary
 * table ("12 updated, 3 already current, 1 failed — click for details").
 *
 * No auto-retry on failures here — the daily cron retries automatically
 * the next day, and the operator can re-click the button once they've
 * triaged an error.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	// Capture narrowed locals so the inner Promise.all closures don't lose
	// the not-null refinement (TS can't track narrowing through async maps).
	const actingUserId = locals.user.id;
	const tenantId = locals.tenant.id;

	const latest = await getLatestConnectorRelease();
	if (!latest) {
		return json(
			{ error: 'Nu există nicio versiune publicată pentru OTS Connector' },
			{ status: 404 }
		);
	}

	// Fetch the ZIP once, up front. Guarantees every site in this run
	// gets the same bytes even if someone publishes a new release
	// mid-sweep. Keeps S3 round-trips low.
	let zipBuffer: Buffer;
	try {
		const fetched = await fetchConnectorRelease(latest.version);
		zipBuffer = fetched.buffer;
	} catch (err) {
		const { message } = serializeError(err);
		logWarning('wordpress', `Bulk connector update: could not fetch v${latest.version}: ${message}`, {
			tenantId: locals.tenant.id
		});
		return json(
			{ error: `Nu am putut citi release-ul v${latest.version} din MinIO: ${message}` },
			{ status: 500 }
		);
	}
	const dataBase64 = zipBuffer.toString('base64');

	// Scope strictly to the current tenant — this button lives in a
	// tenant dashboard and must never leak into other tenants' sites.
	const sites = await db
		.select({
			id: table.wordpressSite.id,
			name: table.wordpressSite.name,
			tenantId: table.wordpressSite.tenantId,
			siteUrl: table.wordpressSite.siteUrl,
			secretKey: table.wordpressSite.secretKey,
			status: table.wordpressSite.status,
			paused: table.wordpressSite.paused,
			connectorVersion: table.wordpressSite.connectorVersion
		})
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.tenantId, locals.tenant.id));

	const results: PerSiteResult[] = [];

	// Small concurrent batches (4 at a time). Matches the scheduler's
	// cadence — one slow site doesn't dominate the whole sweep.
	const CONCURRENCY = 4;

	for (let i = 0; i < sites.length; i += CONCURRENCY) {
		const batch = sites.slice(i, i + CONCURRENCY);
		await Promise.all(
			batch.map(async (site) => {
				// Skip non-eligible sites but surface them in the result so
				// the UI can show "X skipped because paused/disconnected".
				if (site.paused === 1) {
					results.push({
						siteId: site.id,
						name: site.name,
						url: site.siteUrl,
						status: 'skipped_paused'
					});
					return;
				}
				if (site.status === 'disconnected') {
					results.push({
						siteId: site.id,
						name: site.name,
						url: site.siteUrl,
						status: 'skipped_disconnected'
					});
					return;
				}

				let secret: string;
				try {
					secret = decrypt(site.tenantId, site.secretKey);
				} catch (err) {
					if (err instanceof DecryptionError) {
						await new Promise((r) => setTimeout(r, 1000));
						const [fresh] = await db
							.select({ secretKey: table.wordpressSite.secretKey })
							.from(table.wordpressSite)
							.where(eq(table.wordpressSite.id, site.id))
							.limit(1);
						if (!fresh) {
							results.push({
								siteId: site.id,
								name: site.name,
								url: site.siteUrl,
								status: 'failed',
								error: 'Nu am găsit înregistrarea după retry decrypt'
							});
							return;
						}
						try {
							secret = decrypt(site.tenantId, fresh.secretKey);
						} catch (inner) {
							results.push({
								siteId: site.id,
								name: site.name,
								url: site.siteUrl,
								status: 'failed',
								error: `Decrypt failed: ${inner instanceof Error ? inner.message : 'unknown'}`
							});
							return;
						}
					} else {
						results.push({
							siteId: site.id,
							name: site.name,
							url: site.siteUrl,
							status: 'failed',
							error: err instanceof Error ? err.message : 'Decrypt failed'
						});
						return;
					}
				}

				const client = new WpClient(site.siteUrl, secret);

				// Live probe — the connectorVersion column can be stale
				// (PHP opcache issue we fixed in v0.6.5) or missing for
				// brand-new sites. A fresh /health beats the cache.
				let currentVersion: string | null = null;
				try {
					const health = await client.health({ siteId: site.id });
					currentVersion = health.connectorVersion ?? null;
				} catch (err) {
					const { message } = serializeError(err);
					const code = WpError.isWpError(err) ? err.code : 'unknown_error';
					const subcode = WpError.isWpError(err) ? err.subcode : undefined;
					// Per-site log entry so a failed health check is greppable by
					// siteId / siteUrl afterwards. Without this, the only evidence
					// would be the summary log at the end of the sweep.
					logWarning(
						'wordpress',
						`Bulk update health check failed: ${site.siteUrl}`,
						{
							tenantId: site.tenantId,
							userId: actingUserId,
							metadata: {
								siteId: site.id,
								code,
								subcode,
								phase: 'health'
							}
						}
					);
					results.push({
						siteId: site.id,
						name: site.name,
						url: site.siteUrl,
						status: 'failed',
						error: `Health check failed: ${message}`
					});
					return;
				}

				if (
					currentVersion &&
					compareConnectorVersions(currentVersion, latest.version) >= 0
				) {
					results.push({
						siteId: site.id,
						name: site.name,
						url: site.siteUrl,
						status: 'already_current',
						fromVersion: currentVersion,
						toVersion: latest.version
					});
					return;
				}

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
					await updateConnectorVersionIfNewer(site.id, latest.version);

					results.push({
						siteId: site.id,
						name: site.name,
						url: site.siteUrl,
						status: 'updated',
						fromVersion: currentVersion,
						toVersion: latest.version
					});
				} catch (err) {
					const { message } = serializeError(err);
					const code = WpError.isWpError(err) ? err.code : 'unknown_error';
					const subcode = WpError.isWpError(err) ? err.subcode : undefined;
					logWarning(
						'wordpress',
						`Bulk update install failed: ${site.siteUrl}`,
						{
							tenantId: site.tenantId,
							userId: actingUserId,
							metadata: {
								siteId: site.id,
								code,
								subcode,
								targetVersion: latest.version,
								fromVersion: currentVersion,
								phase: 'install'
							}
						}
					);
					results.push({
						siteId: site.id,
						name: site.name,
						url: site.siteUrl,
						status: 'failed',
						fromVersion: currentVersion,
						error: `${code}: ${message}`
					});
				}
			})
		);
	}

	// Preserve the input order in the response. Sites listed in the
	// same order as on the dashboard keeps the result dialog readable.
	const resultsById = new Map(results.map((r) => [r.siteId, r]));
	const ordered = sites
		.map((s) => resultsById.get(s.id))
		.filter((r): r is PerSiteResult => r !== undefined);

	const summary = {
		total: ordered.length,
		updated: ordered.filter((r) => r.status === 'updated').length,
		alreadyCurrent: ordered.filter((r) => r.status === 'already_current').length,
		failed: ordered.filter((r) => r.status === 'failed').length,
		skipped: ordered.filter(
			(r) => r.status === 'skipped_paused' || r.status === 'skipped_disconnected'
		).length
	};

	logInfo(
		'wordpress',
		`Bulk connector update sweep: ${summary.updated} updated / ${summary.alreadyCurrent} current / ${summary.failed} failed / ${summary.skipped} skipped (target v${latest.version})`,
		{
			tenantId: locals.tenant.id,
			userId: locals.user.id,
			metadata: { ...summary, targetVersion: latest.version }
		}
	);

	return json({
		success: true,
		targetVersion: latest.version,
		summary,
		results: ordered
	});
};
