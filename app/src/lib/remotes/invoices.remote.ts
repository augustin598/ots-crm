import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, inArray, like, sql, lt, gte, lte, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { sendInvoiceEmail, getNotificationRecipients } from '$lib/server/email';
import { generateInvoiceNumber, getNextInvoiceNumberFromPlugin } from '$lib/server/invoice-utils';

function generateInvoiceLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getInvoice = query(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

	return {
		...invoice,
		lineItems
	};
});

export const getInvoices = query(
	v.object({
		clientId: v.optional(v.union([v.string(), v.array(v.string())])),
		projectId: v.optional(v.union([v.string(), v.array(v.string())])),
		serviceId: v.optional(v.union([v.string(), v.array(v.string())])),
		status: v.optional(v.union([v.string(), v.array(v.string())])),
		search: v.optional(v.string()),
		issueDate: v.optional(v.string()), // 'overdue', 'today', 'thisWeek', 'thisMonth', or date range
		dueDate: v.optional(v.string()) // 'overdue', 'today', 'thisWeek', 'thisMonth', or date range
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions: any = eq(table.invoice.tenantId, event.locals.tenant.id);

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			// Secondary email users cannot see invoices
			if (!event.locals.isClientUserPrimary) return [];
			conditions = and(conditions, eq(table.invoice.clientId, event.locals.client.id)) as any;
		} else if (filters.clientId) {
			const clientIds = Array.isArray(filters.clientId) ? filters.clientId : [filters.clientId];
			conditions = and(conditions, inArray(table.invoice.clientId, clientIds)) as any;
		}

		// Project filter
		if (filters.projectId) {
			const projectIds = Array.isArray(filters.projectId) ? filters.projectId : [filters.projectId];
			conditions = and(conditions, inArray(table.invoice.projectId, projectIds)) as any;
		}

		// Service filter
		if (filters.serviceId) {
			const serviceIds = Array.isArray(filters.serviceId) ? filters.serviceId : [filters.serviceId];
			conditions = and(conditions, inArray(table.invoice.serviceId, serviceIds)) as any;
		}

		// Status filter
		if (filters.status) {
			const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
			conditions = and(conditions, inArray(table.invoice.status, statuses)) as any;
		}

		// Search filter (invoice number)
		if (filters.search) {
			const searchPattern = `%${filters.search}%`;
			conditions = and(conditions, like(table.invoice.invoiceNumber, searchPattern)) as any;
		}

		// Issue date filter
		if (filters.issueDate) {
			const now = new Date();
			now.setHours(0, 0, 0, 0);
			const todayEnd = new Date(now);
			todayEnd.setHours(23, 59, 59, 999);

			if (filters.issueDate === 'overdue') {
				// For issue date, "overdue" doesn't make sense, so we'll skip it
			} else if (filters.issueDate === 'today') {
				conditions = and(
					conditions,
					and(gte(table.invoice.issueDate, now), lte(table.invoice.issueDate, todayEnd))
				) as any;
			} else if (filters.issueDate === 'thisWeek') {
				const weekEnd = new Date(now);
				weekEnd.setDate(weekEnd.getDate() + 7);
				conditions = and(
					conditions,
					and(gte(table.invoice.issueDate, now), lte(table.invoice.issueDate, weekEnd))
				) as any;
			} else if (filters.issueDate === 'thisMonth') {
				const monthEnd = new Date(now);
				monthEnd.setMonth(monthEnd.getMonth() + 1);
				conditions = and(
					conditions,
					and(gte(table.invoice.issueDate, now), lte(table.invoice.issueDate, monthEnd))
				) as any;
			} else if (filters.issueDate === 'lastMonth') {
				const lastMonthStart = new Date(now);
				lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
				lastMonthStart.setDate(1);
				lastMonthStart.setHours(0, 0, 0, 0);
				const lastMonthEnd = new Date(now);
				lastMonthEnd.setDate(0); // Last day of previous month
				lastMonthEnd.setHours(23, 59, 59, 999);
				conditions = and(
					conditions,
					and(gte(table.invoice.issueDate, lastMonthStart), lte(table.invoice.issueDate, lastMonthEnd))
				) as any;
			} else if (filters.issueDate.startsWith('dateRange:')) {
				const [startStr, endStr] = filters.issueDate.replace('dateRange:', '').split(':');
				const startDate = new Date(startStr);
				const endDate = new Date(endStr);
				endDate.setHours(23, 59, 59, 999);
				conditions = and(
					conditions,
					and(gte(table.invoice.issueDate, startDate), lte(table.invoice.issueDate, endDate))
				) as any;
			}
		}

		// Due date filter
		if (filters.dueDate) {
			const now = new Date();
			now.setHours(0, 0, 0, 0);
			const todayEnd = new Date(now);
			todayEnd.setHours(23, 59, 59, 999);

			if (filters.dueDate === 'overdue') {
				conditions = and(conditions, lt(table.invoice.dueDate, now)) as any;
			} else if (filters.dueDate === 'today') {
				conditions = and(
					conditions,
					and(gte(table.invoice.dueDate, now), lte(table.invoice.dueDate, todayEnd))
				) as any;
			} else if (filters.dueDate === 'thisWeek') {
				const weekEnd = new Date(now);
				weekEnd.setDate(weekEnd.getDate() + 7);
				conditions = and(
					conditions,
					and(gte(table.invoice.dueDate, now), lte(table.invoice.dueDate, weekEnd))
				) as any;
			} else if (filters.dueDate === 'thisMonth') {
				const monthEnd = new Date(now);
				monthEnd.setMonth(monthEnd.getMonth() + 1);
				conditions = and(
					conditions,
					and(gte(table.invoice.dueDate, now), lte(table.invoice.dueDate, monthEnd))
				) as any;
			} else if (filters.dueDate.startsWith('dateRange:')) {
				const [startStr, endStr] = filters.dueDate.replace('dateRange:', '').split(':');
				const startDate = new Date(startStr);
				const endDate = new Date(endStr);
				endDate.setHours(23, 59, 59, 999);
				conditions = and(
					conditions,
					and(gte(table.invoice.dueDate, startDate), lte(table.invoice.dueDate, endDate))
				) as any;
			}
		}

		return await db.select().from(table.invoice).where(conditions).orderBy(desc(table.invoice.issueDate));
	}
);

