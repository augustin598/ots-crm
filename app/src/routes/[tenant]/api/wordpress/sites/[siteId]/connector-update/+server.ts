import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import {
	fetchConnectorRelease,
	getLatestConnectorRelease,
	compareConnectorVersions,
	updateConnectorVersionIfNewer
} from '$lib/server/wordpress/connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

async function loadSiteAndClient(siteId: string, tenantId: string) {
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
				.where(eq(table.wordpressSite.id, site.id))
				.limit(1);
			secret = decrypt(fresh!.tenantId, fresh!.secretKey);
		} else {
			throw err;
		}
	}
	return { site, client: new WpClient(site.siteUrl, secret) };
}

/**
 * GET — report which connector version the site is running and whether
 * a newer release exists on MinIO.
 *
 * Intentionally does NOT trigger an update — gives the UI enough info
 * to decide whether to enable the "Update connector" button.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	let siteVersion: string | null = null;
	let siteReachable = true;
	try {
		const health = await ctx.client.health({ siteId: ctx.site.id });
		siteVersion = health.connectorVersion ?? null;
	} catch (err) {
		siteReachable = false;
		logWarning('wordpress', `Connector-update GET: site unreachable ${ctx.site.siteUrl}`, {
			metadata: { siteId: ctx.site.id, reason: err instanceof Error ? err.message : 'unknown' }
		});
	}

	const latest = await getLatestConnectorRelease();
	const latestVersion = latest?.version ?? null;

	const canUpdate =
		siteReachable &&
		siteVersion !== null &&
		latestVersion !== null &&
		compareConnectorVersions(siteVersion, latestVersion) < 0;

	return json({
		site: {
			id: ctx.site.id,
			url: ctx.site.siteUrl,
			reachable: siteReachable,
			connectorVersion: siteVersion
		},
		latest: latestVersion
			? {
					version: latestVersion,
					sha256: latest!.sha256,
					size: latest!.size,
					uploadedAt: latest!.uploadedAt,
					notes: latest!.notes ?? null
				}
			: null,
		canUpdate
	});
};

/**
 * POST — push the latest (or a specific) connector release to the site
 * by fetching the ZIP from MinIO and re-using the connector's own
 * `/plugins/install` endpoint with `overwrite_package=true`. The
 * connector replaces itself on-the-fly; the request completes before
 * the new code loads (WP's Plugin_Upgrader writes files at the end
 * of its run), so the same request that triggered the swap cleanly
 * returns a success response.
 *
 * Body (optional): { version?: string, force?: boolean }
 *   - version: pin to a specific release; defaults to latest
 *   - force:   ignore the "already up to date" check and reinstall
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => ({}))) as {
		version?: string;
		force?: boolean;
	};

	// Decide target version.
	let targetVersion: string;
	if (body.version) {
		targetVersion = body.version;
	} else {
		const latest = await getLatestConnectorRelease();
		if (!latest) {
			return json(
				{ error: 'Nu există nicio versiune publicată pentru OTS Connector' },
				{ status: 404 }
			);
		}
		targetVersion = latest.version;
	}

	// Health-check the site (and get its current version) before doing work.
	let currentVersion: string | null = null;
	try {
		const health = await ctx.client.health({ siteId: ctx.site.id });
		currentVersion = health.connectorVersion ?? null;
	} catch (err) {
		const { message } = serializeError(err);
		return json(
			{
				error: `Site inaccesibil: ${message}`,
				code: WpError.isWpError(err) ? err.code : 'unknown_error'
			},
			{ status: 502 }
		);
	}

	if (
		currentVersion &&
		compareConnectorVersions(currentVersion, targetVersion) >= 0 &&
		!body.force
	) {
		return json({
			success: true,
			skipped: true,
			reason: 'already_up_to_date',
			// Use the same field names as the non-skipped path so the client
			// can read `toVersion` unconditionally in toasts.
			fromVersion: currentVersion,
			toVersion: targetVersion
		});
	}

	// Fetch the ZIP from MinIO and forward to the site.
	let zipBuffer: Buffer;
	let metadata;
	try {
		const fetched = await fetchConnectorRelease(targetVersion);
		zipBuffer = fetched.buffer;
		metadata = fetched.metadata;
	} catch (err) {
		const { message } = serializeError(err);
		logWarning('wordpress', `Connector release fetch failed: v${targetVersion}`, {
			tenantId: ctx.site.tenantId,
			metadata: { version: targetVersion, reason: message }
		});
		return json(
			{ error: `Nu am putut citi release-ul v${targetVersion} din MinIO: ${message}` },
			{ status: 500 }
		);
	}

	// Push to site via existing install endpoint. activate=false because
	// the connector is already active and re-activating while it's
	// currently handling the request is an edge case that WP Plugin_Upgrader
	// handles via its own active-state preservation — but only when the
	// request completes cleanly, so we prefer the explicit "do nothing"
	// path here. A future admin-side reactivation isn't needed because
	// the plugin stays active across upgrade.
	const dataBase64 = zipBuffer.toString('base64');
	try {
		const result = await ctx.client.installPlugin(
			{
				filename: `ots-wp-connector-v${targetVersion}.zip`,
				mimeType: 'application/zip',
				dataBase64,
				activate: false
			},
			{ siteId: ctx.site.id, timeoutMs: 120_000 }
		);

		// Persist the new version on the site row so the dashboard's
		// "update available" indicator clears on the next list refresh.
		// Uses the optimistic helper so a concurrent bulk/cron run can't
		// roll this back.
		await updateConnectorVersionIfNewer(ctx.site.id, targetVersion);

		logInfo(
			'wordpress',
			`OTS Connector updated on ${ctx.site.siteUrl}: ${currentVersion ?? '?'} → ${targetVersion}`,
			{
				tenantId: ctx.site.tenantId,
				userId: locals.user.id,
				metadata: {
					siteId: ctx.site.id,
					from: currentVersion,
					to: targetVersion,
					sha256: metadata.sha256.slice(0, 12)
				}
			}
		);

		return json({
			success: true,
			skipped: false,
			fromVersion: currentVersion,
			toVersion: targetVersion,
			installedAs: result.plugin,
			sha256: metadata.sha256
		});
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning(
			'wordpress',
			`Connector self-update failed on ${ctx.site.siteUrl}: ${message}`,
			{
				tenantId: ctx.site.tenantId,
				userId: locals.user.id,
				metadata: { siteId: ctx.site.id, to: targetVersion, code }
			}
		);
		return json({ error: `${code}: ${message}` }, { status: 502 });
	}
};
