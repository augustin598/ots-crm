import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { validateInvoiceViewToken } from '$lib/server/invoice-token';
import { generateInvoicePDF } from '$lib/server/invoice-pdf-generator';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';

export const GET: RequestHandler = async ({ params }) => {
	const result = await validateInvoiceViewToken(params.tenant, params.token);

	if (!result) {
		throw error(400, 'Link invalid');
	}

	if ('expired' in result) {
		throw error(400, 'Link invalid sau expirat');
	}

	const { tenant, invoice, lineItems, client, invoiceSettings } = result;

	const displayInvoiceNumber = formatInvoiceNumberDisplay(invoice, invoiceSettings);

	const pdfBuffer = await generateInvoicePDF({
		invoice,
		lineItems,
		tenant,
		client: client!,
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
