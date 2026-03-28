import { clientLogger } from '$lib/client-logger';

export type AdPlatform = 'meta' | 'google' | 'tiktok';

interface ApiErrorMapping {
	errorCode: string;
	details: Record<string, unknown>;
}

// =================== META ADS ===================

function mapMetaError(httpStatus: number, body: unknown): ApiErrorMapping {
	const metaError = (body as Record<string, unknown>)?.error as Record<string, unknown> | undefined;
	const code = metaError?.code as number | undefined;
	const subcode = metaError?.error_subcode as number | undefined;

	const mapping: Record<string, string> = {
		'429': 'META_API_RATE_LIMIT',
		'200-4': 'META_API_RATE_LIMIT',
		'200-32': 'META_API_RATE_LIMIT',
		'200-17': 'META_API_RATE_LIMIT',
		'401': 'META_API_TOKEN_EXPIRED',
		'200-190': 'META_API_TOKEN_EXPIRED',
		'200-190-463': 'META_API_TOKEN_EXPIRED',
		'200-190-467': 'META_API_TOKEN_EXPIRED',
		'403': 'META_API_PERMISSION_DENIED',
		'200-10': 'META_API_PERMISSION_DENIED',
		'200-200': 'META_API_PERMISSION_DENIED',
		'200-294': 'META_API_PERMISSION_DENIED',
		'200-100-1487390': 'META_API_ACCOUNT_DISABLED',
		'200-2635': 'META_API_ACCOUNT_DISABLED',
		'200-1': 'META_API_INVALID_RESPONSE',
		'200-2': 'META_API_INVALID_RESPONSE',
		'500': 'NETWORK_SERVER_ERROR',
		'502': 'NETWORK_SERVER_ERROR',
		'503': 'NETWORK_SERVER_ERROR'
	};

	const keys = [
		`${httpStatus}-${code}-${subcode}`,
		`${httpStatus}-${code}`,
		`${httpStatus}`
	];

	let errorCode = 'META_API_FETCH_FAILED';
	for (const key of keys) {
		if (mapping[key]) {
			errorCode = mapping[key];
			break;
		}
	}

	return {
		errorCode,
		details: {
			httpStatus,
			metaErrorCode: code,
			metaSubcode: subcode,
			metaMessage: metaError?.message,
			metaType: metaError?.type,
			fbtrace_id: metaError?.fbtrace_id
		}
	};
}

// =================== GOOGLE ADS ===================

function mapGoogleError(httpStatus: number, body: unknown): ApiErrorMapping {
	const gError = (body as Record<string, unknown>)?.error as Record<string, unknown> | undefined;
	const grpcStatus = gError?.status as string | undefined;
	const errorDetails = (gError?.details || []) as Array<Record<string, unknown>>;

	const adsErrors = errorDetails
		.flatMap((d) => (d?.errors || []) as Array<Record<string, unknown>>)
		.map((e) => {
			const errorCode = (e?.errorCode || {}) as Record<string, string>;
			const type = Object.keys(errorCode)[0];
			return { type, value: errorCode[type], message: e?.message as string };
		});

	const firstAdsError = adsErrors[0];

	const statusMapping: Record<string, string> = {
		RESOURCE_EXHAUSTED: 'GOOGLE_API_RATE_LIMIT',
		UNAUTHENTICATED: 'GOOGLE_API_TOKEN_EXPIRED',
		PERMISSION_DENIED: 'GOOGLE_API_PERMISSION_DENIED',
		INTERNAL: 'NETWORK_SERVER_ERROR',
		UNAVAILABLE: 'NETWORK_SERVER_ERROR',
		DEADLINE_EXCEEDED: 'NETWORK_TIMEOUT'
	};

	const adsErrorMapping: Record<string, string> = {
		OAUTH_TOKEN_EXPIRED: 'GOOGLE_API_TOKEN_EXPIRED',
		OAUTH_TOKEN_REVOKED: 'GOOGLE_API_TOKEN_EXPIRED',
		OAUTH_TOKEN_INVALID: 'GOOGLE_API_TOKEN_EXPIRED',
		NOT_ADS_USER: 'GOOGLE_API_PERMISSION_DENIED',
		CUSTOMER_NOT_FOUND: 'GOOGLE_API_PERMISSION_DENIED',
		USER_PERMISSION_DENIED: 'GOOGLE_API_PERMISSION_DENIED',
		CUSTOMER_NOT_ENABLED: 'GOOGLE_API_ACCOUNT_DISABLED',
		CUSTOMER_NOT_ACTIVE: 'GOOGLE_API_ACCOUNT_DISABLED'
	};

	let errorCode = 'GOOGLE_API_FETCH_FAILED';

	if (firstAdsError?.value && adsErrorMapping[firstAdsError.value]) {
		errorCode = adsErrorMapping[firstAdsError.value];
	} else if (grpcStatus && statusMapping[grpcStatus]) {
		errorCode = statusMapping[grpcStatus];
	} else if (httpStatus === 429) {
		errorCode = 'GOOGLE_API_RATE_LIMIT';
	} else if (httpStatus === 401) {
		errorCode = 'GOOGLE_API_TOKEN_EXPIRED';
	} else if (httpStatus === 403) {
		errorCode = 'GOOGLE_API_PERMISSION_DENIED';
	} else if (httpStatus >= 500) {
		errorCode = 'NETWORK_SERVER_ERROR';
	}

	return {
		errorCode,
		details: {
			httpStatus,
			grpcStatus,
			grpcMessage: gError?.message,
			adsErrors: adsErrors.map((e) => ({ type: e.type, value: e.value, message: e.message }))
		}
	};
}

