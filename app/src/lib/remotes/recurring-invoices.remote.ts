import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { generateInvoiceFromRecurringTemplate, calculateNextRunDate } from '$lib/server/invoice-utils';
import { logInfo } from '$lib/server/logger';

function generateRecurringInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

// Line item schema (same as in invoices.remote.ts)
const lineItemSchema = v.object({
	description: v.pipe(v.string(), v.minLength(1)),
	quantity: v.number(),
	rate: v.number(), // in currency units (will be converted to cents)
	taxRate: v.optional(v.number()), // as percentage (will be converted to cents)
	discountType: v.optional(v.string()), // 'percent', 'fixed', or empty
	discount: v.optional(v.number()), // discount amount
	note: v.optional(v.string()), // item-specific note
	currency: v.optional(v.string()), // item currency
	unitOfMeasure: v.optional(v.string()), // unit of measure
	keezItemExternalId: v.optional(v.string()), // Keez item external ID
	serviceId: v.optional(v.string()) // Service ID if item came from a service
});

const recurringInvoiceSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	clientId: v.pipe(v.string(), v.minLength(1, 'Client ID is required')),
	projectId: v.optional(v.string()),
	serviceId: v.optional(v.string()),
	amount: v.optional(v.number()), // Legacy support - will be calculated from lineItems if provided
	taxRate: v.optional(v.number()), // Legacy support
	lineItems: v.optional(v.array(lineItemSchema)), // Array of line items
	currency: v.optional(v.string()), // 'RON', 'EUR', 'USD', etc.
	recurringType: v.pipe(v.string(), v.picklist(['daily', 'weekly', 'monthly', 'yearly'])),
	recurringInterval: v.optional(v.number()),
	startDate: v.pipe(v.string(), v.minLength(1, 'Start date is required')),
	endDate: v.optional(v.string()),
	issueDateOffset: v.optional(v.number()),
	dueDateOffset: v.optional(v.number()),
	notes: v.optional(v.string()),
	isActive: v.optional(v.boolean()),
	// Invoice fields
	discountType: v.optional(v.string()), // 'none', 'percent', 'value'
	discountValue: v.optional(v.number()), // Discount amount
	taxApplicationType: v.optional(v.string()), // 'apply', 'none', 'reverse'
	invoiceSeries: v.optional(v.string()),
	invoiceCurrency: v.optional(v.string()),
	paymentTerms: v.optional(v.string()),
	paymentMethod: v.optional(v.string()),
	exchangeRate: v.optional(v.string()),
	vatOnCollection: v.optional(v.boolean()),
	isCreditNote: v.optional(v.boolean())
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

	// Get default currency and tax rate from invoice settings
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';
	const defaultTaxRatePercent = invoiceSettings?.defaultTaxRate ?? 19;
	const defaultTaxRateCents = defaultTaxRatePercent * 100; // Convert percentage to cents (19 → 1900)

	let amount = 0;
	let taxRate = defaultTaxRateCents;
	let taxAmount = 0;
	let totalAmount = 0;

	// Calculate from line items if provided, otherwise use legacy amount
	if (data.lineItems && data.lineItems.length > 0) {
		// Calculate totals from line items with discounts (same logic as createInvoice)
		let subtotal = 0;
		let totalTax = 0;

		for (const item of data.lineItems) {
			const itemRate = Math.round(item.rate * 100); // Convert to cents
			let itemSubtotal = Math.round(itemRate * item.quantity);

			// Apply item-level discount if present
			if (item.discountType && item.discount !== undefined) {
				let itemDiscount = 0;
				if (item.discountType === 'percent') {
					itemDiscount = Math.round((itemSubtotal * item.discount) / 100);
				} else if (item.discountType === 'fixed') {
					itemDiscount = Math.round(item.discount * 100); // Convert to cents
				}
				itemSubtotal -= itemDiscount;
			}

			subtotal += itemSubtotal;

			// Only calculate tax if taxApplicationType is 'apply'
			if (data.taxApplicationType === 'apply') {
				// Use item's tax rate if provided, otherwise use default from settings
				const itemTaxRate = item.taxRate ? Math.round(item.taxRate * 100) : defaultTaxRateCents;
				const itemTax = Math.round((itemSubtotal * itemTaxRate) / 10000);
				totalTax += itemTax;
			}
		}

		// Apply invoice-level discount if present
		let discountAmount = 0;
		if (data.discountType && data.discountType !== 'none' && data.discountValue !== undefined) {
			if (data.discountType === 'percent') {
				discountAmount = Math.round((subtotal * data.discountValue) / 100);
			} else if (data.discountType === 'value') {
				discountAmount = Math.round(data.discountValue * 100); // Convert to cents
			}
			subtotal -= discountAmount;
		}

		amount = subtotal;
		taxAmount = totalTax;
		totalAmount = amount + taxAmount;
		// Only set tax rate if taxApplicationType is 'apply'
		if (data.taxApplicationType === 'apply') {
			taxRate = data.lineItems[0]?.taxRate
				? Math.round(data.lineItems[0].taxRate * 100)
				: defaultTaxRateCents;
		} else {
			taxRate = 0; // No tax for 'none' or 'reverse'
		}
	} else if (data.amount !== undefined) {
		// Legacy support: single amount
		amount = Math.round(data.amount * 100); // Convert to cents
		taxRate = data.taxRate ? Math.round(data.taxRate * 100) : defaultTaxRateCents;
		taxAmount = Math.round((amount * taxRate) / 10000);
		totalAmount = amount + taxAmount;
	} else {
		throw new Error('Either lineItems or amount must be provided');
	}

	// Store invoice fields metadata in notes (for backward compatibility and additional fields)
	const invoiceFieldsMetadata: {
		discountType?: string;
		discountValue?: number;
		taxApplicationType?: string;
		invoiceSeries?: string;
		invoiceCurrency?: string;
		paymentTerms?: string;
		paymentMethod?: string;
		exchangeRate?: string;
		vatOnCollection?: boolean;
		isCreditNote?: boolean;
	} = {};

	if (
		data.discountType ||
		data.discountValue !== undefined ||
		data.taxApplicationType ||
		data.invoiceSeries ||
		data.invoiceCurrency ||
		data.paymentTerms ||
		data.paymentMethod ||
		data.exchangeRate ||
		data.vatOnCollection !== undefined ||
		data.isCreditNote !== undefined
	) {
		invoiceFieldsMetadata.discountType = data.discountType;
		invoiceFieldsMetadata.discountValue = data.discountValue;
		invoiceFieldsMetadata.taxApplicationType = data.taxApplicationType;
		invoiceFieldsMetadata.invoiceSeries = data.invoiceSeries;
		invoiceFieldsMetadata.invoiceCurrency = data.invoiceCurrency;
		invoiceFieldsMetadata.paymentTerms = data.paymentTerms;
		invoiceFieldsMetadata.paymentMethod = data.paymentMethod;
		invoiceFieldsMetadata.exchangeRate = data.exchangeRate;
		invoiceFieldsMetadata.vatOnCollection = data.vatOnCollection;
		invoiceFieldsMetadata.isCreditNote = data.isCreditNote;
	}

	// Store invoice fields metadata in notes (for backward compatibility)
	const notesWithMetadata = data.notes
		? `${data.notes}\n\n<!-- RECURRING_INVOICE_FIELDS:${JSON.stringify(invoiceFieldsMetadata)} -->`
		: Object.keys(invoiceFieldsMetadata).length > 0
			? `<!-- RECURRING_INVOICE_FIELDS:${JSON.stringify(invoiceFieldsMetadata)} -->`
			: data.notes || null;

	const startDate = new Date(data.startDate);
	const recurringInterval = data.recurringInterval || 1;
	const nextRunDate = startDate; // First invoice should generate on startDate, not startDate + interval

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
		notes: notesWithMetadata || null,
		lineItemsJson:
			data.lineItems && data.lineItems.length > 0 ? JSON.stringify(data.lineItems) : null,
		isActive: data.isActive !== undefined ? data.isActive : true,
		createdByUserId: event.locals.user.id
	});

	// Log Keez recurring invoice creation
	if (data.lineItems && data.lineItems.length > 0) {
		const keezItems = data.lineItems.filter((li) => li.keezItemExternalId);
		if (keezItems.length > 0) {
			logInfo('keez', `Factură recurentă creată cu ${keezItems.length}/${data.lineItems.length} articole Keez: ${data.recurringType} interval=${recurringInterval}`, {
				tenantId: event.locals.tenant.id,
				userId: event.locals.user.id,
				action: 'keez_recurring_created',
				metadata: {
					recurringInvoiceId,
					name: data.name,
					series: data.invoiceSeries,
					type: data.recurringType,
					interval: recurringInterval,
					startDate: data.startDate,
					endDate: data.endDate,
					keezItems: keezItems.map((li) => ({ keezExternalId: li.keezItemExternalId, description: li.description }))
				}
			});
		}
	}

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

		// Get default currency and tax rate from invoice settings
		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		const defaultTaxRatePercent = invoiceSettings?.defaultTaxRate ?? 19;
		const defaultTaxRateCents = defaultTaxRatePercent * 100;

		// Calculate amount from line items if provided
		let amount = existing.amount;
		let taxRate = existing.taxRate;

		if (updateData.lineItems && updateData.lineItems.length > 0) {
			let subtotal = 0;
			let totalTax = 0;

			for (const item of updateData.lineItems) {
				const itemRate = Math.round(item.rate * 100);
				let itemSubtotal = Math.round(itemRate * item.quantity);

				if (item.discountType && item.discount !== undefined) {
					let itemDiscount = 0;
					if (item.discountType === 'percent') {
						itemDiscount = Math.round((itemSubtotal * item.discount) / 100);
					} else if (item.discountType === 'fixed') {
						itemDiscount = Math.round(item.discount * 100);
					}
					itemSubtotal -= itemDiscount;
				}

				subtotal += itemSubtotal;

				const taxApplicationType =
					updateData.taxApplicationType || (existing.taxRate > 0 ? 'apply' : 'none');
				if (taxApplicationType === 'apply') {
					const itemTaxRate = item.taxRate ? Math.round(item.taxRate * 100) : defaultTaxRateCents;
					const itemTax = Math.round((itemSubtotal * itemTaxRate) / 10000);
					totalTax += itemTax;
				}
			}

			let discountAmount = 0;
			if (
				updateData.discountType &&
				updateData.discountType !== 'none' &&
				updateData.discountValue !== undefined
			) {
				if (updateData.discountType === 'percent') {
					discountAmount = Math.round((subtotal * updateData.discountValue) / 100);
				} else if (updateData.discountType === 'value') {
					discountAmount = Math.round(updateData.discountValue * 100);
				}
				subtotal -= discountAmount;
			}

			amount = subtotal;
			taxRate =
				updateData.taxApplicationType === 'apply'
					? updateData.lineItems[0]?.taxRate
						? Math.round(updateData.lineItems[0].taxRate * 100)
						: defaultTaxRateCents
					: 0;
		} else if (updateData.amount !== undefined) {
			amount = Math.round(updateData.amount * 100);
			taxRate =
				updateData.taxRate !== undefined ? Math.round(updateData.taxRate * 100) : existing.taxRate;
		}

		// Store invoice fields metadata in notes (for backward compatibility)
		const invoiceFieldsMetadata: {
			discountType?: string;
			discountValue?: number;
			taxApplicationType?: string;
			invoiceSeries?: string;
			invoiceCurrency?: string;
			paymentTerms?: string;
			paymentMethod?: string;
			exchangeRate?: string;
			vatOnCollection?: boolean;
			isCreditNote?: boolean;
		} = {};

		if (
			updateData.discountType ||
			updateData.discountValue !== undefined ||
			updateData.taxApplicationType ||
			updateData.invoiceSeries ||
			updateData.invoiceCurrency ||
			updateData.paymentTerms ||
			updateData.paymentMethod ||
			updateData.exchangeRate ||
			updateData.vatOnCollection !== undefined ||
			updateData.isCreditNote !== undefined
		) {
			invoiceFieldsMetadata.discountType = updateData.discountType;
			invoiceFieldsMetadata.discountValue = updateData.discountValue;
			invoiceFieldsMetadata.taxApplicationType = updateData.taxApplicationType;
			invoiceFieldsMetadata.invoiceSeries = updateData.invoiceSeries;
			invoiceFieldsMetadata.invoiceCurrency = updateData.invoiceCurrency;
			invoiceFieldsMetadata.paymentTerms = updateData.paymentTerms;
			invoiceFieldsMetadata.paymentMethod = updateData.paymentMethod;
			invoiceFieldsMetadata.exchangeRate = updateData.exchangeRate;
			invoiceFieldsMetadata.vatOnCollection = updateData.vatOnCollection;
			invoiceFieldsMetadata.isCreditNote = updateData.isCreditNote;
		}

		const notesWithMetadata =
			updateData.notes !== undefined
				? updateData.notes
					? Object.keys(invoiceFieldsMetadata).length > 0
						? `${updateData.notes}\n\n<!-- RECURRING_INVOICE_FIELDS:${JSON.stringify(invoiceFieldsMetadata)} -->`
						: updateData.notes
					: Object.keys(invoiceFieldsMetadata).length > 0
						? `<!-- RECURRING_INVOICE_FIELDS:${JSON.stringify(invoiceFieldsMetadata)} -->`
						: null
				: undefined;

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
				amount: updateData.lineItems || updateData.amount !== undefined ? amount : undefined,
				taxRate: updateData.lineItems || updateData.taxRate !== undefined ? taxRate : undefined,
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
				notes: notesWithMetadata,
				lineItemsJson:
					updateData.lineItems !== undefined
						? updateData.lineItems && updateData.lineItems.length > 0
							? JSON.stringify(updateData.lineItems)
							: null
						: undefined,
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