export const createInvoiceFromService = command(
	v.pipe(v.string(), v.minLength(1)),
	async (serviceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [service] = await db
			.select()
			.from(table.service)
			.where(
				and(eq(table.service.id, serviceId), eq(table.service.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!service) {
			throw new Error('Service not found');
		}

		// Generate invoice number (with Keez series if configured)
		const invoiceNumber = await generateInvoiceNumber(event.locals.tenant.id);
		const invoiceId = generateInvoiceId();

		const amount = service.price || 0;

		// Get default currency and tax rate from invoice settings
		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		const currency = invoiceSettings?.defaultCurrency || 'RON';
		const defaultTaxRatePercent = invoiceSettings?.defaultTaxRate ?? 19;
		const taxRate = defaultTaxRatePercent * 100; // Convert percentage to cents (19 → 1900)
		const taxAmount = Math.round((amount * taxRate) / 10000);
		const totalAmount = amount + taxAmount;

		const newInvoice = {
			id: invoiceId,
			tenantId: event.locals.tenant.id,
			clientId: service.clientId,
			projectId: service.projectId,
			serviceId: service.id,
			invoiceNumber,
			status: 'draft' as const,
			amount,
			taxRate,
			taxAmount,
			totalAmount,
			currency,
			issueDate: new Date(),
			dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
			createdByUserId: event.locals.user.id
		};

		await db.insert(table.invoice).values(newInvoice);

		// Emit invoice.created hook
		const hooks = getHooksManager();
		await hooks.emit({
			type: 'invoice.created',
			invoice: newInvoice as any,
			tenantId: event.locals.tenant.id,
			userId: event.locals.user.id
		});

		return { success: true, invoiceId };
	}
);

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

export const createInvoice = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		projectId: v.optional(v.string()),
		serviceId: v.optional(v.string()),
		amount: v.optional(v.number()), // Legacy support - will be calculated from lineItems if provided
		taxRate: v.optional(v.number()), // Legacy support
		lineItems: v.optional(v.array(lineItemSchema)), // New: array of line items
		status: v.optional(v.string()),
		issueDate: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		notes: v.optional(v.string()),
		currency: v.optional(v.string()), // 'RON', 'EUR', 'USD', etc.
		invoiceSeries: v.optional(v.string()), // User-entered invoice series
		invoiceNumber: v.optional(v.string()), // User-entered invoice number
		invoiceCurrency: v.optional(v.string()), // Invoice display currency
		paymentTerms: v.optional(v.string()), // Payment terms
		paymentMethod: v.optional(v.string()), // Payment method
		exchangeRate: v.optional(v.string()), // Exchange rate as string
		vatOnCollection: v.optional(v.boolean()), // VAT on collection flag
		isCreditNote: v.optional(v.boolean()), // Credit note flag
		taxApplicationType: v.optional(v.string()), // 'apply', 'none', 'reverse' - for SmartBill tax name mapping
		discountType: v.optional(v.string()), // 'none', 'percent', 'value'
		discountValue: v.optional(v.number()) // Discount amount
	}),
	async (data) => {
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
		const taxApplicationType = data.taxApplicationType || 'apply';

		// Use user-provided invoice series and number if provided, otherwise auto-generate
		let invoiceNumber: string;
		if (data.invoiceSeries && data.invoiceNumber) {
			// User provided both series and number - use as-is
			invoiceNumber = `${data.invoiceSeries} ${data.invoiceNumber}`.trim();
		} else if (data.invoiceSeries && !data.invoiceNumber) {
			// User provided only series, get next number from plugin settings
			const nextNumber = await getNextInvoiceNumberFromPlugin(
				event.locals.tenant.id,
				data.invoiceSeries
			);
			if (nextNumber) {
				invoiceNumber = nextNumber;
			} else {
				// No matching plugin found, use series with default number
				invoiceNumber = `${data.invoiceSeries} 1`;
			}
		} else if (data.invoiceNumber) {
			// User provided only number, use series from settings if available
			const series = invoiceSettings?.keezSeries || invoiceSettings?.smartbillSeries || '';
			if (series) {
				// Get next number from plugin for this series, but replace with user's number
				const nextNumber = await getNextInvoiceNumberFromPlugin(event.locals.tenant.id, series);
				if (nextNumber) {
					// Replace the number part with user's number while keeping the format
					// Handle both "SERIES NUMBER" and "SERIES-NUMBER" formats
					invoiceNumber = nextNumber.replace(/\d+$/, data.invoiceNumber);
				} else {
					// Fallback: use series with user's number
					invoiceNumber = `${series} ${data.invoiceNumber}`.trim();
				}
			} else {
				// No series configured, use just the number
				invoiceNumber = data.invoiceNumber;
			}
		} else {
			// Auto-generate invoice number (with plugin series if configured)
			invoiceNumber = await generateInvoiceNumber(event.locals.tenant.id);
		}
		const invoiceId = generateInvoiceId();

		let amount = 0;
		let taxRate = defaultTaxRateCents; // Use default from settings
		let taxAmount = 0;
		let totalAmount = 0;

		// Calculate from line items if provided, otherwise use legacy amount
		if (data.lineItems && data.lineItems.length > 0) {
			// Calculate totals from line items with discounts
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
				if (taxApplicationType === 'apply') {
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
			if (taxApplicationType === 'apply') {
				taxRate = data.lineItems[0]?.taxRate
					? Math.round(data.lineItems[0].taxRate * 100)
					: defaultTaxRateCents;
			} else {
				taxRate = 0; // No tax for 'none' or 'reverse'
			}
		} else if (data.amount !== undefined) {
			// Legacy support: single amount
			amount = Math.round(data.amount * 100); // Convert to cents
			taxRate = data.taxRate ? Math.round(data.taxRate * 100) : defaultTaxRateCents; // Use default from settings
			taxAmount = Math.round((amount * taxRate) / 10000);
			totalAmount = amount + taxAmount;
		} else {
			throw new Error('Either lineItems or amount must be provided');
		}

		const invoiceStatus = (data.status || 'draft') as
			| 'draft'
			| 'sent'
			| 'paid'
			| 'overdue'
			| 'cancelled';

		// Calculate invoice-level discount value in cents
		// For percentage discounts, store the percentage value as-is (e.g., 15 for 15%)
		// For value discounts, store in cents
		let discountValueCents: number | null = null;
		if (data.discountType && data.discountType !== 'none' && data.discountValue !== undefined) {
			if (data.discountType === 'percent') {
				// Store percentage as-is (e.g., 15 for 15%)
				// We'll multiply by 10000 to store as integer (15% = 1500, representing 15.00%)
				discountValueCents = Math.round(data.discountValue * 100); // Store as basis points (15% = 1500)
			} else if (data.discountType === 'value') {
				discountValueCents = Math.round(data.discountValue * 100); // Convert to cents
			}
		}

		const newInvoice = {
			id: invoiceId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			projectId: data.projectId || null,
			serviceId: data.serviceId || null,
			invoiceNumber,
			status: invoiceStatus,
			amount,
			taxRate,
			taxAmount,
			totalAmount,
			currency,
			issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
			dueDate: data.dueDate
				? new Date(data.dueDate)
				: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			notes: data.notes || null,
			invoiceSeries: data.invoiceSeries || null,
			invoiceCurrency: data.invoiceCurrency || null,
			paymentTerms: data.paymentTerms || null,
			paymentMethod: data.paymentMethod || null,
			exchangeRate: data.exchangeRate || null,
			vatOnCollection: data.vatOnCollection || false,
			isCreditNote: data.isCreditNote || false,
			taxApplicationType,
			discountType: data.discountType || null,
			discountValue: discountValueCents,
			createdByUserId: event.locals.user.id
		};

		// Use transaction to create invoice and line items
		await db.transaction(async (tx) => {
			await tx.insert(table.invoice).values(newInvoice);

			// Insert line items if provided
			if (data.lineItems && data.lineItems.length > 0) {
				const lineItemsToInsert = data.lineItems.map((item) => {
					const itemRate = Math.round(item.rate * 100); // Convert to cents
					let itemAmount = Math.round(itemRate * item.quantity);

					// Calculate item discount if present
					let itemDiscountCents: number | null = null;
					if (item.discountType && item.discount !== undefined) {
						if (item.discountType === 'percent') {
							itemDiscountCents = Math.round((itemAmount * item.discount) / 100);
						} else if (item.discountType === 'fixed') {
							itemDiscountCents = Math.round(item.discount * 100); // Convert to cents
						}
						if (itemDiscountCents) {
							itemAmount -= itemDiscountCents;
						}
					}

					return {
						id: generateInvoiceLineItemId(),
						invoiceId,
						serviceId: item.serviceId || null,
						description: item.description,
						quantity: item.quantity,
						rate: itemRate,
						amount: itemAmount,
						taxRate: item.taxRate ? Math.round(item.taxRate * 100) : null,
						discountType: item.discountType || null,
						discount: itemDiscountCents,
						note: item.note || null,
						currency: item.currency || null,
						unitOfMeasure: item.unitOfMeasure || null,
						keezItemExternalId: item.keezItemExternalId || null
					};
				});

				await tx.insert(table.invoiceLineItem).values(lineItemsToInsert);
			} else {
				// Create a default line item from the amount (legacy support)
				await tx.insert(table.invoiceLineItem).values({
					id: generateInvoiceLineItemId(),
					invoiceId,
					description: data.notes || 'Professional Services',
					quantity: 1,
					rate: amount,
					amount: amount
				});
			}
		});

		// Get the full invoice with line items for hooks
		const [fullInvoice] = await db
			.select()
			.from(table.invoice)
			.where(eq(table.invoice.id, invoiceId))
			.limit(1);

		const lineItems = await db
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

		// Emit invoice.created hook (after database transaction)
		// If hook fails, rollback by deleting the invoice
		const hooks = getHooksManager();
		try {
			await hooks.emit({
				type: 'invoice.created',
				invoice: { ...fullInvoice, lineItems } as any,
				tenantId: event.locals.tenant.id,
				userId: event.locals.user.id
			});
		} catch (error) {
			// Rollback: delete the invoice and line items if hook fails
			await db.transaction(async (tx) => {
				await tx.delete(table.invoiceLineItem).where(eq(table.invoiceLineItem.invoiceId, invoiceId));
				await tx.delete(table.invoice).where(eq(table.invoice.id, invoiceId));
			});
			throw error;
		}

		return { success: true, invoiceId };
	}
);

