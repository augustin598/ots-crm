import type { Invoice, InvoiceLineItem, Client, Tenant } from '$lib/server/db/schema';
import type { ParsedUblInvoice } from './xml-parser';
import type { AnafCompanyData } from './client';

/**
 * Map parsed UBL invoice to CRM invoice format
 */
export function mapUblInvoiceToCrm(
	ublData: ParsedUblInvoice,
	tenantId: string,
	userId: string,
	clientId: string
): Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'> & { lineItems: Omit<InvoiceLineItem, 'id' | 'createdAt'>[] } {
	// Parse dates
	const issueDate = new Date(ublData.issueDate);
	const dueDate = new Date(ublData.dueDate);

	// Convert amounts to cents
	const amount = Math.round(ublData.subTotal * 100);
	const taxAmount = Math.round(ublData.taxAmount * 100);
	const totalAmount = Math.round(ublData.total * 100);

	// Determine tax rate from line items or default to 19%
	const taxRate = ublData.lineItems[0]?.taxRate
		? Math.round(ublData.lineItems[0].taxRate * 100) // Convert percentage to cents (19% = 1900)
		: 1900;

	// Map line items
	const lineItems = ublData.lineItems.map((item) => ({
		invoiceId: '', // Will be set after invoice is created
		description: item.description,
		quantity: item.quantity,
		rate: Math.round(item.unitPrice * 100), // Convert to cents
		amount: Math.round(item.amount * 100) // Convert to cents
	}));

	return {
		tenantId,
		clientId,
		projectId: null,
		serviceId: null,
		invoiceNumber: ublData.invoiceNumber,
		status: 'sent' as const,
		amount,
		taxRate,
		taxAmount,
		totalAmount,
		issueDate,
		dueDate,
		paidDate: null,
		lastEmailSentAt: null,
		lastEmailStatus: null,
		currency: ublData.currency || 'RON',
		notes: null,
		smartbillSeries: null,
		smartbillNumber: null,
		keezInvoiceId: null,
		keezExternalId: null,
		spvId: null, // Will be set when synced
		createdByUserId: userId,
		lineItems
	};
}

/**
 * Map CRM invoice to UBL structure for XML generation
 */
export function mapCrmInvoiceToUbl(
	invoice: Invoice & { lineItems: InvoiceLineItem[] },
	tenant: Tenant,
	client: Client
): {
	invoice: {
		invoiceNumber: string;
		issueDate: Date;
		dueDate: Date;
		currency: string;
		subTotal: number;
		taxAmount: number;
		total: number;
		taxRate: number;
	};
	supplier: {
		name: string;
		vatId: string;
		taxId?: string;
		address?: string;
		city?: string;
		county?: string;
		postalCode?: string;
		country?: string;
		email?: string;
	};
	customer: {
		name: string;
		vatId: string;
		address?: string;
		city?: string;
		county?: string;
		postalCode?: string;
		country?: string;
		email?: string;
	};
	lineItems: Array<{
		description: string;
		quantity: number;
		unitPrice: number;
		amount: number;
	}>;
} {
	// Convert amounts from cents to regular numbers
	const subTotal = (invoice.amount || 0) / 100;
	const taxAmount = (invoice.taxAmount || 0) / 100;
	const total = (invoice.totalAmount || 0) / 100;
	const taxRate = invoice.taxRate ? invoice.taxRate / 100 : 19; // Convert from cents to percentage

	// Map supplier (tenant)
	const supplierVatId = tenant.cui || tenant.vatNumber || '';
	const supplierTaxId = tenant.vatNumber || undefined;

	// Map customer (client)
	const customerVatId = client.vatCode || client.cui || '';

	return {
		invoice: {
			invoiceNumber: invoice.invoiceNumber,
			issueDate: invoice.issueDate || new Date(),
			dueDate: invoice.dueDate || new Date(),
			currency: invoice.currency || 'RON',
			subTotal,
			taxAmount,
			total,
			taxRate
		},
		supplier: {
			name: tenant.name,
			vatId: supplierVatId.replace(/^RO/i, ''), // Remove RO prefix
			taxId: supplierTaxId?.replace(/^RO/i, ''),
			address: tenant.address || undefined,
			city: tenant.city || undefined,
			county: tenant.county || undefined,
			postalCode: tenant.postalCode || undefined,
			country: tenant.country || 'România',
			email: tenant.email || undefined
		},
		customer: {
			name: client.name,
			vatId: customerVatId.replace(/^RO/i, ''), // Remove RO prefix
			address: client.address || undefined,
			city: client.city || undefined,
			county: client.county || undefined,
			postalCode: client.postalCode || undefined,
			country: client.country || 'România',
			email: client.email || undefined
		},
		lineItems: invoice.lineItems.map((item) => ({
			description: item.description,
			quantity: item.quantity,
			unitPrice: (item.rate || 0) / 100, // Convert from cents
			amount: (item.amount || 0) / 100 // Convert from cents
		}))
	};
}

/**
 * Map ANAF company data to client format
 */
export function mapAnafCompanyToClient(
	anafData: AnafCompanyData,
	tenantId: string
): Omit<Client, 'id' | 'createdAt' | 'updatedAt'> {
	return {
		tenantId,
		name: anafData.name,
		email: undefined,
		phone: anafData.phone || undefined,
		address: anafData.address || undefined,
		city: anafData.city || undefined,
		county: anafData.county || undefined,
		postalCode: anafData.postalCode || undefined,
		country: anafData.country || 'România',
		cui: anafData.vat_id.replace(/^RO/i, ''), // Store without RO prefix
		vatCode: anafData.tax_id || anafData.vat_id, // Use tax_id if available, otherwise vat_id
		registrationNumber: anafData.reg_no || undefined,
		tradeRegister: undefined,
		legalRepresentative: undefined,
		iban: undefined,
		bankName: undefined,
		companyType: undefined,
		notes: undefined,
		isActive: anafData.status
	};
}

/**
 * Find or create client from supplier VAT ID
 * This is used when syncing invoices from SPV
 */
export function normalizeVatId(vatId: string): string {
	// Remove RO prefix and return clean CUI
	return vatId.replace(/^RO/i, '').trim();
}
