import { describe, test, expect, mock } from 'bun:test';

// invoice-scraper.ts transitively imports db/crypto/logger via the cookie-save
// helpers — mock everything stateful before importing the SUT. We only test the
// pure normalizeCookiesForInjection function here.
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('$lib/server/meta-ads/fb-cookies', () => ({
	saveFbSessionCookies: async () => {},
	getDecryptedFbCookies: async () => null
}));
mock.module('$lib/server/google-ads/google-cookies', () => ({
	saveGoogleSessionCookies: async () => {},
	getDecryptedGoogleCookies: async () => null
}));
mock.module('$lib/server/tiktok-ads/tt-cookies', () => ({
	saveTtSessionCookies: async () => {},
	getDecryptedTtCookies: async () => null
}));

const { normalizeCookiesForInjection } = await import('../invoice-scraper');

const base = { value: 'v', domain: '.facebook.com' };

describe('normalizeCookiesForInjection', () => {
	test('maps Cookie-Editor sameSite values to puppeteer format', () => {
		const out = normalizeCookiesForInjection(
			[
				{ ...base, name: 'a', sameSite: 'no_restriction' },
				{ ...base, name: 'b', sameSite: 'lax' },
				{ ...base, name: 'c', sameSite: 'strict' },
				{ ...base, name: 'd', sameSite: 'unspecified' }
			],
			'meta'
		);
		expect(out.find((c) => c.name === 'a')?.sameSite).toBe('None');
		expect(out.find((c) => c.name === 'b')?.sameSite).toBe('Lax');
		expect(out.find((c) => c.name === 'c')?.sameSite).toBe('Strict');
		expect(out.find((c) => c.name === 'd')?.sameSite).toBeUndefined();
	});

	test('passes through puppeteer-format sameSite values', () => {
		const out = normalizeCookiesForInjection(
			[
				{ ...base, name: 'a', sameSite: 'None' },
				{ ...base, name: 'b', sameSite: 'Lax' }
			],
			'meta'
		);
		expect(out.find((c) => c.name === 'a')?.sameSite).toBe('None');
		expect(out.find((c) => c.name === 'b')?.sameSite).toBe('Lax');
	});

	test('falls back to Cookie-Editor expirationDate when expires is missing', () => {
		const out = normalizeCookiesForInjection(
			[{ ...base, name: 'xs', expirationDate: 1790000000 }],
			'meta'
		);
		expect(out[0].expires).toBe(1790000000);
	});

	test('prefers expires over expirationDate', () => {
		const out = normalizeCookiesForInjection(
			[{ ...base, name: 'xs', expires: 1780000000, expirationDate: 1790000000 }],
			'meta'
		);
		expect(out[0].expires).toBe(1780000000);
	});

	test('treats missing/-1 expires as session cookies (no expires set)', () => {
		const out = normalizeCookiesForInjection(
			[
				{ ...base, name: 'a' },
				{ ...base, name: 'b', expires: -1 }
			],
			'meta'
		);
		expect(out).toHaveLength(2);
		expect(out[0].expires).toBeUndefined();
		expect(out[1].expires).toBeUndefined();
	});

	test('filters out junk: empty name/value and out-of-scope domains', () => {
		const out = normalizeCookiesForInjection(
			[
				{ name: '', value: 'v', domain: '.facebook.com' },
				{ name: 'a', value: '', domain: '.facebook.com' },
				{ name: 'gcookie', value: 'v', domain: '.google.com' },
				{ name: 'ok', value: 'v', domain: '.facebook.com' }
			],
			'meta'
		);
		expect(out.map((c) => c.name)).toEqual(['ok']);
	});

	test('accepts both .facebook.com and business.facebook.com domains', () => {
		const out = normalizeCookiesForInjection(
			[
				{ name: 'c_user', value: '123', domain: '.facebook.com' },
				{ name: 'wd', value: 'x', domain: 'business.facebook.com' }
			],
			'meta'
		);
		expect(out).toHaveLength(2);
	});

	test('defaults path to / and preserves boolean flags', () => {
		const out = normalizeCookiesForInjection(
			[{ ...base, name: 'xs', httpOnly: true, secure: true }],
			'meta'
		);
		expect(out[0].path).toBe('/');
		expect(out[0].httpOnly).toBe(true);
		expect(out[0].secure).toBe(true);
	});
});
