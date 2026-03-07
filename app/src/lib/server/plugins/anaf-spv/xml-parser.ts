/**
 * UBL XML Parser for Romanian e-factura
 * Based on UBL 2.1 and Romanian CIUS-RO specification
 */

import { DOMParser } from '@xmldom/xmldom';
import { logWarning } from '$lib/server/logger';

const UBL_NS = {
	ubl: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
	cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
	cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
	ccts: 'urn:un:unece:uncefact:documentation:2',
	udt: 'urn:oasis:names:specification:ubl:schema:xsd:UnqualifiedDataTypes-2',
	qdt: 'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDataTypes-2'
};

export interface ParsedUblInvoice {
	invoiceNumber: string;
	issueDate: string; // YYYY-MM-DD
	dueDate: string; // YYYY-MM-DD
	currency: string;
	subTotal: number;
	total: number;
	taxAmount: number;
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
		iban?: string;
		bankName?: string;
	};
	customer: {
		name: string;
		vatId: string;
		taxId?: string;
		address?: string;
		city?: string;
		county?: string;
		postalCode?: string;
		country?: string;
		email?: string;
		iban?: string;
		bankName?: string;
	};
	lineItems: Array<{
		description: string;
		quantity: number;
		unitPrice: number;
		amount: number;
		taxRate?: number;
	}>;
}

/**
 * Parse UBL XML invoice
 */
