import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Queue-based db mock: each awaited select resolves with the next queued rows.
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
const refreshCalls: Array<{ platform: string; tenantId: string; integrationId: string; opts: any }> = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => ({
	metaAdsIntegration: {}, googleAdsIntegration: {}, tiktokAdsIntegration: {}, tenantUser: {}
}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {}, logError: () => {}, logWarning: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('$lib/server/notifications', () => ({
	createNotification: async (n: Record<string, any>) => { notifications.push(n); }
}));
mock.module('$lib/server/scraper/headless-session-refresh', () => ({
	refreshSessionHeadless: async () => ({ status: 'error', error: 'not mocked' })
}));
mock.module('$lib/server/scraper/invoice-scraper', () => ({}));

const { processAdsSessionKeepalive } = await import('../ads-session-keepalive');

function integ(id: string, tenantId = 'tnt_ots') {
	return { id, tenantId, label: `label ${id}` };
}

function refreshReturning(statusById: Record<string, string>) {
	return async (platform: string, tenantId: string, integrationId: string, opts: any) => {
		refreshCalls.push({ platform, tenantId, integrationId, opts });
		return { status: statusById[integrationId] ?? 'error' } as any;
	};
}

describe('processAdsSessionKeepalive', () => {
	beforeEach(() => {
		queue.length = 0;
		notifications.length = 0;
		refreshCalls.length = 0;
	});

	test('iterates all three platforms and aggregates counts', async () => {
		queue.push([integ('meta_a')]);      // meta integrations
		queue.push([integ('goog_a')]);      // google integrations
		queue.push([integ('tt_a')]);        // tiktok integrations

		const result = await processAdsSessionKeepalive({}, {
			refresh: refreshReturning({ meta_a: 'refreshed', goog_a: 'skipped_fresh', tt_a: 'refreshed' }),
			delayMs: 0
		});

		expect(result.total).toBe(3);
		expect(result.refreshed).toBe(2);
		expect(result.skipped).toBe(1);
		// each platform refreshed with the right platform arg
		expect(refreshCalls.map(c => c.platform).sort()).toEqual(['google', 'meta', 'tiktok']);
	});

	test('notifies admins once per expired integration with the right platform label + link', async () => {
		queue.push([integ('meta_dead')]);        // meta integrations
		queue.push([{ userId: 'u1' }]);           // admins for meta_dead
		queue.push([]);                            // google integrations (none)
		queue.push([]);                            // tiktok integrations (none)

		await processAdsSessionKeepalive({}, {
			refresh: refreshReturning({ meta_dead: 'expired' }),
			delayMs: 0
		});

		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Sesiune Facebook expirată');
		expect(notifications[0].link).toBe('invoices/meta-ads');
	});

	test('google expired notifies with Google Ads label + link', async () => {
		queue.push([]);                            // meta integrations (none)
		queue.push([integ('g_dead')]);            // google integrations
		queue.push([{ userId: 'u1' }]);           // admins for g_dead
		queue.push([]);                            // tiktok integrations (none)

		await processAdsSessionKeepalive({}, {
			refresh: refreshReturning({ g_dead: 'expired' }),
			delayMs: 0
		});

		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Sesiune Google Ads expirată');
		expect(notifications[0].link).toBe('invoices/google-ads');
	});

	test('passes 24h freshness skip to refresh', async () => {
		queue.push([integ('meta_a')]);
		queue.push([]);
		queue.push([]);
		await processAdsSessionKeepalive({}, { refresh: refreshReturning({ meta_a: 'refreshed' }), delayMs: 0 });
		expect(refreshCalls[0].opts.skipIfFresherThanMs).toBe(24 * 60 * 60 * 1000);
	});

	test('a throwing refresh counts as error and does not stop the run', async () => {
		queue.push([integ('boom'), integ('ok')]);
		queue.push([]);
		queue.push([]);

		const result = await processAdsSessionKeepalive({}, {
			refresh: async (platform, tenantId, integrationId, opts) => {
				refreshCalls.push({ platform, tenantId, integrationId, opts });
				if (integrationId === 'boom') throw new Error('chrome crashed');
				return { status: 'refreshed' } as any;
			},
			delayMs: 0
		});

		expect(result.errors).toBe(1);
		expect(result.refreshed).toBe(1);
	});
});
