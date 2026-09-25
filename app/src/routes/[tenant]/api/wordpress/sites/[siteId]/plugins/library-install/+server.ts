import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { WpError } from '$lib/server/wordpress/errors';
import type { WpClient } from '$lib/server/wordpress/client';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { fetchLibraryPluginZip, getLibraryPlugin } from '$lib/server/wordpress/plugin-library';
import { compareWpVersions } from '$lib/server/wordpress/plugin-match';
import { normalizePluginZip } from '$lib/server/wordpress/plugin-zip';
import { syncUpdates } from '$lib/server/wordpress/sync';
import { pluginFolder } from '$lib/logic/wordpress-plugin-dependencies';

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** The connector signs with a ±60 s window; long uploads can outlive it. */
const HMAC_WINDOW_HINT_MS = 50_000;

/**
 * After a transport error, ask the site what it actually runs. A long
 * install can finish on WordPress while the CRM gets a timeout, a proxy
 * 5xx or a replayed request rejected by the 60 s HMAC window (seen on
 * heylux.ro, 2026-09-25: WPForms updated, CRM received HTTP 401).
 */
async function verifyInstalled(
	client: WpClient,
	siteId: string,
	folder: string,
	targetVersion: string
): Promise<{ plugin: string; version: string; active: boolean } | null> {
	try {
		const list = await client.listPlugins({ siteId, light: true, timeoutMs: 45_000 });
		const items = Array.isArray(list?.items) ? list.items : [];
		const hit = items.find((p) => pluginFolder(p.plugin) === folder);
		if (hit && compareWpVersions(hit.version, targetVersion) >= 0) {
			return { plugin: hit.plugin, version: hit.version, active: hit.active };
		}
	} catch {
		// Verification is best effort; the original error stands.
	}
	return null;
}

