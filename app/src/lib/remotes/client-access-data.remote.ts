import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';

const ACCESS_CATEGORIES = [
	'website', 'email', 'cpanel', 'hosting',
	'tiktok', 'facebook', 'instagram', 'google', 'altele'
] as const;

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function validateCustomFields(value: string): boolean {
	if (!value) return true;
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return false;
		if (parsed.length > 20) return false;
		return parsed.every(
			(item: any) =>
				typeof item.key === 'string' && item.key.length <= 100 &&
				typeof item.value === 'string' && item.value.length <= 100
		);
	} catch {
		return false;
	}
}

// ==================== GET ====================

export const getAccessData = query(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		category: v.optional(v.picklist([...ACCESS_CATEGORIES]))
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		let effectiveClientId: string;

		if (event.locals.isClientUser && event.locals.client) {
			effectiveClientId = event.locals.client.id;
		} else {
			const [clientCheck] = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(and(
					eq(table.client.id, filters.clientId),
					eq(table.client.tenantId, tenantId)
				))
				.limit(1);
			if (!clientCheck) throw new Error('Client invalid');
			effectiveClientId = filters.clientId;
		}

		let conditions = and(
			eq(table.clientAccessData.tenantId, tenantId),
			eq(table.clientAccessData.clientId, effectiveClientId)
		);

		if (filters.category) {
			conditions = and(conditions, eq(table.clientAccessData.category, filters.category)) as typeof conditions;
		}

		const rows = await db
			.select()
			.from(table.clientAccessData)
			.where(conditions!)
			.orderBy(desc(table.clientAccessData.createdAt))
			.limit(500);

		return rows.map((row) => ({
			...row,
			password: row.password
				? (() => { try { return decrypt(tenantId, row.password!); } catch { return null; } })()
				: null
		}));
	}
);

// ==================== CREATE ====================

const createSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	category: v.picklist([...ACCESS_CATEGORIES]),
	label: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	url: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2048)))),
	username: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
	password: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1000)))),
	notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(5000)))),
	customFields: v.optional(v.nullable(v.pipe(
		v.string(),
		v.check(validateCustomFields, 'custom_fields invalid: max 20 items, key/value max 100 chars')
	)))
});

export const createAccessData = command(createSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

	const tenantId = event.locals.tenant.id;
	const isClientUser = event.locals.isClientUser;

	if (isClientUser && event.locals.client) {
		if (data.clientId !== event.locals.client.id) {
			throw new Error('Nu puteți crea înregistrări pentru alt client');
		}
	} else {
		const [clientCheck] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(
				eq(table.client.id, data.clientId),
				eq(table.client.tenantId, tenantId)
			))
			.limit(1);
		if (!clientCheck) throw new Error('Client invalid');
	}

	const id = generateId();
	const encryptedPassword = data.password ? encrypt(tenantId, data.password) : null;

	await db.insert(table.clientAccessData).values({
		id,
		tenantId,
		clientId: data.clientId,
		category: data.category,
		label: data.label,
		url: data.url || null,
		username: data.username || null,
		password: encryptedPassword,
		notes: data.notes || null,
		customFields: data.customFields || null,
		createdByUserId: isClientUser ? null : event.locals.user.id,
		createdByClientUserId: isClientUser ? (event.locals as any).clientUser?.id || null : null
	});

	return { success: true, id };
});

// ==================== UPDATE ====================

const updateSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	category: v.optional(v.picklist([...ACCESS_CATEGORIES])),
	label: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
	url: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2048)))),
	username: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
	password: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1000)))),
	notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(5000)))),
	customFields: v.optional(v.nullable(v.pipe(
		v.string(),
		v.check(validateCustomFields, 'custom_fields invalid: max 20 items, key/value max 100 chars')
	)))
});

export const updateAccessData = command(updateSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

	const tenantId = event.locals.tenant.id;
	let conditions = and(
		eq(table.clientAccessData.id, data.id),
		eq(table.clientAccessData.tenantId, tenantId)
	);

	if (event.locals.isClientUser && event.locals.client) {
		const clientUserId = (event.locals as any).clientUser?.id;
		if (!clientUserId) throw new Error('Sesiune client invalidă');
		conditions = and(
			conditions,
			eq(table.clientAccessData.clientId, event.locals.client.id),
			eq(table.clientAccessData.createdByClientUserId, clientUserId)
		) as typeof conditions;
	}

	const [existing] = await db
		.select({ id: table.clientAccessData.id })
		.from(table.clientAccessData)
		.where(conditions!)
		.limit(1);
	if (!existing) throw new Error('Înregistrare negăsită sau fără permisiune');

	const updatePayload: Record<string, any> = { updatedAt: new Date() };
	if (data.category !== undefined) updatePayload.category = data.category;
	if (data.label !== undefined) updatePayload.label = data.label;
	if (data.url !== undefined) updatePayload.url = data.url;
	if (data.username !== undefined) updatePayload.username = data.username;
	if (data.password !== undefined) {
		updatePayload.password = data.password ? encrypt(tenantId, data.password) : null;
	}
	if (data.notes !== undefined) updatePayload.notes = data.notes;
	if (data.customFields !== undefined) updatePayload.customFields = data.customFields;

	await db.update(table.clientAccessData).set(updatePayload).where(conditions!);
	return { success: true };
});

// ==================== DELETE ====================

export const deleteAccessData = command(
	v.pipe(v.string(), v.minLength(1)),
	async (entryId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;
		let conditions = and(
			eq(table.clientAccessData.id, entryId),
			eq(table.clientAccessData.tenantId, tenantId)
		);

		if (event.locals.isClientUser && event.locals.client) {
			const clientUserId = (event.locals as any).clientUser?.id;
			if (!clientUserId) throw new Error('Sesiune client invalidă');
			conditions = and(
				conditions,
				eq(table.clientAccessData.clientId, event.locals.client.id),
				eq(table.clientAccessData.createdByClientUserId, clientUserId)
			) as typeof conditions;
		}

		const [entry] = await db
			.select({ id: table.clientAccessData.id })
			.from(table.clientAccessData)
			.where(conditions!)
			.limit(1);
		if (!entry) throw new Error('Înregistrare negăsită sau fără permisiune');

		await db.delete(table.clientAccessData).where(conditions!);
		return { success: true };
	}
);
