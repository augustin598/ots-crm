import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import {
	compareConnectorVersions,
	getLatestConnectorRelease
} from '$lib/server/wordpress/connector-release';
import { logInfo, serializeError } from '$lib/server/logger';

/**
 * Shape of the diagnostics payload. One entry per site, plus a global
 * section with the latest connector release pointer.
 *
 * Designed for a human-readable dashboard, not programmatic consumption —
 * field names match UI labels to avoid an extra mapping layer.
 */
type SiteDiagnostic = {
	id: string;
	name: string;
	url: string;
	clientName: string | null;
	status: 'connected' | 'disconnected' | 'error' | 'pending';
	paused: number;
	uptimeStatus: 'up' | 'down' | 'unknown';
	consecutiveFailures: number;
	wpVersion: string | null;
	phpVersion: string | null;
	sslExpiresAt: string | null;
	lastHealthCheckAt: string | null;
	lastUptimePingAt: string | null;
	lastUpdatesCheckAt: string | null;
	lastError: string | null;

	// Connector version: DB snapshot vs. what /health returns right now.
	// Mismatch usually means either PHP opcache (fixed in v0.6.5) or the
	// site was updated via a channel outside the CRM.
	connectorVersionDb: string | null;
	connectorVersionLive: string | null;
	connectorVersionAgree: boolean | null; // null when live fetch failed
	liveHealthError: string | null;
	liveHealthSubcode: string | null;

	// Is the site on the latest published connector? Computed from the
	// same `compareConnectorVersions` the cron uses, so the badge mirrors
	// what auto-update will do tonight.
	onLatestConnector: boolean | null;

	// Last 10 log entries for source='wordpress' mentioning this site.
	recentLogs: Array<{
		id: string;
		level: 'info' | 'warning' | 'error';
		message: string;
		createdAt: string;
		errorCode: string | null;
	}>;
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const tenantId = locals.tenant.id;

	const sites = await db
		.select({
			id: table.wordpressSite.id,
			name: table.wordpressSite.name,
			siteUrl: table.wordpressSite.siteUrl,
			secretKey: table.wordpressSite.secretKey,
			status: table.wordpressSite.status,
			paused: table.wordpressSite.paused,
			uptimeStatus: table.wordpressSite.uptimeStatus,
			consecutiveFailures: table.wordpressSite.consecutiveFailures,
			wpVersion: table.wordpressSite.wpVersion,
			phpVersion: table.wordpressSite.phpVersion,
			sslExpiresAt: table.wordpressSite.sslExpiresAt,
			lastHealthCheckAt: table.wordpressSite.lastHealthCheckAt,
			lastUptimePingAt: table.wordpressSite.lastUptimePingAt,
			lastUpdatesCheckAt: table.wordpressSite.lastUpdatesCheckAt,
			lastError: table.wordpressSite.lastError,
			connectorVersion: table.wordpressSite.connectorVersion,
			clientId: table.wordpressSite.clientId,
			clientName: table.client.name,
			tenantId: table.wordpressSite.tenantId
		})
		.from(table.wordpressSite)
		.leftJoin(table.client, eq(table.client.id, table.wordpressSite.clientId))
		.where(eq(table.wordpressSite.tenantId, tenantId))
		.orderBy(table.wordpressSite.name);

	const latestRelease = await getLatestConnectorRelease();

	// Concurrent live health probes + log lookups. Bounded at 6 so a
	// tenant with 100+ sites doesn't fan out to 100 simultaneous fetches.
	const CONCURRENCY = 6;
	const diagnostics: SiteDiagnostic[] = [];
	for (let i = 0; i < sites.length; i += CONCURRENCY) {
		const batch = sites.slice(i, i + CONCURRENCY);
		const batchResults = await Promise.all(
			batch.map(async (site) => buildSiteDiagnostic(site, latestRelease?.version ?? null, tenantId))
		);
		diagnostics.push(...batchResults);
	}

	logInfo('wordpress', `Diagnostics pulled for ${sites.length} site(s)`, {
		tenantId,
		userId: locals.user.id,
		metadata: {
			siteCount: sites.length,
			latestConnector: latestRelease?.version ?? null
		}
	});

	return json({
		tenantId,
		fetchedAt: new Date().toISOString(),
		latestConnector: latestRelease
			? {
					version: latestRelease.version,
					uploadedAt: latestRelease.uploadedAt,
					notes: latestRelease.notes ?? null
				}
			: null,
		sites: diagnostics
	});
};

/**
 * Build the per-site diagnostic entry. Probes /health live, reads recent
 * logs, and computes derived fields (version drift, latest-match).
 */
