import { env } from '$env/dynamic/private';

const DEFAULT_BASE_URL = 'https://app.keez.ro/api/v1.0/public-api';
const DEFAULT_TOKEN_URL = 'https://app.keez.ro/oauth/token';

export interface KeezClientConfig {
	clientEid: string;
	applicationId: string;
	secret: string;
	baseUrl?: string;
	tokenUrl?: string;
	environment?: 'app' | 'sandbox'; // 'app' for production, 'sandbox' for testing
}

export interface KeezAccessToken {
	access_token: string;
	token_type: string;
	expires_in: number;
	api_endpoint?: string;
}

export interface KeezInvoice {
	externalId?: string;
	partner?: KeezPartner;
	issueDate: string; // YYYY-MM-DD
	dueDate?: string; // YYYY-MM-DD
	deliveryDate?: string; // YYYY-MM-DD
	currency?: string; // 'RON', 'EUR', etc.
	exchangeRate?: number;
	details: KeezInvoiceDetail[];
	notes?: string;
	paymentType?: string;
	paymentDueDate?: string;
}

export interface KeezInvoiceDetail {
	item?: {
		externalId?: string;
		name: string;
		code?: string;
	};
	quantity: number;
	unitPrice: number;
	discount?: number;
	discountType?: 'value' | 'percentage';
	vatRate?: number;
	vatAmount?: number;
	amount?: number;
}

export interface KeezPartner {
	externalId?: string;
	name: string;
	vatCode?: string;
	registrationNumber?: string;
	address?: string;
	city?: string;
	county?: string;
	postalCode?: string;
	country?: string;
	email?: string;
	phone?: string;
	isLegalEntity?: boolean; // true for legal entity, false for individual
	legalRepresentative?: string;
	iban?: string;
	bankName?: string;
}

export interface KeezInvoiceResponse {
	externalId: string;
}

export interface KeezInvoiceListResponse {
	data: KeezInvoiceHeader[];
	total?: number;
    recordsCount: number;
    first: number;
    last: number;
}

export interface KeezInvoiceHeader {
	externalId: string;
	number?: string;
	series?: string;
	issueDate: string;
	dueDate?: string;
	partner?: {
		name: string;
		vatCode?: string;
	};
	totalAmount?: number;
	currency?: string;
	status?: string;
}

export interface KeezPartnerListResponse {
	partners: KeezPartner[];
	total?: number;
}

export class KeezClient {
	private clientEid: string;
	private applicationId: string;
	private secret: string;
	private baseUrl: string;
	private tokenUrl: string;
	private cachedToken: string | null = null;
	private tokenExpiresAt: Date | null = null;

	constructor(config: KeezClientConfig) {
		this.clientEid = config.clientEid;
		this.applicationId = config.applicationId;
		this.secret = config.secret;
		
		const environment = config.environment || 'app';
		const envPrefix = environment === 'sandbox' ? 'sandbox' : 'app';
		
		this.baseUrl = config.baseUrl || `https://${envPrefix}.keez.ro/api/v1.0/public-api`;
		this.tokenUrl = config.tokenUrl || `https://${envPrefix}.keez.ro/idp/connect/token`;
	}

