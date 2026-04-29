import { describe, expect, test } from 'bun:test';
import {
	assessMaturity,
	detectDeviations,
	DEVIATION_CONSTANTS,
	type CampaignContext,
	type CampaignTargets,
	type DailyMetrics
} from './deviation-engine';

const { LEARNING_DAYS_MIN, SPARSE_CONVERSIONS_MIN, ANTI_FLAP_DAYS } = DEVIATION_CONSTANTS;

const NOW = new Date('2026-04-29T07:00:00Z');

function makeDay(overrides: Partial<DailyMetrics>): DailyMetrics {
	return {
		date: '2026-04-28',
		spendCents: 0,
		impressions: 0,
		clicks: 0,
		conversions: 0,
		cpcCents: null,
		cpmCents: null,
		cpaCents: null,
		cplCents: null,
		ctr: null,
		roas: null,
		frequency: null,
		...overrides
	};
}

function makeContext(overrides: Partial<CampaignContext> = {}): CampaignContext {
	return {
		campaignStartDate: '2026-03-01', // ~60 days running
		isMuted: false,
		mutedUntil: null,
		now: NOW,
		...overrides
	};
}

const matureTargets: CampaignTargets = {
	targetCplCents: 3000, // 30 RON
	targetCpaCents: null,
	targetRoas: null,
	targetCtr: null,
	targetDailyBudgetCents: null,
	deviationThresholdPct: 20
};

// ─── Maturity ────────────────────────────────────────────────────────────────

describe('assessMaturity', () => {
	test('campaign running < 7d → learning', () => {
		const last7 = Array.from({ length: 5 }, () => makeDay({ conversions: 100 }));
		const ctx = makeContext({ campaignStartDate: '2026-04-26' }); // 3 days
		const result = assessMaturity(last7, ctx);
		expect(result.maturity).toBe('learning');
		expect(result.daysRunning).toBe(3);
	});

	test('mature campaign with < 50 conv last 7d → sparse', () => {
		const last7 = Array.from({ length: 7 }, () => makeDay({ conversions: 5 })); // 35 total
		const ctx = makeContext();
		const result = assessMaturity(last7, ctx);
		expect(result.maturity).toBe('sparse');
		expect(result.conversionsLast7d).toBe(35);
	});

	test('mature campaign with ≥ 50 conv last 7d → mature', () => {
		const last7 = Array.from({ length: 7 }, () => makeDay({ conversions: 10 })); // 70 total
		const ctx = makeContext();
		const result = assessMaturity(last7, ctx);
		expect(result.maturity).toBe('mature');
		expect(result.conversionsLast7d).toBe(70);
	});

	test('exactly LEARNING_DAYS_MIN days → still mature (boundary)', () => {
		const last7 = Array.from({ length: 7 }, () => makeDay({ conversions: 10 }));
		const start = new Date(NOW.getTime() - LEARNING_DAYS_MIN * 86400_000);
		const startISO = start.toISOString().slice(0, 10);
		const ctx = makeContext({ campaignStartDate: startISO });
		const result = assessMaturity(last7, ctx);
		expect(result.maturity).toBe('mature');
	});

	test('exactly SPARSE_CONVERSIONS_MIN conversions → mature (boundary)', () => {
		const last7 = Array.from({ length: 7 }, () =>
			makeDay({ conversions: Math.ceil(SPARSE_CONVERSIONS_MIN / 7) })
		);
		const ctx = makeContext();
		const result = assessMaturity(last7, ctx);
		expect(result.maturity).toBe('mature');
	});

	test('null campaignStartDate → skip learning check', () => {
		const last7 = Array.from({ length: 7 }, () => makeDay({ conversions: 10 }));
		const ctx = makeContext({ campaignStartDate: null });
		const result = assessMaturity(last7, ctx);
		expect(result.daysRunning).toBeNull();
		expect(result.maturity).toBe('mature');
	});
});

// ─── detectDeviations: anti-flap ─────────────────────────────────────────────

describe('detectDeviations — anti-flap', () => {
	test('CPL > 20% over target on 2 consecutive days → alert', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 4000, conversions: 10 }), // +33%
			makeDay({ date: '2026-04-28', cplCents: 4200, conversions: 10 }) // +40%
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.skipped).toBe(false);
		expect(result.deviations).toHaveLength(1);
		expect(result.deviations[0]!.metric).toBe('cpl');
		expect(result.deviations[0]!.consecutiveDays).toBe(ANTI_FLAP_DAYS);
	});

	test('CPL > 20% only on 1 day → no alert (anti-flap)', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 3100, conversions: 10 }), // +3%
			makeDay({ date: '2026-04-28', cplCents: 4500, conversions: 10 }) // +50%
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations).toHaveLength(0);
	});

	test('CPL within target → no alert', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 2900, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 3100, conversions: 10 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations).toHaveLength(0);
	});
});

