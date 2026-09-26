import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// googleapis e greu și cere rețea; ne interesează doar ce state-ul primește.
const captured: { opts: Record<string, unknown> | null } = { opts: null };
const lastState = () => String(captured.opts?.state);
mock.module('googleapis', () => ({
	google: {
		auth: {
			OAuth2: class {
				generateAuthUrl(opts: Record<string, unknown>) {
					captured.opts = opts;
					return `https://accounts.google.com/o/oauth2/auth?state=${opts.state}`;
				}
				setCredentials() {}
				async getToken() {
					return { tokens: {} };
				}
			}
		},
		oauth2: () => ({ userinfo: { get: async () => ({ data: {} }) } })
	}
}));

const { encodeState, decodeState, safePortalReturnTo, generateGoogleLoginUrl, parseState } =
	await import('../google-client-auth');

const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('encodeState / decodeState', () => {
	test('round-trip cu mode și returnTo', () => {
		const state = { tenantSlug: 'ots', nonce: 'n0nce', mode: 'signup' as const, returnTo: '/client/ots/hosting/packages' };
		expect(decodeState(encodeState(state))).toEqual(state);
	});

	test('state vechi (doar tenantSlug + nonce) → mode login, fără returnTo', () => {
		const legacy = toUrlSafe(btoa(JSON.stringify({ tenantSlug: 'ots', nonce: 'abc' })));
		expect(decodeState(legacy)).toEqual({ tenantSlug: 'ots', nonce: 'abc', mode: 'login', returnTo: null });
	});

	test('mode necunoscut cade pe login', () => {
		const raw = toUrlSafe(btoa(JSON.stringify({ tenantSlug: 'ots', nonce: 'abc', mode: 'admin' })));
		expect(decodeState(raw).mode).toBe('login');
	});

	test('state fără tenantSlug/nonce → aruncă', () => {
		expect(() => decodeState(toUrlSafe(btoa(JSON.stringify({ nonce: 'x' }))))).toThrow();
		expect(() => decodeState('nu-e-base64!!')).toThrow();
	});

	test('parseState rămâne alias pentru callback-ul existent', () => {
		expect(parseState).toBe(decodeState);
	});
});

describe('safePortalReturnTo', () => {
	test('acceptă doar căi din portalul tenantului curent', () => {
		expect(safePortalReturnTo('ots', '/client/ots/hosting/packages')).toBe('/client/ots/hosting/packages');
		expect(safePortalReturnTo('ots', '/client/ots/dashboard')).toBe('/client/ots/dashboard');
	});

	test('respinge scheme, protocol-relative, alt tenant, pagini publice, gol', () => {
		for (const bad of [
			'https://evil.ro/client/ots/dashboard',
			'//evil.ro',
			'/client/alt/dashboard',
			'/client/ots',
			'/pachete-hosting',
			'',
			null,
			undefined
		]) {
			expect(safePortalReturnTo('ots', bad)).toBeNull();
		}
	});
});

describe('generateGoogleLoginUrl', () => {
	test('implicit: mode login, fără returnTo, nonce url-safe', () => {
		captured.opts = null;
		const { nonce } = generateGoogleLoginUrl('ots');
		expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
		const state = decodeState(lastState());
		expect(state).toEqual({ tenantSlug: 'ots', nonce, mode: 'login', returnTo: null });
	});

	test('signup + returnTo valid ajung în state', () => {
		generateGoogleLoginUrl('ots', { mode: 'signup', returnTo: '/client/ots/hosting/packages' });
		const state = decodeState(lastState());
		expect(state.mode).toBe('signup');
		expect(state.returnTo).toBe('/client/ots/hosting/packages');
	});

	test('returnTo invalid e aruncat, nu transmis', () => {
		generateGoogleLoginUrl('ots', { mode: 'signup', returnTo: 'https://evil.ro' });
		expect(decodeState(lastState()).returnTo).toBeNull();
	});
});
