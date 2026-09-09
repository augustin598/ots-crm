/**
 * Google session probe verdict.
 *
 * `payments.google.com/payments/u/0/w/home` answers 200 even for a logged-out
 * request, so probing it always reported the stored cookies as "active".
 * `ads.google.com/aw/billing/documents` redirects logged-out requests to
 * accounts.google.com/ServiceLogin (often via ads.google.com/nav/login first),
 * which is the signal we actually want.
 */
export const GOOGLE_SESSION_PROBE_URL = 'https://ads.google.com/aw/billing/documents';

export type GoogleProbeVerdict = 'alive' | 'expired' | 'error';

// Checked FIRST: any hop towards a login screen means the cookies are dead.
const LOGIN_REDIRECT = /accounts\.google\.com|ServiceLogin|\/signin|\/nav\/login|\/login\b/i;
// Logged-in redirects stay inside the Ads UI (ocid/authuser added) or land on
// the account picker when the user has several top-level accounts.
const STAYS_LOGGED_IN = /^https?:\/\/ads\.google\.com\/(aw\/|nav\/selectaccount)/i;

export function classifyGoogleProbe(status: number, location: string | null | undefined): GoogleProbeVerdict {
	if (status >= 300 && status < 400) {
		const loc = location || '';
		if (LOGIN_REDIRECT.test(loc)) return 'expired';
		if (STAYS_LOGGED_IN.test(loc)) return 'alive';
		return 'error';
	}
	if (status === 200) return 'alive';
	if (status === 401 || status === 403) return 'expired';
	return 'error';
}
