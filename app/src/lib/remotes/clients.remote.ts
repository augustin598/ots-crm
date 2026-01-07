import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getCompanyData } from '$lib/remotes/anaf.remote';

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const clientSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	email: v.optional(v.pipe(v.string(), v.email('Invalid email'))),
	phone: v.optional(v.string()),
	status: v.optional(v.string()),
	companyType: v.optional(v.string()),
	cui: v.optional(v.string()),
	registrationNumber: v.optional(v.string()),
	tradeRegister: v.optional(v.string()),
	vatNumber: v.optional(v.string()),
	legalRepresentative: v.optional(v.string()),
	iban: v.optional(v.string()),
	bankName: v.optional(v.string()),
	address: v.optional(v.string()),
	city: v.optional(v.string()),
	county: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string()),
	notes: v.optional(v.string())
});

export const getClients = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const clients = await db
		.select()
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant.id));

	return clients;
});

export const getClient = query(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!client) {
		throw new Error('Client not found');
	}

	return client;
});

export const createClient = command(clientSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const clientId = generateClientId();

	await db.insert(table.client).values({
		id: clientId,
		tenantId: event.locals.tenant.id,
		name: data.name,
		email: data.email || null,
		phone: data.phone || null,
		status: data.status || 'prospect',
		companyType: data.companyType || null,
		cui: data.cui || null,
		registrationNumber: data.registrationNumber || null,
		tradeRegister: data.tradeRegister || null,
		vatNumber: data.vatNumber || null,
		legalRepresentative: data.legalRepresentative || null,
		iban: data.iban || null,
		bankName: data.bankName || null,
		address: data.address || null,
		city: data.city || null,
		county: data.county || null,
		postalCode: data.postalCode || null,
		country: data.country || 'România',
		notes: data.notes || null
	});

	return { success: true, clientId };
});

export const updateClient = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		...clientSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { clientId, ...updateData } = data;

		// Verify client belongs to tenant
		const [existing] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Client not found');
		}

		await db
			.update(table.client)
			.set({
				...updateData,
				updatedAt: new Date()
			})
			.where(eq(table.client.id, clientId));

		return { success: true };
	}
);

export const deleteClient = command(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify client belongs to tenant
	const [existing] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Client not found');
	}

	await db.delete(table.client).where(eq(table.client.id, clientId));

	return { success: true };
});