/**
 * POST — push ONE library plugin to this site through the connector's
 * `/plugins/install` (overwrite). The UI sends one request per
 * (site, plugin) pair, sequentially per site and base plugin first, so
 * every request is bounded by a single WordPress install.
 *
 * Body: {
 *   libraryPluginId: string,
 *   installedPlugin: string,   // matched WP identifier from library-compare
 *   activate?: boolean,        // true only when the plugin was active on the site
 *   fromVersion?: string       // for the audit row / response only
 * }
 *
 * Every attempt writes a `wordpress_update_job` row (`source: 'library'`),
 * same audit trail as the apply-updates flow.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params, request } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);
	const tenantId = locals.tenant.id;
	const userId = locals.user.id;

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const libraryPluginId = typeof body?.libraryPluginId === 'string' ? body.libraryPluginId : '';
	const installedPlugin = typeof body?.installedPlugin === 'string' ? body.installedPlugin : '';
	if (!libraryPluginId || !installedPlugin) {
		return json({ error: 'libraryPluginId și installedPlugin sunt obligatorii' }, { status: 400 });
	}
	const activate = body?.activate === true;
	const fromVersion = typeof body?.fromVersion === 'string' ? body.fromVersion : null;

	const ctx = await loadSiteAndClient(params.siteId, tenantId);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const row = await getLibraryPlugin(tenantId, libraryPluginId);
	if (!row) return json({ error: 'Plugin-ul nu există în bibliotecă' }, { status: 404 });

	// A ZIP whose folder differs from the installed one would be unpacked
	// NEXT TO the old plugin (Plugin_Upgrader clears only its own
	// destination), leaving two copies. Refuse instead of guessing.
	const installedFolder = pluginFolder(installedPlugin);
	if (installedFolder !== row.slug.toLowerCase()) {
		return json(
			{
				error: `Folderul din ZIP (${row.slug}) diferă de cel instalat (${installedFolder}); instalarea ar crea o copie paralelă. Șterge plugin-ul vechi din wp-admin sau încarcă un ZIP cu același folder.`,
				code: 'slug_mismatch'
			},
			{ status: 409 }
		);
	}

	const jobId = newId();
	const startedAt = new Date();
	await db.insert(table.wordpressUpdateJob).values({
		id: jobId,
		tenantId,
		siteId: ctx.site.id,
		userId,
		items: JSON.stringify([
			{
				type: 'plugin',
				slug: row.pluginFile,
				fromVersion,
				toVersion: row.version,
				source: 'library',
				libraryPluginId: row.id
			}
		]),
		status: 'running',
		startedAt,
		createdAt: startedAt
	});

	let zipBuffer: Buffer;
	try {
		zipBuffer = await fetchLibraryPluginZip(row);
	} catch (err) {
		const { message } = serializeError(err);
		await db
			.update(table.wordpressUpdateJob)
			.set({ status: 'failed', error: `minio: ${message}`.slice(0, 500), finishedAt: new Date() })
			.where(eq(table.wordpressUpdateJob.id, jobId));
		logWarning('wordpress', `Plugin library install: could not read ${row.slug} v${row.version} from MinIO`, {
			tenantId,
			userId,
			metadata: { siteId: ctx.site.id, libraryPluginId: row.id, reason: message, jobId }
		});
		return json({ error: `Nu am putut citi arhiva din MinIO: ${message}`, jobId }, { status: 500 });
	}

	// Archives stored before stray-entry detection (e.g. Product Catalog Feed
	// Pro with a bonus woocommerce-pip.zip at the root) fail in WordPress with
	// "No valid plugins were found"; send the normalized archive instead.
	try {
		zipBuffer = (await normalizePluginZip(zipBuffer)).buffer;
	} catch {
		// Unreadable here too: let WordPress report its own error.
	}

	const started = Date.now();
	try {
		const result = await ctx.client.installPlugin(
			{
				filename: row.filename,
				mimeType: 'application/zip',
				dataBase64: zipBuffer.toString('base64'),
				activate
			},
			{ siteId: ctx.site.id, timeoutMs: 300_000 }
		);

		await db
			.update(table.wordpressUpdateJob)
			.set({ status: 'success', result: JSON.stringify(result), finishedAt: new Date() })
			.where(eq(table.wordpressUpdateJob.id, jobId));

		logInfo(
			'wordpress',
			`Plugin library install on ${ctx.site.siteUrl}: ${row.slug} ${fromVersion ?? '?'} → ${row.version} (activated=${result.activated})`,
			{
				tenantId,
				userId,
				metadata: {
					siteId: ctx.site.id,
					libraryPluginId: row.id,
					plugin: result.plugin,
					fromVersion,
					toVersion: row.version,
					activate,
					activated: result.activated,
					sizeBytes: result.sizeBytes,
					jobId
				}
			}
		);

		// Same as apply-updates: refresh the cached pending-updates list so the
		// sites dashboard stops counting what was just installed. Non-fatal.
		syncUpdates(ctx.site.id).catch(() => undefined);

		return json({
			success: true,
			plugin: result.plugin,
			activated: result.activated,
			activationError: result.activationError ?? null,
			fromVersion,
			toVersion: row.version,
			jobId
		});
	} catch (err) {
		const elapsedMs = Date.now() - started;
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		const subcode = WpError.isWpError(err) ? err.subcode : undefined;
		const bodySnippet = WpError.isWpError(err) ? err.bodySnippet : undefined;
		const hint =
			code === 'wp_auth_error' && elapsedMs >= HMAC_WINDOW_HINT_MS
				? `Semnătura HMAC e valabilă 60 s, iar cererea a durat ${Math.round(elapsedMs / 1000)} s (upload + instalare).`
				: undefined;

		const verified = await verifyInstalled(ctx.client, ctx.site.id, installedFolder, row.version);
		if (verified) {
			const note = `${code} după ${Math.round(elapsedMs / 1000)} s, dar site-ul raportează acum v${verified.version}`;
			await db
				.update(table.wordpressUpdateJob)
				.set({
					status: 'success',
					result: JSON.stringify({ verifiedAfterError: true, code, subcode, message, bodySnippet, verified }),
					finishedAt: new Date()
				})
				.where(eq(table.wordpressUpdateJob.id, jobId));
			logWarning('wordpress', `Plugin library install confirmed after ${code} on ${ctx.site.siteUrl}: ${row.slug} v${verified.version}`, {
				tenantId,
				userId,
				metadata: { siteId: ctx.site.id, libraryPluginId: row.id, code, subcode, elapsedMs, jobId }
			});
			syncUpdates(ctx.site.id).catch(() => undefined);
			return json({
				success: true,
				verifiedAfterError: true,
				warning: `Confirmarea s-a pierdut (${note}).`,
				plugin: verified.plugin,
				activated: verified.active,
				activationError: activate && !verified.active ? 'plugin-ul nu apare activ după instalare' : null,
				fromVersion,
				toVersion: row.version,
				jobId
			});
		}

		const detail = [`${code}: ${message}`, bodySnippet ? `WordPress: ${bodySnippet.slice(0, 300)}` : '', hint ?? '']
			.filter(Boolean)
			.join(' · ');
		await db
			.update(table.wordpressUpdateJob)
			.set({ status: 'failed', error: detail.slice(0, 500), finishedAt: new Date() })
			.where(eq(table.wordpressUpdateJob.id, jobId));

		logWarning('wordpress', `Plugin library install failed on ${ctx.site.siteUrl}: ${row.slug} v${row.version}: ${code}`, {
			tenantId,
			userId,
			metadata: {
				siteId: ctx.site.id,
				libraryPluginId: row.id,
				code,
				subcode,
				reason: message,
				bodySnippet: bodySnippet?.slice(0, 300),
				elapsedMs,
				jobId
			}
		});
		return json({ error: detail, code, subcode, bodySnippet, jobId }, { status: 502 });
	}
};