// =================== TIKTOK ADS ===================

function mapTikTokError(httpStatus: number, body: unknown): ApiErrorMapping {
	const ttResponse = body as Record<string, unknown>;
	const ttCode = ttResponse?.code as number | undefined;
	const ttMessage = ((ttResponse?.message as string) || '').toLowerCase();
	const requestId = ttResponse?.request_id as string | undefined;

	const codeMapping: Record<number, string> = {
		40001: 'TIKTOK_API_TOKEN_EXPIRED',
		40100: 'TIKTOK_API_TOKEN_EXPIRED',
		40101: 'TIKTOK_API_TOKEN_EXPIRED',
		40102: 'TIKTOK_API_TOKEN_EXPIRED',
		40103: 'TIKTOK_API_TOKEN_EXPIRED',
		40003: 'TIKTOK_API_PERMISSION_DENIED',
		40004: 'TIKTOK_API_PERMISSION_DENIED',
		40105: 'TIKTOK_API_PERMISSION_DENIED',
		40200: 'TIKTOK_API_RATE_LIMIT',
		40301: 'TIKTOK_API_ACCOUNT_DISABLED',
		40302: 'TIKTOK_API_ACCOUNT_DISABLED',
		50000: 'NETWORK_SERVER_ERROR',
		50001: 'NETWORK_SERVER_ERROR',
		50002: 'NETWORK_SERVER_ERROR'
	};

	let errorCode = 'TIKTOK_API_FETCH_FAILED';

	if (ttCode !== undefined && codeMapping[ttCode]) {
		errorCode = codeMapping[ttCode];

		// Disambiguate 40002: rate limit vs parameter error
		if (ttCode === 40002) {
			if (ttMessage.includes('throttl') || ttMessage.includes('rate') || ttMessage.includes('frequency')) {
				errorCode = 'TIKTOK_API_RATE_LIMIT';
			} else {
				errorCode = 'TIKTOK_API_FETCH_FAILED';
			}
		}
	} else if (httpStatus === 429) {
		errorCode = 'TIKTOK_API_RATE_LIMIT';
	} else if (httpStatus === 401) {
		errorCode = 'TIKTOK_API_TOKEN_EXPIRED';
	} else if (httpStatus === 403) {
		errorCode = 'TIKTOK_API_PERMISSION_DENIED';
	} else if (httpStatus >= 500) {
		errorCode = 'NETWORK_SERVER_ERROR';
	}

	return {
		errorCode,
		details: {
			httpStatus,
			tiktokCode: ttCode,
			tiktokMessage: ttResponse?.message,
			tiktokRequestId: requestId
		}
	};
}

// =================== MAIN MAPPER ===================

function mapPlatformError(
	platform: AdPlatform,
	httpStatus: number,
	errorBody: unknown
): ApiErrorMapping {
	switch (platform) {
		case 'meta':
			return mapMetaError(httpStatus, errorBody);
		case 'google':
			return mapGoogleError(httpStatus, errorBody);
		case 'tiktok':
			return mapTikTokError(httpStatus, errorBody);
	}
}

export async function handleApiError(
	platform: AdPlatform,
	response: Response,
	errorBody: unknown,
	action: string
): Promise<void> {
	const mapping = mapPlatformError(platform, response.status, errorBody);
	clientLogger.apiError(action, errorBody, mapping.errorCode);
}
