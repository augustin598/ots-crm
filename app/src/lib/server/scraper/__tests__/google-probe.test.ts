import { describe, test, expect } from 'bun:test';
import { classifyGoogleProbe, GOOGLE_SESSION_PROBE_URL } from '../google-probe';

/**
 * The old probe hit payments.google.com/payments/u/0/w/home, which answers 200
 * even for a logged-out request, so a dead session was reported as "active"
 * forever. The billing documents page on ads.google.com redirects logged-out
 * requests to accounts.google.com/ServiceLogin, which is the signal we want.
 */
describe('classifyGoogleProbe', () => {
	test('probe URL is the ads.google.com billing page, not the always-200 payments home', () => {
		expect(GOOGLE_SESSION_PROBE_URL).toBe('https://ads.google.com/aw/billing/documents');
	});

	test('302 to accounts.google.com ServiceLogin → expired', () => {
		expect(
			classifyGoogleProbe(
				302,
				'https://accounts.google.com/ServiceLogin?service=adwords&passive=1209600&continue=https://ads.google.com/nav/login'
			)
		).toBe('expired');
	});

	test('302 to accounts.google.com/v3/signin → expired', () => {
		expect(classifyGoogleProbe(302, 'https://accounts.google.com/v3/signin/identifier?x=1')).toBe('expired');
	});

	test('302 that stays on ads.google.com (ocid/authuser added) → alive', () => {
		expect(classifyGoogleProbe(302, 'https://ads.google.com/aw/billing/documents?ocid=123&authuser=0')).toBe('alive');
		expect(classifyGoogleProbe(302, '/aw/overview?ocid=123')).toBe('error');
	});

	test('200 → alive', () => {
		expect(classifyGoogleProbe(200, null)).toBe('alive');
	});

	test('401/403 → expired', () => {
		expect(classifyGoogleProbe(401, null)).toBe('expired');
		expect(classifyGoogleProbe(403, null)).toBe('expired');
	});

	test('5xx, 429 and a redirect without location → error (never false-expire)', () => {
		expect(classifyGoogleProbe(503, null)).toBe('error');
		expect(classifyGoogleProbe(429, null)).toBe('error');
		expect(classifyGoogleProbe(302, null)).toBe('error');
	});
});
