import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { sendInvoiceEmail } from '$lib/server/email';
import { generateKeezInvoiceNumber, extractInvoiceNumber } from '$lib/utils/invoice';
import { KeezClient } from '$lib/server/plugins/keez/client';
import { decrypt } from '$lib/server/plugins/keez/crypto';
import { generateNextInvoiceNumber } from '$lib/server/plugins/keez/mapper';

function generateInvoiceLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Generate invoice number based on Keez settings if configured
 * Falls back to default format if Keez is not configured
 */
async function generateInvoiceNumber(tenantId: string): Promise<string> {
	// Check if Keez integration is active
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true)))
		.limit(1);

	if (!integration) {
		// No Keez integration, use default format
		return `INV-${Date.now()}`;
	}

	// Get invoice settings
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	if (!settings?.keezSeries) {
		// Keez series not configured, use default format
		return `INV-${Date.now()}`;
	}

	const series = settings.keezSeries.trim();
	if (!series) {
		return `INV-${Date.now()}`;
	}

	// Try to get next number from Keez API
	try {
		const secret = decrypt(tenantId, integration.secret);
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		const nextNumber = await keezClient.getNextInvoiceNumber(series);
		if (nextNumber !== null) {
			return generateKeezInvoiceNumber(series, nextNumber);
		}
	} catch (error) {
		console.warn(`[Invoice] Failed to get next number from Keez, using fallback:`, error);
	}

	// Fallback: use last synced number or start number
	let nextNum: string;
	if (settings.keezLastSyncedNumber) {
		// Extract numeric part and increment
		const numericPart = extractInvoiceNumber(settings.keezLastSyncedNumber);
		nextNum = generateNextInvoiceNumber(numericPart);
	} else if (settings.keezStartNumber) {
		// Use start number
		nextNum = extractInvoiceNumber(settings.keezStartNumber);
	} else {
		// No start number, default to 1
		nextNum = '1';
	}

	return generateKeezInvoiceNumber(series, nextNum);
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

		if (filters.clientId) {
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
		const taxRate = 1900; // 19% VAT
		const taxAmount = Math.round((amount * taxRate) / 10000);
		const totalAmount = amount + taxAmount;

		// Get default currency from invoice settings
		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		const currency = invoiceSettings?.defaultCurrency || 'RON';

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

export const createInvoice = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		projectId: v.optional(v.string()),
		serviceId: v.optional(v.string()),
		amount: v.number(),
		taxRate: v.optional(v.number()),
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

		// Get default currency from invoice settings
		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';

		// Generate invoice number (with Keez series if configured)
		const invoiceNumber = await generateInvoiceNumber(event.locals.tenant.id);
		const invoiceId = generateInvoiceId();

		const amount = Math.round(data.amount * 100); // Convert to cents
		const taxRate = data.taxRate ? Math.round(data.taxRate * 100) : 1900; // Default 19%
		const taxAmount = Math.round((amount * taxRate) / 10000);
		const totalAmount = amount + taxAmount;

		const newInvoice = {
			id: invoiceId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			projectId: data.projectId || null,
			serviceId: data.serviceId || null,
			invoiceNumber,
			status: (data.status || 'draft') as const,
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
		let amount = existing.amount;
		let taxRate = existing.taxRate;
		let taxAmount = existing.taxAmount;
		let totalAmount = existing.totalAmount;

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
	if (existing.status === 'draft') {
		await db
			.update(table.invoice)
			.set({
				status: 'sent',
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));
	}

	// Send email to client only if enabled
	if (invoiceEmailsEnabled && client?.email) {
		try {
			await sendInvoiceEmail(invoiceId, client.email);
		} catch (error) {
			console.error('Failed to send invoice email:', error);
			// Don't throw - allow invoice to be marked as sent even if email fails
			// The email error is logged for debugging
		}
	} else if (!invoiceEmailsEnabled) {
		console.log('Invoice emails are disabled for this tenant. Skipping email send.');
	}

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
