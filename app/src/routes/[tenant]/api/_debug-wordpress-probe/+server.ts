import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { WpError } from '$lib/server/wordpress/errors';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { serializeError } from '$lib/server/logger';

/**
 * GET /_debug-wordpress-probe[?siteId=X] — admin-only, read-only.
 *
 * Answers "is this site REALLY connected?" with evidence, not the cached
 * status column: the signed `/health` call returns `siteUrl` as WordPress
 * itself reports it (`get_site_url()`), so a domain served by another
 * install's default vhost shows up immediately, and `/plugins?light=1`
 * proves the OTS Connector entry exists and is active on that install.
 *
 * Per site: configured URL, live health (siteUrl / versions), the connector
 * plugin entry, installed plugin total, and the error if anything failed.
 */
type ProbeRow = {
	siteId: string;
	name: string;
	configuredUrl: string;
	dbStatus: string;
	health: { siteUrl: string; connectorVersion: string; wpVersion: string; phpVersion: string } | null;
	healthError: string | null;
	sameHost: boolean | null;
	connectorPlugin: { plugin: string; version: string; active: boolean } | null;
	installedTotal: number | null;
	pluginsError: string | null;
};

function hostOf(url: string): string {
	try {
		return new URL(url).host.replace(/^www\./, '').toLowerCase();
	} catch {
		return url.toLowerCase();
	}
}

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	const tenantId = event.locals.tenant.id;

	const onlySiteId = event.url.searchParams.get('siteId');
	const sites = await db
		.select({ id: table.wordpressSite.id, name: table.wordpressSite.name, siteUrl: table.wordpressSite.siteUrl, status: table.wordpressSite.status })
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.tenantId, tenantId));
	const targets = onlySiteId ? sites.filter((s) => s.id === onlySiteId) : sites;

	const rows: ProbeRow[] = [];
	const CONCURRENCY = 3;
	for (let i = 0; i < targets.length; i += CONCURRENCY) {
		await Promise.all(
			targets.slice(i, i + CONCURRENCY).map(async (s) => {
				const row: ProbeRow = {
					siteId: s.id,
					name: s.name,
					configuredUrl: s.siteUrl,
					dbStatus: s.status,
					health: null,
					healthError: null,
					sameHost: null,
					connectorPlugin: null,
					installedTotal: null,
					pluginsError: null
				};
				const ctx = await loadSiteAndClient(s.id, tenantId);
				if (!ctx) {
					row.healthError = 'site not found';
					rows.push(row);
					return;
				}
				try {
					const h = await ctx.client.health({ siteId: s.id });
					row.health = {
						siteUrl: h.siteUrl,
						connectorVersion: h.connectorVersion,
						wpVersion: h.wpVersion,
						phpVersion: h.phpVersion
					};
					row.sameHost = hostOf(h.siteUrl) === hostOf(s.siteUrl);
				} catch (err) {
					const { message } = serializeError(err);
					row.healthError = `${WpError.isWpError(err) ? err.code : 'unknown_error'}: ${message}`;
					rows.push(row);
					return;
				}
				try {
					const list = await ctx.client.listPlugins({ siteId: s.id, light: true });
					const items = Array.isArray(list?.items) ? list.items : [];
					row.installedTotal = items.length;
					const connector = items.find(
						(p) => p.plugin.toLowerCase().includes('ots-connector') || p.name.toLowerCase().includes('ots connector')
					);
					row.connectorPlugin = connector
						? { plugin: connector.plugin, version: connector.version, active: connector.active }
						: null;
				} catch (err) {
					const { message } = serializeError(err);
					row.pluginsError = `${WpError.isWpError(err) ? err.code : 'unknown_error'}: ${message}`;
				}
				rows.push(row);
			})
		);
	}

	rows.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
	return json({ probedAt: new Date().toISOString(), sites: rows });
};
