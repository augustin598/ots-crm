// Teste pentru selecția providerului SERP. Eager-load schema ÎNAINTE de mock-uri
// (mock.module e global în Bun). DB și logger mock-uite; deps injectate evită rețeaua.
import { describe, test, expect, mock } from 'bun:test';

// Încarcă schema reală înainte de orice mock (altfel se corup tabelele global).
await import('$lib/server/db/schema');

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const { resolveSerpProvider, shouldFailover } = await import('../resolve');
const { DecryptionError } = await import('$lib/server/plugins/smartbill/crypto');

const activeRow = { loginEncrypted: 'encL', passwordEncrypted: 'encP', isActive: true };

describe('shouldFailover — prag 20% cu minim de verificări', () => {
	test('sub minimul de verificări → false', () => {
		expect(shouldFailover({ keywordsChecked: 5, failed: 5 })).toBe(false);
	});
	test('15% eșecuri (3/20) → false', () => {
		expect(shouldFailover({ keywordsChecked: 20, failed: 3 })).toBe(false);
	});
	test('25% eșecuri (5/20) → true', () => {
		expect(shouldFailover({ keywordsChecked: 20, failed: 5 })).toBe(true);
	});
});

describe('resolveSerpProvider — moduri', () => {
	test("'scraper' → principal scraper, fără rezervă", async () => {
		const r = await resolveSerpProvider('t1', { loadMode: async () => 'scraper' });
		expect(r.mode).toBe('scraper');
		expect(r.primary.name).toBe('scraper');
		expect(r.fallback).toBeNull();
	});

	test("'dataforseo' cu integrare activă → principal dataforseo", async () => {
		const r = await resolveSerpProvider('t1', {
			loadMode: async () => 'dataforseo',
			loadIntegration: async () => activeRow,
			decryptFn: (_t, c) => `dec:${c}`
		});
		expect(r.primary.name).toBe('dataforseo');
		expect(r.fallback).toBeNull();
	});

	test("'dataforseo' fără integrare activă → aruncă eroare config", async () => {
		let err: unknown;
		try {
			await resolveSerpProvider('t1', {
				loadMode: async () => 'dataforseo',
				loadIntegration: async () => null
			});
		} catch (e) {
			err = e;
		}
		expect((err as { kind?: string }).kind).toBe('config');
	});

	test("'auto' cu integrare → principal scraper + rezervă dataforseo", async () => {
		const r = await resolveSerpProvider('t1', {
			loadMode: async () => 'auto',
			loadIntegration: async () => activeRow,
			decryptFn: (_t, c) => `dec:${c}`
		});
		expect(r.primary.name).toBe('scraper');
		expect(r.fallback?.name).toBe('dataforseo');
	});

	test("'auto' fără integrare → principal scraper, fără rezervă", async () => {
		const r = await resolveSerpProvider('t1', {
			loadMode: async () => 'auto',
			loadIntegration: async () => null
		});
		expect(r.primary.name).toBe('scraper');
		expect(r.fallback).toBeNull();
	});

	test('integrare inactivă → tratată ca lipsă (fără rezervă în auto)', async () => {
		const r = await resolveSerpProvider('t1', {
			loadMode: async () => 'auto',
			loadIntegration: async () => ({ ...activeRow, isActive: false })
		});
		expect(r.fallback).toBeNull();
	});
});

describe('resolveSerpProvider — decriptare cu retry pe DecryptionError', () => {
	test('prima decriptare eșuează → re-citire proaspătă → reușită', async () => {
		let calls = 0;
		let reloads = 0;
		const r = await resolveSerpProvider('t1', {
			loadMode: async () => 'dataforseo',
			loadIntegration: async () => {
				reloads++;
				return activeRow;
			},
			decryptFn: (_t, c) => {
				calls++;
				if (calls === 1) throw new DecryptionError('transient');
				return `dec:${c}`;
			}
		});
		expect(r.primary.name).toBe('dataforseo');
		expect(reloads).toBe(2); // o citire inițială + o re-citire după eșec
	});
});
