import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateUserBankAccountId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const userBankAccountSchema = v.object({
	userId: v.optional(v.string()), // If not provided, uses current user
	iban: v.pipe(v.string(), v.minLength(1, 'IBAN is required')),
	bankName: v.optional(v.string()),
	accountName: v.optional(v.string()),
	currency: v.optional(v.string()),
	isActive: v.optional(v.boolean())
});

export const getUserBankAccounts = query(
	v.optional(v.object({ userId: v.optional(v.string()) })),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const userId = params?.userId || event.locals.user.id;

		// Verify user belongs to tenant
		const [tenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(and(eq(table.tenantUser.userId, userId), eq(table.tenantUser.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!tenantUser) {
			throw new Error('User not found in tenant');
		}

		const accounts = await db
			.select()
			.from(table.userBankAccount)
			.where(and(eq(table.userBankAccount.userId, userId), eq(table.userBankAccount.tenantId, event.locals.tenant.id)));

		return accounts;
	}
);

export const createUserBankAccount = command(userBankAccountSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const userId = data.userId || event.locals.user.id;

	// Verify user belongs to tenant
	const [tenantUser] = await db
		.select()
		.from(table.tenantUser)
		.where(and(eq(table.tenantUser.userId, userId), eq(table.tenantUser.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!tenantUser) {
		throw new Error('User not found in tenant');
	}

	const accountId = generateUserBankAccountId();

	await db.insert(table.userBankAccount).values({
		id: accountId,
		tenantId: event.locals.tenant.id,
		userId,
		iban: data.iban,
		bankName: data.bankName || null,
		accountName: data.accountName || null,
		currency: data.currency || 'RON',
		isActive: data.isActive !== undefined ? data.isActive : true
	});

	return { success: true, accountId };
});

export const updateUserBankAccount = command(
	v.object({
		accountId: v.pipe(v.string(), v.minLength(1)),
		iban: v.optional(v.pipe(v.string(), v.minLength(1))),
		bankName: v.optional(v.string()),
		accountName: v.optional(v.string()),
		currency: v.optional(v.string()),
		isActive: v.optional(v.boolean())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { accountId, ...updateData } = data;

		// Verify account belongs to tenant
		const [existing] = await db
			.select()
			.from(table.userBankAccount)
			.where(and(eq(table.userBankAccount.id, accountId), eq(table.userBankAccount.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Bank account not found');
		}

		await db
			.update(table.userBankAccount)
			.set({
				...updateData,
				updatedAt: new Date()
			})
			.where(eq(table.userBankAccount.id, accountId));

		return { success: true };
	}
);

export const deleteUserBankAccount = command(v.pipe(v.string(), v.minLength(1)), async (accountId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify account belongs to tenant
	const [existing] = await db
		.select()
		.from(table.userBankAccount)
		.where(and(eq(table.userBankAccount.id, accountId), eq(table.userBankAccount.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Bank account not found');
	}

	await db.delete(table.userBankAccount).where(eq(table.userBankAccount.id, accountId));

	return { success: true };
});
