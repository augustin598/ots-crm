import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateServiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const serviceSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	description: v.optional(v.string()),
	clientId: v.pipe(v.string(), v.minLength(1, 'Client ID is required')),
	projectId: v.optional(v.string()),
	price: v.optional(v.number()),
	recurringType: v.optional(v.string()),
	recurringInterval: v.optional(v.number()),
	isActive: v.optional(v.boolean())
});

export const getServices = query(
	v.object({
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.service.tenantId, event.locals.tenant.id);

		if (filters.clientId) {
			conditions = and(conditions, eq(table.service.clientId, filters.clientId)) as any;
		}
		if (filters.projectId) {
			conditions = and(conditions, eq(table.service.projectId, filters.projectId)) as any;
		}

		return await db.select().from(table.service).where(conditions);
	}
);

export const createService = command(serviceSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const serviceId = generateServiceId();

	await db.insert(table.service).values({
		id: serviceId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		projectId: data.projectId || null,
		name: data.name,
		description: data.description || null,
		price: data.price ? Math.round(data.price * 100) : null,
		recurringType: data.recurringType || 'none',
		recurringInterval: data.recurringInterval || 1,
		isActive: data.isActive !== undefined ? data.isActive : true
	});

	return { success: true, serviceId };
});