export const updateInvoice = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string()),
		serviceId: v.optional(v.string()),
		amount: v.optional(v.number()),
		taxRate: v.optional(v.number()),
		status: v.optional(v.string()),
		issueDate: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		paidDate: v.optional(v.string()),
		notes: v.optional(v.string()),
		currency: v.optional(v.string()) // 'RON', 'EUR', 'USD', etc.
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { invoiceId, ...updateData } = data;

		// Verify invoice belongs to tenant
		const [existing] = await db
			.select()
			.from(table.invoice)
			.where(
				and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!existing) {
			throw new Error('Invoice not found');
		}

		// Recalculate amounts if amount or taxRate changed
		let amount = existing.amount || 0;
		let taxRate = existing.taxRate || 1900;
		let taxAmount = existing.taxAmount || 0;
		let totalAmount = existing.totalAmount || 0;

		if (updateData.amount !== undefined) {
			amount = Math.round(updateData.amount * 100);
		}
		if (updateData.taxRate !== undefined) {
			taxRate = Math.round(updateData.taxRate * 100);
		}
		if (updateData.amount !== undefined || updateData.taxRate !== undefined) {
			taxAmount = Math.round((amount * taxRate) / 10000);
			totalAmount = amount + taxAmount;
		}

		const previousInvoice = { ...existing };

		await db
			.update(table.invoice)
			.set({
				clientId: updateData.clientId || undefined,
				projectId: updateData.projectId !== undefined ? updateData.projectId || null : undefined,
				serviceId: updateData.serviceId !== undefined ? updateData.serviceId || null : undefined,
				amount,
				taxRate,
				taxAmount,
				totalAmount,
				currency: updateData.currency !== undefined ? updateData.currency : undefined,
				status: updateData.status || undefined,
				issueDate: updateData.issueDate ? new Date(updateData.issueDate) : undefined,
				dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
				paidDate: updateData.paidDate ? new Date(updateData.paidDate) : undefined,
				notes: updateData.notes !== undefined ? updateData.notes || null : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		// Get updated invoice
		const [updatedInvoice] = await db
			.select()
			.from(table.invoice)
			.where(eq(table.invoice.id, invoiceId))
			.limit(1);

		if (updatedInvoice) {
			// Emit invoice.updated hook (after database update)
			// If hook fails, rollback by restoring previous invoice state
			const hooks = getHooksManager();
			try {
				await hooks.emit({
					type: 'invoice.updated',
					invoice: updatedInvoice as any,
					previousInvoice: previousInvoice as any,
					tenantId: event.locals.tenant.id,
					userId: event.locals.user.id
				});

				// Emit status changed hook if status changed
				if (updateData.status && updateData.status !== existing.status) {
					await hooks.emit({
						type: 'invoice.status.changed',
						invoice: updatedInvoice as any,
						previousStatus: existing.status,
						newStatus: updateData.status,
						tenantId: event.locals.tenant.id,
						userId: event.locals.user.id
					});

					// Emit paid hook if status changed to paid
					if (updateData.status === 'paid') {
						await hooks.emit({
							type: 'invoice.paid',
							invoice: updatedInvoice as any,
							tenantId: event.locals.tenant.id,
							userId: event.locals.user.id
						});
					}
				}
			} catch (error) {
				// Rollback: restore invoice to previous state
				await db
					.update(table.invoice)
					.set({
						clientId: previousInvoice.clientId,
						projectId: previousInvoice.projectId,
						serviceId: previousInvoice.serviceId,
						amount: previousInvoice.amount,
						taxRate: previousInvoice.taxRate,
						taxAmount: previousInvoice.taxAmount,
						totalAmount: previousInvoice.totalAmount,
						currency: previousInvoice.currency,
						status: previousInvoice.status,
						issueDate: previousInvoice.issueDate,
						dueDate: previousInvoice.dueDate,
						paidDate: previousInvoice.paidDate,
						notes: previousInvoice.notes,
						updatedAt: new Date()
					})
					.where(eq(table.invoice.id, invoiceId));
				throw error;
			}
		}

		return { success: true };
	}
);

