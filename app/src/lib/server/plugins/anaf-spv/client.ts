const DEFAULT_BASE_URL = 'https://api.anaf.ro/prod/FCTEL/rest';
const DEFAULT_TOKEN_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';
const DEFAULT_AUTHORIZE_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';
const ANAF_COMPANY_API_URL = 'https://webservicesp.anaf.ro/PlatitorTvaRest/api/v8/ws/tva';

export interface AnafSpvClientConfig {
	accessToken: string;
	refreshToken: string;
	expiresAt?: Date;
	baseUrl?: string;
	tokenUrl?: string;
	clientId?: string;
	clientSecret?: string;
}

export interface AnafSpvInvoiceMessage {
	id: string;
	data: string; // Date in format YYYY-MM-DD
	tip: string; // Message type
}

export interface AnafSpvInvoiceListResponse {
	mesaje?: AnafSpvInvoiceMessage[];
	eroare?: string;
	titlu?: string;
}

export interface AnafSpvUploadResponse {
	index_incarcare: string;
}

export interface AnafCompanyData {
	name: string;
	address: string;
	country: string;
	vat_id: string;
	reg_no: string;
	phone?: string;
	status: boolean;
	tax_id: string;
	county: string;
	city: string;
	street: string;
	street_number: string;
	postal_code: string;
}

export interface AnafTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in?: number;
	token_type?: string;
}

export class AnafSpvClient {
	private accessToken: string;
	private refreshToken: string;
	private expiresAt: Date | null;
	private baseUrl: string;
	private tokenUrl: string;
	private authorizeUrl: string;
	private clientId?: string;
	private clientSecret?: string;

	constructor(config: AnafSpvClientConfig) {
		this.accessToken = config.accessToken || '';
		this.refreshToken = config.refreshToken || '';
		this.expiresAt = config.expiresAt || null;
		this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
		this.tokenUrl = config.tokenUrl || DEFAULT_TOKEN_URL;
		this.authorizeUrl = DEFAULT_AUTHORIZE_URL;
		this.clientId = config.clientId;
		this.clientSecret = config.clientSecret;
	}

