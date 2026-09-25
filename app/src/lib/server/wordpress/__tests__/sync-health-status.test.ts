import { describe, test, expect, mock } from 'bun:test';

// mock.module e GLOBAL în bun; oferim setul complet de operatori drizzle (vezi sync-scope.test.ts).
const passthrough = () => ({});
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
	and: (...conds: unknown[]) => ({ kind: 'and', conds }),
	lte: passthrough,
	gte: passthrough,
	lt: passthrough,
	gt: passthrough,
	or: passthrough,
	ne: passthrough,
	isNull: passthrough,
	isNotNull: passthrough,
	inArray: passthrough,
	desc: passthrough,
	asc: passthrough,
	sql: passthrough
}));
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { id: { name: 'id' }, connectorVersion: { name: 'connector_version' } },
	wordpressPost: {},
	wordpressPendingUpdate: {}
}));

type Row = Record<string, unknown>;
let siteRow: Row = {};
const updates: Row[] = [];
const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (r: (rows: Row[]) => unknown) => r([siteRow])
		};
		return chain;
	},
	insert: () => ({ values: async () => undefined }),
	update: () => ({
		set: (s: Row) => {
			updates.push(s);
			return { where: async () => undefined };
		}
	}),
	delete: () => ({ where: async () => undefined })
};
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({
	decrypt: () => 'secret',
	DecryptionError: class extends Error {}
}));

let healthImpl: () => Promise<unknown> = async () => ({
	connectorVersion: '0.7.0',
	wpVersion: '7.1.2',
	phpVersion: '8.2',
	sslExpiresAt: null,
	timestamp: 0
});
mock.module('../client', () => ({
	WpClient: class {
		constructor(_u: string, _s: string) {}
		health() {
			return healthImpl();
		}
	}
}));
mock.module('../connector-release', () => ({ compareConnectorVersions: () => 0 }));

const { syncHealth } = await import('../sync');
const { WpAuthError, WpPluginMissingError, WpConnectionError } = await import('../errors');

function site(over: Row = {}): Row {
	return {
		id: 's1',
		tenantId: 'tn',
		siteUrl: 'https://agencymeduza.ro',
		secretKey: 'enc',
		status: 'connected',
		consecutiveFailures: 0,
		connectorVersion: '0.7.0',
		...over
	};
}

describe('syncHealth status transitions', () => {
	test('HMAC rejected → disconnected on the FIRST failure (deterministic, not transient)', async () => {
		siteRow = site();
		updates.length = 0;
		healthImpl = async () => {
			throw new WpAuthError('HMAC rejected by https://agencymeduza.ro (HTTP 403)', { siteId: 's1' });
		};
		const r = await syncHealth('s1');
		expect(r.ok).toBe(false);
		expect(updates.at(-1)).toMatchObject({ status: 'disconnected', consecutiveFailures: 1 });
		expect(String(updates.at(-1)?.lastError)).toContain('wp_auth_error');
	});

	test('connector missing (404) → disconnected on the first failure', async () => {
		siteRow = site();
		updates.length = 0;
		healthImpl = async () => {
			throw new WpPluginMissingError('OTS Connector plugin not found (HTTP 404)', { siteId: 's1' });
		};
		await syncHealth('s1');
		expect(updates.at(-1)).toMatchObject({ status: 'disconnected', consecutiveFailures: 1 });
	});

	test('network error keeps the current status until 3 consecutive failures, then error', async () => {
		updates.length = 0;
		healthImpl = async () => {
			throw new WpConnectionError('Timeout calling GET /health', { siteId: 's1', subcode: 'timeout' });
		};
		siteRow = site({ consecutiveFailures: 0 });
		await syncHealth('s1');
		expect(updates.at(-1)).toMatchObject({ status: 'connected', consecutiveFailures: 1 });
		siteRow = site({ consecutiveFailures: 2 });
		await syncHealth('s1');
		expect(updates.at(-1)).toMatchObject({ status: 'error', consecutiveFailures: 3 });
	});

	test('success → connected, failure counter reset', async () => {
		updates.length = 0;
		healthImpl = async () => ({ connectorVersion: '0.7.0', wpVersion: '7.1.2', phpVersion: '8.2', sslExpiresAt: null, timestamp: 0 });
		siteRow = site({ status: 'disconnected', consecutiveFailures: 5 });
		const r = await syncHealth('s1');
		expect(r.ok).toBe(true);
		expect(updates.at(-1)).toMatchObject({ status: 'connected', consecutiveFailures: 0, lastError: null });
	});
});