export const deleteInvoice = command(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify invoice belongs to tenant
	const [existing] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Invoice not found');
	}

	// Emit invoice.deleted hook (before database deletion)
	const hooks = getHooksManager();
	await hooks.emit({
		type: 'invoice.deleted',
		invoice: existing as any,
		tenantId: event.locals.tenant.id,
		userId: event.locals.user.id
	});

	await db.delete(table.invoice).where(eq(table.invoice.id, invoiceId));

	return { success: true };
});

export const markInvoiceAsPaid = command(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify invoice belongs to tenant
	const [existing] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Invoice not found');
	}

	const previousStatus = existing.status;

	await db
		.update(table.invoice)
		.set({
			status: 'paid',
			paidDate: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.invoice.id, invoiceId));

	// Get updated invoice
	const [updatedInvoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (updatedInvoice) {
		// Emit hooks
		const hooks = getHooksManager();
		await hooks.emit({
			type: 'invoice.updated',
			invoice: updatedInvoice as any,
			previousInvoice: existing as any,
			tenantId: event.locals.tenant.id,
			userId: event.locals.user.id
		});

		if (previousStatus !== 'paid') {
			await hooks.emit({
				type: 'invoice.status.changed',
				invoice: updatedInvoice as any,
				previousStatus,
				newStatus: 'paid',
				tenantId: event.locals.tenant.id,
				userId: event.locals.user.id
			});

			await hooks.emit({
				type: 'invoice.paid',
				invoice: updatedInvoice as any,
				tenantId: event.locals.tenant.id,
				userId: event.locals.user.id
			});
		}
	}

	return { success: true };
});

