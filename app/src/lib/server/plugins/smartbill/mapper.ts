import type { Invoice, InvoiceLineItem, Client, Tenant } from '$lib/server/db/schema';
import type {
	SmartBillInvoice,
	SmartBillProduct,
	SmartBillInvoiceResponse
} from './client';

/**
 * Convert CRM invoice to SmartBill invoice format
 */
export function mapInvoiceToSmartBill(
	invoice: Invoice & { lineItems: InvoiceLineItem[] },
	client: Client,
	tenant: Tenant,
	seriesName: string,
	invoiceNumber: string
): SmartBillInvoice {
	// Map client data
	const smartBillClient = {
		name: client.name,
		vatCode: client.vatCode || undefined,
		isTaxPayer: !!client.vatCode,
		address: client.address || undefined,
		city: client.city || undefined,
		county: client.county || undefined,
		country: client.country || 'România',
		email: client.email || undefined,
		saveToDb: false
	};

	// Map products from line items
	const products: SmartBillProduct[] = invoice.lineItems.map((item) => ({
		name: item.description,
		isDiscount: false,
		measuringUnitName: 'buc',
		currency: 'RON',
		quantity: item.quantity,
		price: item.rate / 100, // Convert from cents to regular number
		isTaxIncluded: true,
		taxName: 'Normala',
		taxPercentage: invoice.taxRate ? invoice.taxRate / 100 : 19, // Convert from cents (1900) to percentage (19)
		saveToDb: false,
		isService: true // Default to service
	}));

	// Format dates
	const formatDate = (date: Date | null | undefined): string => {
		if (!date) return new Date().toISOString().split('T')[0];
		return date instanceof Date
			? date.toISOString().split('T')[0]
			: new Date(date).toISOString().split('T')[0];
	};

	const smartBillInvoice: SmartBillInvoice = {
		companyVatCode: tenant.cui || tenant.vatNumber || '',
		client: smartBillClient,
		issueDate: formatDate(invoice.issueDate),
		seriesName,
		isDraft: invoice.status === 'draft',
		dueDate: formatDate(invoice.dueDate),
		deliveryDate: formatDate(invoice.issueDate),
		products,
		currency: 'RON'
	};

	return smartBillInvoice;
}

/**
 * Convert SmartBill invoice response to CRM invoice data
 */
export function mapSmartBillResponseToInvoice(
	response: SmartBillInvoiceResponse,
	smartBillInvoice: SmartBillInvoice,
	tenantId: string,
	clientId: string,
	userId: string
): Partial<Invoice> {
	// Calculate amounts from SmartBill products
	let amount = 0;
	let taxAmount = 0;
	let totalAmount = 0;

	for (const product of smartBillInvoice.products) {
		if (!product.isDiscount) {
			const productTotal = product.price * product.quantity;
			amount += productTotal;

			if (product.isTaxIncluded && product.taxPercentage) {
				// Calculate tax from tax-included price
				const taxRate = product.taxPercentage / 100;
				const productTax = (productTotal * taxRate) / (1 + taxRate);
				taxAmount += productTax;
			} else if (product.taxPercentage) {
				const taxRate = product.taxPercentage / 100;
				taxAmount += productTotal * taxRate;
			}
		}
	}

	totalAmount = amount + taxAmount;

	// Convert to cents
	amount = Math.round(amount * 100);
	taxAmount = Math.round(taxAmount * 100);
	totalAmount = Math.round(totalAmount * 100);

	// Determine tax rate (use first product's tax rate or default to 19%)
	const taxRate = smartBillInvoice.products[0]?.taxPercentage
		? Math.round(smartBillInvoice.products[0].taxPercentage * 100)
		: 1900;

	// Parse dates
	const parseDate = (dateStr: string | undefined): Date | null => {
		if (!dateStr) return null;
		return new Date(dateStr);
	};

	return {
		tenantId,
		clientId,
		invoiceNumber: `${response.series}-${response.number}`,
		status: smartBillInvoice.isDraft ? 'draft' : 'sent',
		amount,
		taxRate,
		taxAmount,
		totalAmount,
		issueDate: parseDate(smartBillInvoice.issueDate),
		dueDate: parseDate(smartBillInvoice.dueDate),
		smartbillSeries: response.series,
		smartbillNumber: response.number,
		createdByUserId: userId
	};
}

/**
 * Convert SmartBill invoice to CRM invoice line items
 */
export function mapSmartBillProductsToLineItems(
	products: SmartBillProduct[],
	invoiceId: string
): Array<Omit<InvoiceLineItem, 'id' | 'createdAt'>> {
	return products
		.filter((p) => !p.isDiscount)
		.map((product) => ({
			invoiceId,
			description: product.name,
			quantity: product.quantity,
			rate: Math.round(product.price * 100), // Convert to cents
			amount: Math.round(product.price * product.quantity * 100) // Convert to cents
		}));
}

/**
 * Generate next invoice number by incrementing the last synced number
 */
export function generateNextInvoiceNumber(lastNumber: string | null | undefined): string {
	if (!lastNumber) {
		return '0001';
	}

	// Extract numeric part
	const match = lastNumber.match(/(\d+)$/);
	if (!match) {
		return '0001';
	}

	const num = parseInt(match[1], 10);
	const nextNum = num + 1;

	// Preserve leading zeros
	const padding = match[1].length;
	return nextNum.toString().padStart(padding, '0');
}
