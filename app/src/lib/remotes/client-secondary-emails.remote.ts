import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	ACCESS_CATEGORIES,
	parseAccessFlags,
	type AccessFlags
} from '$lib/server/portal-access';

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

		const rows = await db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.tenantId, event.locals.tenant.id)
				)
			);

		// Resolve accessFlags so the UI gets a guaranteed-shape object per row.
		// Fallback to legacy notify* columns when access_flags is NULL (pre-backfill rows).
		return rows.map((r) => {
			const parsed = parseAccessFlags(r.accessFlags);
			const flags: AccessFlags = parsed ?? {
				invoices: !!r.notifyInvoices,
				contracts: !!r.notifyContracts,
				tasks: !!r.notifyTasks,
				marketing: false,
				reports: false,
				leads: false,
				accessData: false,
				backlinks: false,
				budgets: false
			};
			return { ...r, accessFlagsResolved: flags };
		});
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

	// Cannot duplicate the primary email of THIS client.
	if (client.email?.toLowerCase() === data.email.toLowerCase()) {
		throw new Error('Această adresă este deja emailul principal al clientului.');
	}

	// Per-client uniqueness only — same email may legitimately appear on multiple
	// clients (one user managing multiple companies). Cross-client checks lifted:
	// uniqueness for a client = CUI, not email/phone.
	const [existing] = await db
		.select({ id: table.clientSecondaryEmail.id })
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenantId),
				eq(table.clientSecondaryEmail.clientId, data.clientId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, data.email.toLowerCase())
			)
		)
		.limit(1);
	if (existing) throw new Error('Acest email este deja secundar pentru acest client.');

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

const accessFlagsSchema = v.object({
	invoices: v.boolean(),
	contracts: v.boolean(),
	tasks: v.boolean(),
	marketing: v.boolean(),
	reports: v.boolean(),
	leads: v.boolean(),
	accessData: v.boolean(),
	backlinks: v.boolean(),
	budgets: v.boolean()
});

/**
 * Update per-user portal access flags for a secondary contact (admin only).
 * Persists JSON in `access_flags` and dual-writes the 3 legacy notify* columns
 * so existing email-sending logic keeps working until callers migrate.
 */
export const updateClientSecondaryEmailAccess = command(
	v.object({
		secondaryEmailId: v.pipe(v.string(), v.minLength(1)),
		accessFlags: accessFlagsSchema
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

		const flags: AccessFlags = data.accessFlags;
		// Sanity: only persist known categories.
		const sanitized = Object.fromEntries(
			ACCESS_CATEGORIES.map((c) => [c, !!flags[c]])
		) as AccessFlags;

		await db
			.update(table.clientSecondaryEmail)
			.set({
				accessFlags: JSON.stringify(sanitized),
				notifyInvoices: sanitized.invoices,
				notifyTasks: sanitized.tasks,
				notifyContracts: sanitized.contracts,
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
