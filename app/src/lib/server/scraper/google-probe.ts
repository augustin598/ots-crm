/**
 * Google session probe verdict.
 *
 * `payments.google.com/payments/u/0/w/home` answers 200 even for a logged-out
 * request, so probing it always reported the stored cookies as "active".
 * `ads.google.com/aw/billing/documents` redirects logged-out requests to
 * accounts.google.com/ServiceLogin, which is the signal we actually want.
 */
export const GOOGLE_SESSION_PROBE_URL = 'https://ads.google.com/aw/billing/documents';

export type GoogleProbeVerdict = 'alive' | 'expired' | 'error';

const LOGIN_REDIRECT = /accounts\.google\.com|ServiceLogin|\/signin/i;
const STAYS_ON_ADS = /^https?:\/\/ads\.google\.com/i;

export function classifyGoogleProbe(status: number, location: string | null | undefined): GoogleProbeVerdict {
	if (status >= 300 && status < 400) {
		const loc = location || '';
		if (LOGIN_REDIRECT.test(loc)) return 'expired';
		if (STAYS_ON_ADS.test(loc)) return 'alive';
		return 'error';
	}
	if (status === 200) return 'alive';
	if (status === 401 || status === 403) return 'expired';
	return 'error';
}
