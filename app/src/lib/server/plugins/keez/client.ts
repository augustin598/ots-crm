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
	// Optional: pre-load cached token from DB to avoid extra token fetch per request
	cachedTokenData?: { token: string; expiresAt: Date };
	// Optional: callback to persist token after refresh (for DB caching)
	onTokenRefreshed?: (token: string, expiresAt: Date) => Promise<void>;
}

export interface KeezAccessToken {
	access_token: string;
	token_type: string;
	expires_in: number;
	api_endpoint?: string;
}

export interface KeezInvoice {
	externalId?: string;
	series?: string; // Invoice series (e.g., "OTS")
	number?: number; // Invoice number as integer (e.g., 520)
	partner?: KeezPartner;
	documentDate?: number; // YYYYMMDD format as integer (e.g., 20190102)
	issueDate: number; // YYYYMMDD format as integer (Keez API requires integer, not string)
	dueDate?: number; // YYYYMMDD format as integer
	deliveryDate?: number; // YYYYMMDD format as integer
	currency?: string; // 'RON', 'EUR', etc. (legacy field)
	currencyCode?: string; // 'RON', 'EUR', etc. (preferred field)
	exchangeRate?: number;
	vatOnCollection?: boolean; // TVA la încasare
	paymentTypeId?: number; // Payment type ID (1 = default, 3 = bank transfer, 6 = payment processor)
	paymentType?: string; // Legacy field
	paymentDueDate?: string;
	discountType?: 'Percent' | 'Value';
	discountPercent?: number;
	discountValue?: number;
	invoiceDetails: KeezInvoiceDetail[];
	notes?: string;
	// Invoice-level totals (required by Keez API)
	originalNetAmount?: number;
	originalVatAmount?: number;
	originalNetAmountCurrency?: number;
	originalVatAmountCurrency?: number;
	netAmount?: number;
	vatAmount?: number;
	grossAmount?: number;
	netAmountCurrency?: number;
	vatAmountCurrency?: number;
	grossAmountCurrency?: number;
}

export interface KeezInvoiceDetail {
	itemExternalId?: string; // Identificatorul Keez al articolului (externalId)
	itemName: string; // Numele articolului
	itemDescription?: string; // Descrierea articolului
	measureUnitId: number; // Unitatea de măsură (integer: 1=Buc/Pcs, 2=Hours, 3=Days)
	quantity: number; // Cantitatea articolului (Numeric 2 zecimale)
	unitPrice: number; // Prețul articolului (Numeric 4 zecimale)
	unitPriceCurrency?: number; // Prețul articolului în valuta facturii (Numeric 4 zecimale)
	vatPercent?: number; // Procent de TVA (Numeric 2 zecimale)
	discountType?: 'Percent' | 'Value'; // Tipul de discount global
	discountPercent?: number; // Procentul de discount (Numeric 2 zecimale)
	discountValueOnNet?: boolean; // Se aplică discountul la valoarea netă sau la valoarea brută
	originalNetAmount: number; // Valoarea netă înainte de discount în RON (Numeric 2 zecimale)
	originalVatAmount: number; // Valoarea TVA înainte de discount în RON (Numeric 2 zecimale)
	discountNetValue?: number; // Valoarea netă de discount în RON (Numeric 2 zecimale)
	discountGrossValue?: number; // Valoarea brută de discount în RON (Numeric 2 zecimale)
	discountVatValue?: number; // Valoarea TVA de discount în RON (Numeric 2 zecimale)
	netAmount: number; // Valoarea netă totală în RON (Net - Discount) (Numeric 2 zecimale)
	vatAmount: number; // Valoarea TVA totală în RON (TVA - TVA discount) (Numeric 2 zecimale)
	grossAmount: number; // Valoarea totală brută în RON (Net + TVA) (Numeric 2 zecimale)
	exciseAmount?: number; // Valoarea totală a accizei de pe factură (Numeric 2 zecimale)
	originalNetAmountCurrency?: number; // Valoarea netă înainte de discount în valuta facturii (Numeric 2 zecimale)
	originalVatAmountCurrency?: number; // Valoarea TVA înainte de discount în valuta facturii (Numeric 2 zecimale)
	discountNetValueCurrency?: number; // Valoarea netă de discount în valuta facturii (Numeric 2 zecimale)
	discountGrossValueCurrency?: number; // Valoarea brută de discount în valuta facturii (Numeric 2 zecimale)
	discountVatValueCurrency?: number; // Valoarea TVA de discount în valuta facturii (Numeric 2 zecimale)
	netAmountCurrency?: number; // Valoarea netă totală în valuta facturii (Net - Discount) (Numeric 2 zecimale)
	vatAmountCurrency?: number; // Valoarea TVA totală în valuta facturii (TVA - TVA discount) (Numeric 2 zecimale)
	grossAmountCurrency?: number; // Valoarea totală brută în valuta facturii (Net + VAT) (Numeric 2 zecimale)
	exciseAmountCurrency?: number; // Valoarea totală a accizei de pe factură în valuta facturii (Numeric 2 zecimale)
}

