import { env } from '$env/dynamic/private';
import { DOMParser } from '@xmldom/xmldom';

const DEFAULT_BASE_URL = 'https://ws.smartbill.ro/SBORO/api';

export interface SmartBillClientConfig {
	email: string;
	token: string;
	baseUrl?: string;
}

export interface SmartBillInvoice {
	companyVatCode: string; // Required
	client: {
		name: string; // Required
		vatCode?: string;
		code?: string;
		isTaxPayer: boolean;
		address?: string;
		regCom?: string;
		contact?: string;
		phone?: string;
		city?: string;
		county?: string;
		country?: string;
		email?: string; // Required
		bank?: string;
		iban?: string;
		saveToDb?: boolean;
	};
	isDraft?: boolean;
	issueDate?: string; // YYYY-MM-DD
	seriesName?: string;
	currency?: string;
	exchangeRate?: number;
	language?: string;
	precision?: number;
	issuerCnp?: string;
	issuerName?: string;
	aviz?: string;
	dueDate?: string;
	mentions?: string;
	observations?: string;
	delegateAuto?: string;
	delegateIdentityCard?: string;
	delegateName?: string;
	deliveryDate?: string;
	paymentDate?: string;
	useStock?: boolean;
	useEstimateDetails?: boolean;
	usePaymentTax?: boolean;
	paymentBase?: number;
	colectedTax?: number; // Note: API uses "colected" not "collected"
	paymentTotal?: number;
	estimate?: {
		seriesName?: string;
		number?: string;
	};
	products: SmartBillProduct[]; // Required
	payment?: {
		value: number; // Required if payment is provided
		paymentSeries: string; // Required if payment is provided
		type: string; // Required if payment is provided
		isCash?: boolean;
	};
	paymentUrl?: string;
	sendEmail?: boolean;
	email?: {
		to?: string;
		cc?: string;
		bcc?: string;
	};
}

export interface SmartBillProduct {
	name: string; // Required
	code?: string; // Required if "Foloseste cod produs" is enabled in Cloud
	productDescription?: string;
	translatedName?: string;
	translatedMeasuringUnit?: string;
	isDiscount?: boolean;
	numberOfItems?: number;
	discountType?: number; // 1 = value, 2 = percentage
	discountPercentage?: number;
	discountValue?: number;
	measuringUnitName: string; // Required
	currency: string; // Required
	quantity: number;
	price: number;
	isTaxIncluded?: boolean;
	taxName?: string;
	taxPercentage?: number;
	exchangeRate?: number;
	saveToDb?: boolean;
	warehouseName?: string;
	isService?: boolean;
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
	 * Parse XML response from SmartBill
	 */
	private parseXMLResponse(xmlText: string): SmartBillInvoiceResponse {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xmlText, 'application/xml');

		// Check for parsing errors
		const parserError = doc.getElementsByTagName('parsererror')[0];
		if (parserError) {
			throw new Error(`XML parsing error: ${parserError.textContent || 'Unknown parsing error'}`);
		}

		// Get sbcResponse element (can be root or wrapped)
		let responseElement = doc.documentElement;
		if (responseElement.tagName === 'sbcResponse') {
			// Root is sbcResponse
		} else {
			// Look for sbcResponse child
			const sbcResponseElements = doc.getElementsByTagName('sbcResponse');
			if (sbcResponseElements.length > 0) {
				responseElement = sbcResponseElements[0] as HTMLElement;
			}
		}

		const getText = (tagName: string): string => {
			const elements = responseElement.getElementsByTagName(tagName);
			return elements[0]?.textContent?.trim() || '';
		};

		return {
			errorText: getText('errorText') || undefined,
			message: getText('message') || undefined,
			number: getText('number') || '',
			series: getText('series') || '',
			url: getText('url') || undefined
		};
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

				// Handle PDF responses
				if (response.headers.get('content-type')?.includes('application/pdf')) {
					if (!response.ok) {
						const errorText = await response.text();
						throw new Error(`SmartBill API error: ${response.status} ${errorText}`);
					}
					return response.arrayBuffer() as unknown as T;
				}

				// Get response text to check if it's XML
				const responseText = await response.text();
				const contentType = response.headers.get('content-type') || '';

				// Handle XML responses (check content-type or response text)
				if (
					contentType.includes('application/xml') ||
					contentType.includes('text/xml') ||
					responseText.trim().startsWith('<?xml') ||
					responseText.trim().startsWith('<sbcResponse>')
				) {
					const parsed = this.parseXMLResponse(responseText);
					if (!response.ok) {
						const errorMessage = parsed.errorText || responseText;
						throw new Error(`SmartBill API error: ${response.status} ${errorMessage}`);
					}
					return parsed as unknown as T;
				}

				// Handle JSON responses
				if (!response.ok) {
					throw new Error(`SmartBill API error: ${response.status} ${responseText}`);
				}
				const data = JSON.parse(responseText);
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
	async deleteInvoice(
		cif: string,
		seriesName: string,
		number: string
	): Promise<SmartBillInvoiceResponse> {
		const params = new URLSearchParams({
			cif,
			seriesname: seriesName,
			number
		});
		const response = await this.request<
			SmartBillInvoiceResponse | { sbcResponse: SmartBillInvoiceResponse }
		>(`/invoice?${params.toString()}`, {
			method: 'DELETE'
		});

		// Handle wrapped response (sbcResponse) or direct response
		if ('sbcResponse' in response) {
			return response.sbcResponse;
		}
		return response;
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
