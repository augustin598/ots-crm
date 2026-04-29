// Pure deviation engine for ads performance monitoring.
// No DB access, no I/O — just math + decision logic. Easy to unit test.

import type { AdMetricMaturity } from '$lib/server/db/schema';

export type MetricKey = 'cpl' | 'cpa' | 'roas' | 'ctr' | 'dailyBudget';

export type DeviationDirection = 'over' | 'under';

export type Severity = 'warning' | 'high' | 'urgent';

export interface DailyMetrics {
	date: string;
	spendCents: number;
	impressions: number;
	clicks: number;
	conversions: number;
	cpcCents: number | null;
	cpmCents: number | null;
	cpaCents: number | null;
	cplCents: number | null;
	ctr: number | null;
	roas: number | null;
	frequency: number | null;
}

export interface CampaignTargets {
	targetCplCents: number | null;
	targetCpaCents: number | null;
	targetRoas: number | null;
	targetCtr: number | null;
	targetDailyBudgetCents: number | null;
	deviationThresholdPct: number;
}

export interface CampaignContext {
	campaignStartDate: string | null; // ISO YYYY-MM-DD; null = unknown (treat as new)
	isMuted: boolean;
	mutedUntil: Date | null;
	now: Date;
}

export interface DeviationResult {
	metric: MetricKey;
	actual: number;
	target: number;
	deviationPct: number;        // signed: positive = over target, negative = under
	direction: DeviationDirection;
	severity: Severity;
	consecutiveDays: number;
}

export interface MaturityAssessment {
	maturity: AdMetricMaturity;
	reason: string;
	conversionsLast7d: number;
	daysRunning: number | null;
}

const LEARNING_DAYS_MIN = 7;
const SPARSE_CONVERSIONS_MIN = 50;
const ANTI_FLAP_DAYS = 2;

// ─── Maturity assessment (Gemini fix #3) ────────────────────────────────────

export function assessMaturity(
	last7d: DailyMetrics[],
	context: CampaignContext
): MaturityAssessment {
	const conversionsLast7d = last7d.reduce((s, d) => s + (d.conversions ?? 0), 0);

	let daysRunning: number | null = null;
	if (context.campaignStartDate) {
		const start = new Date(context.campaignStartDate + 'T00:00:00Z').getTime();
		const ms = context.now.getTime() - start;
		daysRunning = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
	}

	if (daysRunning !== null && daysRunning < LEARNING_DAYS_MIN) {
		return {
			maturity: 'learning',
			reason: `Campania rulează de ${daysRunning} zile (< ${LEARNING_DAYS_MIN}, fază de învățare Meta).`,
			conversionsLast7d,
			daysRunning
		};
	}

	if (conversionsLast7d < SPARSE_CONVERSIONS_MIN) {
		return {
			maturity: 'sparse',
			reason: `${conversionsLast7d} conversii în ultimele 7 zile (< ${SPARSE_CONVERSIONS_MIN} pentru atribuire stabilă).`,
			conversionsLast7d,
			daysRunning
		};
	}

	return {
		maturity: 'mature',
		reason: 'Date suficiente pentru detecție stabilă.',
		conversionsLast7d,
		daysRunning
	};
}

// ─── Per-metric deviation computation ────────────────────────────────────────

interface MetricSpec {
	key: MetricKey;
	target: number | null;
	actual: number | null;
	// 'higher_is_worse' for CPL/CPA/dailyBudget overrun; 'lower_is_worse' for ROAS/CTR
	direction: 'higher_is_worse' | 'lower_is_worse';
}

function buildSpecs(targets: CampaignTargets, day: DailyMetrics): MetricSpec[] {
	return [
		{ key: 'cpl', target: targets.targetCplCents, actual: day.cplCents, direction: 'higher_is_worse' },
		{ key: 'cpa', target: targets.targetCpaCents, actual: day.cpaCents, direction: 'higher_is_worse' },
		{ key: 'roas', target: targets.targetRoas, actual: day.roas, direction: 'lower_is_worse' },
		{ key: 'ctr', target: targets.targetCtr, actual: day.ctr, direction: 'lower_is_worse' },
		{
			key: 'dailyBudget',
			target: targets.targetDailyBudgetCents,
			actual: day.spendCents,
			direction: 'higher_is_worse'
		}
	];
}

