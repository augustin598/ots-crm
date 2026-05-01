import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' } ));

// ─── Telegram mock ───────────────────────────────────────────────────────────

const telegramCalls: Array<{ tenantId: string; text: string }> = [];
mock.module('$lib/server/telegram/sender', () => ({
	sendTelegramMessage: async (args: { tenantId: string; userId: string; text: string }) => {
		telegramCalls.push({ tenantId: args.tenantId, text: args.text });
		return { ok: true };
	}
}));

// ─── DB mock ─────────────────────────────────────────────────────────────────

// Rows returned by each query in sequence (FIFO).
const queryQueue: Array<unknown[]> = [];

// Tracks INSERT calls
const insertCalls: Array<{ values: unknown }> = [];
let insertRowsAffected = 1; // default: insert succeeds

// Rows are captured once when select/selectDistinct is called; all chain methods
// just propagate the same resolved rows, making it awaitable at any point.
function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		returning: () => makeChain(rows),
		set: () => makeChain(rows),
	});
}

mock.module('$lib/server/db', () => {
	return {
		db: {
			select: () => makeChain(queryQueue.length > 0 ? queryQueue.shift() as unknown[] : []),
			selectDistinct: () => makeChain(queryQueue.length > 0 ? queryQueue.shift() as unknown[] : []),
			insert: () => ({
				values: (v: unknown) => ({
					onConflictDoNothing: () => {
						insertCalls.push({ values: v });
						return Promise.resolve({ rowsAffected: insertRowsAffected });
					},
				}),
			}),
		}
	};
});

mock.module('$lib/server/db/schema', () => ({
	adMonitorTarget: 'adMonitorTarget',
	adsOptimizationTask: 'adsOptimizationTask',
	tenantUser: 'tenantUser',
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) }),
}));

const { processAdsOptimizationTaskCreator } = await import('../ads-optimization-task-creator');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<{ id: string; tenantId: string; isMuted: boolean }> = {}) {
	return {
		id: overrides.id ?? 'tgt-1',
		tenantId: overrides.tenantId ?? 'tenant-1',
		externalCampaignId: 'camp-1',
		clientId: 'client-1',
		isActive: true,
		isMuted: overrides.isMuted ?? false,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processAdsOptimizationTaskCreator', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		insertCalls.length = 0;
		telegramCalls.length = 0;
		insertRowsAffected = 1;
	});

	test('creates N tasks for N active non-muted targets', async () => {
		// select targets for tenant → 2 targets (selectDistinct is skipped when tenantId provided)
		queryQueue.push([makeTarget({ id: 'tgt-1' }), makeTarget({ id: 'tgt-2' })]);
		// negative monitoring count query → 2 rows today
		queryQueue.push([{ count: 2 }]);

		const result = await processAdsOptimizationTaskCreator({ tenantId: 'tenant-1' });

		expect(result.totalCreated).toBe(2);
		expect(result.totalSkipped).toBe(0);
		expect(insertCalls).toHaveLength(2);
	});

	test('skips muted targets — DB returns 0 non-muted targets', async () => {
		// DB WHERE isMuted=false returns empty (all targets are muted)
		queryQueue.push([]); // no non-muted targets returned

		const result = await processAdsOptimizationTaskCreator({ tenantId: 'tenant-1' });

		expect(result.totalCreated).toBe(0);
		expect(result.totalSkipped).toBe(0);
		expect(insertCalls).toHaveLength(0);
	});

	test('idempotent: ON CONFLICT DO NOTHING means re-run inserts 0 rows', async () => {
		insertRowsAffected = 0; // simulate conflict — already exists
		queryQueue.push([makeTarget({ id: 'tgt-1' }), makeTarget({ id: 'tgt-2' })]);
		queryQueue.push([{ count: 2 }]); // tasks already exist from first run

		const result = await processAdsOptimizationTaskCreator({ tenantId: 'tenant-1' });

		expect(result.totalCreated).toBe(0);
		expect(result.totalSkipped).toBe(2);
		// Still attempted inserts (idempotent via ON CONFLICT DO NOTHING)
		expect(insertCalls).toHaveLength(2);
	});

	test('sends Telegram alert when 0 tasks created despite active targets', async () => {
		insertRowsAffected = 0;
		queryQueue.push([makeTarget()]);
		// Negative monitoring: count = 0 → fail-loud
		queryQueue.push([{ count: 0 }]);
		// tenantUser select for Telegram recipients
		queryQueue.push([{ userId: 'user-1' }]);

		await processAdsOptimizationTaskCreator({ tenantId: 'tenant-1' });

		expect(telegramCalls.length).toBeGreaterThan(0);
		expect(telegramCalls[0].text).toContain('0 tasks');
	});

	test('does NOT send Telegram alert when count > 0', async () => {
		insertRowsAffected = 1;
		queryQueue.push([makeTarget()]);
		queryQueue.push([{ count: 1 }]);

		await processAdsOptimizationTaskCreator({ tenantId: 'tenant-1' });

		expect(telegramCalls).toHaveLength(0);
	});
});
