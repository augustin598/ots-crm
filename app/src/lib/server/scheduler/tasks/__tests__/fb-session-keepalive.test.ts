import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Queue-based db mock (same pattern as hosting-expiry-guard.test.ts):
// each awaited select resolves with the next queued row set.
type Rows = unknown[];
const queue: Rows[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (resolve: (rows: Rows) => unknown) => resolve(queue.shift() ?? [])
		};
		return chain;
	}
};

const notifications: Array<Record<string, any>> = [];
const refreshCalls: Array<{ tenantId: string; integrationId: string; opts: any }> = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => ({ metaAdsIntegration: {}, tenantUser: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('$lib/server/notifications', () => ({
	createNotification: async (n: Record<string, any>) => {
		notifications.push(n);
	}
}));
// Avoid pulling puppeteer + the whole scraper chain into the test
mock.module('$lib/server/scraper/headless-session-refresh', () => ({
	refreshFbSessionHeadless: async () => ({ status: 'error', error: 'not mocked' })
}));

const { processFbSessionKeepalive } = await import('../fb-session-keepalive');

function makeIntegration(id: string, tenantId = 'tnt_ots') {
	return { id, tenantId, businessName: `BM ${id}` };
}

function refreshReturning(statusById: Record<string, string>) {
	return async (tenantId: string, integrationId: string, opts: any) => {
		refreshCalls.push({ tenantId, integrationId, opts });
		return { status: statusById[integrationId] ?? 'error' } as any;
	};
}

describe('processFbSessionKeepalive', () => {
	beforeEach(() => {
		queue.length = 0;
		notifications.length = 0;
		refreshCalls.length = 0;
	});

	test('counts refreshed/skipped/expired/errors per integration', async () => {
		queue.push([
			makeIntegration('int_a'),
			makeIntegration('int_b'),
			makeIntegration('int_c'),
			makeIntegration('int_d')
		]);
		// admins select for the expired integration
		queue.push([{ userId: 'usr_admin' }]);

		const result = await processFbSessionKeepalive({}, {
			refresh: refreshReturning({
				int_a: 'refreshed',
				int_b: 'skipped_fresh',
				int_c: 'expired',
				int_d: 'error'
			}),
			delayMs: 0
		});

		expect(result.total).toBe(4);
		expect(result.refreshed).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.expired).toBe(1);
		expect(result.errors).toBe(1);
	});

	test('notifies admins exactly once per expired integration, none otherwise', async () => {
		queue.push([makeIntegration('int_ok'), makeIntegration('int_dead')]);
		queue.push([{ userId: 'usr_1' }, { userId: 'usr_2' }]); // admins for int_dead

		await processFbSessionKeepalive({}, {
			refresh: refreshReturning({ int_ok: 'refreshed', int_dead: 'expired' }),
			delayMs: 0
		});

		expect(notifications).toHaveLength(2); // both admins, one integration
		expect(notifications[0].type).toBe('sync.error');
		expect(notifications[0].link).toBe('invoices/meta-ads');
		expect(notifications.every((n) => n.title === 'Sesiune Facebook expirată')).toBe(true);
	});

	test('passes a 24h freshness skip to the refresh function', async () => {
		queue.push([makeIntegration('int_a')]);

		await processFbSessionKeepalive({}, {
			refresh: refreshReturning({ int_a: 'refreshed' }),
			delayMs: 0
		});

		expect(refreshCalls).toHaveLength(1);
		expect(refreshCalls[0].opts.skipIfFresherThanMs).toBe(24 * 60 * 60 * 1000);
	});

	test('a throwing refresh counts as error and does not stop the run', async () => {
		queue.push([makeIntegration('int_boom'), makeIntegration('int_ok')]);

		const result = await processFbSessionKeepalive({}, {
			refresh: async (tenantId, integrationId, opts) => {
				refreshCalls.push({ tenantId, integrationId, opts });
				if (integrationId === 'int_boom') throw new Error('chrome crashed');
				return { status: 'refreshed' } as any;
			},
			delayMs: 0
		});

		expect(result.errors).toBe(1);
		expect(result.refreshed).toBe(1);
		expect(refreshCalls).toHaveLength(2);
	});

	test('busy counts as skipped (another refresh already in flight)', async () => {
		queue.push([makeIntegration('int_a')]);

		const result = await processFbSessionKeepalive({}, {
			refresh: refreshReturning({ int_a: 'busy' }),
			delayMs: 0
		});

		expect(result.skipped).toBe(1);
		expect(notifications).toHaveLength(0);
	});
});
