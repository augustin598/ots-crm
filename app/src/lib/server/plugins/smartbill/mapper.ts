import type { Invoice, InvoiceLineItem, Client, Tenant } from '$lib/server/db/schema';
import type { SmartBillInvoice, SmartBillProduct, SmartBillInvoiceResponse } from './client';

/**
 * Convert CRM invoice to SmartBill invoice format
 */
export function mapInvoiceToSmartBill(
	invoice: Invoice & { lineItems: InvoiceLineItem[] },
	client: Client,
	tenant: Tenant,
	seriesName: string,
	invoiceNumber: string,
	taxNameMappings?: {
		apply?: string | null;
		none?: string | null;
		reverse?: string | null;
	}
): SmartBillInvoice {
	// Map client data
	const smartBillClient = {
		name: client.name,
		vatCode: client.vatNumber || client.cui || undefined,
		code: undefined, // Client code - not stored in our schema
		isTaxPayer: !!(client.vatNumber || client.cui),
		address: client.address || undefined,
		regCom: client.tradeRegister || undefined,
		contact: client.legalRepresentative || undefined,
		phone: client.phone || undefined,
		city: client.city || undefined,
		county: client.county || undefined,
		country: client.country || 'România',
		email: client.email || undefined,
		bank: client.bankName || undefined,
		iban: client.iban || undefined,
		saveToDb: false
	};

	// Get currency - use invoiceCurrency if available
	const currency = invoice.invoiceCurrency || invoice.currency || 'RON';

	// Map products from line items
	const products: SmartBillProduct[] = [];

	for (const item of invoice.lineItems) {
		// Use per-item tax rate if available, otherwise use invoice tax rate
		const itemTaxRateCents = item.taxRate ?? invoice.taxRate ?? 1900;
		const itemTaxPercentage = itemTaxRateCents / 100;

		// Use per-item currency if available, otherwise use invoice currency
		const itemCurrency = item.currency || currency;

		// Calculate item subtotal
		const itemSubtotal = (item.rate * item.quantity) / 100; // Convert from cents

		// Handle item-level discount
		let itemPrice = item.rate / 100;
		let itemDiscountType: number | undefined;
		let itemDiscountValue: number | undefined;
		let itemDiscountPercentage: number | undefined;

		if (
			item.discountType &&
			item.discount !== null &&
			item.discount !== undefined &&
			item.discount > 0
		) {
			if (item.discountType === 'percent') {
				// Percentage discount
				itemDiscountType = 2; // 2 = percentage
				itemDiscountPercentage = item.discount;
				itemPrice = itemSubtotal * (1 - item.discount / 100);
			} else if (item.discountType === 'fixed') {
				// Fixed value discount
				itemDiscountType = 1; // 1 = value
				itemDiscountValue = item.discount;
				itemPrice = itemSubtotal - item.discount / 100; // Convert from cents
			}
		}

		// Build item description with note if available
		let itemDescription = item.description;
		if (item.note) {
			itemDescription = `${itemDescription}${itemDescription !== item.note ? ` - ${item.note}` : ''}`;
		}

		// Use unit of measure if available
		const measuringUnitName = item.unitOfMeasure || 'buc';

		// Map tax application type to SmartBill taxName using settings mappings
		let taxName: string;
		let taxPercentage: number;

		const taxApplicationType = invoice.taxApplicationType || 'apply';
		if (taxApplicationType === 'reverse') {
			// Reverse charge - use mapping from settings or default
			taxName = taxNameMappings?.reverse || 'Taxare inversa';
			taxPercentage = itemTaxPercentage;
		} else if (taxApplicationType === 'none') {
			// No tax applied - use mapping from settings or default
			taxName = taxNameMappings?.none || 'Neimpozabil';
			taxPercentage = 0;
		} else {
			// Apply tax (default) - use mapping from settings or default
			taxName = taxNameMappings?.apply || 'Normala';
			taxPercentage = itemTaxPercentage;
		}

		products.push({
			name: item.description,
			productDescription: itemDescription !== item.description ? itemDescription : undefined,
			isDiscount: false,
			measuringUnitName,
			currency: itemCurrency,
			quantity: item.quantity,
			price: itemPrice,
			isTaxIncluded: false, // CRM stores base amount and tax separately, so price does NOT include tax
			taxName,
			taxPercentage,
			discountType: itemDiscountType,
			discountValue: itemDiscountValue,
			discountPercentage: itemDiscountPercentage,
			saveToDb: false,
			isService: true // Default to service
		});
	}

	// Handle invoice-level discount as a separate discount line item
	if (
		invoice.discountType &&
		invoice.discountType !== 'none' &&
		invoice.discountValue !== null &&
		invoice.discountValue !== undefined
	) {
		let discountType: number;
		let discountValue: number | undefined;
		let discountPercentage: number | undefined;

		if (invoice.discountType === 'percent') {
			discountType = 2; // 2 = percentage
			// discountValue is stored in basis points (e.g., 1500 = 15%), convert to percentage
			discountPercentage = invoice.discountValue / 100;
		} else if (invoice.discountType === 'value') {
			discountType = 1; // 1 = value
			// discountValue is stored in cents, convert to regular number
			discountValue = invoice.discountValue / 100;
		} else {
			discountType = 1;
			discountValue = 0;
		}

		if (discountValue !== undefined || discountPercentage !== undefined) {
			products.push({
				name: 'Discount',
				isDiscount: true,
				measuringUnitName: 'buc',
				currency,
				quantity: 1,
				price: discountValue !== undefined ? -discountValue : 0, // Negative price for discount
				discountType,
				discountValue,
				discountPercentage,
				saveToDb: false,
				isService: false
			});
		}
	}

	// Format dates
	const formatDate = (date: Date | null | undefined): string => {
		if (!date) return new Date().toISOString().split('T')[0];
		return date instanceof Date
			? date.toISOString().split('T')[0]
			: new Date(date).toISOString().split('T')[0];
	};

	// Parse exchange rate from string format "1,0000" or use default
	let exchangeRate: number | undefined;
	if (invoice.exchangeRate) {
		const parsedRate = parseFloat(invoice.exchangeRate.replace(',', '.'));
		if (!isNaN(parsedRate) && parsedRate > 0 && parsedRate !== 1) {
			exchangeRate = parsedRate;
		}
	}

	const smartBillInvoice: SmartBillInvoice = {
		companyVatCode: tenant.cui || tenant.vatNumber || '',
		client: smartBillClient,
		isDraft: invoice.status === 'draft',
		issueDate: formatDate(invoice.issueDate),
		seriesName,
		currency,
		exchangeRate,
		language: 'RO', // Default to Romanian
		precision: 2, // Default precision
		dueDate: formatDate(invoice.dueDate),
		mentions: invoice.notes || undefined,
		observations: undefined, // Observations are for reports, not documents
		deliveryDate: formatDate(invoice.issueDate),
		paymentDate: invoice.paidDate ? formatDate(invoice.paidDate) : undefined,
		useStock: false,
		useEstimateDetails: false,
		usePaymentTax: invoice.vatOnCollection || false,
		products
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
			serviceId: null,
			description: product.name,
			quantity: product.quantity,
			rate: Math.round(product.price * 100), // Convert to cents
			amount: Math.round(product.price * product.quantity * 100), // Convert to cents
			taxRate: product.taxPercentage ? Math.round(product.taxPercentage * 100) : null,
			discountType:
				product.discountType === 1 ? 'fixed' : product.discountType === 2 ? 'percent' : null,
			discount: product.discountValue
				? Math.round(product.discountValue * 100)
				: product.discountPercentage
					? Math.round(product.discountPercentage * 100)
					: null,
			note: product.productDescription || null,
			currency: product.currency || null,
			unitOfMeasure: product.measuringUnitName || null,
			keezItemExternalId: null
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