export interface KeezPartner {
	partnerName: string; // e.g., "WEBCO MEDIA S.R.L."
	registrationNumber?: string; // e.g., "J33/1558/2018"
	identificationNumber?: string; // e.g., "40015841"
	taxAttribute?: string; // e.g., "RO"
	isLegalPerson: boolean; // true for legal entity, false for individual
	countryCode?: string; // e.g., "RO"
	countryName?: string; // e.g., "Romania"
	countyCode?: string; // e.g., "RO-SV"
	countyName?: string; // e.g., "Suceava"
	cityName?: string; // e.g., "SUCEAVA"
	addressDetails?: string; // e.g., "STR. TINERETULUI, NR.6, BL.86, SC.A, ET.0, AP.4"
	postalCode?: string;
	email?: string;
	phone?: string;
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
	number?: string | number; // Can be string or number
	series?: string;
	documentDate?: string | number; // Data facturii din lista de facturi - format YYYYMMDD ca număr (e.g., 20260112)
	issueDate?: string | number; // Pentru compatibilitate cu versiuni anterioare
	dueDate?: string | number; // Format YYYYMMDD ca număr (e.g., 20260117)
	partner?: {
		name: string;
		vatCode?: string;
	};
	totalAmount?: number;
	currency?: string;
	status?: string;
	remainingAmount?: number; // Suma rămasă de plată (0 = factură plătită complet)
}

export interface KeezPartnerListResponse {
	partners: KeezPartner[];
	total?: number;
}

export interface KeezItem {
	categoryExternalId: string;
	categoryName?: string;
	code: string;
	description?: string;
	currencyCode: string;
	externalId?: string;
	isActive: boolean;
	isStockable?: boolean;
	lastPrice?: number;
	measureUnitId: number;
	name: string;
	vatRate?: number;
}

export interface KeezItemListResponse {
	data?: KeezItem[];
	total?: number;
	recordsCount?: number;
}

export interface KeezItemResponse {
	externalId: string;
}

export class KeezClient {
	private clientEid: string;
	private applicationId: string;
	private secret: string;
	private baseUrl: string;
	private tokenUrl: string;
	private cachedToken: string | null = null;
	private tokenExpiresAt: Date | null = null;
	private onTokenRefreshed?: (token: string, expiresAt: Date) => Promise<void>;

	constructor(config: KeezClientConfig) {
		this.clientEid = config.clientEid;
		this.applicationId = config.applicationId;
		this.secret = config.secret;
		this.onTokenRefreshed = config.onTokenRefreshed;

		const environment = config.environment || 'app';
		const envPrefix = environment === 'sandbox' ? 'sandbox' : 'app';

		this.baseUrl = config.baseUrl || `https://${envPrefix}.keez.ro/api/v1.0/public-api`;
		this.tokenUrl = config.tokenUrl || `https://${envPrefix}.keez.ro/idp/connect/token`;

		// Pre-load cached token from DB if provided (avoids extra token fetch per request)
		if (config.cachedTokenData) {
			const safetyBuffer = new Date(Date.now() + 60 * 1000); // 60s buffer
			if (config.cachedTokenData.expiresAt > safetyBuffer) {
				this.cachedToken = config.cachedTokenData.token;
				this.tokenExpiresAt = config.cachedTokenData.expiresAt;
			}
		}
	}

