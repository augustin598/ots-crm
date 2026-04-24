import { describe, expect, test, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

const { reconcileMissingKeezInvoices } = await import('./sync-reconcile');
const { KeezClientError } = await import('./errors');

describe('reconcileMissingKeezInvoices', () => {
	test('marks cancelled the candidates whose getInvoice returns 400 VALIDATION_ERROR + nu exista', async () => {
		const seen = new Set(['A', 'B']);
		const candidates = [
			{ id: 'inv-A', externalId: 'A' }, // in seen — defensively skipped
			{ id: 'inv-C', externalId: 'C' }, // not in seen — verified, missing
			{ id: 'inv-D', externalId: 'D' }, // not in seen — verified, exists
		];
		const getInvoice = mock((externalId: string) => {
			if (externalId === 'C') {
				return Promise.reject(
					new KeezClientError(
						'Keez API client error 400: {"Code":"VALIDATION_ERROR","Message":"Factura (C) nu exista!"}',
						400,
					),
				);
			}
			return Promise.resolve({ externalId: 'D', status: 'Valid' });
		});
		const cancelled: string[] = [];
		const markCancelled = (id: string) => {
			cancelled.push(id);
			return Promise.resolve();
		};

		const result = await reconcileMissingKeezInvoices({ seen, candidates, getInvoice, markCancelled });

		expect(cancelled).toEqual(['inv-C']);
		expect(result.cancelled).toBe(1);
		expect(result.verified).toBe(2); // C and D were both verified; A skipped
		expect(result.skipped).toBe(1); // A
	});

	test('does NOT cancel on transient errors (502)', async () => {
		const candidates = [{ id: 'inv-X', externalId: 'X' }];
		const getInvoice = mock(() =>
			Promise.reject(new KeezClientError('Keez API client error: 502 nginx', 502)),
		);
		const cancelled: string[] = [];

		const result = await reconcileMissingKeezInvoices({
			seen: new Set(),
			candidates,
			getInvoice,
			markCancelled: (id) => {
				cancelled.push(id);
				return Promise.resolve();
			},
		});

		expect(cancelled).toEqual([]);
		expect(result.cancelled).toBe(0);
	});

	test('handles empty candidate list (no-op)', async () => {
		const result = await reconcileMissingKeezInvoices({
			seen: new Set(['A']),
			candidates: [],
			getInvoice: () => Promise.resolve({}),
			markCancelled: () => Promise.resolve(),
		});
		expect(result).toEqual({ verified: 0, cancelled: 0, skipped: 0 });
	});
});
