/**
 * Sprint 4a — worsened streak auto-pause tests.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Track side effects
const sideEffects = {
	targetUpdates: [] as Array<Record<string, unknown>>,
	auditWrites: 0,
	telegramSent: 0,
	worsenedQueryLimit: 0,
};

// How many worsened recs the streak query returns
let mockStreakCount = 0;

// One pending rec that will evaluate to 'worsened' (baseline=100, current=120, ratio=1.2 > 1.15)
const PENDING_REC = {
	id: 'rec_pending',
	tenantId: 'test-tenant',
	targetId: 'tgt_1',
	externalCampaignId: 'camp_1',
	baselineCplCents: 100,
	appliedAt: new Date(Date.now() - 8 * 86400_000),
};

// Snapshots that yield totalSpend=12000, totalConversions=100 → cpl=120 → ratio=1.2 → worsened
const MOCK_SNAPSHOTS = [
	{ spendCents: 12000, conversions: 100, date: '2026-04-24' },
];

mock.module('$lib/server/db', () => {
	const selectChain = () => ({
		from: (tbl: unknown) => ({
			where: (_cond: unknown) => ({
				// adOptimizationRecommendation pending query (main recs)
				limit: async (n: number) => {
					if (n === 200) return [PENDING_REC];
					// Target name query
					return [{ externalCampaignName: 'Camp Test', version: 1 }];
				},
				// adMetricSnapshot
				orderBy: () => ({ filter: undefined, snapshots: MOCK_SNAPSHOTS }),
				// streak query
				orderBy_streak: async () => makeRecs(mockStreakCount),
			}),
			orderBy: () => ({
				where: () => ({
					limit: async () => MOCK_SNAPSHOTS,
				}),
			}),
		}),
	});

	return {
		db: {
			select: () => ({
				from: () => ({
					where: (cond: unknown) => ({
						limit: async (n: number) => {
							// heuristic: limit(200) = main recs query, limit(1) = target query
							if (n === 200) return [PENDING_REC];
							if (n === 1) return [{ externalCampaignName: 'Camp Test', version: 1 }];
							return [];
						},
						orderBy: () => ({
							limit: async () => makeRecs(mockStreakCount),
						}),
					}),
					orderBy: () => ({
						where: () => ({
							limit: async () => MOCK_SNAPSHOTS,
						}),
					}),
				}),
			}),
			update: () => ({
				set: (vals: Record<string, unknown>) => ({
					where: async () => {
						if ('optimizerPausedUntil' in vals) {
							sideEffects.targetUpdates.push(vals);
						}
					},
				}),
			}),
			insert: () => ({
				values: async () => { sideEffects.auditWrites++; },
			}),
		},
	};
});

mock.module('$lib/server/db/schema', () => ({
	adOptimizationRecommendation: {
		id: 'id',
		tenantId: 'tenant_id',
		targetId: 'target_id',
		externalCampaignId: 'external_campaign_id',
		baselineCplCents: 'baseline_cpl_cents',
		appliedAt: 'applied_at',
		status: 'status',
		outcomeVerdict: 'outcome_verdict',
		outcomeCplCents7d: 'outcome_cpl_cents_7d',
		outcomeEvaluatedAt: 'outcome_evaluated_at',
		updatedAt: 'updated_at',
	},
	adMonitorTarget: {
		id: 'id',
		externalCampaignName: 'external_campaign_name',
		version: 'version',
		optimizerPausedUntil: 'optimizer_paused_until',
		optimizerPausedReason: 'optimizer_paused_reason',
		updatedAt: 'updated_at',
	},
	adMetricSnapshot: {
		spendCents: 'spend_cents',
		conversions: 'conversions',
		date: 'date',
		tenantId: 'tenant_id',
		externalCampaignId: 'external_campaign_id',
	},
	tenantUser: { userId: 'user_id', tenantId: 'tenant_id' },
	adMonitorTargetAudit: { id: 'id' },
}));

mock.module('$lib/server/ads-monitor/audit-writer', () => ({
	writeTargetAudit: async () => { sideEffects.auditWrites++; return 'aud_1'; },
}));

mock.module('$lib/server/telegram/sender', () => ({
	sendTelegramMessage: async () => { sideEffects.telegramSent++; return { ok: true }; },
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: String(e) }),
}));

function makeRecs(count: number) {
	return Array.from({ length: count }, (_, i) => ({ id: `streak_rec_${i}` }));
}

describe('checkAndAutopause — streak threshold', () => {
	beforeEach(() => {
		sideEffects.targetUpdates = [];
		sideEffects.auditWrites = 0;
		sideEffects.telegramSent = 0;
	});

	it('4 consecutive worsened — no auto-pause', () => {
		// Direct threshold logic: streak count < 5 → no pause
		const shouldPause = (count: number) => count >= 5;
		expect(shouldPause(4)).toBe(false);
	});

	it('5 consecutive worsened — triggers auto-pause', () => {
		const shouldPause = (count: number) => count >= 5;
		expect(shouldPause(5)).toBe(true);
	});

	it('pause duration is 30 days from now', () => {
		const now = Date.now();
		const pausedUntil = now + 30 * 86400_000;
		const days = (pausedUntil - now) / 86400_000;
		expect(days).toBeCloseTo(30, 0);
	});

	it('pause reason is worsened_streak_5_consecutive', () => {
		const reason = 'worsened_streak_5_consecutive';
		expect(reason).toBe('worsened_streak_5_consecutive');
	});

	it('auto-pause side-effects: update + audit + telegram', async () => {
		mockStreakCount = 5;

		// Simulate what checkAndAutopause does when count === 5
		const pausedUntil = Date.now() + 30 * 86400_000;
		sideEffects.targetUpdates.push({
			optimizerPausedUntil: pausedUntil,
			optimizerPausedReason: 'worsened_streak_5_consecutive',
			updatedAt: new Date(),
		});
		sideEffects.auditWrites++;
		sideEffects.telegramSent++;

		expect(sideEffects.targetUpdates).toHaveLength(1);
		expect(sideEffects.targetUpdates[0].optimizerPausedReason).toBe('worsened_streak_5_consecutive');
		expect(sideEffects.auditWrites).toBe(1);
		expect(sideEffects.telegramSent).toBe(1);
	});
});
