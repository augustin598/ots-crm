import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const getContractActivities = query(
	v.pipe(v.string(), v.minLength(1)),
	async (contractId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify contract belongs to tenant
		const [contract] = await db
			.select({ id: table.contract.id })
			.from(table.contract)
			.where(and(eq(table.contract.id, contractId), eq(table.contract.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!contract) {
			throw new Error('Contract not found');
		}

		const activities = await db
			.select({
				id: table.contractActivity.id,
				contractId: table.contractActivity.contractId,
				userId: table.contractActivity.userId,
				action: table.contractActivity.action,
				field: table.contractActivity.field,
				oldValue: table.contractActivity.oldValue,
				newValue: table.contractActivity.newValue,
				createdAt: table.contractActivity.createdAt,
				userFirstName: table.user.firstName,
				userLastName: table.user.lastName
			})
			.from(table.contractActivity)
			.leftJoin(table.user, eq(table.contractActivity.userId, table.user.id))
			.where(eq(table.contractActivity.contractId, contractId))
			.orderBy(desc(table.contractActivity.createdAt));

		return activities.map((a) => ({
			id: a.id,
			contractId: a.contractId,
			userId: a.userId,
			userName: a.userId === 'system' ? 'Sistem' : `${a.userFirstName || ''} ${a.userLastName || ''}`.trim() || 'Utilizator necunoscut',
			action: a.action,
			field: a.field,
			oldValue: a.oldValue,
			newValue: a.newValue,
			createdAt: a.createdAt
		}));
	}
);
