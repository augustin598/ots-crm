import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStaff } from '$lib/server/get-actor';
import { logWarning, serializeError } from '$lib/server/logger';
import { WpError } from '$lib/server/wordpress/errors';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { listLibraryPlugins } from '$lib/server/wordpress/plugin-library';
import { compareLibraryWithInstalled } from '$lib/server/wordpress/plugin-library-compare';

/**
 * GET — compare the tenant's plugin library with what this site has
 * installed. Read-only: lists the site's plugins through the connector
 * (`?light=1`, no update-cache refresh) and classifies every library row.
 *
 * Response: { site, items: LibraryCompareItem[], installedTotal, checkedAt }
 * Errors: 404 unknown site, 502 { error, code, subcode } when the connector
 * cannot be reached.
 */
export const GET: RequestHandler = async (event) => {
	const { locals, params } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);
	const tenantId = locals.tenant.id;

	const ctx = await loadSiteAndClient(params.siteId, tenantId);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const site = {
		id: ctx.site.id,
		name: ctx.site.name,
		url: ctx.site.siteUrl,
		connectorVersion: ctx.site.connectorVersion
	};

	const library = await listLibraryPlugins(tenantId);
	if (library.length === 0) {
		// Site not contacted: nothing to compare against.
		return json({ site, items: [], installedTotal: null, checkedAt: new Date().toISOString() });
	}

	try {
		const listRaw = await ctx.client.listPlugins({ siteId: ctx.site.id, light: true });
		const installed = (Array.isArray(listRaw?.items) ? listRaw.items : []).map((p) => ({
			plugin: p.plugin,
			name: p.name,
			version: p.version,
			author: p.author,
			pluginUri: p.pluginUri,
			textDomain: p.textDomain,
			active: p.active,
			updateAvailable: p.updateAvailable,
			newVersion: p.newVersion,
			updatePackage: p.updatePackage ?? null,
			requiresPlugins: p.requiresPlugins
		}));

		const items = compareLibraryWithInstalled(
			library.map((r) => ({
				id: r.id,
				slug: r.slug,
				name: r.name,
				version: r.version,
				author: r.author,
				textDomain: r.textDomain,
				pluginUri: r.pluginUri,
				updateUri: r.updateUri
			})),
			installed
		);

		return json({
			site,
			items,
			installedTotal: installed.length,
			checkedAt: new Date().toISOString()
		});
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		const subcode = WpError.isWpError(err) ? err.subcode : undefined;
		const bodySnippet = WpError.isWpError(err) ? err.bodySnippet : undefined;
		logWarning('wordpress', `Plugin library compare failed on ${ctx.site.siteUrl}: ${code}`, {
			tenantId,
			userId: locals.user.id,
			metadata: { siteId: ctx.site.id, code, subcode, reason: message, bodySnippet: bodySnippet?.slice(0, 300) }
		});
		const detail = bodySnippet ? `${code}: ${message} · WordPress: ${bodySnippet.slice(0, 300)}` : `${code}: ${message}`;
		return json({ error: detail, code, subcode }, { status: 502 });
	}
};
