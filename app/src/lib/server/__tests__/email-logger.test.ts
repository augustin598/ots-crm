import { describe, test, expect, mock } from 'bun:test';

// Mock SvelteKit virtual modules BEFORE importing email-logger (which transitively
// imports $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const { EMAIL_TYPES, isEmailType } = await import('../email-logger');

describe('EMAIL_TYPES', () => {
	test('includes all 8 new hosting + checkout types', () => {
		expect(EMAIL_TYPES).toContain('hosting-account-created');
		expect(EMAIL_TYPES).toContain('hosting-suspended');
		expect(EMAIL_TYPES).toContain('hosting-reactivated');
		expect(EMAIL_TYPES).toContain('hosting-renewal-reminder');
		expect(EMAIL_TYPES).toContain('hosting-payment-failed');
		expect(EMAIL_TYPES).toContain('hosting-provisioning-failed');
		expect(EMAIL_TYPES).toContain('payment-succeeded');
		expect(EMAIL_TYPES).toContain('admin-payment-received');
	});

	test('preserves all pre-existing types', () => {
		// sample a few to verify nothing was accidentally removed
		expect(EMAIL_TYPES).toContain('invitation');
		expect(EMAIL_TYPES).toContain('invoice');
		expect(EMAIL_TYPES).toContain('magic-link');
		expect(EMAIL_TYPES).toContain('admin-magic-link');
		expect(EMAIL_TYPES).toContain('ad_payment_alert'); // underscore preserved
		expect(EMAIL_TYPES).toContain('notification_alert'); // underscore preserved
	});

	test('has exactly 26 types (18 existing + 8 new)', () => {
		expect(EMAIL_TYPES.length).toBe(26);
	});
});

describe('isEmailType', () => {
	test('returns true for known types', () => {
		expect(isEmailType('hosting-account-created')).toBe(true);
		expect(isEmailType('magic-link')).toBe(true);
		expect(isEmailType('ad_payment_alert')).toBe(true);
	});

	test('returns false for unknown values', () => {
		expect(isEmailType('not-a-real-type')).toBe(false);
		expect(isEmailType('')).toBe(false);
		expect(isEmailType('HOSTING-ACCOUNT-CREATED')).toBe(false); // case sensitive
	});
});
