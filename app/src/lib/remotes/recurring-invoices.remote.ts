import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { generateInvoiceFromRecurringTemplate } from '$lib/server/invoice-utils';

function generateRecurringInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Calculate the next run date based on recurring type and interval
 */
function calculateNextRunDate(
	startDate: Date,
	recurringType: string,
	recurringInterval: number
): Date {
	const nextDate = new Date(startDate);

	switch (recurringType) {
		case 'daily':
			nextDate.setDate(nextDate.getDate() + recurringInterval);
			break;
		case 'weekly':
			nextDate.setDate(nextDate.getDate() + recurringInterval * 7);
			break;
		case 'monthly':
			nextDate.setMonth(nextDate.getMonth() + recurringInterval);
			// Handle month-end edge cases (e.g., Jan 31 + 1 month = Feb 28/29)
			if (nextDate.getDate() !== startDate.getDate()) {
				nextDate.setDate(0); // Go to last day of previous month
			}
			break;
		case 'yearly':
			nextDate.setFullYear(nextDate.getFullYear() + recurringInterval);
			// Handle leap year edge cases
			if (nextDate.getMonth() !== startDate.getMonth()) {
				nextDate.setDate(0); // Go to last day of previous month
			}
			break;
		default:
			throw new Error(`Unknown recurring type: ${recurringType}`);
	}

	return nextDate;
}

const recurringInvoiceSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	clientId: v.pipe(v.string(), v.minLength(1, 'Client ID is required')),
	projectId: v.optional(v.string()),
	serviceId: v.optional(v.string()),
	amount: v.number(),
	taxRate: v.optional(v.number()),
	currency: v.optional(v.string()), // 'RON', 'EUR', 'USD', etc.
	recurringType: v.pipe(v.string(), v.picklist(['daily', 'weekly', 'monthly', 'yearly'])),
	recurringInterval: v.optional(v.number()),
	startDate: v.pipe(v.string(), v.minLength(1, 'Start date is required')),
	endDate: v.optional(v.string()),
	issueDateOffset: v.optional(v.number()),
	dueDateOffset: v.optional(v.number()),
	notes: v.optional(v.string()),
	isActive: v.optional(v.boolean())
});

export const getRecurringInvoices = query(
	v.object({
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.recurringInvoice.tenantId, event.locals.tenant.id);

		if (filters.clientId) {
			conditions = and(conditions, eq(table.recurringInvoice.clientId, filters.clientId)) as any;
		}
		if (filters.projectId) {
			conditions = and(conditions, eq(table.recurringInvoice.projectId, filters.projectId)) as any;
		}

		return await db.select().from(table.recurringInvoice).where(conditions);
	}
);

export const getRecurringInvoice = query(
	v.pipe(v.string(), v.minLength(1)),
	async (recurringInvoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [recurringInvoice] = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.id, recurringInvoiceId),
					eq(table.recurringInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!recurringInvoice) {
			throw new Error('Recurring invoice not found');
		}

		return recurringInvoice;
	}
);

export const createRecurringInvoice = command(recurringInvoiceSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Get default currency from invoice settings
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';
	const taxRate = data.taxRate ? Math.round(data.taxRate * 100) : 1900; // Default 19%
	const amount = Math.round(data.amount * 100); // Convert to cents

	const startDate = new Date(data.startDate);
	const recurringInterval = data.recurringInterval || 1;
	const nextRunDate = calculateNextRunDate(startDate, data.recurringType, recurringInterval);

	const recurringInvoiceId = generateRecurringInvoiceId();

	await db.insert(table.recurringInvoice).values({
		id: recurringInvoiceId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		projectId: data.projectId || null,
		serviceId: data.serviceId || null,
		name: data.name,
		amount,
		taxRate,
		currency,
		recurringType: data.recurringType,
		recurringInterval,
		startDate,
		endDate: data.endDate ? new Date(data.endDate) : null,
		nextRunDate,
		issueDateOffset: data.issueDateOffset ?? 0,
		dueDateOffset: data.dueDateOffset ?? 30,
		notes: data.notes || null,
		isActive: data.isActive !== undefined ? data.isActive : true,
		createdByUserId: event.locals.user.id
	});

	return { success: true, recurringInvoiceId };
});

