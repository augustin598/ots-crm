import { describe, expect, test, mock } from 'bun:test';

// The transitive db import requires SQLITE_PATH (or a Turso URL) on the
// SvelteKit `$env/dynamic/private` module at load time. We never actually touch
// the DB in this test — only `retryJobId` and `enqueueKeezRetry`, neither of
// which open a connection — so an in-memory libsql path is enough.
mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

// Capture every schedulerQueue.add() call so we can assert jobId + options.
const addCalls: Array<{ name: string; data: any; opts: any }> = [];
mock.module('../index', () => ({
	schedulerQueue: {
		add: (name: string, data: any, opts: any) => {
			addCalls.push({ name, data, opts });
			return Promise.resolve({ id: opts.jobId });
		},
		remove: () => Promise.resolve(),
	},
}));

const { retryJobId, enqueueKeezRetry } = await import('./keez-invoice-sync-retry');

describe('retryJobId', () => {
	test('does not contain colon (BullMQ rejects colons in jobIds)', () => {
		const id = retryJobId('tenant-abc-123', 1);
		expect(id).not.toContain(':');
	});

	test('is unique per tenant', () => {
		expect(retryJobId('a', 1)).not.toBe(retryJobId('b', 1));
	});

	test('embeds the tenantId for traceability', () => {
		expect(retryJobId('tenant-xyz', 1)).toContain('tenant-xyz');
	});

	test('differs per attempt (so a re-enqueue from inside the active job is not silently deduped)', () => {
		// BullMQ Queue.add() with an existing jobId is a silent no-op (it returns
		// the existing job, not a new one). When the first retry job is *active*
		// and re-enqueues itself for the next hop, a stable-per-tenant jobId would
		// be deduped against the still-running job, breaking the retry chain.
		expect(retryJobId('t', 1)).not.toBe(retryJobId('t', 2));
		expect(retryJobId('t', 2)).not.toBe(retryJobId('t', 3));
	});

	test('is stable for the same (tenant, attempt) pair (so dedup still works within a hop)', () => {
		expect(retryJobId('xyz', 2)).toBe(retryJobId('xyz', 2));
	});
});

describe('enqueueKeezRetry', () => {
	test('passes removeOnComplete + removeOnFail so jobId hash does not linger in Redis', async () => {
		addCalls.length = 0;
		await enqueueKeezRetry('t1', 60_000, 1);
		expect(addCalls).toHaveLength(1);
		expect(addCalls[0].opts.removeOnComplete).toBe(true);
		expect(addCalls[0].opts.removeOnFail).toBe(true);
	});

	test('uses an attempt-specific jobId', async () => {
		addCalls.length = 0;
		await enqueueKeezRetry('t1', 60_000, 1);
		await enqueueKeezRetry('t1', 60_000, 2);
		expect(addCalls[0].opts.jobId).not.toBe(addCalls[1].opts.jobId);
	});
});