export function parseUblInvoice(xml: string): ParsedUblInvoice {
	const parser = new DOMParser();
	const doc = parser.parseFromString(xml, 'application/xml');

	// Check for parsing errors
	const parserError = doc.getElementsByTagName('parsererror')[0];
	if (parserError) {
		throw new Error(`XML parsing error: ${parserError.textContent || 'Unknown parsing error'}`);
	}

	// Helper to get text content with namespace
	const getText = (element: Element | null, localName: string, namespace: string): string => {
		const nsElements = element?.getElementsByTagNameNS(namespace, localName);
		return nsElements?.[0]?.textContent?.trim() || '';
	};

	// Helper to get number
	const getNumber = (element: Element | null, localName: string, namespace: string): number => {
		const text = getText(element, localName, namespace);
		return text ? parseFloat(text) : 0;
	};

	// Get invoice basic info
	const invoiceNumber = getText(doc.documentElement, 'ID', UBL_NS.cbc);
	const issueDate = getText(doc.documentElement, 'IssueDate', UBL_NS.cbc);
	const dueDate = getText(doc.documentElement, 'DueDate', UBL_NS.cbc);
	const currency = getText(doc.documentElement, 'DocumentCurrencyCode', UBL_NS.cbc);

	// Get monetary totals
	const legalMonetaryTotal = doc.documentElement.getElementsByTagNameNS(
		UBL_NS.cac,
		'LegalMonetaryTotal'
	)[0];
	const subTotal = getNumber(legalMonetaryTotal, 'LineExtensionAmount', UBL_NS.cbc);
	const total = getNumber(legalMonetaryTotal, 'PayableAmount', UBL_NS.cbc);
	const taxTotal = doc.documentElement.getElementsByTagNameNS(UBL_NS.cac, 'TaxTotal')[0];
	const taxAmount = getNumber(taxTotal, 'TaxAmount', UBL_NS.cbc);

	// Get supplier party
	const supplierParty = doc.documentElement.getElementsByTagNameNS(
		UBL_NS.cac,
		'AccountingSupplierParty'
	)[0];
	const supplierPartyInfo = supplierParty?.getElementsByTagNameNS(UBL_NS.cac, 'Party')[0];
	
	// Try to get CUI from PartyIdentification first (more reliable)
	const supplierPartyIdentification = supplierPartyInfo?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PartyIdentification'
	)[0];
	const supplierCuiFromIdentification = getText(supplierPartyIdentification, 'ID', UBL_NS.cbc);
	
	const supplierLegalEntity = supplierPartyInfo?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PartyLegalEntity'
	)[0];
	// Supplier name comes from PartyLegalEntity -> RegistrationName
	const supplierName = getText(supplierLegalEntity, 'RegistrationName', UBL_NS.cbc);
	// CompanyID in PartyLegalEntity is the registration number (e.g., "J2016002611238")
	const supplierRegistrationNumber = getText(supplierLegalEntity, 'CompanyID', UBL_NS.cbc);
	
	const supplierTaxScheme = supplierPartyInfo?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PartyTaxScheme'
	)[0];
	// CompanyID in PartyTaxScheme is the VAT ID (e.g., "RO2864518")
	const supplierVatIdFromTaxScheme = getText(supplierTaxScheme, 'CompanyID', UBL_NS.cbc);
	
	// Use PartyIdentification CUI if available, otherwise use TaxScheme VAT ID
	const supplierVatId = supplierCuiFromIdentification || supplierVatIdFromTaxScheme;

	const supplierAddress = supplierPartyInfo?.getElementsByTagNameNS(UBL_NS.cac, 'PostalAddress')[0];
	const supplierStreet = getText(supplierAddress, 'StreetName', UBL_NS.cbc);
	const supplierCity = getText(supplierAddress, 'CityName', UBL_NS.cbc);
	const supplierCounty = getText(supplierAddress, 'CountrySubentity', UBL_NS.cbc);
	const supplierPostalCode = getText(supplierAddress, 'PostalZone', UBL_NS.cbc);
	const supplierCountry = getText(
		supplierAddress?.getElementsByTagNameNS(UBL_NS.cac, 'Country')[0],
		'IdentificationCode',
		UBL_NS.cbc
	);

	const supplierContact = supplierPartyInfo?.getElementsByTagNameNS(UBL_NS.cac, 'Contact')[0];
	const supplierEmail = getText(supplierContact, 'ElectronicMail', UBL_NS.cbc);

	// Get payment means (bank information) - typically belongs to supplier/payee
	const paymentMeans = doc.documentElement.getElementsByTagNameNS(UBL_NS.cac, 'PaymentMeans')[0];
	const payeeFinancialAccount = paymentMeans?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PayeeFinancialAccount'
	)[0];
	const supplierIban = getText(payeeFinancialAccount, 'ID', UBL_NS.cbc);
	const supplierBankName = getText(payeeFinancialAccount, 'Name', UBL_NS.cbc);

	// Get customer party
	const customerParty = doc.documentElement.getElementsByTagNameNS(
		UBL_NS.cac,
		'AccountingCustomerParty'
	)[0];
	const customerPartyInfo = customerParty?.getElementsByTagNameNS(UBL_NS.cac, 'Party')[0];
	
	const customerLegalEntity = customerPartyInfo?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PartyLegalEntity'
	)[0];
	// Customer name comes from PartyLegalEntity -> RegistrationName
	const customerName = getText(customerLegalEntity, 'RegistrationName', UBL_NS.cbc);
	// CompanyID in PartyLegalEntity is the registration number (e.g., "J07/297/2022")
	const customerRegistrationNumber = getText(customerLegalEntity, 'CompanyID', UBL_NS.cbc);
	
	const customerTaxScheme = customerPartyInfo?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PartyTaxScheme'
	)[0];
	// CompanyID in PartyTaxScheme is the VAT ID (e.g., "RO44938033") - THIS IS THE CORRECT ONE
	const customerVatIdFromTaxScheme = getText(customerTaxScheme, 'CompanyID', UBL_NS.cbc);
	
	// PartyIdentification might exist but could contain registration number
	const customerPartyIdentification = customerPartyInfo?.getElementsByTagNameNS(
		UBL_NS.cac,
		'PartyIdentification'
	)[0];
	const customerIdFromIdentification = getText(customerPartyIdentification, 'ID', UBL_NS.cbc);
	
	// ALWAYS prefer PartyTaxScheme CompanyID (the VAT ID), only use PartyIdentification if it starts with RO (is a VAT ID)
	let customerVatId = customerVatIdFromTaxScheme;
	if (!customerVatId && customerIdFromIdentification && /^RO\d+$/i.test(customerIdFromIdentification)) {
		// Only use PartyIdentification if it looks like a VAT ID (RO + numbers)
		customerVatId = customerIdFromIdentification;
	} else if (!customerVatId && customerIdFromIdentification && /^\d+$/.test(customerIdFromIdentification)) {
		// Or if it's just numbers (CUI without RO prefix)
		customerVatId = customerIdFromIdentification;
	}
	
	// If still no VAT ID found, use whatever we have (but log warning)
	if (!customerVatId) {
		customerVatId = customerIdFromIdentification || '';
		logWarning('anaf-spv', `No valid VAT ID found for customer ${customerName}, using: ${customerVatId}`);
	}

	const customerAddress = customerPartyInfo?.getElementsByTagNameNS(UBL_NS.cac, 'PostalAddress')[0];
	const customerStreet = getText(customerAddress, 'StreetName', UBL_NS.cbc);
	const customerCity = getText(customerAddress, 'CityName', UBL_NS.cbc);
	const customerCounty = getText(customerAddress, 'CountrySubentity', UBL_NS.cbc);
	const customerPostalCode = getText(customerAddress, 'PostalZone', UBL_NS.cbc);
	const customerCountry = getText(
		customerAddress?.getElementsByTagNameNS(UBL_NS.cac, 'Country')[0],
		'IdentificationCode',
		UBL_NS.cbc
	);

	const customerContact = customerPartyInfo?.getElementsByTagNameNS(UBL_NS.cac, 'Contact')[0];
	const customerEmail = getText(customerContact, 'ElectronicMail', UBL_NS.cbc);

	// Get line items
	const lineItems: ParsedUblInvoice['lineItems'] = [];
	const invoiceLines = doc.documentElement.getElementsByTagNameNS(UBL_NS.cac, 'InvoiceLine');

	for (let i = 0; i < invoiceLines.length; i++) {
		const line = invoiceLines[i];
		const quantity = getNumber(line, 'InvoicedQuantity', UBL_NS.cbc);
		const lineExtensionAmount = getNumber(line, 'LineExtensionAmount', UBL_NS.cbc);

		const item = line.getElementsByTagNameNS(UBL_NS.cac, 'Item')[0];
		// Try to get Description first (more detailed), fall back to Name
		const itemDescription = getText(item, 'Description', UBL_NS.cbc);
		const itemName = getText(item, 'Name', UBL_NS.cbc);
		const description = itemDescription || itemName;

		const price = line.getElementsByTagNameNS(UBL_NS.cac, 'Price')[0];
		const unitPrice = getNumber(price, 'PriceAmount', UBL_NS.cbc);

		// Tax category is inside Item
		const taxCategory = item?.getElementsByTagNameNS(UBL_NS.cac, 'ClassifiedTaxCategory')[0];
		const taxRateText = getText(taxCategory, 'Percent', UBL_NS.cbc);
		const taxRate = taxRateText ? parseFloat(taxRateText) : undefined;

		lineItems.push({
			description,
			quantity,
			unitPrice,
			amount: lineExtensionAmount,
			taxRate: taxRate !== undefined ? taxRate : undefined
		});
	}

	return {
		invoiceNumber,
		issueDate,
		dueDate,
		currency,
		subTotal,
		total,
		taxAmount,
		supplier: {
			name: supplierName,
			vatId: supplierVatId,
			taxId: supplierRegistrationNumber || undefined,
			address: supplierStreet || undefined,
			city: supplierCity || undefined,
			county: supplierCounty || undefined,
			postalCode: supplierPostalCode || undefined,
			country: supplierCountry || undefined,
			email: supplierEmail || undefined,
			iban: supplierIban || undefined,
			bankName: supplierBankName || undefined
		},
		customer: {
			name: customerName,
			vatId: customerVatId,
			taxId: customerRegistrationNumber || undefined,
			address: customerStreet || undefined,
			city: customerCity || undefined,
			county: customerCounty || undefined,
			postalCode: customerPostalCode || undefined,
			country: customerCountry || undefined,
			email: customerEmail || undefined,
			iban: undefined, // Customer bank info not typically in invoice
			bankName: undefined
		},
		lineItems
	};
}