export const updateRecurringInvoice = command(
	v.object({
		recurringInvoiceId: v.pipe(v.string(), v.minLength(1)),
		...recurringInvoiceSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { recurringInvoiceId, ...updateData } = data;

		// Verify recurring invoice belongs to tenant
		const [existing] = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.id, recurringInvoiceId),
					eq(table.recurringInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Recurring invoice not found');
		}

		// Recalculate nextRunDate if recurring pattern changed
		let nextRunDate = existing.nextRunDate;
		const recurringType = updateData.recurringType || existing.recurringType;
		const recurringInterval = updateData.recurringInterval ?? existing.recurringInterval;
		const startDate = updateData.startDate ? new Date(updateData.startDate) : existing.startDate;

		if (
			updateData.recurringType ||
			updateData.recurringInterval !== undefined ||
			updateData.startDate
		) {
			nextRunDate = calculateNextRunDate(startDate, recurringType, recurringInterval);
		}

		await db
			.update(table.recurringInvoice)
			.set({
				name: updateData.name !== undefined ? updateData.name : undefined,
				clientId: updateData.clientId || undefined,
				projectId: updateData.projectId !== undefined ? updateData.projectId || null : undefined,
				serviceId: updateData.serviceId !== undefined ? updateData.serviceId || null : undefined,
				amount: updateData.amount !== undefined ? Math.round(updateData.amount * 100) : undefined,
				taxRate:
					updateData.taxRate !== undefined ? Math.round(updateData.taxRate * 100) : undefined,
				currency: updateData.currency !== undefined ? updateData.currency : undefined,
				recurringType: updateData.recurringType || undefined,
				recurringInterval:
					updateData.recurringInterval !== undefined ? updateData.recurringInterval : undefined,
				startDate: updateData.startDate ? new Date(updateData.startDate) : undefined,
				endDate:
					updateData.endDate !== undefined
						? updateData.endDate
							? new Date(updateData.endDate)
							: null
						: undefined,
				nextRunDate,
				issueDateOffset:
					updateData.issueDateOffset !== undefined ? updateData.issueDateOffset : undefined,
				dueDateOffset:
					updateData.dueDateOffset !== undefined ? updateData.dueDateOffset : undefined,
				notes: updateData.notes !== undefined ? updateData.notes || null : undefined,
				isActive: updateData.isActive !== undefined ? updateData.isActive : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.recurringInvoice.id, recurringInvoiceId));

		return { success: true };
	}
);

export const deleteRecurringInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (recurringInvoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify recurring invoice belongs to tenant
		const [existing] = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.id, recurringInvoiceId),
					eq(table.recurringInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Recurring invoice not found');
		}

		await db
			.delete(table.recurringInvoice)
			.where(eq(table.recurringInvoice.id, recurringInvoiceId));

		return { success: true };
	}
);

export const toggleRecurringInvoiceActive = command(
	v.pipe(v.string(), v.minLength(1)),
	async (recurringInvoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify recurring invoice belongs to tenant
		const [existing] = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.id, recurringInvoiceId),
					eq(table.recurringInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Recurring invoice not found');
		}

		await db
			.update(table.recurringInvoice)
			.set({
				isActive: !existing.isActive,
				updatedAt: new Date()
			})
			.where(eq(table.recurringInvoice.id, recurringInvoiceId));

		return { success: true, isActive: !existing.isActive };
	}
);

export const triggerRecurringInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (recurringInvoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify recurring invoice belongs to tenant
		const [existing] = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.id, recurringInvoiceId),
					eq(table.recurringInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Recurring invoice not found');
		}

		const result = await generateInvoiceFromRecurringTemplate(recurringInvoiceId);
		return result;
	}
);
