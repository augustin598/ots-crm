import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateInvoicePDF } from '$lib/server/invoice-pdf-generator';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const invoiceId = event.params.invoiceId;
	const tenantId = event.locals.tenant.id;

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
		.limit(1);

	if (!invoice) {
		throw error(404, 'Invoice not found');
	}

	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client) {
		throw error(404, 'Client not found');
	}

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	const displayInvoiceNumber = formatInvoiceNumberDisplay(invoice, invoiceSettings);

	const pdfBuffer = await generateInvoicePDF({
		invoice,
		lineItems,
		tenant: event.locals.tenant,
		client,
		displayInvoiceNumber
	});

	const safeFilename = `Factura-${displayInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;

	const uint8 = new Uint8Array(pdfBuffer);

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${safeFilename}"`,
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