	/**
	 * Get OAuth 2.0 access token using client credentials flow.
	 * Checks in-memory cache first, then fetches a new token if needed.
	 */
	async getAccessToken(): Promise<string> {
		// Check if we have a valid cached token
		if (this.cachedToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
			return this.cachedToken;
		}

		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				scope: 'public-api',
				client_id: `app${this.applicationId}`,
				client_secret: this.secret
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Keez OAuth error: ${response.status} ${errorText}`);
		}

		const tokenData: KeezAccessToken = await response.json();

		// Cache token in memory
		this.cachedToken = tokenData.access_token;
		const expiresIn = tokenData.expires_in || 3600; // Default to 1 hour
		this.tokenExpiresAt = new Date(Date.now() + (expiresIn - 60) * 1000); // Subtract 60s for safety

		// Update base URL if provided in token response
		if (tokenData.api_endpoint) {
			this.baseUrl = tokenData.api_endpoint;
		}

		// Persist token via callback (e.g., to DB) if provided
		if (this.onTokenRefreshed) {
			try {
				await this.onTokenRefreshed(this.cachedToken, this.tokenExpiresAt);
			} catch (err) {
				// Non-fatal: log but don't fail the request
				console.warn('[Keez] Failed to persist token to DB:', err);
			}
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
		const response = await this.request<string | { externalId: string }>(
			`/${this.clientEid}/invoices`,
			{
				method: 'POST',
				body: JSON.stringify(invoice)
			}
		);

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
	 * Validate invoice - changes status from Proforma (Draft) to Fiscal Invoice
	 */
	async validateInvoice(externalId: string): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/valid`, {
			method: 'POST',
			body: JSON.stringify({ externalId })
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
	async sendInvoiceEmail(
		externalId: string,
		emailData: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			message?: string;
		}
	): Promise<void> {
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

	/**
	 * Get list of items (articles)
	 */
	async getItems(filters?: {
		offset?: number;
		count?: number;
		order?: string;
		filter?: string;
	}): Promise<KeezItem[]> {
		const params = new URLSearchParams();
		if (filters?.offset !== undefined) params.append('offset', filters.offset.toString());
		if (filters?.count !== undefined) params.append('count', filters.count.toString());
		if (filters?.order) params.append('order', filters.order);
		if (filters?.filter) params.append('filter', filters.filter);

		const queryString = params.toString();
		const endpoint = `/${this.clientEid}/items${queryString ? `?${queryString}` : ''}`;

		return this.request<KeezItem[]>(endpoint, {
			method: 'GET'
		});
	}

	/**
	 * Get single item by externalId
	 */
	async getItem(externalId: string): Promise<KeezItem> {
		return this.request<KeezItem>(`/${this.clientEid}/items/${externalId}`, {
			method: 'GET'
		});
	}

	/**
	 * Get item by code
	 */
	async getItemByCode(code: string): Promise<KeezItem | null> {
		try {
			const response = await this.getItems({
				count: 1000,
				filter: `code eq '${code}'`
			});

			if (response && response.length > 0) {
				return response[0];
			}

			return null;
		} catch (error) {
			console.error(`[Keez] Error getting item by code ${code}:`, error);
			return null;
		}
	}

	/**
	 * Create item (article)
	 */
	async createItem(item: KeezItem): Promise<KeezItemResponse> {
		const response = await this.request<string | { externalId: string }>(
			`/${this.clientEid}/items`,
			{
				method: 'POST',
				body: JSON.stringify(item)
			}
		);

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
	 * Update item
	 */
	async updateItem(externalId: string, item: KeezItem): Promise<void> {
		await this.request(`/${this.clientEid}/items/${externalId}`, {
			method: 'PUT',
			body: JSON.stringify(item)
		});
	}

	/**
	 * Get next invoice number for a given series by fetching invoices from Keez
	 * Returns the next number that should be used (max + 1)
	 * Example: If last invoice is "OTS 520", returns 521
	 */
	async getNextInvoiceNumber(series: string): Promise<number | null> {
		try {
			// Fetch invoices with the specified series, ordered by number descending to get the latest first
			const response = await this.getInvoices({
				count: 1000, // Fetch up to 1000 invoices to find max
				filter: `series eq '${series}'`,
				order: 'number desc' // Order by number descending to get latest first
			});

			if (!response.data || response.data.length === 0) {
				// No invoices found with this series, start from 1
				console.log(`[Keez] No invoices found for series ${series}, starting from 1`);
				return 1;
			}

			// Find the maximum number for this series
			let maxNumber = 0;
			for (const invoice of response.data) {
				if (invoice.series === series && invoice.number !== undefined && invoice.number !== null) {
					// Extract numeric part from invoice number
					// invoice.number can be string (e.g., "520") or number (e.g., 520)
					let num: number;
					
					if (typeof invoice.number === 'number') {
						// If it's already a number, use it directly
						num = invoice.number;
					} else {
						// If it's a string, extract numeric part
						const numberStr = String(invoice.number).trim();
						// Try to match the entire string as a number, or extract numeric part
						if (/^\d+$/.test(numberStr)) {
							// Entire string is numeric
							num = parseInt(numberStr, 10);
						} else {
							// Extract numeric part from end (e.g., "OTS 520" -> "520")
							const numericMatch = numberStr.match(/(\d+)$/);
							if (numericMatch) {
								num = parseInt(numericMatch[1], 10);
							} else {
								// No numeric part found, skip this invoice
								continue;
							}
						}
					}
					
					if (!isNaN(num) && num > maxNumber) {
						maxNumber = num;
					}
				}
			}

			// Return next number (max + 1)
			const nextNumber = maxNumber + 1;
			console.log(`[Keez] Found max invoice number ${maxNumber} for series ${series}, next number: ${nextNumber}`);
			return nextNumber;
		} catch (error) {
			console.error(`[Keez] Error getting next invoice number for series ${series}:`, error);
			return null;
		}
	}

	/**
	 * Create storno (credit note) for an invoice
	 */
	async createStorno(externalId: string): Promise<KeezInvoiceResponse> {
		const response = await this.request<string | { externalId: string }>(
			`/${this.clientEid}/invoices/${externalId}/storno`,
			{ method: 'POST' }
		);

		if (typeof response === 'string') {
			return { externalId: response };
		}
		if (response && typeof response === 'object' && 'externalId' in response) {
			return { externalId: response.externalId };
		}
		return { externalId: String(response) };
	}
}
