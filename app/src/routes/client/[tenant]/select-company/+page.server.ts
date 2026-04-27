import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	const tenantSlug = event.params.tenant;
	if (!event.locals.user || !event.locals.isClientUser) {
		throw redirect(302, `/client/${tenantSlug}/login`);
	}

	const companies = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			businessName: table.client.businessName,
			cui: table.client.cui,
			status: table.client.status,
			lastSelectedAt: table.clientUser.lastSelectedAt,
			isPrimary: table.clientUser.isPrimary
		})
		.from(table.clientUser)
		.innerJoin(table.client, eq(table.clientUser.clientId, table.client.id))
		.where(
			and(
				eq(table.clientUser.userId, event.locals.user.id),
				eq(table.clientUser.tenantId, event.locals.tenant!.id)
			)
		)
		.orderBy(
			sql`${table.clientUser.lastSelectedAt} DESC NULLS LAST`,
			sql`${table.clientUser.isPrimary} DESC`,
			table.client.name
		);

	// If the user has only one company, skip the selector entirely.
	if (companies.length <= 1) {
		throw redirect(302, `/client/${tenantSlug}/dashboard`);
	}

	return { companies };
};

export const actions: Actions = {
	select: async (event) => {
		const tenantSlug = event.params.tenant;
		if (!event.locals.user || !event.locals.tenant || !event.locals.isClientUser) {
			throw redirect(302, `/client/${tenantSlug}/login`);
		}

		const formData = await event.request.formData();
		const clientId = formData.get('clientId');
		if (typeof clientId !== 'string' || clientId.length === 0) {
			return fail(400, { error: 'Missing clientId' });
		}

		// Ownership check: the (userId, clientId, tenantId) clientUser row must exist.
		// This is what prevents a user from "selecting" a company they don't have access to.
		const updateResult = await db
			.update(table.clientUser)
			.set({ lastSelectedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(table.clientUser.userId, event.locals.user.id),
					eq(table.clientUser.tenantId, event.locals.tenant.id),
					eq(table.clientUser.clientId, clientId)
				)
			);

		if ((updateResult as { rowsAffected?: number })?.rowsAffected === 0) {
			return fail(403, { error: 'Compania nu este accesibilă din contul tău' });
		}

		throw redirect(302, `/client/${tenantSlug}/dashboard`);
	}
};
