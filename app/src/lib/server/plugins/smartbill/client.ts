import { env } from '$env/dynamic/private';

const DEFAULT_BASE_URL = 'https://ws.smartbill.ro/SBORO/api';

export interface SmartBillClientConfig {
	email: string;
	token: string;
	baseUrl?: string;
}

export interface SmartBillInvoice {
	companyVatCode: string;
	client: {
		name: string;
		vatCode?: string;
		isTaxPayer: boolean;
		address?: string;
		city?: string;
		county?: string;
		country?: string;
		email?: string;
		saveToDb?: boolean;
	};
	issueDate: string; // YYYY-MM-DD
	seriesName: string;
	isDraft?: boolean;
	dueDate?: string;
	deliveryDate?: string;
	products: SmartBillProduct[];
	paymentUrl?: string;
	sendEmail?: boolean;
	email?: {
		to?: string;
		cc?: string;
		bcc?: string;
	};
	language?: string;
	currency?: string;
	exchangeRate?: number;
	useStock?: boolean;
}

export interface SmartBillProduct {
	name: string;
	code?: string;
	isDiscount?: boolean;
	measuringUnitName: string;
	currency: string;
	quantity: number;
	price: number;
	isTaxIncluded?: boolean;
	taxName?: string;
	taxPercentage?: number;
	saveToDb?: boolean;
	isService?: boolean;
	productDescription?: string;
	translatedName?: string;
	translatedMeasuringUnit?: string;
	numberOfItems?: number;
	discountType?: number; // 1 = value, 2 = percentage
	discountValue?: number;
	discountPercentage?: number;
}

export interface SmartBillInvoiceResponse {
	errorText?: string;
	message?: string;
	number: string;
	series: string;
	url?: string;
}

export interface SmartBillPaymentStatus {
	invoiceValue: number;
	paymentValue: number;
	remainingValue: number;
}

export interface SmartBillVATRate {
	name: string;
	percentage: number;
}

export interface SmartBillSeries {
	name: string;
	nextNumber: string;
}

export class SmartBillClient {
	private email: string;
	private token: string;
	private baseUrl: string;

	constructor(config: SmartBillClientConfig) {
		this.email = config.email;
		this.token = config.token;
		this.baseUrl = config.baseUrl || env.SMARTBILL_BASE_URL || DEFAULT_BASE_URL;
	}

	/**
	 * Get Basic Auth header value
	 */
	private getAuthHeader(): string {
		const credentials = `${this.email}:${this.token}`;
		return `Basic ${Buffer.from(credentials).toString('base64')}`;
	}

	/**
	 * Make API request with retry logic
	 */
	private async request<T>(endpoint: string, options: RequestInit = {}, retries = 3): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;
		const headers = {
			'Content-Type': 'application/json',
			Accept: 'application/xml, application/json',
			Authorization: this.getAuthHeader(),
			...options.headers
		};

		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				const response = await fetch(url, {
					...options,
					headers
				});

				if (response.status === 404) {
					throw new Error('Not found');
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`SmartBill API error: ${response.status} ${errorText}`);
				}

				// Handle PDF responses
				if (response.headers.get('content-type')?.includes('application/pdf')) {
					return response.arrayBuffer() as unknown as T;
				}

				// Handle XML responses
				const contentType = response.headers.get('content-type') || '';
				if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
					const xmlText = await response.text();
					return xmlText as unknown as T;
				}

				// Handle JSON responses
				const data = await response.json();
				return data as T;
			} catch (error) {
				if (attempt === retries - 1) {
					throw error;
				}
				// Exponential backoff
				const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw new Error('Request failed after retries');
	}

	/**
	 * Create invoice
	 */
	async createInvoice(invoice: SmartBillInvoice): Promise<SmartBillInvoiceResponse> {
		return this.request<SmartBillInvoiceResponse>('/invoice', {
			method: 'POST',
			body: JSON.stringify(invoice)
		});
	}

	/**
	 * DISABLED: SmartBill API does not support retrieving invoice data
	 * The SmartBill API only supports:
	 * - Creating invoices (POST /invoice)
	 * - Getting PDFs (GET /invoice/pdf)
	 * - Getting payment status (GET /invoice/paymentstatus)
	 * There is no endpoint to retrieve invoice details.
	 */
	// async getInvoice(cif: string, seriesName: string, number: string): Promise<SmartBillInvoice> {
	// 	... removed ...
	// }

	/**
	 * DISABLED: Parse XML invoice response - not needed since getInvoice is disabled
	 */
	// private parseInvoiceXML(xmlString: string): SmartBillInvoice {
	// 	... removed ...
	// }

	/**
	 * Get invoice PDF
	 */
	async getInvoicePDF(cif: string, seriesName: string, number: string): Promise<ArrayBuffer> {
		const params = new URLSearchParams({
			cif,
			seriesname: seriesName,
			number
		});
		return this.request<ArrayBuffer>(`/invoice/pdf?${params.toString()}`, {
			method: 'GET'
		});
	}

	/**
	 * Get invoice payment status
	 */
	async getInvoicePaymentStatus(
		cif: string,
		seriesName: string,
		number: string
	): Promise<SmartBillPaymentStatus> {
		const params = new URLSearchParams({
			cif,
			seriesname: seriesName,
			number
		});
		return this.request<SmartBillPaymentStatus>(`/invoice/paymentstatus?${params.toString()}`, {
			method: 'GET'
		});
	}

	/**
	 * Reverse invoice (storno)
	 */
	async reverseInvoice(
		cif: string,
		seriesName: string,
		number: string,
		issueDate: string
	): Promise<SmartBillInvoiceResponse> {
		return this.request<SmartBillInvoiceResponse>('/invoice/reverse', {
			method: 'POST',
			body: JSON.stringify({
				companyVatCode: cif,
				seriesName,
				number,
				issueDate
			})
		});
	}

	/**
	 * Cancel invoice
	 */
	async cancelInvoice(cif: string, seriesName: string, number: string): Promise<void> {
		const params = new URLSearchParams({
			cif,
			seriesname: seriesName,
			number
		});
		await this.request(`/invoice/cancel?${params.toString()}`, {
			method: 'PUT'
		});
	}

	/**
	 * Delete invoice
	 */
	async deleteInvoice(cif: string, seriesName: string, number: string): Promise<void> {
		const params = new URLSearchParams({
			cif,
			seriesname: seriesName,
			number
		});
		await this.request(`/invoice?${params.toString()}`, {
			method: 'DELETE'
		});
	}

	/**
	 * Get VAT rates
	 */
	async getVATRates(cif: string): Promise<SmartBillVATRate[]> {
		const params = new URLSearchParams({ cif });
		return this.request<SmartBillVATRate[]>(`/tax?${params.toString()}`, {
			method: 'GET'
		});
	}

	/**
	 * Get invoice series
	 */
	async getInvoiceSeries(cif: string): Promise<SmartBillSeries[]> {
		const params = new URLSearchParams({ cif, type: 'f' });
		return this.request<SmartBillSeries[]>(`/series?${params.toString()}`, {
			method: 'GET'
		});
	}

	/**
	 * Get all document series
	 */
	async getSeries(cif: string): Promise<SmartBillSeries[]> {
		const params = new URLSearchParams({ cif });
		return this.request<SmartBillSeries[]>(`/series?${params.toString()}`, {
			method: 'GET'
		});
	}
}
