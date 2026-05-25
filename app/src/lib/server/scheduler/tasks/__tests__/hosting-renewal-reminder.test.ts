import { describe, test, expect, beforeEach, mock } from 'bun:test';

// SvelteKit virtual modules + db must be mocked before importing the SUT.
type QueueItem = unknown[];
const queue: QueueItem[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (resolve: (rows: QueueItem) => unknown) =>
				resolve(queue.shift() ?? [])
		};
		return chain;
	}
};

const notifyCalls: Array<{ tenantId: string; accountId: string; window: number }> = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => ({
	hostingAccount: {},
	hostingEmailEvent: {}
}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('$lib/server/hosting/notifications', () => ({
	notifyHostingRenewalReminder: async (tenantId: string, accountId: string, window: number) => {
		notifyCalls.push({ tenantId, accountId, window });
	}
}));

const { processHostingRenewalReminder } = await import('../hosting-renewal-reminder');

function isoFromToday(daysFromNow: number): string {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() + daysFromNow);
	return d.toISOString().slice(0, 10);
}

describe('processHostingRenewalReminder — self-healing', () => {
	beforeEach(() => {
		queue.length = 0;
		notifyCalls.length = 0;
	});

	test('account with 6 days remaining, no dedupe → sends 7d window', async () => {
		const accounts = [{ id: 'acc-1', tenantId: 't-1', nextDueDate: isoFromToday(6) }];
		queue.push(accounts); // initial candidate scan
		queue.push([]); // dedupe lookup for 1d → empty
		queue.push([]); // dedupe lookup for 7d → empty (1d skipped because 6 > 1, so 7d is the dispatch)
		const r = await processHostingRenewalReminder();
		expect(notifyCalls).toHaveLength(1);
		expect(notifyCalls[0]).toEqual({ tenantId: 't-1', accountId: 'acc-1', window: 7 });
		expect(r.sent).toBe(1);
	});

	test('account with 1 day remaining + no dedupe → sends 1d window (most urgent)', async () => {
		const accounts = [{ id: 'acc-2', tenantId: 't-1', nextDueDate: isoFromToday(1) }];
		queue.push(accounts);
		queue.push([]); // dedupe 1d → empty, dispatches immediately
		const r = await processHostingRenewalReminder();
		expect(notifyCalls).toHaveLength(1);
		expect(notifyCalls[0]).toEqual({ tenantId: 't-1', accountId: 'acc-2', window: 1 });
		expect(r.sent).toBe(1);
	});

	test('account with 12 days remaining → sends 14d window (only applicable)', async () => {
		const accounts = [{ id: 'acc-3', tenantId: 't-1', nextDueDate: isoFromToday(12) }];
		queue.push(accounts);
		queue.push([]); // 1d dedupe lookup (skipped, 12 > 1)
		queue.push([]); // 7d dedupe lookup (skipped, 12 > 7)
		queue.push([]); // 14d dedupe lookup (12 <= 14 → dispatch)
		const r = await processHostingRenewalReminder();
		expect(notifyCalls).toHaveLength(1);
		expect(notifyCalls[0].window).toBe(14);
		expect(r.sent).toBe(1);
	});

	test('account with 6 days remaining + 7d dedupe already present → noop (does not downgrade to 14d)', async () => {
		const accounts = [{ id: 'acc-4', tenantId: 't-1', nextDueDate: isoFromToday(6) }];
		queue.push(accounts);
		queue.push([]); // 1d dedupe empty
		queue.push([{ id: 'dedupe-existing' }]); // 7d dedupe EXISTS → noop, do not fire 14d
		const r = await processHostingRenewalReminder();
		expect(notifyCalls).toHaveLength(0);
		expect(r.sent).toBe(0);
		expect(r.skipped).toBe(0); // noop is neither sent nor skipped
	});

	test('account with 6 days remaining + 1d dedupe present → shadows, no further fire this cycle', async () => {
		const accounts = [{ id: 'acc-5', tenantId: 't-1', nextDueDate: isoFromToday(6) }];
		queue.push(accounts);
		queue.push([{ id: 'dedupe-1d' }]); // 1d dedupe exists → return noop immediately
		const r = await processHostingRenewalReminder();
		expect(notifyCalls).toHaveLength(0);
		expect(r.sent).toBe(0);
	});

	test('no candidates → returns zeros', async () => {
		queue.push([]); // empty candidate scan
		const r = await processHostingRenewalReminder();
		expect(r).toEqual({ checked: 0, sent: 0, skipped: 0 });
		expect(notifyCalls).toHaveLength(0);
	});

	test('multiple accounts in one run — each picks its own most-urgent applicable window', async () => {
		queue.push([
			{ id: 'far', tenantId: 't-1', nextDueDate: isoFromToday(13) },
			{ id: 'mid', tenantId: 't-1', nextDueDate: isoFromToday(5) },
			{ id: 'near', tenantId: 't-1', nextDueDate: isoFromToday(1) }
		]);
		// far: 1d-dedupe-check, 7d-dedupe-check, 14d-dedupe-check → dispatch 14d
		queue.push([]); queue.push([]); queue.push([]);
		// mid: 1d-dedupe-check, 7d-dedupe-check → dispatch 7d
		queue.push([]); queue.push([]);
		// near: 1d-dedupe-check → dispatch 1d
		queue.push([]);
		const r = await processHostingRenewalReminder();
		expect(r.sent).toBe(3);
		expect(notifyCalls.map((c) => c.window).sort((a, b) => a - b)).toEqual([1, 7, 14]);
	});
});