export const sendInvoice = command(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify invoice belongs to tenant
	const [existing] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Invoice not found');
	}

	// Check if invoice emails are enabled for this tenant
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const masterEnabled = invoiceSettings?.invoiceEmailsEnabled ?? true;
	const sendInvoiceEnabled = invoiceSettings?.sendInvoiceEmailEnabled ?? true;
	const invoiceEmailsEnabled = masterEnabled && sendInvoiceEnabled;

	// Get client email
	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, existing.clientId))
		.limit(1);

	if (!client?.email) {
		if (invoiceEmailsEnabled) {
			throw new Error('Client email not found. Cannot send invoice email.');
		}
		// If emails are disabled, we can still mark as sent
	}

	// Update status to 'sent' if it's currently 'draft'
	const updateData: {
		status?: string;
		lastEmailSentAt?: Date;
		lastEmailStatus?: string;
		updatedAt: Date;
	} = {
		updatedAt: new Date()
	};

	if (existing.status === 'draft') {
		updateData.status = 'sent';
	}

	// Send email to client only if enabled
	if (invoiceEmailsEnabled && client?.email) {
		try {
			const recipients = await getNotificationRecipients(existing.clientId, 'invoices');
			for (const recipientEmail of recipients) {
				await sendInvoiceEmail(invoiceId, recipientEmail);
			}
			// Email sent successfully
			updateData.lastEmailSentAt = new Date();
			updateData.lastEmailStatus = 'sent';
		} catch (error) {
			console.error('Failed to send invoice email:', error);
			// Email failed but invoice can still be marked as sent
			updateData.lastEmailSentAt = new Date();
			updateData.lastEmailStatus = 'failed';
			// Don't throw - allow invoice to be marked as sent even if email fails
			// The email error is logged for debugging
		}
	} else if (!invoiceEmailsEnabled) {
		console.log('Invoice emails are disabled for this tenant. Skipping email send.');
		// When emails are disabled, we still mark as sent but don't set email tracking
		updateData.lastEmailStatus = 'sent';
	} else if (!client?.email) {
		// No email configured for client
		updateData.lastEmailStatus = 'failed';
	}

	// Update invoice with status and email tracking
	await db.update(table.invoice).set(updateData).where(eq(table.invoice.id, invoiceId));

	return { success: true };
});

