import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { sendInvoiceEmail } from '$lib/server/email';
import { generateInvoiceNumber } from '$lib/server/invoice-utils';

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
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string()),
		serviceId: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.invoice.tenantId, event.locals.tenant.id);

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(conditions, eq(table.invoice.clientId, event.locals.client.id)) as any;
		} else if (filters.clientId) {
			conditions = and(conditions, eq(table.invoice.clientId, filters.clientId)) as any;
		}
		if (filters.projectId) {
			conditions = and(conditions, eq(table.invoice.projectId, filters.projectId)) as any;
		}
		if (filters.serviceId) {
			conditions = and(conditions, eq(table.invoice.serviceId, filters.serviceId)) as any;
		}

		return await db.select().from(table.invoice).where(conditions);
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
	taxRate: v.optional(v.number()) // as percentage (will be converted to cents)
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
		currency: v.optional(v.string()) // 'RON', 'EUR', 'USD', etc.
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

		// Generate invoice number (with Keez series if configured)
		const invoiceNumber = await generateInvoiceNumber(event.locals.tenant.id);
		const invoiceId = generateInvoiceId();

		let amount = 0;
		let taxRate = defaultTaxRateCents; // Use default from settings
		let taxAmount = 0;
		let totalAmount = 0;

		// Calculate from line items if provided, otherwise use legacy amount
		if (data.lineItems && data.lineItems.length > 0) {
			// Calculate totals from line items
			let subtotal = 0;
			let totalTax = 0;

			for (const item of data.lineItems) {
				const itemRate = Math.round(item.rate * 100); // Convert to cents
				const itemAmount = Math.round(itemRate * item.quantity);
				subtotal += itemAmount;

				// Use item's tax rate if provided, otherwise use default from settings
				const itemTaxRate = item.taxRate ? Math.round(item.taxRate * 100) : defaultTaxRateCents;
				const itemTax = Math.round((itemAmount * itemTaxRate) / 10000);
				totalTax += itemTax;
			}

			amount = subtotal;
			taxAmount = totalTax;
			totalAmount = amount + taxAmount;
			// Use first line item's tax rate as invoice tax rate, or default from settings
			taxRate = data.lineItems[0]?.taxRate ? Math.round(data.lineItems[0].taxRate * 100) : defaultTaxRateCents;
		} else if (data.amount !== undefined) {
			// Legacy support: single amount
			amount = Math.round(data.amount * 100); // Convert to cents
			taxRate = data.taxRate ? Math.round(data.taxRate * 100) : defaultTaxRateCents; // Use default from settings
			taxAmount = Math.round((amount * taxRate) / 10000);
			totalAmount = amount + taxAmount;
		} else {
			throw new Error('Either lineItems or amount must be provided');
		}

		const invoiceStatus = (data.status || 'draft') as 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

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
			createdByUserId: event.locals.user.id
		};

		// Use transaction to create invoice and line items
		await db.transaction(async (tx) => {
			await tx.insert(table.invoice).values(newInvoice);

			// Insert line items if provided
			if (data.lineItems && data.lineItems.length > 0) {
				const lineItemsToInsert = data.lineItems.map((item) => {
					const itemRate = Math.round(item.rate * 100); // Convert to cents
					const itemAmount = Math.round(itemRate * item.quantity);

					return {
						id: generateInvoiceLineItemId(),
						invoiceId,
						description: item.description,
						quantity: item.quantity,
						rate: itemRate,
						amount: itemAmount
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

		// Emit invoice.created hook (plugins will handle sync when active)
		const hooks = getHooksManager();
		await hooks.emit({
			type: 'invoice.created',
			invoice: { ...fullInvoice, lineItems } as any,
			tenantId: event.locals.tenant.id,
			userId: event.locals.user.id
		});

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
			// Emit invoice.updated hook
			const hooks = getHooksManager();
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

	await db.delete(table.invoice).where(eq(table.invoice.id, invoiceId));

	// Emit invoice.deleted hook
	const hooks = getHooksManager();
	await hooks.emit({
		type: 'invoice.deleted',
		invoice: existing as any,
		tenantId: event.locals.tenant.id,
		userId: event.locals.user.id
	});

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

	const invoiceEmailsEnabled = invoiceSettings?.invoiceEmailsEnabled ?? true;

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
			await sendInvoiceEmail(invoiceId, client.email);
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
	await db
		.update(table.invoice)
		.set(updateData)
		.where(eq(table.invoice.id, invoiceId));

	return { success: true };
});

export const downloadInvoicePDF = query(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify invoice belongs to tenant
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// TODO: Implement PDF generation
	// For now, return invoice data that can be used to generate PDF on client side
	return { invoiceId, invoiceNumber: invoice.invoiceNumber };
});
