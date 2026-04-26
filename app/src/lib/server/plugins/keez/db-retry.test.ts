import { describe, expect, test } from 'bun:test';
import { withTursoBusyRetry } from './db-retry';

/**
 * Run: `bun test src/lib/server/plugins/keez/db-retry.test.ts`
 *
 * Verifies that withTursoBusyRetry retries on libSQL/Turso busy errors
 * and gives up immediately on unrelated errors.
 */
describe('withTursoBusyRetry', () => {
	test('passes through on success without retrying', async () => {
		let calls = 0;
		const result = await withTursoBusyRetry(
			async () => {
				calls++;
				return 'ok';
			},
			{ label: 'noop', tenantId: 't1' }
		);
		expect(result).toBe('ok');
		expect(calls).toBe(1);
	});

	test('retries and succeeds after a transient SQLITE_BUSY', async () => {
		let calls = 0;
		const result = await withTursoBusyRetry(
			async () => {
				calls++;
				if (calls === 1) throw new Error('SQLITE_BUSY: database is locked');
				return 'ok';
			},
			{ label: 'flaky', tenantId: 't1' }
		);
		expect(result).toBe('ok');
		expect(calls).toBe(2);
	});

	test('retries on busy in .cause chain (Drizzle wrapper)', async () => {
		let calls = 0;
		const result = await withTursoBusyRetry(
			async () => {
				calls++;
				if (calls === 1) {
					const inner = new Error('SQLITE_BUSY: database is locked');
					const wrapper = new Error('Failed query: insert into "invoice_line_item"…');
					(wrapper as Error & { cause?: unknown }).cause = inner;
					throw wrapper;
				}
				return 'ok';
			},
			{ label: 'wrapped', tenantId: 't1' }
		);
		expect(result).toBe('ok');
		expect(calls).toBe(2);
	});

	test('does NOT retry on non-busy errors', async () => {
		let calls = 0;
		await expect(
			withTursoBusyRetry(
				async () => {
					calls++;
					throw new Error('FOREIGN KEY constraint failed');
				},
				{ label: 'fk-violation' }
			)
		).rejects.toThrow('FOREIGN KEY constraint failed');
		expect(calls).toBe(1);
	});

	test('gives up after max retries on persistent busy', async () => {
		let calls = 0;
		await expect(
			withTursoBusyRetry(
				async () => {
					calls++;
					throw new Error('SQLITE_BUSY: database is locked');
				},
				{ label: 'always-busy' }
			)
		).rejects.toThrow('SQLITE_BUSY');
		// Initial attempt + 2 retries = 3 total.
		expect(calls).toBe(3);
	});
});
