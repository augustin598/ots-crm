/**
 * The google-ads-api library throws plain objects (GoogleAdsFailure), not
 * Error instances. `err.message` is undefined and `String(err)` gives
 * "[object Object]", which is exactly what ended up in debug_log for months.
 */

interface GoogleAdsFailureLike {
	errors?: Array<{ error_code?: Record<string, unknown>; message?: string }>;
	message?: string;
}

function extractCodes(err: GoogleAdsFailureLike): string[] {
	const codes: string[] = [];
	for (const e of err.errors || []) {
		for (const [type, code] of Object.entries(e.error_code || {})) {
			codes.push(`${type}:${String(code)}`);
		}
	}
	return codes;
}

export function describeGoogleAdsError(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === 'object') {
		const failure = err as GoogleAdsFailureLike;
		if (Array.isArray(failure.errors) && failure.errors.length > 0) {
			const parts = failure.errors.map((e) => {
				const codes = Object.values(e.error_code || {}).map(String).join(',');
				return [codes, e.message].filter(Boolean).join(' ');
			});
			return parts.join('; ').slice(0, 500);
		}
		if (typeof failure.message === 'string' && failure.message) return failure.message.slice(0, 500);
		try {
			return JSON.stringify(err).slice(0, 500);
		} catch {
			return '[unserializable error]';
		}
	}
	return String(err).slice(0, 500);
}

export type ListInvoicesErrorKind = 'not_monthly_invoicing' | 'account_inaccessible' | 'other';

const NOT_MONTHLY = /BILLING_SETUP_NOT_ON_MONTHLY_INVOICING|INVALID_VALUE|billingSetups/i;
const INACCESSIBLE = /CUSTOMER_NOT_FOUND|CUSTOMER_NOT_ENABLED|CUSTOMER_NOT_ACTIVE|NOT_ADS_USER|USER_PERMISSION_DENIED|CUSTOMER_NOT_IN_MANAGER|ACCOUNT_DISABLED/i;

export function classifyListInvoicesError(err: unknown): { kind: ListInvoicesErrorKind; message: string } {
	const message = describeGoogleAdsError(err);
	const haystack = [message, ...(err && typeof err === 'object' ? extractCodes(err as GoogleAdsFailureLike) : [])].join(' ');
	if (NOT_MONTHLY.test(haystack)) return { kind: 'not_monthly_invoicing', message };
	if (INACCESSIBLE.test(haystack)) return { kind: 'account_inaccessible', message };
	return { kind: 'other', message };
}
