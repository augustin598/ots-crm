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

// Controls what .returning() yields for each update call in sequence (FIFO).
const updateReturns: Array<Array<{ id: string; tenantId?: string }>> = [];

mock.module('$lib/server/db', () => {
	function makeUpdateChain(rows: Array<{ id: string; tenantId?: string }>) {
		return {
			set: () => makeUpdateChain(rows),
			where: () => makeUpdateChain(rows),
			returning: () => Promise.resolve(rows),
		};
	}

	return {
		db: {
			update: () => ({
				set: () => ({
					where: () => ({
						returning: () => {
							const rows = updateReturns.length > 0 ? updateReturns.shift()! : [];
							return Promise.resolve(rows);
						},
					}),
				}),
			}),
			select: () => ({
				from: () => ({
					where: () => Promise.resolve([{ userId: 'user-1' }]),
				}),
			}),
		}
	};
});

mock.module('$lib/server/db/schema', () => ({
	adsOptimizationTask: {
		status: 'status',
		claimedAt: 'claimed_at',
		claimedBy: 'claimed_by',
		expiresAt: 'expires_at',
		tenantId: 'tenant_id',
		id: 'id',
	},
	tenantUser: { tenantId: 'tenant_id', userId: 'user_id' },
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) }),
}));

const { processAdsOptimizationTaskReaper } = await import('../ads-optimization-task-reaper');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processAdsOptimizationTaskReaper', () => {
	beforeEach(() => {
		updateReturns.length = 0;
		telegramCalls.length = 0;
	});

	test('reverts stale claimed tasks back to pending', async () => {
		// First update (revert) returns 2 reverted tasks
		updateReturns.push([
			{ id: 'task-1', tenantId: 'tenant-1' },
			{ id: 'task-2', tenantId: 'tenant-1' },
		]);
		// Second update (expire) returns 0
		updateReturns.push([]);

		const result = await processAdsOptimizationTaskReaper();

		expect(result.reverted).toBe(2);
		expect(result.expired).toBe(0);
	});

	test('does not affect freshly claimed tasks (< 1h)', async () => {
		// The reaper's WHERE clause filters claimedAt < cutoff (1h ago).
		// We simulate DB returning 0 rows (fresh tasks not matched).
		updateReturns.push([]); // revert: 0 stale
		updateReturns.push([]); // expire: 0

		const result = await processAdsOptimizationTaskReaper();

		expect(result.reverted).toBe(0);
	});

	test('expires pending tasks past expiresAt', async () => {
		updateReturns.push([]); // revert: nothing stale
		updateReturns.push([{ id: 'old-task-1' }, { id: 'old-task-2' }, { id: 'old-task-3' }]); // expire

		const result = await processAdsOptimizationTaskReaper();

		expect(result.expired).toBe(3);
		expect(result.reverted).toBe(0);
	});

	test('sends Telegram alert when >= 5 tasks are stuck', async () => {
		const stuckTasks = Array.from({ length: 5 }, (_, i) => ({ id: `task-${i}`, tenantId: 'tenant-1' }));
		updateReturns.push(stuckTasks); // revert: 5 stuck
		updateReturns.push([]); // expire: 0

		await processAdsOptimizationTaskReaper();

		expect(telegramCalls.length).toBeGreaterThan(0);
		expect(telegramCalls[0].text).toContain('stuck');
	});

	test('does NOT send Telegram alert when fewer than 5 tasks reverted', async () => {
		updateReturns.push([{ id: 'task-1', tenantId: 'tenant-1' }]); // only 1 stuck
		updateReturns.push([]);

		await processAdsOptimizationTaskReaper();

		expect(telegramCalls).toHaveLength(0);
	});
});
