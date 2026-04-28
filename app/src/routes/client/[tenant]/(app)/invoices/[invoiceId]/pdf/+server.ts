import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateInvoicePDF } from '$lib/server/invoice-pdf-generator';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
import { getRequestAccessFlags } from '$lib/server/portal-access';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.isClientUser || !event.locals.client || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const invoiceId = event.params.invoiceId;
	const tenantId = event.locals.tenant.id;
	const clientId = event.locals.client.id;

	// Per-user access gate. (app)/+layout.server.ts gates page routes;
	// +server.ts endpoints must enforce explicitly (layouts don't run for them).
	const flags = await getRequestAccessFlags({
		tenantId,
		clientId,
		userEmail: event.locals.user.email,
		isPrimary: event.locals.clientUser?.isPrimary ?? false
	});
	if (!flags.invoices) throw error(403, 'Nu ai acces la facturi.');

	// Scope to both tenant and client so clients can only access their own invoices
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.id, invoiceId),
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.clientId, clientId)
			)
		)
		.limit(1);

	if (!invoice) {
		throw error(404, 'Invoice not found');
	}

	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

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
		client: event.locals.client,
		displayInvoiceNumber,
		invoiceLogo: invoiceSettings?.invoiceLogo || null
	});

	const isProforma = invoice.keezStatus === 'Draft' || (!invoice.keezStatus && invoice.status === 'draft');
	const isCreditNote = invoice.isCreditNote;
	const filenamePrefix = isCreditNote ? 'NotaDeCredit' : isProforma ? 'Proforma' : 'Factura';
	const safeFilename = `${filenamePrefix}-${displayInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;

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
