import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

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

		return invoice;
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
			status: 'draft',
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