// ─── detectDeviations: maturity gating ───────────────────────────────────────

describe('detectDeviations — maturity gating', () => {
	test('learning maturity → skip even with deviation', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 5000, conversions: 5 }),
			makeDay({ date: '2026-04-28', cplCents: 5500, conversions: 5 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'learning', reason: '', conversionsLast7d: 30, daysRunning: 3 }
		});
		expect(result.skipped).toBe(true);
		expect(result.skippedReason).toBe('maturity:learning');
	});

	test('sparse maturity → skip', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 5000, conversions: 5 }),
			makeDay({ date: '2026-04-28', cplCents: 5500, conversions: 5 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'sparse', reason: '', conversionsLast7d: 30, daysRunning: 60 }
		});
		expect(result.skipped).toBe(true);
		expect(result.skippedReason).toBe('maturity:sparse');
	});
});

// ─── detectDeviations: mute ──────────────────────────────────────────────────

describe('detectDeviations — mute', () => {
	test('isMuted=true with no mutedUntil → skip', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 5000, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 5500, conversions: 10 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext({ isMuted: true, mutedUntil: null }),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.skipped).toBe(true);
		expect(result.skippedReason).toBe('muted');
	});

	test('isMuted=true with mutedUntil in past → not skipped', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 5000, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 5500, conversions: 10 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext({
				isMuted: true,
				mutedUntil: new Date(NOW.getTime() - 86400_000)
			}),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.skipped).toBe(false);
		expect(result.deviations).toHaveLength(1);
	});
});

// ─── detectDeviations: severity escalation ───────────────────────────────────

describe('detectDeviations — severity', () => {
	test('CPL +30% → warning', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 3900, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 4000, conversions: 10 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations[0]!.severity).toBe('warning');
	});

	test('CPL +60% → high', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 4800, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 4900, conversions: 10 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations[0]!.severity).toBe('high');
	});

	test('CPL +120% → urgent', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 6700, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 6800, conversions: 10 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations[0]!.severity).toBe('urgent');
	});

	test('ROAS < 0.5× target → urgent', () => {
		const targets: CampaignTargets = {
			...matureTargets,
			targetCplCents: null,
			targetRoas: 3.0
		};
		const history = [
			makeDay({ date: '2026-04-27', roas: 1.0, conversions: 10 }), // 33% of target = -67% (over threshold)
			makeDay({ date: '2026-04-28', roas: 1.2, conversions: 10 })
		];
		const result = detectDeviations({
			targets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations[0]!.metric).toBe('roas');
		expect(result.deviations[0]!.severity).toBe('urgent');
	});
});

// ─── detectDeviations: null/missing data ─────────────────────────────────────

describe('detectDeviations — missing data', () => {
	test('null actual metric → no deviation for that metric', () => {
		const history = [
			makeDay({ date: '2026-04-27', cplCents: null, conversions: 0 }),
			makeDay({ date: '2026-04-28', cplCents: null, conversions: 0 })
		];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations).toHaveLength(0);
	});

	test('null target → no deviation for that metric', () => {
		const targets: CampaignTargets = {
			targetCplCents: null,
			targetCpaCents: null,
			targetRoas: null,
			targetCtr: null,
			targetDailyBudgetCents: null,
			deviationThresholdPct: 20
		};
		const history = [
			makeDay({ date: '2026-04-27', cplCents: 9000, conversions: 10 }),
			makeDay({ date: '2026-04-28', cplCents: 9000, conversions: 10 })
		];
		const result = detectDeviations({
			targets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.deviations).toHaveLength(0);
	});

	test('insufficient history (1 day only) → skip', () => {
		const history = [makeDay({ date: '2026-04-28', cplCents: 5000, conversions: 10 })];
		const result = detectDeviations({
			targets: matureTargets,
			dailyHistory: history,
			context: makeContext(),
			maturity: { maturity: 'mature', reason: '', conversionsLast7d: 70, daysRunning: 60 }
		});
		expect(result.skipped).toBe(true);
		expect(result.skippedReason).toBe('insufficient_history');
	});
});
