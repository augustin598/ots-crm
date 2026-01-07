import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateInvoiceLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getInvoice = query(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
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
	}
);

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
			.where(and(eq(table.service.id, serviceId), eq(table.service.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!service) {
			throw new Error('Service not found');
		}

		// Generate invoice number
		const invoiceNumber = `INV-${Date.now()}`;
		const invoiceId = generateInvoiceId();

		const amount = service.price || 0;
		const taxRate = 1900; // 19% VAT
		const taxAmount = Math.round(amount * taxRate / 10000);
		const totalAmount = amount + taxAmount;

		await db.insert(table.invoice).values({
			id: invoiceId,
			tenantId: event.locals.tenant.id,
			clientId: service.clientId,
			projectId: service.projectId,
			serviceId: service.id,
			invoiceNumber,
			status: 'draft',
			amount,
			taxRate,
			taxAmount,
			totalAmount,
			issueDate: new Date(),
			dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
			createdByUserId: event.locals.user.id
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
		notes: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const invoiceNumber = `INV-${Date.now()}`;
		const invoiceId = generateInvoiceId();

		const amount = Math.round(data.amount * 100); // Convert to cents
		const taxRate = data.taxRate ? Math.round(data.taxRate * 100) : 1900; // Default 19%
		const taxAmount = Math.round(amount * taxRate / 10000);
		const totalAmount = amount + taxAmount;

		await db.insert(table.invoice).values({
			id: invoiceId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			projectId: data.projectId || null,
			serviceId: data.serviceId || null,
			invoiceNumber,
			status: data.status || 'draft',
			amount,
			taxRate,
			taxAmount,
			totalAmount,
			issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
			dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			notes: data.notes || null,
			createdByUserId: event.locals.user.id
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
		notes: v.optional(v.string())
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
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
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
			taxAmount = Math.round(amount * taxRate / 10000);
			totalAmount = amount + taxAmount;
		}

		await db
			.update(table.invoice)
			.set({
				clientId: updateData.clientId || undefined,
				projectId: updateData.projectId !== undefined ? (updateData.projectId || null) : undefined,
				serviceId: updateData.serviceId !== undefined ? (updateData.serviceId || null) : undefined,
				amount,
				taxRate,
				taxAmount,
				totalAmount,
				status: updateData.status || undefined,
				issueDate: updateData.issueDate ? new Date(updateData.issueDate) : undefined,
				dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
				paidDate: updateData.paidDate ? new Date(updateData.paidDate) : undefined,
				notes: updateData.notes !== undefined ? (updateData.notes || null) : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		return { success: true };
	}
);

export const deleteInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
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

		return { success: true };
	}
);

export const markInvoiceAsPaid = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
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

		await db
			.update(table.invoice)
			.set({
				status: 'paid',
				paidDate: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		return { success: true };
	}
);

export const sendInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
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

		// TODO: Implement actual email sending logic
		// For now, just return success

		return { success: true };
	}
);

export const downloadInvoicePDF = query(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
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
	}
);
