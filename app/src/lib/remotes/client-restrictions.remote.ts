import { query, command, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const getClientsRestrictionStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	const clients = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			businessName: table.client.businessName,
			restrictedAccess: table.client.restrictedAccess,
			portalScope: table.client.portalScope,
			overdueCount: sql<number>`(
				SELECT COUNT(*) FROM invoice
				WHERE invoice.client_id = ${table.client.id}
				AND invoice.tenant_id = ${event.locals.tenant.id}
				AND invoice.status = 'overdue'
			)`.as('overdue_count')
		})
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant.id));

	return clients.map((c) => ({
		id: c.id,
		name: c.businessName || c.name,
		restrictedAccess: c.restrictedAccess,
		portalScope: c.portalScope === 'hosting' ? ('hosting' as const) : ('full' as const),
		hasOverdueInvoice: c.overdueCount > 0
	}));
});

/**
 * Cât din portal vede clientul: 'full' sau 'hosting' (doar Dashboard, Hosting,
 * Facturi, Setări). Conturile create singure de pe /pachete-hosting pornesc pe
 * 'hosting'; de aici le treci pe 'full' când devin clienți de agenție.
 */
export const setClientPortalScope = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		portalScope: v.picklist(['full', 'hosting'])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		await db
			.update(table.client)
			.set({ portalScope: data.portalScope, updatedAt: new Date() })
			.where(
				and(
					eq(table.client.id, data.clientId),
					eq(table.client.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

export const setClientRestriction = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		restrictedAccess: v.picklist(['auto', 'forced', 'unrestricted'])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const dbValue = data.restrictedAccess === 'auto' ? null : data.restrictedAccess;

		await db
			.update(table.client)
			.set({
				restrictedAccess: dbValue,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(table.client.id, data.clientId),
					eq(table.client.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);
