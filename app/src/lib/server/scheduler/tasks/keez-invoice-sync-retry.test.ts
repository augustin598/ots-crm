import { describe, expect, test, mock } from 'bun:test';

// The transitive db import requires SQLITE_PATH (or a Turso URL) on the
// SvelteKit `$env/dynamic/private` module at load time. We never actually touch
// the DB in this test — only `retryJobId`, a pure string fn — so an in-memory
// libsql path is enough to satisfy module init.
mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

const { retryJobId } = await import('./keez-invoice-sync-retry');

describe('retryJobId', () => {
	test('does not contain colon (BullMQ rejects colons in jobIds)', () => {
		const id = retryJobId('tenant-abc-123');
		expect(id).not.toContain(':');
	});

	test('is unique per tenant', () => {
		expect(retryJobId('a')).not.toBe(retryJobId('b'));
	});

	test('is stable for the same tenant (so dedup works)', () => {
		expect(retryJobId('xyz')).toBe(retryJobId('xyz'));
	});

	test('embeds the tenantId for traceability', () => {
		expect(retryJobId('tenant-xyz')).toContain('tenant-xyz');
	});
});
