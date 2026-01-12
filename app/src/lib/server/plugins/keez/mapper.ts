import type { Invoice, InvoiceLineItem, Client, Tenant } from '$lib/server/db/schema';
import type {
	KeezInvoice,
	KeezInvoiceDetail,
	KeezPartner,
	KeezInvoiceResponse,
	KeezInvoiceHeader
} from './client';

/**
 * Convert CRM invoice to Keez invoice format
 */
export function mapInvoiceToKeez(
	invoice: Invoice & { lineItems: InvoiceLineItem[] },
	client: Client,
	tenant: Tenant,
	externalId?: string
): KeezInvoice {
	// Map partner data
	const partner: KeezPartner = {
		externalId: client.keezPartnerId || undefined,
		name: client.name,
		vatCode: client.vatNumber || client.cui || undefined,
		registrationNumber: client.registrationNumber || undefined,
		address: client.address || undefined,
		city: client.city || undefined,
		county: client.county || undefined,
		postalCode: client.postalCode || undefined,
		country: client.country || 'România',
		email: client.email || undefined,
		phone: client.phone || undefined,
		isLegalEntity: client.companyType !== null && client.companyType !== undefined,
		legalRepresentative: client.legalRepresentative || undefined,
		iban: client.iban || undefined,
		bankName: client.bankName || undefined
	};

	// Map invoice details from line items
	const details: KeezInvoiceDetail[] = invoice.lineItems.map((item) => {
		const unitPrice = item.rate / 100; // Convert from cents
		const amount = (item.amount || item.rate * item.quantity) / 100; // Convert from cents

		// Calculate VAT if tax rate is set
		let vatRate: number | undefined;
		let vatAmount: number | undefined;

		if (invoice.taxRate) {
			vatRate = invoice.taxRate / 100; // Convert from cents (1900) to percentage (19)
			// Assume tax is included in the amount
			const taxMultiplier = 1 + vatRate / 100;
			const amountWithoutTax = amount / taxMultiplier;
			vatAmount = amount - amountWithoutTax;
		}

		return {
			item: {
				name: item.description
			},
			quantity: item.quantity,
			unitPrice,
			vatRate,
			vatAmount,
			amount
		};
	});

	// Format dates
	const formatDate = (date: Date | null | undefined): string => {
		if (!date) return new Date().toISOString().split('T')[0];
		return date instanceof Date
			? date.toISOString().split('T')[0]
			: new Date(date).toISOString().split('T')[0];
	};

	const keezInvoice: KeezInvoice = {
		externalId,
		partner,
		issueDate: formatDate(invoice.issueDate),
		dueDate: formatDate(invoice.dueDate),
		deliveryDate: formatDate(invoice.issueDate),
		currency: invoice.currency || 'RON',
		details,
		notes: invoice.notes || undefined
	};

	return keezInvoice;
}

/**
 * Convert Keez invoice to CRM invoice data
 */
export function mapKeezInvoiceToCRM(
	keezInvoice: KeezInvoice,
	keezHeader: KeezInvoiceHeader,
	tenantId: string,
	clientId: string | null,
	userId: string
): Partial<Invoice> & { lineItems: Array<Omit<InvoiceLineItem, 'id' | 'createdAt'>> } {
	// Calculate amounts from Keez details
	let amount = 0;
	let taxAmount = 0;
	let totalAmount = 0;

	for (const detail of keezInvoice.invoiceDetails) {
		const detailAmount = detail.netAmount || detail.unitPrice * detail.quantity;
		amount += detailAmount;

		if (detail.vatAmount) {
			taxAmount += detail.vatAmount;
		} else if (detail.vatPercent) {
			taxAmount += detailAmount * (detail.vatPercent / 100);
		}
	}

	totalAmount = amount + taxAmount;

	// Convert to cents
	amount = Math.round(amount * 100);
	taxAmount = Math.round(taxAmount * 100);
	totalAmount = Math.round(totalAmount * 100);

	// Determine tax rate (use first detail's tax rate or default to 19%)
	const taxRate = keezInvoice.invoiceDetails[0]?.vatPercent
		? Math.round(keezInvoice.invoiceDetails[0].vatPercent * 100)
		: 1900;

	// Parse dates
	const parseDate = (dateStr: string | undefined): Date | null => {
		if (!dateStr) return null;
		try {
			return new Date(dateStr);
		} catch {
			return null;
		}
	};

	// Map line items - will be added later when invoice is created
	const lineItems: Array<Omit<InvoiceLineItem, 'id' | 'createdAt'>> = [];

	return {
		tenantId,
		clientId: clientId || '',
		invoiceNumber: keezHeader.number || keezHeader.externalId,
		status: 'sent', // Keez invoices are typically already sent
		amount,
		taxRate,
		taxAmount,
		totalAmount,
		issueDate: parseDate(keezInvoice.issueDate),
		dueDate: parseDate(keezInvoice.dueDate),
		currency: keezInvoice.currency || 'RON',
		notes: keezInvoice.notes || undefined,
		keezInvoiceId: keezHeader.externalId || null,
		keezExternalId: keezHeader.externalId || null,
		createdByUserId: userId,
		lineItems
	};
}

/**
 * Convert Keez partner to CRM client
 */
export function mapKeezPartnerToClient(
	keezPartner: KeezPartner,
	tenantId: string
): Omit<Client, 'id' | 'createdAt' | 'updatedAt'> {
	return {
		tenantId,
		name: keezPartner.partnerName,
		status: 'active',
		companyType: keezPartner.isLegalPerson ? 'SRL' : null, // Default to SRL for legal entities
		cui: keezPartner.identificationNumber || null,
		vatNumber: keezPartner.taxAttribute || null,
		registrationNumber: keezPartner.registrationNumber || null,
		tradeRegister: null,
		address: keezPartner.addressDetails || null,
		city: keezPartner.cityName || null,
		county: keezPartner.countyName || null,
		postalCode: keezPartner.postalCode || null,
		country: keezPartner.countryName || 'România',
		email: keezPartner.email || null,
		phone: keezPartner.phone || null,
		legalRepresentative: keezPartner.legalRepresentative || null,
		iban: keezPartner.iban || null,
		bankName: keezPartner.bankName || null,
		keezPartnerId: keezPartner.partnerName || null,
		notes: null
	};
}

/**
 * Convert CRM client to Keez partner format
 */
export function mapClientToKeezPartner(client: Client): KeezPartner {
	return {
		partnerName: client.name,
		taxAttribute: client.vatNumber || client.cui || undefined,
		registrationNumber: client.registrationNumber || undefined,
		addressDetails: client.address || undefined,
		cityName: client.city || undefined,
		countyName: client.county || undefined,
		postalCode: client.postalCode || undefined,
		countryName: client.country || 'România',
		email: client.email || undefined,
		phone: client.phone || undefined,
		isLegalPerson: client.companyType === 'SRL',
		legalRepresentative: client.legalRepresentative || undefined,
		iban: client.iban || undefined,
		bankName: client.bankName || undefined
	};
}

/**
 * Convert Keez invoice details to CRM invoice line items
 */
export function mapKeezDetailsToLineItems(
	details: KeezInvoiceDetail[],
	invoiceId: string
): Array<Omit<InvoiceLineItem, 'id' | 'createdAt'>> {
	return details.map((detail) => ({
		invoiceId,
		description: detail.itemDescription || detail.itemName || 'Item',
		quantity: detail.quantity,
		rate: Math.round(detail.unitPrice * 100), // Convert to cents
		amount: Math.round(detail.netAmount * 100) // Convert to cents
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