async function buildSiteDiagnostic(
	site: {
		id: string;
		name: string;
		siteUrl: string;
		secretKey: string;
		status: string;
		paused: number;
		uptimeStatus: string;
		consecutiveFailures: number;
		wpVersion: string | null;
		phpVersion: string | null;
		sslExpiresAt: Date | null;
		lastHealthCheckAt: Date | null;
		lastUptimePingAt: Date | null;
		lastUpdatesCheckAt: Date | null;
		lastError: string | null;
		connectorVersion: string | null;
		clientName: string | null;
		tenantId: string;
	},
	latestVersion: string | null,
	tenantId: string
): Promise<SiteDiagnostic> {
	// Fetch recent logs first — cheap DB query, runs even if the site
	// is unreachable.
	const recentLogs = await db
		.select({
			id: table.debugLog.id,
			level: table.debugLog.level,
			message: table.debugLog.message,
			createdAt: table.debugLog.createdAt,
			errorCode: table.debugLog.errorCode
		})
		.from(table.debugLog)
		.where(
			and(
				eq(table.debugLog.tenantId, tenantId),
				eq(table.debugLog.source, 'wordpress'),
				// Metadata is JSON-encoded text; a simple LIKE is the fastest
				// way to find entries tied to this siteId without a dedicated
				// index. Good enough for a diagnostics page — we display 10.
				like(table.debugLog.metadata, `%"siteId":"${site.id}"%`)
			)
		)
		.orderBy(desc(table.debugLog.createdAt))
		.limit(10);

	// Try a live /health. Paused or disconnected sites skip the probe —
	// we still want their DB state visible.
	let connectorVersionLive: string | null = null;
	let liveHealthError: string | null = null;
	let liveHealthSubcode: string | null = null;

	if (site.status !== 'disconnected' && site.paused === 0) {
		try {
			let secret: string;
			try {
				secret = decrypt(site.tenantId, site.secretKey);
			} catch (err) {
				if (err instanceof DecryptionError) {
					await new Promise((r) => setTimeout(r, 500));
					const [fresh] = await db
						.select({ secretKey: table.wordpressSite.secretKey })
						.from(table.wordpressSite)
						.where(eq(table.wordpressSite.id, site.id))
						.limit(1);
					if (!fresh) throw err;
					secret = decrypt(site.tenantId, fresh.secretKey);
				} else {
					throw err;
				}
			}

			const client = new WpClient(site.siteUrl, secret);
			// Short timeout — diagnostics is meant to be fast. A slow site
			// gets marked live=unknown rather than blocking the dashboard.
			const health = await client.health({ siteId: site.id, timeoutMs: 8_000 });
			connectorVersionLive = health.connectorVersion ?? null;
		} catch (err) {
			const { message } = serializeError(err);
			liveHealthError = message;
			liveHealthSubcode =
				WpError.isWpError(err) ? (err.subcode ?? err.code) : 'unknown_error';
		}
	}

	const connectorVersionAgree =
		connectorVersionLive === null
			? null
			: connectorVersionLive === site.connectorVersion;

	const onLatestConnector =
		connectorVersionLive === null || latestVersion === null
			? null
			: compareConnectorVersions(connectorVersionLive, latestVersion) >= 0;

	return {
		id: site.id,
		name: site.name,
		url: site.siteUrl,
		clientName: site.clientName,
		status: site.status as SiteDiagnostic['status'],
		paused: site.paused,
		uptimeStatus: site.uptimeStatus as SiteDiagnostic['uptimeStatus'],
		consecutiveFailures: site.consecutiveFailures,
		wpVersion: site.wpVersion,
		phpVersion: site.phpVersion,
		sslExpiresAt: site.sslExpiresAt?.toISOString() ?? null,
		lastHealthCheckAt: site.lastHealthCheckAt?.toISOString() ?? null,
		lastUptimePingAt: site.lastUptimePingAt?.toISOString() ?? null,
		lastUpdatesCheckAt: site.lastUpdatesCheckAt?.toISOString() ?? null,
		lastError: site.lastError,
		connectorVersionDb: site.connectorVersion,
		connectorVersionLive,
		connectorVersionAgree,
		liveHealthError,
		liveHealthSubcode,
		onLatestConnector,
		recentLogs: recentLogs.map((l) => ({
			id: l.id,
			level: l.level as 'info' | 'warning' | 'error',
			message: l.message,
			createdAt: l.createdAt.toISOString(),
			errorCode: l.errorCode
		}))
	};
};

// Silence unused import warning from `sql` — kept in case we later need
// it for raw JSON extracts, which would bypass the LIKE scan.
void sql;
