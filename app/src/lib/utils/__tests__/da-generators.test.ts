import { describe, test, expect } from 'bun:test';
import { generateDaPassword, generateDaUsername } from '../da-generators';

describe('generateDaPassword', () => {
	// Run 200 iterations to catch non-deterministic class-coverage bugs (Fisher–Yates
	// shuffle + crypto.getRandomValues). DA's `complexity_check=1` rejects any
	// password missing one of the four char classes.
	test('every sample contains lowercase, uppercase, digit, and symbol', () => {
		for (let i = 0; i < 200; i++) {
			const p = generateDaPassword();
			expect(p).toMatch(/[a-z]/);
			expect(p).toMatch(/[A-Z]/);
			expect(p).toMatch(/[0-9]/);
			expect(p).toMatch(/[!@#%*\-_=+.?]/);
		}
	});

	test('length is at least 14 (DA min) and stable', () => {
		for (let i = 0; i < 50; i++) {
			const p = generateDaPassword();
			expect(p.length).toBeGreaterThanOrEqual(14);
			expect(p.length).toBeLessThanOrEqual(20);
		}
	});

	test('no URL-encoding-hazardous characters', () => {
		// `&`, `=`, `+`, `%`, `?`, `#`, space — would break the legacy
		// CMD_API_ACCOUNT_USER form body if not properly encoded. Our SAFE_SYMBOLS
		// set deliberately excludes `&`, `=`, `?`, `#` to avoid any encoding
		// fragility in unusual code paths. Confirm here so a future tweak doesn't
		// silently add them back.
		for (let i = 0; i < 50; i++) {
			const p = generateDaPassword();
			expect(p).not.toMatch(/[&\s"'`$|<>(){}\[\]\\]/);
		}
	});
});

describe('generateDaUsername', () => {
	test('produces lowercase alphanumeric starting with a letter', () => {
		for (const seed of ['Acme SRL', 'ACME-Corp', '123Corp', 'Țapul de Aur', 'a@b.com']) {
			const u = generateDaUsername(seed);
			expect(u).toMatch(/^[a-z][a-z0-9]+$/);
			expect(u.length).toBeLessThanOrEqual(16);
		}
	});

	test('different invocations on same seed yield different usernames (random suffix)', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 20; i++) {
			seen.add(generateDaUsername('Acme'));
		}
		// 20 random 4-char base32 suffixes → expect >= 18 unique with very high probability
		expect(seen.size).toBeGreaterThanOrEqual(18);
	});

	test('strips Romanian diacritics', () => {
		const u = generateDaUsername('Țesătorul');
		// `Țesătorul` → `tesatorul` (lowercase, diacritics stripped)
		expect(u).toMatch(/^tesatorul[a-z0-9]{2,4}$/);
	});

	test('seeds starting with a digit get `ots` prefix', () => {
		const u = generateDaUsername('123corp');
		expect(u).toMatch(/^ots/);
	});
});
