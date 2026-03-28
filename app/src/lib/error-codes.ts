export interface ErrorDefinition {
	code: string;
	severity: 'error' | 'warning' | 'info';
	userMessage: string; // Romanian, for toast
	internalMessage: string; // English, for DB
	suggestedFix?: string; // English, for admin/logs
	retryable: boolean;
}

export const ERROR_CODES = {
	// ===================== VALIDATION =====================

	VALIDATION_DATE_RANGE_INVALID: {
		code: 'VALIDATION_DATE_RANGE_INVALID',
		severity: 'warning',
		userMessage: 'Data de inceput nu poate fi dupa data de sfarsit.',
		internalMessage: 'Date range validation failed: start > end',
		retryable: false
	},
	VALIDATION_DATE_RANGE_TOO_LONG: {
		code: 'VALIDATION_DATE_RANGE_TOO_LONG',
		severity: 'warning',
		userMessage: 'Intervalul maxim permis este de 90 de zile.',
		internalMessage: 'Date range exceeds 90 days limit',
		retryable: false
	},
	VALIDATION_DATE_FUTURE: {
		code: 'VALIDATION_DATE_FUTURE',
		severity: 'warning',
		userMessage: 'Nu poti selecta o data din viitor.',
		internalMessage: 'Future date selected',
		retryable: false
	},
	VALIDATION_DATE_INVALID: {
		code: 'VALIDATION_DATE_INVALID',
		severity: 'warning',
		userMessage: 'Data introdusa nu este valida.',
		internalMessage: 'Invalid date value provided',
		retryable: false
	},
	VALIDATION_NO_ACCOUNT_SELECTED: {
		code: 'VALIDATION_NO_ACCOUNT_SELECTED',
		severity: 'warning',
		userMessage: 'Selecteaza cel putin un cont.',
		internalMessage: 'No ad account selected for operation',
		retryable: false
	},
	VALIDATION_TOO_MANY_ACCOUNTS: {
		code: 'VALIDATION_TOO_MANY_ACCOUNTS',
		severity: 'warning',
		userMessage: 'Poti selecta maxim 50 de conturi odata.',
		internalMessage: 'Too many accounts selected (max 50)',
		retryable: false
	},
	VALIDATION_NO_DATA_TO_EXPORT: {
		code: 'VALIDATION_NO_DATA_TO_EXPORT',
		severity: 'warning',
		userMessage: 'Nu exista date de exportat. Aplica filtrele si incearca din nou.',
		internalMessage: 'Export attempted with empty dataset',
		retryable: false
	},
	VALIDATION_FILTER_EMPTY: {
		code: 'VALIDATION_FILTER_EMPTY',
		severity: 'warning',
		userMessage: 'Selecteaza cel putin o optiune din filtru.',
		internalMessage: 'Filter applied with no options selected',
		retryable: false
	},
	VALIDATION_SEARCH_TOO_SHORT: {
		code: 'VALIDATION_SEARCH_TOO_SHORT',
		severity: 'info',
		userMessage: 'Introdu cel putin 2 caractere pentru cautare.',
		internalMessage: 'Search query too short (min 2 chars)',
		retryable: false
	},
	VALIDATION_REQUIRED_FIELD: {
		code: 'VALIDATION_REQUIRED_FIELD',
		severity: 'warning',
		userMessage: 'Acest camp este obligatoriu.',
		internalMessage: 'Required field is empty',
		retryable: false
	},
	VALIDATION_INVALID_EMAIL: {
		code: 'VALIDATION_INVALID_EMAIL',
		severity: 'warning',
		userMessage: 'Adresa de email nu este valida.',
		internalMessage: 'Invalid email format',
		retryable: false
	},

	// ===================== META API =====================

	META_API_RATE_LIMIT: {
		code: 'META_API_RATE_LIMIT',
		severity: 'error',
		userMessage: 'Limita de request-uri Meta a fost atinsa. Incearca din nou in cateva minute.',
		internalMessage: 'Meta API returned 429 - rate limit exceeded',
		suggestedFix: 'Wait for rate limit reset or reduce request frequency',
		retryable: true
	},
	META_API_TOKEN_EXPIRED: {
		code: 'META_API_TOKEN_EXPIRED',
		severity: 'error',
		userMessage: 'Sesiunea Meta a expirat. Contacteaza administratorul.',
		internalMessage: 'Meta API token expired or invalid (401/190)',
		suggestedFix: 'Regenerate Meta API access token in Business Manager',
		retryable: false
	},
	META_API_PERMISSION_DENIED: {
		code: 'META_API_PERMISSION_DENIED',
		severity: 'error',
		userMessage: 'Nu ai permisiuni pentru acest cont Meta.',
		internalMessage: 'Meta API permission denied (403/10)',
		suggestedFix: 'Check ad account permissions in Business Manager',
		retryable: false
	},
	META_API_ACCOUNT_DISABLED: {
		code: 'META_API_ACCOUNT_DISABLED',
		severity: 'error',
		userMessage: 'Contul Meta Ads este dezactivat sau restrictionat.',
		internalMessage: 'Meta ad account is disabled or restricted',
		suggestedFix: 'Check account status in Business Manager, may need appeal',
		retryable: false
	},
	META_API_FETCH_FAILED: {
		code: 'META_API_FETCH_FAILED',
		severity: 'error',
		userMessage: 'Nu s-au putut incarca datele din Meta. Incearca din nou.',
		internalMessage: 'Meta API fetch failed',
		retryable: true
	},
	META_API_INVALID_RESPONSE: {
		code: 'META_API_INVALID_RESPONSE',
		severity: 'error',
		userMessage: 'Raspuns neasteptat de la Meta. Incearca din nou.',
		internalMessage: 'Meta API returned unexpected response structure',
		suggestedFix: 'Check if Meta API version is up to date',
		retryable: true
	},

	// ===================== GOOGLE API =====================

	GOOGLE_API_RATE_LIMIT: {
		code: 'GOOGLE_API_RATE_LIMIT',
		severity: 'error',
		userMessage: 'Limita de request-uri Google a fost atinsa. Incearca din nou in cateva minute.',
		internalMessage: 'Google Ads API rate limit exceeded',
		suggestedFix: 'Wait for rate limit reset',
		retryable: true
	},
	GOOGLE_API_TOKEN_EXPIRED: {
		code: 'GOOGLE_API_TOKEN_EXPIRED',
		severity: 'error',
		userMessage: 'Sesiunea Google a expirat. Contacteaza administratorul.',
		internalMessage: 'Google Ads API OAuth token expired',
		suggestedFix: 'Refresh OAuth token or re-authenticate',
		retryable: false
	},
	GOOGLE_API_PERMISSION_DENIED: {
		code: 'GOOGLE_API_PERMISSION_DENIED',
		severity: 'error',
		userMessage: 'Nu ai permisiuni pentru acest cont Google Ads.',
		internalMessage: 'Google Ads API permission denied',
		suggestedFix: 'Check MCC account access permissions',
		retryable: false
	},
	GOOGLE_API_FETCH_FAILED: {
		code: 'GOOGLE_API_FETCH_FAILED',
		severity: 'error',
		userMessage: 'Nu s-au putut incarca datele din Google Ads. Incearca din nou.',
		internalMessage: 'Google Ads API fetch failed',
		retryable: true
	},
	GOOGLE_API_ACCOUNT_DISABLED: {
		code: 'GOOGLE_API_ACCOUNT_DISABLED',
		severity: 'error',
		userMessage: 'Contul Google Ads este dezactivat sau suspendat.',
		internalMessage: 'Google Ads customer account is disabled or not active',
		suggestedFix: 'Check account status in Google Ads MCC',
		retryable: false
	},

	// ===================== TIKTOK API =====================

	TIKTOK_API_RATE_LIMIT: {
		code: 'TIKTOK_API_RATE_LIMIT',
		severity: 'error',
		userMessage: 'Limita de request-uri TikTok a fost atinsa. Incearca din nou in cateva minute.',
		internalMessage: 'TikTok API rate limit exceeded',
		retryable: true
	},
	TIKTOK_API_TOKEN_EXPIRED: {
		code: 'TIKTOK_API_TOKEN_EXPIRED',
		severity: 'error',
		userMessage: 'Sesiunea TikTok a expirat. Contacteaza administratorul.',
		internalMessage: 'TikTok API access token expired',
		suggestedFix: 'Refresh TikTok API token via OAuth flow',
		retryable: false
	},
	TIKTOK_API_FETCH_FAILED: {
		code: 'TIKTOK_API_FETCH_FAILED',
		severity: 'error',
		userMessage: 'Nu s-au putut incarca datele din TikTok. Incearca din nou.',
		internalMessage: 'TikTok API fetch failed',
		retryable: true
	},
	TIKTOK_API_PERMISSION_DENIED: {
		code: 'TIKTOK_API_PERMISSION_DENIED',
		severity: 'error',
		userMessage: 'Nu ai permisiuni pentru acest cont TikTok Ads.',
		internalMessage: 'TikTok API permission denied or insufficient scope',
		suggestedFix: 'Check app permissions and advertiser authorization in TikTok',
		retryable: false
	},
	TIKTOK_API_ACCOUNT_DISABLED: {
		code: 'TIKTOK_API_ACCOUNT_DISABLED',
		severity: 'error',
		userMessage: 'Contul TikTok Ads este dezactivat sau nu a fost gasit.',
		internalMessage: 'TikTok advertiser account abnormal or not found',
		suggestedFix: 'Check advertiser account status in TikTok Ads Manager',
		retryable: false
	},

	// ===================== NETWORK =====================

	NETWORK_TIMEOUT: {
		code: 'NETWORK_TIMEOUT',
		severity: 'error',
		userMessage: 'Conexiunea a expirat. Verifica internetul si incearca din nou.',
		internalMessage: 'Network request timed out',
		suggestedFix: 'Check server health and network connectivity',
		retryable: true
	},
	NETWORK_OFFLINE: {
		code: 'NETWORK_OFFLINE',
		severity: 'error',
		userMessage: 'Nu esti conectat la internet.',
		internalMessage: 'Client is offline (navigator.onLine = false)',
		retryable: false
	},
	NETWORK_SERVER_ERROR: {
		code: 'NETWORK_SERVER_ERROR',
		severity: 'error',
		userMessage: 'A aparut o eroare pe server. Incearca din nou.',
		internalMessage: 'Server returned 5xx error',
		retryable: true
	},
	NETWORK_FETCH_FAILED: {
		code: 'NETWORK_FETCH_FAILED',
		severity: 'error',
		userMessage: 'Nu s-a putut realiza conexiunea. Verifica internetul.',
		internalMessage: 'Fetch failed (TypeError: Failed to fetch)',
		retryable: true
	},

	// ===================== AUTH =====================

	AUTH_SESSION_EXPIRED: {
		code: 'AUTH_SESSION_EXPIRED',
		severity: 'warning',
		userMessage: 'Sesiunea ta a expirat. Te rugam sa te autentifici din nou.',
		internalMessage: 'User session expired',
		retryable: false
	},
	AUTH_UNAUTHORIZED: {
		code: 'AUTH_UNAUTHORIZED',
		severity: 'error',
		userMessage: 'Nu ai permisiuni pentru aceasta actiune.',
		internalMessage: 'Unauthorized access attempt',
		retryable: false
	},

	// ===================== EXPORT =====================

	EXPORT_GENERATION_FAILED: {
		code: 'EXPORT_GENERATION_FAILED',
		severity: 'error',
		userMessage: 'Nu s-a putut genera raportul. Incearca din nou.',
		internalMessage: 'Report generation failed',
		retryable: true
	},
	EXPORT_TIMEOUT: {
		code: 'EXPORT_TIMEOUT',
		severity: 'warning',
		userMessage: 'Generarea raportului dureaza mai mult decat de obicei. Te rugam sa astepti.',
		internalMessage: 'Report generation exceeded timeout',
		retryable: true
	},

	// ===================== DATABASE =====================

	DB_QUERY_FAILED: {
		code: 'DB_QUERY_FAILED',
		severity: 'error',
		userMessage: 'Eroare de server. Incearca din nou.',
		internalMessage: 'Database query failed',
		suggestedFix: 'Check database connection and query syntax',
		retryable: true
	},
	DB_CONNECTION_FAILED: {
		code: 'DB_CONNECTION_FAILED',
		severity: 'error',
		userMessage: 'Eroare de server. Incearca din nou mai tarziu.',
		internalMessage: 'Database connection failed',
		suggestedFix: 'Check database service status and connection string',
		retryable: true
	},

	// ===================== SYSTEM =====================

	SYSTEM_UNEXPECTED: {
		code: 'SYSTEM_UNEXPECTED',
		severity: 'error',
		userMessage: 'A aparut o eroare neasteptata. Incearca din nou sau contacteaza administratorul.',
		internalMessage: 'Unexpected system error',
		retryable: false
	}
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function getErrorByCode(code: string): ErrorDefinition | undefined {
	return (ERROR_CODES as Record<string, ErrorDefinition>)[code];
}

export function getUserMessage(code: string): string {
	return getErrorByCode(code)?.userMessage ?? 'A aparut o eroare. Incearca din nou.';
}

export function isRetryable(code: string): boolean {
	return getErrorByCode(code)?.retryable ?? false;
}
