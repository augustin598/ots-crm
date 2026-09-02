import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { serializeError } from '$lib/server/logger';
import { gscPullWindow } from '$lib/logic/gsc';
import type { RequestHandler } from './$types';

/**
 * Sondă operațională pentru integrarea Search Console (admin-only, tenant-scoped).
 *
 *   GET            — e conectat? câte proiecte au proprietate? ultima sincronizare?
 *   GET ?probe=1   — apel REAL la API: listează proprietățile și trage o zi.
 *
 * `probe=1` e singurul lucru care dovedește că API-ul e ACTIVAT în Google Cloud:
 * OAuth „connected" nu spune nimic despre asta (lecția de la Google Calendar).
 * Tokenii nu apar niciodată în răspuns.
 */
function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);

	const [integration] = await db
		.select()
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);

	const projects = await db
		.select({ id: table.rankProject.id, gscProperty: table.rankProject.gscProperty })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.tenantId, tenantId), eq(table.rankProject.active, true)));

	const result: Record<string, unknown> = {
		connected: !!integration,
		isActive: integration?.isActive ?? false,
		email: integration?.email ?? null,
		lastSyncAt: integration?.lastSyncAt ?? null,
		lastError: integration?.lastError ?? null,
		activeProjects: projects.length,
		projectsWithProperty: projects.filter((p) => p.gscProperty).length
	};

	if (event.url.searchParams.get('probe') === '1') {
		if (!integration) {
			result.probe = { ok: false, error: 'Search Console nu este conectat' };
		} else {
			const startedAt = Date.now();
			try {
				const { listProperties, querySearchAnalytics } = await import('$lib/server/gsc/client');
				const properties = await listProperties(tenantId);
				const target = projects.find((p) => p.gscProperty)?.gscProperty ?? properties[0] ?? null;
				const window = gscPullWindow(new Date(), 2);
				const rows = target ? await querySearchAnalytics(tenantId, target, window) : [];
				result.probe = {
					ok: true,
					durationMs: Date.now() - startedAt,
					properties,
					probedProperty: target,
					window,
					rowCount: rows.length
				};
			} catch (probeError) {
				const { message } = serializeError(probeError);
				result.probe = {
					ok: false,
					durationMs: Date.now() - startedAt,
					error: message,
					// mesajul tipic când API-ul nu e activat în Google Cloud
					hint: /has not been used|is disabled|SERVICE_DISABLED/i.test(message)
						? 'Search Console API pare DEZACTIVAT în proiectul Google Cloud — activează-l și reîncearcă'
						: undefined
				};
			}
		}
	}

	return json(result);
};
