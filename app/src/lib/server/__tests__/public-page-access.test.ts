import { describe, test, expect, mock } from 'bun:test';

// Modulele virtuale SvelteKit trebuie mock-uite ÎNAINTE de import (public-page-access
// importă $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));

const {
	signGateToken,
	verifyGateToken,
	gateCookieName,
	PUBLIC_SERVICES_PAGE_KEY,
	GATE_COOKIE_MAX_AGE_SEC
} = await import('../public-page-access');

const SECRET = 'y6yqQ1s2f0KZ2Yk0m1Nq0m0Kx1s2f0KZ2Yk0m1Nq0m0';
const PAGE = PUBLIC_SERVICES_PAGE_KEY;

describe('token-ul de deblocare a paginii publice', () => {
	test('un token proaspăt semnat este acceptat', () => {
		const exp = Date.now() + 60_000;
		const token = signGateToken(SECRET, PAGE, exp);
		expect(verifyGateToken(SECRET, PAGE, token)).toBe(true);
	});

	test('formatul este v1.<expirare>.<hmac hex de 64 caractere>', () => {
		const exp = Date.now() + 60_000;
		const [version, expPart, sig] = signGateToken(SECRET, PAGE, exp).split('.');
		expect(version).toBe('v1');
		expect(expPart).toBe(String(exp));
		expect(sig).toMatch(/^[0-9a-f]{64}$/);
	});

	test('token expirat → respins', () => {
		const token = signGateToken(SECRET, PAGE, Date.now() - 1);
		expect(verifyGateToken(SECRET, PAGE, token)).toBe(false);
	});

	test('expirarea este verificată față de „acum", nu față de momentul semnării', () => {
		const exp = Date.now() + 10_000;
		const token = signGateToken(SECRET, PAGE, exp);
		expect(verifyGateToken(SECRET, PAGE, token, exp - 1)).toBe(true);
		expect(verifyGateToken(SECRET, PAGE, token, exp + 1)).toBe(false);
	});

	test('rotirea secretului (schimbarea parolei) invalidează token-urile vechi', () => {
		const token = signGateToken(SECRET, PAGE, Date.now() + 60_000);
		expect(verifyGateToken('alt-secret-complet-diferit', PAGE, token)).toBe(false);
	});

	test('un token semnat pentru altă pagină nu deblochează pagina curentă', () => {
		const exp = Date.now() + 60_000;
		// semnătură pentru o cheie de pagină diferită, dar cu același secret
		const foreign = signGateToken(SECRET, 'altceva' as typeof PAGE, exp);
		// atacatorul păstrează semnătura, dar schimbă eticheta paginii
		const tampered = `v1.${exp}.${foreign.split('.')[2]}`;
		expect(verifyGateToken(SECRET, PAGE, tampered)).toBe(false);
	});

	test('modificarea expirării invalidează semnătura', () => {
		const exp = Date.now() + 60_000;
		const sig = signGateToken(SECRET, PAGE, exp).split('.')[2];
		const tampered = `v1.${exp + 10_000_000}.${sig}`;
		expect(verifyGateToken(SECRET, PAGE, tampered)).toBe(false);
	});

	test('intrări malformate sunt respinse fără să arunce', () => {
		const cases = [
			'',
			'garbage',
			'v1.abc.def',
			`v1.${Date.now() + 60_000}`,
			`v2.${Date.now() + 60_000}.${'a'.repeat(64)}`,
			`v1.${Date.now() + 60_000}.zzzz`,
			`v1.${Date.now() + 60_000}.${'a'.repeat(63)}`,
			`v1.${Number.MAX_SAFE_INTEGER + 10}.${'a'.repeat(64)}`
		];
		for (const c of cases) {
			expect(verifyGateToken(SECRET, PAGE, c)).toBe(false);
		}
	});

	test('fără secret sau fără token → respins (pagina fără parolă nu se deblochează)', () => {
		const token = signGateToken(SECRET, PAGE, Date.now() + 60_000);
		expect(verifyGateToken(null, PAGE, token)).toBe(false);
		expect(verifyGateToken(undefined, PAGE, token)).toBe(false);
		expect(verifyGateToken(SECRET, PAGE, null)).toBe(false);
		expect(verifyGateToken(SECRET, PAGE, undefined)).toBe(false);
	});
});

describe('constante', () => {
	test('numele cookie-ului e derivat din cheia paginii', () => {
		expect(gateCookieName(PAGE)).toBe('ots_pub_services');
	});

	test('durata cookie-ului e de 30 de zile', () => {
		expect(GATE_COOKIE_MAX_AGE_SEC).toBe(30 * 24 * 60 * 60);
	});
});
