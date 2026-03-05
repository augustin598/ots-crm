import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/** Get all secondary emails for a client (admin only) */
export const getClientSecondaryEmails = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		return db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.tenantId, event.locals.tenant.id)
				)
			);
	}
);

const createSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	email: v.pipe(v.string(), v.email('Email invalid')),
	label: v.optional(v.string())
});

/** Add a secondary email to a client */
export const createClientSecondaryEmail = command(createSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	if (event.locals.isClientUser) throw new Error('Unauthorized');

	const tenantId = event.locals.tenant.id;

	// Validate clientId belongs to tenant
	const [client] = await db
		.select({ id: table.client.id, email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!client) throw new Error('Client not found');

	// Cannot duplicate the primary email
	if (client.email?.toLowerCase() === data.email.toLowerCase()) {
		throw new Error('Această adresă este deja emailul principal al clientului.');
	}

	// Uniqueness within tenant
	const [existing] = await db
		.select({ id: table.clientSecondaryEmail.id })
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenantId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, data.email.toLowerCase())
			)
		)
		.limit(1);
	if (existing) throw new Error('Acest email este deja asociat unui client din acest tenant.');

	const now = new Date();
	const id = generateId();
	await db.insert(table.clientSecondaryEmail).values({
		id,
		tenantId,
		clientId: data.clientId,
		email: data.email,
		label: data.label || null,
		createdAt: now,
		updatedAt: now
	});

	return { success: true, id };
});

/** Update notification preferences for a secondary email (admin only) */
export const updateClientSecondaryEmailNotifications = command(
	v.object({
		secondaryEmailId: v.pipe(v.string(), v.minLength(1)),
		notifyInvoices: v.boolean(),
		notifyTasks: v.boolean(),
		notifyContracts: v.boolean()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const [record] = await db
			.select({ id: table.clientSecondaryEmail.id })
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.id, data.secondaryEmailId),
					eq(table.clientSecondaryEmail.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);
		if (!record) throw new Error('Email secundar negăsit');

		await db
			.update(table.clientSecondaryEmail)
			.set({
				notifyInvoices: data.notifyInvoices,
				notifyTasks: data.notifyTasks,
				notifyContracts: data.notifyContracts,
				updatedAt: new Date()
			})
			.where(eq(table.clientSecondaryEmail.id, data.secondaryEmailId));

		return { success: true };
	}
);

/** Delete a secondary email */
export const deleteClientSecondaryEmail = command(
	v.object({ secondaryEmailId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ secondaryEmailId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const [record] = await db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.id, secondaryEmailId),
					eq(table.clientSecondaryEmail.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);
		if (!record) throw new Error('Email secundar negăsit');

		await db
			.delete(table.clientSecondaryEmail)
			.where(eq(table.clientSecondaryEmail.id, secondaryEmailId));

		return { success: true };
	}
);