	/**
	 * Get OAuth 2.0 access token using client credentials flow
	 */
	async getAccessToken(): Promise<string> {
		// Check if we have a valid cached token
		if (this.cachedToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
			return this.cachedToken;
		}

		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				scope: 'public-api',
                client_id: `app${this.applicationId}`,
                client_secret: this.secret,
                
            })
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Keez OAuth error: ${response.status} ${errorText}`);
		}

		const tokenData: KeezAccessToken = await response.json();
		
		// Cache token
		this.cachedToken = tokenData.access_token;
		const expiresIn = tokenData.expires_in || 3600; // Default to 1 hour
		this.tokenExpiresAt = new Date(Date.now() + (expiresIn - 60) * 1000); // Subtract 60s for safety
		
		// Update base URL if provided in token response
		if (tokenData.api_endpoint) {
			this.baseUrl = tokenData.api_endpoint;
		}

		return this.cachedToken;
	}

	/**
	 * Make authenticated API request with retry logic
	 */
	private async request<T>(endpoint: string, options: RequestInit = {}, retries = 3): Promise<T> {
		const token = await this.getAccessToken();
		const url = `${this.baseUrl}${endpoint}`;
		
		const headers = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
			...options.headers
		};

		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				const response = await fetch(url, {
					...options,
					headers
				});

				if (response.status === 401) {
					// Token expired, clear cache and retry
					this.cachedToken = null;
					this.tokenExpiresAt = null;
					if (attempt < retries - 1) {
						continue;
					}
				}

				if (response.status === 404) {
					throw new Error('Not found');
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Keez API error: ${response.status} ${errorText}`);
				}

				// Handle PDF responses
				if (response.headers.get('content-type')?.includes('application/pdf')) {
					return response.arrayBuffer() as unknown as T;
				}

				// Handle empty responses
				const contentType = response.headers.get('content-type') || '';
				if (contentType.includes('application/json')) {
					const text = await response.text();
					if (!text) {
						return {} as T;
					}
					return JSON.parse(text) as T;
				}

				return response.text() as unknown as T;
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
	 * Get list of invoices
	 */
	async getInvoices(filters?: {
		offset?: number;
		count?: number;
		order?: string;
		filter?: string;
	}): Promise<KeezInvoiceListResponse> {
		const params = new URLSearchParams();
		if (filters?.offset !== undefined) params.append('offset', filters.offset.toString());
		if (filters?.count !== undefined) params.append('count', filters.count.toString());
		if (filters?.order) params.append('order', filters.order);
		if (filters?.filter) params.append('filter', filters.filter);

		const queryString = params.toString();
		const endpoint = `/${this.clientEid}/invoices${queryString ? `?${queryString}` : ''}`;
		
		return this.request<KeezInvoiceListResponse>(endpoint, {
			method: 'GET'
		});
	}

	/**
	 * Get single invoice by externalId
	 */
	async getInvoice(externalId: string): Promise<KeezInvoice> {
		return this.request<KeezInvoice>(`/${this.clientEid}/invoices/${externalId}`, {
			method: 'GET'
		});
	}

	/**
	 * Create invoice
	 */
	async createInvoice(invoice: KeezInvoice): Promise<KeezInvoiceResponse> {
		const response = await this.request<string | { externalId: string }>(`/${this.clientEid}/invoices`, {
			method: 'POST',
			body: JSON.stringify(invoice)
		});
		
		// Keez returns externalId as a string or object
		if (typeof response === 'string') {
			return { externalId: response };
		}
		if (response && typeof response === 'object' && 'externalId' in response) {
			return { externalId: response.externalId };
		}
		// Fallback: try to extract from response
		return { externalId: String(response) };
	}

	/**
	 * Update invoice
	 */
	async updateInvoice(externalId: string, invoice: KeezInvoice): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/${externalId}`, {
			method: 'PUT',
			body: JSON.stringify(invoice)
		});
	}

	/**
	 * Delete invoice
	 */
	async deleteInvoice(externalId: string): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/${externalId}`, {
			method: 'DELETE'
		});
	}

	/**
	 * Validate invoice
	 */
	async validateInvoice(externalId: string): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/${externalId}/validate`, {
			method: 'POST'
		});
	}

	/**
	 * Send invoice to eFactura
	 */
	async sendToEFactura(externalId: string): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/${externalId}/efactura`, {
			method: 'POST'
		});
	}

	/**
	 * Cancel invoice
	 */
	async cancelInvoice(externalId: string): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/${externalId}/cancel`, {
			method: 'POST'
		});
	}

	/**
	 * Send invoice via email
	 */
	async sendInvoiceEmail(externalId: string, emailData: {
		to?: string;
		cc?: string;
		bcc?: string;
		subject?: string;
		message?: string;
	}): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/${externalId}/email`, {
			method: 'POST',
			body: JSON.stringify(emailData)
		});
	}

	/**
	 * Download invoice PDF
	 */
	async downloadInvoicePDF(externalId: string): Promise<ArrayBuffer> {
		return this.request<ArrayBuffer>(`/${this.clientEid}/invoices/${externalId}/pdf`, {
			method: 'GET'
		});
	}

	/**
	 * Get list of partners (clients)
	 */
	async getPartners(filters?: {
		offset?: number;
		count?: number;
		order?: string;
		filter?: string;
	}): Promise<KeezPartnerListResponse> {
		const params = new URLSearchParams();
		if (filters?.offset !== undefined) params.append('offset', filters.offset.toString());
		if (filters?.count !== undefined) params.append('count', filters.count.toString());
		if (filters?.order) params.append('order', filters.order);
		if (filters?.filter) params.append('filter', filters.filter);

		const queryString = params.toString();
		const endpoint = `/${this.clientEid}/partners${queryString ? `?${queryString}` : ''}`;
		
		return this.request<KeezPartnerListResponse>(endpoint, {
			method: 'GET'
		});
	}

	/**
	 * Get single partner by externalId
	 */
	async getPartner(externalId: string): Promise<KeezPartner> {
		return this.request<KeezPartner>(`/${this.clientEid}/partners/${externalId}`, {
			method: 'GET'
		});
	}

	/**
	 * Create partner (optional, for future use)
	 */
	async createPartner(partner: KeezPartner): Promise<{ externalId: string }> {
		const response = await this.request<string>(`/${this.clientEid}/partners`, {
			method: 'POST',
			body: JSON.stringify(partner)
		});
		
		return { externalId: response };
	}
}