/**
 * Generate UBL XML invoice
 * Note: This is a simplified version. Full implementation should follow Romanian CIUS-RO specification
 */
export function generateUblInvoice(
	invoice: {
		invoiceNumber: string;
		issueDate: Date;
		dueDate: Date;
		currency: string;
		subTotal: number;
		taxAmount: number;
		total: number;
		taxRate: number; // in percentage (e.g., 19 for 19%)
	},
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
	},
	customer: {
		name: string;
		vatId: string;
		address?: string;
		city?: string;
		county?: string;
		postalCode?: string;
		country?: string;
		email?: string;
	},
	lineItems: Array<{
		description: string;
		quantity: number;
		unitPrice: number;
		amount: number;
	}>
): string {
	// This is a simplified implementation
	// Full implementation should create proper XML structure following UBL 2.1 and CIUS-RO
	// For now, we'll return a basic structure that can be expanded

	const formatDate = (date: Date): string => {
		return date.toISOString().split('T')[0];
	};

	const formatNumber = (num: number, decimals = 2): string => {
		return num.toFixed(decimals);
	};

	// Build XML manually (in production, use a proper XML builder)
	const xmlParts: string[] = [];

	xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
	xmlParts.push(
		`<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`
	);

	// UBL Version
	xmlParts.push('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
	xmlParts.push(
		'<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>'
	);

	// Invoice ID and dates
	xmlParts.push(`<cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID>`);
	xmlParts.push(`<cbc:IssueDate>${formatDate(invoice.issueDate)}</cbc:IssueDate>`);
	xmlParts.push(`<cbc:DueDate>${formatDate(invoice.dueDate)}</cbc:DueDate>`);
	// 380 = Commercial invoice, 751 = Invoice information for accounting purposes
	xmlParts.push(`<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`);
	xmlParts.push(`<cbc:TaxPointDate>${formatDate(invoice.issueDate)}</cbc:TaxPointDate>`);
	xmlParts.push(`<cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>`);

	if (supplier.taxId) {
		xmlParts.push(`<cbc:TaxCurrencyCode>${invoice.currency}</cbc:TaxCurrencyCode>`);
	} else {
		xmlParts.push('<cbc:Note>Regim special de scutire pentru intreprinderile mici</cbc:Note>');
	}

	// Supplier Party
	xmlParts.push('<cac:AccountingSupplierParty>');
	xmlParts.push('<cac:Party>');
	
	// PartyIdentification with CUI/VAT ID
	xmlParts.push('<cac:PartyIdentification>');
	xmlParts.push(`<cbc:ID>${escapeXml(supplier.vatId)}</cbc:ID>`);
	xmlParts.push('</cac:PartyIdentification>');

	if (supplier.address || supplier.city || supplier.county || supplier.postalCode) {
		xmlParts.push('<cac:PostalAddress>');
		if (supplier.address) {
			xmlParts.push(`<cbc:StreetName>${escapeXml(supplier.address)}</cbc:StreetName>`);
		}
		if (supplier.city) {
			xmlParts.push(`<cbc:CityName>${escapeXml(supplier.city)}</cbc:CityName>`);
		}
		if (supplier.postalCode) {
			xmlParts.push(`<cbc:PostalZone>${escapeXml(supplier.postalCode)}</cbc:PostalZone>`);
		}
		if (supplier.county) {
			xmlParts.push(`<cbc:CountrySubentity>${escapeXml(supplier.county)}</cbc:CountrySubentity>`);
		}
		xmlParts.push('<cac:Country>');
		xmlParts.push(`<cbc:IdentificationCode>${supplier.country || 'RO'}</cbc:IdentificationCode>`);
		xmlParts.push('</cac:Country>');
		xmlParts.push('</cac:PostalAddress>');
	}

	// PartyTaxScheme with VAT ID
	xmlParts.push('<cac:PartyTaxScheme>');
	xmlParts.push(`<cbc:CompanyID>${escapeXml(supplier.vatId)}</cbc:CompanyID>`);
	xmlParts.push('<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>');
	xmlParts.push('</cac:PartyTaxScheme>');

	xmlParts.push('<cac:PartyLegalEntity>');
	xmlParts.push(`<cbc:RegistrationName>${escapeXml(supplier.name)}</cbc:RegistrationName>`);
	if (supplier.taxId) {
		// CompanyID in PartyLegalEntity is the registration number (e.g., "J2016002611238")
		xmlParts.push(`<cbc:CompanyID>${escapeXml(supplier.taxId)}</cbc:CompanyID>`);
	}
	xmlParts.push('</cac:PartyLegalEntity>');

	if (supplier.email) {
		xmlParts.push('<cac:Contact>');
		xmlParts.push(`<cbc:ElectronicMail>${escapeXml(supplier.email)}</cbc:ElectronicMail>`);
		xmlParts.push('</cac:Contact>');
	}

	xmlParts.push('</cac:Party>');
	xmlParts.push('</cac:AccountingSupplierParty>');

	// Customer Party
	xmlParts.push('<cac:AccountingCustomerParty>');
	xmlParts.push('<cac:Party>');
	
	// Customer doesn't typically have PartyIdentification in SPV format
	// Only PartyTaxScheme and PartyLegalEntity

	if (customer.address || customer.city || customer.county || customer.postalCode) {
		xmlParts.push('<cac:PostalAddress>');
		if (customer.address) {
			xmlParts.push(`<cbc:StreetName>${escapeXml(customer.address)}</cbc:StreetName>`);
		}
		if (customer.city) {
			xmlParts.push(`<cbc:CityName>${escapeXml(customer.city)}</cbc:CityName>`);
		}
		if (customer.postalCode) {
			xmlParts.push(`<cbc:PostalZone>${escapeXml(customer.postalCode)}</cbc:PostalZone>`);
		}
		if (customer.county) {
			xmlParts.push(`<cbc:CountrySubentity>${escapeXml(customer.county)}</cbc:CountrySubentity>`);
		}
		xmlParts.push('<cac:Country>');
		xmlParts.push(`<cbc:IdentificationCode>${customer.country || 'RO'}</cbc:IdentificationCode>`);
		xmlParts.push('</cac:Country>');
		xmlParts.push('</cac:PostalAddress>');
	}

	// PartyTaxScheme with VAT ID for customer
	xmlParts.push('<cac:PartyTaxScheme>');
	xmlParts.push(`<cbc:CompanyID>${escapeXml(customer.vatId)}</cbc:CompanyID>`);
	xmlParts.push('<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>');
	xmlParts.push('</cac:PartyTaxScheme>');

	xmlParts.push('<cac:PartyLegalEntity>');
	xmlParts.push(`<cbc:RegistrationName>${escapeXml(customer.name)}</cbc:RegistrationName>`);
	xmlParts.push('</cac:PartyLegalEntity>');

	if (customer.email) {
		xmlParts.push('<cac:Contact>');
		xmlParts.push(`<cbc:ElectronicMail>${escapeXml(customer.email)}</cbc:ElectronicMail>`);
		xmlParts.push('</cac:Contact>');
	}

	xmlParts.push('</cac:Party>');
	xmlParts.push('</cac:AccountingCustomerParty>');

	// Payment Means
	xmlParts.push('<cac:PaymentMeans>');
	xmlParts.push('<cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>');
	xmlParts.push('</cac:PaymentMeans>');

	// Tax Total
	xmlParts.push('<cac:TaxTotal>');
	xmlParts.push(
		`<cbc:TaxAmount currencyID="${invoice.currency}">${formatNumber(invoice.taxAmount)}</cbc:TaxAmount>`
	);

	// Tax subtotals for each line item
	for (let i = 0; i < lineItems.length; i++) {
		const item = lineItems[i];
		xmlParts.push('<cac:TaxSubtotal>');
		xmlParts.push(
			`<cbc:TaxableAmount currencyID="${invoice.currency}">${formatNumber(item.amount)}</cbc:TaxableAmount>`
		);
		const itemTaxAmount = (item.amount * invoice.taxRate) / (100 + invoice.taxRate);
		xmlParts.push(
			`<cbc:TaxAmount currencyID="${invoice.currency}">${formatNumber(itemTaxAmount)}</cbc:TaxAmount>`
		);
		xmlParts.push('<cac:TaxCategory>');
		xmlParts.push(`<cbc:ID>${supplier.taxId ? 'S' : 'O'}</cbc:ID>`);
		if (supplier.taxId) {
			xmlParts.push(`<cbc:Percent>${invoice.taxRate}</cbc:Percent>`);
		} else {
			xmlParts.push('<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>');
			xmlParts.push(
				'<cbc:TaxExemptionReason>Regim special de scutire pentru intreprinderile mici</cbc:TaxExemptionReason>'
			);
		}
		xmlParts.push('<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>');
		xmlParts.push('</cac:TaxCategory>');
		xmlParts.push('</cac:TaxSubtotal>');
	}

	xmlParts.push('</cac:TaxTotal>');

	// Legal Monetary Total
	xmlParts.push('<cac:LegalMonetaryTotal>');
	xmlParts.push(
		`<cbc:LineExtensionAmount currencyID="${invoice.currency}">${formatNumber(invoice.subTotal)}</cbc:LineExtensionAmount>`
	);
	xmlParts.push(
		`<cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${formatNumber(invoice.subTotal)}</cbc:TaxExclusiveAmount>`
	);
	xmlParts.push(
		`<cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${formatNumber(invoice.total)}</cbc:TaxInclusiveAmount>`
	);
	xmlParts.push(
		`<cbc:PayableAmount currencyID="${invoice.currency}">${formatNumber(invoice.total)}</cbc:PayableAmount>`
	);
	xmlParts.push('</cac:LegalMonetaryTotal>');

	// Invoice Lines
	for (let i = 0; i < lineItems.length; i++) {
		const item = lineItems[i];
		xmlParts.push('<cac:InvoiceLine>');
		xmlParts.push(`<cbc:ID>${i + 1}</cbc:ID>`);
		xmlParts.push(
			`<cbc:InvoicedQuantity unitCode="XZZ">${formatNumber(item.quantity)}</cbc:InvoicedQuantity>`
		);
		xmlParts.push(
			`<cbc:LineExtensionAmount currencyID="${invoice.currency}">${formatNumber(item.amount)}</cbc:LineExtensionAmount>`
		);

		xmlParts.push('<cac:Item>');
		xmlParts.push(`<cbc:Description>${escapeXml(item.description)}</cbc:Description>`);
		xmlParts.push(`<cbc:Name>${escapeXml(item.description)}</cbc:Name>`);
		xmlParts.push('<cac:ClassifiedTaxCategory>');
		xmlParts.push(`<cbc:ID>${supplier.taxId ? 'S' : 'O'}</cbc:ID>`);
		if (supplier.taxId) {
			xmlParts.push(`<cbc:Percent>${invoice.taxRate}</cbc:Percent>`);
		}
		xmlParts.push('<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>');
		xmlParts.push('</cac:ClassifiedTaxCategory>');
		xmlParts.push('</cac:Item>');

		xmlParts.push('<cac:Price>');
		xmlParts.push(
			`<cbc:PriceAmount currencyID="${invoice.currency}">${formatNumber(item.unitPrice)}</cbc:PriceAmount>`
		);
		xmlParts.push(
			`<cbc:BaseQuantity unitCode="XZZ">${formatNumber(item.quantity)}</cbc:BaseQuantity>`
		);
		xmlParts.push('</cac:Price>');
		xmlParts.push('</cac:InvoiceLine>');
	}

	xmlParts.push('</Invoice>');

	return xmlParts.join('\n');
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
