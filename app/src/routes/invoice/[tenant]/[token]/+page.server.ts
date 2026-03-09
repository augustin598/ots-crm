import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { validateInvoiceViewToken } from '$lib/server/invoice-token';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
import { logInfo } from '$lib/server/logger';

export const load: PageServerLoad = async ({ params }) => {
	const result = await validateInvoiceViewToken(params.tenant, params.token);

	if (!result) {
		throw error(400, 'Link invalid');
	}

	if ('expired' in result) {
		throw error(400, 'Link invalid sau expirat');
	}

	const { tenant, invoice, lineItems, client, invoiceSettings } = result;

	// Log public invoice page access
	logInfo('invoice-view', `Client accessed public invoice page: ${invoice.invoiceNumber}`, {
		tenantId: tenant.id,
		metadata: {
			invoiceId: invoice.id,
			invoiceNumber: invoice.invoiceNumber,
			clientId: invoice.clientId,
			clientName: client?.businessName || client?.name || null
		}
	});

	const displayInvoiceNumber = formatInvoiceNumberDisplay(invoice, invoiceSettings);

	return {
		invoice: {
			id: invoice.id,
			invoiceNumber: displayInvoiceNumber,
			status: invoice.status,
			issueDate: invoice.issueDate?.toISOString() ?? null,
			dueDate: invoice.dueDate?.toISOString() ?? null,
			totalAmount: invoice.totalAmount,
			currency: invoice.currency,
			taxApplicationType: invoice.taxApplicationType,
			notes: invoice.notes
		},
		lineItems: lineItems.map((li) => ({
			description: li.description,
			quantity: li.quantity,
			rate: li.rate,
			amount: li.amount,
			currency: li.currency,
			unitOfMeasure: li.unitOfMeasure,
			discount: li.discount,
			discountType: li.discountType,
			taxRate: li.taxRate
		})),
		tenant: {
			name: tenant.name,
			slug: tenant.slug,
			email: tenant.email,
			iban: tenant.iban,
			bankName: tenant.bankName
		},
		client: {
			name: client?.businessName || client?.name || 'Client'
		}
	};
};