function computeDeviationPct(spec: MetricSpec): number | null {
	if (spec.target === null || spec.target === 0 || spec.actual === null) return null;
	const pct = ((spec.actual - spec.target) / spec.target) * 100;
	// Sign convention: positive = bad (over) for higher_is_worse, positive = bad (under) for lower_is_worse
	return spec.direction === 'higher_is_worse' ? pct : -pct;
}

function severityFor(absDeviationPct: number, metric: MetricKey, actual: number, target: number): Severity {
	if (metric === 'roas' && target > 0 && actual / target < 0.5) return 'urgent';
	if (absDeviationPct > 100) return 'urgent';
	if (absDeviationPct > 50) return 'high';
	return 'warning';
}

// ─── Main entry: detect deviations on a daily window ─────────────────────────

export interface DetectionInput {
	targets: CampaignTargets;
	// Sorted ascending by date (oldest → newest). Must contain at least last 7 days.
	dailyHistory: DailyMetrics[];
	context: CampaignContext;
	maturity: MaturityAssessment;
}

export interface DetectionOutput {
	skipped: boolean;
	skippedReason?: string;
	deviations: DeviationResult[];
}

export function detectDeviations(input: DetectionInput): DetectionOutput {
	const { targets, dailyHistory, context, maturity } = input;

	if (context.isMuted) {
		const stillMuted = !context.mutedUntil || context.mutedUntil > context.now;
		if (stillMuted) {
			return { skipped: true, skippedReason: 'muted', deviations: [] };
		}
	}

	if (maturity.maturity !== 'mature') {
		return { skipped: true, skippedReason: `maturity:${maturity.maturity}`, deviations: [] };
	}

	if (dailyHistory.length < ANTI_FLAP_DAYS) {
		return { skipped: true, skippedReason: 'insufficient_history', deviations: [] };
	}

	// Look at last N days for anti-flap (default 2 consecutive)
	const lastN = dailyHistory.slice(-ANTI_FLAP_DAYS);
	const threshold = targets.deviationThresholdPct;

	const results: DeviationResult[] = [];
	const allMetrics: MetricKey[] = ['cpl', 'cpa', 'roas', 'ctr', 'dailyBudget'];

	for (const metric of allMetrics) {
		const perDay = lastN.map((day) => {
			const specs = buildSpecs(targets, day);
			const spec = specs.find((s) => s.key === metric);
			if (!spec) return null;
			const dev = computeDeviationPct(spec);
			if (dev === null) return null;
			return { day, spec, dev };
		});

		// All N days must be over threshold to trigger (anti-flap)
		const allOverThreshold = perDay.every((p) => p !== null && p.dev > threshold);
		if (!allOverThreshold) continue;

		// Use most recent day for severity classification
		const latest = perDay[perDay.length - 1]!;
		const consecutive = perDay.filter((p) => p !== null && p.dev > threshold).length;

		results.push({
			metric,
			actual: latest.spec.actual ?? 0,
			target: latest.spec.target ?? 0,
			deviationPct: latest.dev,
			direction: latest.spec.direction === 'higher_is_worse' ? 'over' : 'under',
			severity: severityFor(
				Math.abs(latest.dev),
				metric,
				latest.spec.actual ?? 0,
				latest.spec.target ?? 0
			),
			consecutiveDays: consecutive
		});
	}

	return { skipped: false, deviations: results };
}

// ─── Helpers exposed for callers ────────────────────────────────────────────

export const DEVIATION_CONSTANTS = {
	LEARNING_DAYS_MIN,
	SPARSE_CONVERSIONS_MIN,
	ANTI_FLAP_DAYS
} as const;
