import { describe, test, expect, mock } from 'bun:test';

const passthrough = () => ({});
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
	ne: (col: unknown, val: unknown) => ({ kind: 'ne', col, val }),
	and: (...conds: unknown[]) => ({ kind: 'and', conds }),
	or: passthrough,
	lte: passthrough,
	gte: passthrough,
	lt: passthrough,
	gt: passthrough,
	isNull: passthrough,
	isNotNull: passthrough,
	inArray: passthrough,
	desc: passthrough,
	asc: passthrough,
	sql: passthrough
}));
const col = (name: string) => ({ name });
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { id: col('id'), siteUrl: col('site_url'), tenantId: col('tenant_id'), status: col('status'), paused: col('paused') }
}));

let rows: Array<Record<string, unknown>> = [];
let lastWhere: unknown = null;
mock.module('$lib/server/db', () => ({
	db: {
		select: () => {
			const chain: Record<string, unknown> = {
				from: () => chain,
				where: (w: unknown) => {
					lastWhere = w;
					return chain;
				},
				then: (r: (x: unknown[]) => unknown) => r(rows)
			};
			return chain;
		}
	}
}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const healthCalls: string[] = [];
const updatesCalls: string[] = [];
let healthOk: Record<string, boolean> = {};
mock.module('$lib/server/wordpress/sync', () => ({
	syncHealth: async (id: string) => {
		healthCalls.push(id);
		return healthOk[id] ? { ok: true } : { ok: false, error: 'HMAC rejected' };
	},
	syncUpdates: async (id: string) => {
		updatesCalls.push(id);
		return { ok: true, core: 0, plugins: 1, themes: 0, security: 0 };
	}
}));

const { processWordpressUpdatesCheck } = await import('./wordpress-updates-check');

describe('processWordpressUpdatesCheck', () => {
	test('re-verifies /health on every unpaused site (not only "connected") and pulls updates only where health passed', async () => {
		rows = [
			{ id: 'ok', siteUrl: 'https://ok.ro', tenantId: 't' },
			{ id: 'rejected', siteUrl: 'https://meduza.ro', tenantId: 't' }
		];
		healthOk = { ok: true, rejected: false };
		healthCalls.length = 0;
		updatesCalls.length = 0;

		const r = await processWordpressUpdatesCheck();

		expect(healthCalls).toEqual(['ok', 'rejected']);
		expect(updatesCalls).toEqual(['ok']);
		expect(r).toMatchObject({ checked: 2, healthy: 1, unhealthy: 1 });
		// Filter: paused = 0 only (status is decided by the probe, not the stale column).
		const where = lastWhere as { kind: string; col?: { name: string }; val?: unknown };
		expect(where.kind).toBe('eq');
		expect(where.col?.name).toBe('paused');
		expect(where.val).toBe(0);
	});
});
