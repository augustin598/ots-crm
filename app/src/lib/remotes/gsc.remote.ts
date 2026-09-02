// Remote functions pentru integrarea Search Console. Ca peste tot în proiect:
// requireStaff + scoping pe tenantul din sesiune. Tokenii NU pleacă niciodată
// spre client — doar starea conexiunii.
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';

function requireTenantEvent() {
	const event = getRequestEvent();
	const tenant = event?.locals.tenant;
	if (!event?.locals.user || !tenant) throw error(401, 'Unauthorized');
	return { event, tenantId: tenant.id };
}

/** Starea conexiunii — fără tokeni, doar ce are nevoie UI-ul. */
export const getGscStatus = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const [row] = await db
		.select()
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);
	if (!row) return { connected: false as const };
	return {
		connected: true as const,
		email: row.email,
		isActive: row.isActive,
		lastSyncAt: row.lastSyncAt,
		lastError: row.lastError
	};
});

/** Proprietățile la care contul conectat are acces (pentru dropdown). */
export const getGscProperties = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const { listProperties } = await import('$lib/server/gsc/client');
	return listProperties(tenantId);
});

const propertySchema = v.object({
	projectId: v.pipe(v.string(), v.minLength(1)),
	/** „sc-domain:exemplu.ro" sau „https://www.exemplu.ro/"; gol = deconectare. */
	property: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(300)))
});

export const setGscProperty = command(propertySchema, async ({ projectId, property }) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

	const [project] = await db
		.select({ id: table.rankProject.id })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)))
		.limit(1);
	if (!project) throw error(404, 'Proiectul nu a fost găsit');

	await db
		.update(table.rankProject)
		.set({ gscProperty: property || null, updatedAt: new Date() })
		.where(and(eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)));
	return { saved: true };
});

/** Tragere manuală, pentru butonul „Sincronizează acum". */
export const runGscPullNow = command(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const { processGscDailyPull } = await import('$lib/server/scheduler/tasks/gsc-daily-pull');
	const { gscIntegration } = table;
	return processGscDailyPull({
		loadIntegrations: async () =>
			db
				.select({ tenantId: gscIntegration.tenantId })
				.from(gscIntegration)
				.where(eq(gscIntegration.tenantId, tenantId))
	});
});