	/**
	 * Generate OAuth authorization URL
	 * @param state - CSRF protection token
	 * @param redirectUri - Callback URL
	 * @param clientId - OAuth client ID
	 * @param scope - OAuth scopes (optional, defaults to empty)
	 */
	static getAuthorizationUrl(
		state: string,
		redirectUri: string,
		clientId: string,
		scope = ''
	): string {
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			state: state
		});

		if (scope) {
			params.append('scope', scope);
		}

		return `${DEFAULT_AUTHORIZE_URL}?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for access and refresh tokens
	 * @param code - Authorization code from OAuth callback
	 * @param redirectUri - Must match the redirect_uri used in authorization request
	 * @param clientId - OAuth client ID
	 * @param clientSecret - OAuth client secret
	 */
	static async exchangeCodeForTokens(
		code: string,
		redirectUri: string,
		clientId: string,
		clientSecret: string
	): Promise<AnafTokenResponse> {
		const response = await fetch(DEFAULT_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: code,
				redirect_uri: redirectUri,
				token_content_type: 'jwt' // Required by ANAF
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`ANAF OAuth token exchange error: ${response.status} ${errorText}`);
		}

		const data = await response.json();

		if (!data.access_token) {
			throw new Error('Invalid token response: missing access_token');
		}

		return {
			access_token: data.access_token,
			refresh_token: data.refresh_token || '',
			expires_in: data.expires_in,
			token_type: data.token_type || 'Bearer'
		};
	}

	/**
	 * Decode JWT token to get expiration
	 */
	private decodeJwt(token: string): { exp?: number; [key: string]: unknown } {
		try {
			const parts = token.split('.');
			if (parts.length !== 3) {
				return {};
			}
			const payload = parts[1];
			const decoded = Buffer.from(payload, 'base64').toString('utf-8');
			return JSON.parse(decoded);
		} catch {
			return {};
		}
	}

	/**
	 * Check if token is expired
	 */
	private isTokenExpired(): boolean {
		if (!this.accessToken) {
			return true; // No token means expired
		}

		if (!this.expiresAt) {
			// Try to decode token to get expiration
			const decoded = this.decodeJwt(this.accessToken);
			if (decoded.exp) {
				this.expiresAt = new Date(decoded.exp * 1000);
			} else {
				// Assume expired if we can't determine
				return true;
			}
		}

		// Check if expired (with 60 second buffer)
		return this.expiresAt.getTime() < Date.now() + 60000;
	}

	/**
	 * Refresh access token using refresh token
	 * Uses HTTP Basic Auth as required by ANAF
	 */
	async refreshAccessToken(): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
		if (!this.clientId || !this.clientSecret) {
			throw new Error('Client ID and secret are required for token refresh');
		}

		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: this.refreshToken,
				token_content_type: 'jwt' // Required by ANAF
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`ANAF OAuth refresh error: ${response.status} ${errorText}`);
		}

		const tokenData: AnafTokenResponse = await response.json();

		this.accessToken = tokenData.access_token;
		this.refreshToken = tokenData.refresh_token;

		// Calculate expiration
		let expiresAt: Date;
		if (tokenData.expires_in) {
			expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000); // Subtract 60s for safety
		} else {
			// Try to decode token
			const decoded = this.decodeJwt(tokenData.access_token);
			if (decoded.exp) {
				expiresAt = new Date(decoded.exp * 1000);
			} else {
				// Default to 1 hour
				expiresAt = new Date(Date.now() + 3600 * 1000);
			}
		}

		this.expiresAt = expiresAt;

		return {
			accessToken: this.accessToken,
			refreshToken: this.refreshToken,
			expiresAt
		};
	}

	/**
	 * Get valid access token (refresh if needed)
	 */
	async getAccessToken(): Promise<string> {
		if (!this.accessToken) {
			throw new Error('Access token not available. Please complete OAuth flow first.');
		}

		if (this.isTokenExpired()) {
			await this.refreshAccessToken();
		}
		return this.accessToken;
	}

	/**
	 * Make authenticated API request with retry logic
	 */
	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
		retries = 3
	): Promise<T> {
		const token = await this.getAccessToken();
		const url = `${this.baseUrl}${endpoint}`;

		const headers = {
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
					// Token expired, try to refresh
					if (attempt < retries - 1) {
						await this.refreshAccessToken();
						continue;
					}
				}

				if (response.status === 404) {
					throw new Error('Not found');
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`ANAF SPV API error: ${response.status} ${errorText}`);
				}

				// Handle different content types
				const contentType = response.headers.get('content-type') || '';

				if (contentType.includes('application/json')) {
					const text = await response.text();
					if (!text) {
						return {} as T;
					}
					return JSON.parse(text) as T;
				}

				if (contentType.includes('application/zip') || contentType.includes('application/x-zip-compressed')) {
					return response.arrayBuffer() as unknown as T;
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
	 * Get list of invoices from SPV
	 * @param vatId - Company VAT ID (CUI without RO prefix)
	 * @param filter - "P" for suppliers (received), "T" for sent
	 * @param days - Number of days to look back (default: 60)
	 */
	async getInvoicesFromSpv(vatId: string, filter: 'P' | 'T' = 'P', days = 60): Promise<AnafSpvInvoiceMessage[]> {
		// Remove RO prefix if present
		const cui = vatId.replace(/^RO/i, '');

		const response = await this.request<AnafSpvInvoiceListResponse>(
			`/listaMesajeFactura?zile=${days}&cif=${cui}&filtru=${filter}`,
			{
				method: 'GET'
			}
		);

		// Check for errors
		if (response.eroare) {
			if (response.eroare.includes('Nu exista mesaje')) {
				return []; // No messages is not an error, just empty result
			}
			throw new Error(response.eroare);
		}

		return response.mesaje || [];
	}

	/**
	 * Download invoice XML from SPV
	 * Returns the XML content (extracted from ZIP)
	 * @param invoiceId - SPV invoice ID
	 */
	async getInvoiceFromSpv(invoiceId: string): Promise<{ xml: string; zipBuffer: ArrayBuffer }> {
		const zipBuffer = await this.request<ArrayBuffer>(`/descarcare?id=${invoiceId}`, {
			method: 'GET'
		});

		// Extract XML from ZIP
		// Note: We'll need to use a zip library for this
		// For now, we'll return the buffer and handle extraction in the caller
		// This requires jszip or similar library
		const { default: JSZip } = await import('jszip');
		const zip = await JSZip.loadAsync(zipBuffer);

		// Find XML file (not signature files)
		let xmlContent = '';
		for (const filename of Object.keys(zip.files)) {
			if (filename.endsWith('.xml') && !filename.startsWith('semnatura')) {
				const file = zip.files[filename];
				if (file) {
					xmlContent = await file.async('string');
					break;
				}
			}
		}

		if (!xmlContent) {
			throw new Error('No XML file found in ZIP');
		}

		return { xml: xmlContent, zipBuffer };
	}

	/**
	 * Upload invoice to SPV
	 * @param xmlData - UBL XML invoice data
	 * @param vatId - Company VAT ID (CUI)
	 * @param isExternal - Whether this is an external invoice
	 */
	async uploadInvoiceToSpv(
		xmlData: string,
		vatId: string,
		isExternal = false
	): Promise<AnafSpvUploadResponse> {
		// Remove RO prefix if present
		const cui = vatId.replace(/^RO/i, '');

		const params = new URLSearchParams({
			standard: 'UBL',
			cif: cui
		});

		if (isExternal) {
			params.append('extern', 'DA');
		}

		const response = await this.request<string>(`/upload?${params.toString()}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/xml; charset=utf-8'
			},
			body: xmlData
		});

		// Parse XML response
		const parser = new DOMParser();
		const doc = parser.parseFromString(response, 'application/xml');
		const indexElement = doc.documentElement;

		if (!indexElement || !indexElement.getAttribute('index_incarcare')) {
			throw new Error('Invalid response from SPV upload');
		}

		return {
			index_incarcare: indexElement.getAttribute('index_incarcare') || ''
		};
	}

	/**
	 * Get company data from ANAF
	 * @param cui - Company CUI (without RO prefix)
	 */
	async getCompanyFromAnaf(cui: string): Promise<AnafCompanyData | null> {
		// Remove RO prefix if present
		const cleanCui = cui.replace(/^RO/i, '');

		const date = new Date();
		const currentDate = date.toISOString().split('T')[0];

		const payload = [{ cui: cleanCui, data: currentDate }];

		const response = await fetch(ANAF_COMPANY_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			throw new Error(`ANAF company API error: ${response.status}`);
		}

		const data = await response.json();

		if (!data.found || data.found.length === 0) {
			return null;
		}

		const foundData = data.found[0];
		const dateGenerale = foundData.date_generale || {};
		const adresaSediu = foundData.adresa_sediu_social || {};
		const inregistrareTva = foundData.inregistrare_scop_Tva || {};
		const stareInactiv = foundData.stare_inactiv || {};

		return {
			name: dateGenerale.denumire || '',
			address: dateGenerale.adresa || '',
			country: 'România',
			vat_id: dateGenerale.cui || '',
			reg_no: dateGenerale.nrRegCom || '',
			phone: dateGenerale.telefon || undefined,
			status: !stareInactiv.statusInactivi,
			tax_id: inregistrareTva.scpTVA ? `RO${dateGenerale.cui}` : '',
			county: adresaSediu.sdenumire_Judet || '',
			city: adresaSediu.sdenumire_Localitate || '',
			street: adresaSediu.sdenumire_Strada || '',
			street_number: adresaSediu.snumar_Strada || '',
			postal_code: adresaSediu.scod_Postal || ''
		};
	}
}
