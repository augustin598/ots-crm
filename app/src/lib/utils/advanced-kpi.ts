/**
 * Advanced KPI calculations for Facebook Ads reports.
 * Pure functions — no DB, no side effects.
 */

import type { DailyAggregate, CampaignAggregate } from './report-helpers';

// ============================================================
// 1. Creative Fatigue Index
// ============================================================

export type FatigueLevel = 'fresh' | 'warning' | 'fatigued';

export interface CreativeFatigueResult {
	level: FatigueLevel;
	frequencyTrend: number;  // positive = increasing
	ctrTrend: number;        // negative = decreasing
	message: string;
}

/**
 * Detect creative fatigue per campaign by analyzing frequency trend (up)
 * and CTR trend (down) over the daily data window.
 * Requires per-campaign daily data (filtered insights).
 */
export function calculateCreativeFatigue(
	dailyData: DailyAggregate[]
): CreativeFatigueResult {
	if (dailyData.length < 3) {
		return { level: 'fresh', frequencyTrend: 0, ctrTrend: 0, message: 'Date insuficiente' };
	}

	// Split into first half and second half
	const mid = Math.floor(dailyData.length / 2);
	const firstHalf = dailyData.slice(0, mid);
	const secondHalf = dailyData.slice(mid);

	const avgFreqFirst = avg(firstHalf.map((d) => d.frequency));
	const avgFreqSecond = avg(secondHalf.map((d) => d.frequency));
	const avgCtrFirst = avg(firstHalf.map((d) => d.ctr));
	const avgCtrSecond = avg(secondHalf.map((d) => d.ctr));

	const frequencyTrend = avgFreqFirst > 0 ? ((avgFreqSecond - avgFreqFirst) / avgFreqFirst) * 100 : 0;
	const ctrTrend = avgCtrFirst > 0 ? ((avgCtrSecond - avgCtrFirst) / avgCtrFirst) * 100 : 0;

	// Fatigued: frequency up >20% AND CTR down >20%
	// Warning: frequency up >10% AND CTR down >10%
	let level: FatigueLevel = 'fresh';
	let message = 'Creative-urile performează bine';

	// Ignore noise on very low frequency (< 1.5 in second half)
	if (avgFreqSecond >= 1.5) {
		if (frequencyTrend > 20 && ctrTrend < -20) {
			level = 'fatigued';
			message = 'Creative fatigue — rotește creative-urile urgent';
		} else if (frequencyTrend > 10 && ctrTrend < -10) {
			level = 'warning';
			message = 'Semne de oboseală — pregătește creative-uri noi';
		} else if (frequencyTrend > 15) {
			level = 'warning';
			message = 'Frecvență în creștere — monitorizează CTR-ul';
		}
	}

	return { level, frequencyTrend, ctrTrend, message };
}

/**
 * Batch fatigue analysis for all campaigns.
 * Uses per-campaign daily aggregation from raw insights.
 */
export function calculateCampaignFatigue(
	campaignDailyMap: Map<string, DailyAggregate[]>
): Map<string, CreativeFatigueResult> {
	const results = new Map<string, CreativeFatigueResult>();
	for (const [campaignId, daily] of campaignDailyMap) {
		results.set(campaignId, calculateCreativeFatigue(daily));
	}
	return results;
}

// ============================================================
// 2. Budget Burn Forecast
// ============================================================

export interface BudgetBurnForecast {
	/** Projected total spend by end of month */
	projectedSpend: number;
	/** Daily average spend in current period */
	dailyAvgSpend: number;
	/** Days remaining in month */
	daysRemaining: number;
	/** Days elapsed with data */
	daysElapsed: number;
	/** Total spend so far */
	currentSpend: number;
	/** Burn rate: projected / budget (if budget provided) */
	burnRate: number | null;
	/** Status based on burn rate */
	status: 'on-track' | 'underspend' | 'overspend';
}

export function calculateBudgetBurnForecast(
	dailyData: DailyAggregate[],
	monthlyBudget?: number
): BudgetBurnForecast {
	if (dailyData.length === 0) {
		return {
			projectedSpend: 0, dailyAvgSpend: 0, daysRemaining: 0,
			daysElapsed: 0, currentSpend: 0, burnRate: null, status: 'on-track'
		};
	}

	const currentSpend = dailyData.reduce((sum, d) => sum + d.spend, 0);
	const daysElapsed = dailyData.length;
	const dailyAvgSpend = currentSpend / daysElapsed;

	// Calculate days remaining in month from today (not last data date)
	const today = new Date();
	const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
	const daysRemaining = Math.max(0, endOfMonth.getDate() - today.getDate());

	const projectedSpend = currentSpend + (dailyAvgSpend * daysRemaining);

	let burnRate: number | null = null;
	let status: BudgetBurnForecast['status'] = 'on-track';

	if (monthlyBudget && monthlyBudget > 0) {
		burnRate = projectedSpend / monthlyBudget;
		if (burnRate > 1.1) status = 'overspend';
		else if (burnRate < 0.8) status = 'underspend';
	}

	return { projectedSpend, dailyAvgSpend, daysRemaining, daysElapsed, currentSpend, burnRate, status };
}

// ============================================================
// 3. CPA Momentum
// ============================================================

export interface CpaMomentum {
	cpa1d: number | null;
	cpa7d: number | null;
	cpa30d: number | null;
	trend: 'improving' | 'stable' | 'degrading';
	message: string;
}

export function calculateCpaMomentum(dailyData: DailyAggregate[]): CpaMomentum {
	if (dailyData.length === 0) {
		return { cpa1d: null, cpa7d: null, cpa30d: null, trend: 'stable', message: 'Fără date' };
	}

	const cpaWindow = (days: number): number | null => {
		const slice = dailyData.slice(-days);
		const spend = slice.reduce((s, d) => s + d.spend, 0);
		const conv = slice.reduce((s, d) => s + d.conversions, 0);
		if (conv === 0) return null;
		return spend / conv;
	};

	const cpa1d = cpaWindow(1);
	const cpa7d = cpaWindow(7);
	const cpa30d = cpaWindow(Math.min(30, dailyData.length));

	let trend: CpaMomentum['trend'] = 'stable';
	let message = 'CPA stabil';

	if (cpa7d !== null && cpa30d !== null && cpa30d > 0) {
		const change = ((cpa7d - cpa30d) / cpa30d) * 100;
		if (change < -10) {
			trend = 'improving';
			message = `CPA în scădere cu ${Math.abs(change).toFixed(0)}% (7d vs 30d)`;
		} else if (change > 15) {
			trend = 'degrading';
			message = `CPA în creștere cu ${change.toFixed(0)}% (7d vs 30d)`;
		}
	}

	return { cpa1d, cpa7d, cpa30d, trend, message };
}

// ============================================================
// 4. Funnel Drop-off Analysis
// ============================================================

export interface FunnelStep {
	label: string;
	value: number;
	rate: number;      // conversion rate from previous step (%)
	dropOff: number;   // drop-off from previous step (%)
}

export interface FunnelAnalysis {
	steps: FunnelStep[];
	worstStep: string;   // label of step with biggest drop-off
	worstDropOff: number;
}

export function calculateFunnelAnalysis(campaigns: CampaignAggregate[]): FunnelAnalysis {
	const totals = campaigns.reduce(
		(acc, c) => ({
			impressions: acc.impressions + c.impressions,
			clicks: acc.clicks + c.clicks,
			linkClicks: acc.linkClicks + c.linkClicks,
			landingPageViews: acc.landingPageViews + c.landingPageViews,
			conversions: acc.conversions + c.conversions
		}),
		{ impressions: 0, clicks: 0, linkClicks: 0, landingPageViews: 0, conversions: 0 }
	);

	const rawSteps = [
		{ label: 'Impresii', value: totals.impressions },
		{ label: 'Click-uri', value: totals.clicks },
		{ label: 'Landing Page Views', value: totals.landingPageViews },
		{ label: 'Conversii', value: totals.conversions }
	];

	// Remove LPV step if no data
	const steps: FunnelStep[] = [];
	const filtered = rawSteps.filter((s, i) => i === 0 || s.value > 0 || i === rawSteps.length - 1);

	let worstStep = '';
	let worstDropOff = 0;

	for (let i = 0; i < filtered.length; i++) {
		const prev = i > 0 ? filtered[i - 1].value : filtered[i].value;
		const rate = prev > 0 ? (filtered[i].value / prev) * 100 : 0;
		const dropOff = i > 0 ? 100 - rate : 0;

		steps.push({
			label: filtered[i].label,
			value: filtered[i].value,
			rate: i === 0 ? 100 : rate,
			dropOff
		});

		if (dropOff > worstDropOff && i > 0) {
			worstDropOff = dropOff;
			worstStep = filtered[i].label;
		}
	}

	return { steps, worstStep, worstDropOff };
}

// ============================================================
// 5. Audience Saturation Matrix
// ============================================================

export type SaturationQuadrant = 'scale' | 'optimize' | 'refresh' | 'pause';

export interface SaturationPoint {
	campaignId: string;
	campaignName: string;
	frequency: number;
	ctr: number;
	spend: number;
	roas: number;
	costPerConversion: number;
	cpm: number;
	/** Index Performanță Eficiență (0-100) — axa Y */
	ipe: number;
	/** Index Saturație Cost (0-100) — axa X */
	isc: number;
	quadrant: SaturationQuadrant;
	recommendation: string;
	lowData: boolean;
}

export interface SaturationMatrix {
	points: SaturationPoint[];
	medianIpe: number;
	medianIsc: number;
}

/** Normalize a value to 0-1 using min-max scaling */
function normalize(value: number, min: number, max: number): number {
	if (max <= min) return 0.5;
	return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** Normalize inverted (lower is better) */
function normalizeInv(value: number, min: number, max: number): number {
	return 1 - normalize(value, min, max);
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

type ObjectiveCategory = 'sales' | 'leads' | 'traffic' | 'engagement' | 'awareness';

const OBJECTIVE_CATEGORY: Record<string, ObjectiveCategory> = {
	OUTCOME_SALES: 'sales',
	CONVERSIONS: 'sales',
	OUTCOME_LEADS: 'leads',
	LEAD_GENERATION: 'leads',
	OUTCOME_TRAFFIC: 'traffic',
	LINK_CLICKS: 'traffic',
	OUTCOME_ENGAGEMENT: 'engagement',
	POST_ENGAGEMENT: 'engagement',
	MESSAGES: 'engagement',
	OUTCOME_AWARENESS: 'awareness',
	REACH: 'awareness',
	BRAND_AWARENESS: 'awareness',
	VIDEO_VIEWS: 'awareness',
	OUTCOME_APP_PROMOTION: 'traffic',
	APP_INSTALLS: 'traffic'
};

function getObjectiveCategory(objective: string): ObjectiveCategory {
	return OBJECTIVE_CATEGORY[objective] || 'traffic';
}

export function calculateSaturationMatrix(campaigns: CampaignAggregate[]): SaturationMatrix {
	const eligible = campaigns.filter((c) => c.spend > 0 && c.impressions >= 1000);

	if (eligible.length === 0) {
		return { points: [], medianIpe: 50, medianIsc: 50 };
	}

	// Collect raw values for normalization bounds
	const safe = (arr: number[], fallback = 0.01) => arr.length > 0 ? arr : [fallback];
	const b = (arr: number[]) => ({ min: Math.min(...safe(arr)), max: Math.max(...safe(arr)) });

	const bounds = {
		roas: b(eligible.map((c) => c.roas)),
		ctr: b(eligible.map((c) => c.ctr)),
		cpa: b(eligible.filter((c) => c.costPerConversion > 0).map((c) => c.costPerConversion)),
		cpc: b(eligible.filter((c) => c.cpc > 0).map((c) => c.cpc)),
		cpm: b(eligible.map((c) => c.cpm)),
		freq: b(eligible.map((c) => c.frequency)),
		spr: b(eligible.filter((c) => c.reach > 0).map((c) => c.spend / c.reach)),
		reachRatio: b(eligible.filter((c) => c.impressions > 0).map((c) => c.reach / c.impressions)),
		conversions: b(eligible.map((c) => c.conversions)),
		lpvRatio: b(eligible.filter((c) => c.clicks > 0).map((c) => c.landingPageViews / c.clicks))
	};

	// Calculate IPE and ISC for each campaign
	const scored = eligible.map((c) => {
		const lowData = c.spend < 500;
		const category = getObjectiveCategory(c.objective);

		// IPE — Index Performanță Eficiență (higher = better)
		// Formula diferită per tip de obiectiv
		let ipe: number;
		switch (category) {
			case 'sales':
				// Sales: ROAS (40%) + CPA invers (30%) + CTR (30%)
				ipe = (
					normalize(c.roas, bounds.roas.min, bounds.roas.max) * 0.4 +
					(c.costPerConversion > 0 ? normalizeInv(c.costPerConversion, bounds.cpa.min, bounds.cpa.max) : 0.5) * 0.3 +
					normalize(c.ctr, bounds.ctr.min, bounds.ctr.max) * 0.3
				) * 100;
				break;
			case 'leads':
				// Leads: CPL invers (40%) + volum conversii (30%) + CTR (30%) — fără ROAS
				ipe = (
					(c.costPerConversion > 0 ? normalizeInv(c.costPerConversion, bounds.cpa.min, bounds.cpa.max) : 0.5) * 0.4 +
					normalize(c.conversions, bounds.conversions.min, bounds.conversions.max) * 0.3 +
					normalize(c.ctr, bounds.ctr.min, bounds.ctr.max) * 0.3
				) * 100;
				break;
			case 'traffic': {
				// Traffic: CPC invers (40%) + LPV ratio (30%) + CTR (30%)
				const lpvRatio = c.clicks > 0 ? c.landingPageViews / c.clicks : 0;
				ipe = (
					(c.cpc > 0 ? normalizeInv(c.cpc, bounds.cpc.min, bounds.cpc.max) : 0.5) * 0.4 +
					normalize(lpvRatio, bounds.lpvRatio.min, bounds.lpvRatio.max) * 0.3 +
					normalize(c.ctr, bounds.ctr.min, bounds.ctr.max) * 0.3
				) * 100;
				break;
			}
			case 'engagement':
				// Engagement: CPE invers (40%) + CTR (35%) + volum engagement (25%)
				ipe = (
					(c.costPerConversion > 0 ? normalizeInv(c.costPerConversion, bounds.cpa.min, bounds.cpa.max) : 0.5) * 0.4 +
					normalize(c.ctr, bounds.ctr.min, bounds.ctr.max) * 0.35 +
					normalize(c.conversions, bounds.conversions.min, bounds.conversions.max) * 0.25
				) * 100;
				break;
			case 'awareness': {
				// Awareness: reach ratio (40%) + CTR (30%) + CPM invers (30%)
				const reachRatio = c.impressions > 0 ? c.reach / c.impressions : 0;
				ipe = (
					normalize(reachRatio, bounds.reachRatio.min, bounds.reachRatio.max) * 0.4 +
					normalize(c.ctr, bounds.ctr.min, bounds.ctr.max) * 0.3 +
					normalizeInv(c.cpm, bounds.cpm.min, bounds.cpm.max) * 0.3
				) * 100;
				break;
			}
		}

		// ISC — Index Saturație Cost (higher = more saturated)
		const sprNorm = c.reach > 0
			? normalize(c.spend / c.reach, bounds.spr.min, bounds.spr.max)
			: 0.5;
		const isc = (
			normalize(c.frequency, bounds.freq.min, bounds.freq.max) * 0.5 +
			normalize(c.cpm, bounds.cpm.min, bounds.cpm.max) * 0.3 +
			sprNorm * 0.2
		) * 100;

		return { campaign: c, ipe, isc, lowData, category };
	});

	// Adaptive thresholds via median (exclude low-data campaigns to avoid skewing)
	const scoredForMedian = scored.filter((s) => !s.lowData);
	const medianIpe = median((scoredForMedian.length > 0 ? scoredForMedian : scored).map((s) => s.ipe));
	const medianIsc = median((scoredForMedian.length > 0 ? scoredForMedian : scored).map((s) => s.isc));

	const fmtRoas = (v: number) => v > 0 ? `${v.toFixed(1)}x` : '—';
	const fmtCur = (v: number) => `${v.toFixed(0)} RON`;
	const fmtPct = (v: number) => `${v.toFixed(2)}%`;
	const fmtNum = (v: number) => new Intl.NumberFormat('ro-RO').format(Math.round(v));

	/** Build the key metric string based on objective category */
	function perfMetrics(c: CampaignAggregate, cat: ObjectiveCategory): string {
		switch (cat) {
			case 'sales': return `ROAS ${fmtRoas(c.roas)}, CPA ${fmtCur(c.costPerConversion)}`;
			case 'leads': return `CPL ${fmtCur(c.costPerConversion)}, ${fmtNum(c.conversions)} leads`;
			case 'traffic': return `CPC ${fmtCur(c.cpc)}, CTR ${fmtPct(c.ctr)}`;
			case 'engagement': return `CPE ${fmtCur(c.costPerConversion)}, CTR ${fmtPct(c.ctr)}`;
			case 'awareness': return `CPM ${fmtCur(c.cpm)}, reach ${fmtNum(c.reach)}`;
		}
	}

	const points: SaturationPoint[] = scored.map(({ campaign: c, ipe, isc, lowData, category }) => {
		const highPerf = ipe >= medianIpe;
		const highSat = isc >= medianIsc;
		const perf = perfMetrics(c, category);

		let quadrant: SaturationQuadrant;
		let recommendation: string;

		if (lowData) {
			quadrant = highPerf ? 'scale' : 'optimize';
			recommendation = `Date insuficiente (${fmtCur(c.spend)} spend) — monitorizează`;
		} else if (highPerf && !highSat) {
			quadrant = 'scale';
			recommendation = `Crește bugetul — ${perf}, frequency doar ${c.frequency.toFixed(1)}`;
		} else if (highPerf && highSat) {
			quadrant = 'refresh';
			recommendation = `Rotește creative-urile — ${perf}, dar frequency ${c.frequency.toFixed(1)} saturată`;
		} else if (!highPerf && !highSat) {
			quadrant = 'optimize';
			recommendation = `Optimizează ad-ul — ${perf}, frequency ${c.frequency.toFixed(1)} ok dar performanță sub medie`;
		} else {
			quadrant = 'pause';
			recommendation = `Oprește sau resetează — ${perf}, frequency ${c.frequency.toFixed(1)}`;
		}

		return {
			campaignId: c.campaignId,
			campaignName: c.campaignName,
			frequency: c.frequency,
			ctr: c.ctr,
			spend: c.spend,
			roas: c.roas,
			costPerConversion: c.costPerConversion,
			cpm: c.cpm,
			ipe,
			isc,
			quadrant,
			recommendation,
			lowData
		};
	});

	return { points, medianIpe, medianIsc };
}

// ============================================================
// 6. Day-of-Week Performance Heatmap
// ============================================================

export interface DayOfWeekMetrics {
	day: number;         // 0=Sun, 1=Mon, ..., 6=Sat
	dayLabel: string;
	/** Most recent date for this day of week, e.g. "2026-03-23" */
	lastDate: string;
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	ctr: number;
	cpc: number;
	costPerConversion: number;
	/** Relative score 0-1 for heatmap color (1 = best day for this metric) */
	ctrScore: number;
	cpcScore: number;
	conversionScore: number;
}

const DAY_LABELS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];

export function calculateDayOfWeekPerformance(dailyData: DailyAggregate[]): DayOfWeekMetrics[] {
	// Group by day of week
	const byDay = new Map<number, { spend: number; impressions: number; clicks: number; conversions: number; days: number; lastDate: string }>();

	for (const d of dailyData) {
		const dayOfWeek = new Date(d.date).getDay();
		const existing = byDay.get(dayOfWeek) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, days: 0, lastDate: '' };
		existing.spend += d.spend;
		existing.impressions += d.impressions;
		existing.clicks += d.clicks;
		existing.conversions += d.conversions;
		existing.days += 1;
		if (d.date > existing.lastDate) existing.lastDate = d.date;
		byDay.set(dayOfWeek, existing);
	}

	const metrics: DayOfWeekMetrics[] = [];
	for (let day = 0; day < 7; day++) {
		const data = byDay.get(day);
		if (!data || data.days === 0) {
			metrics.push({
				day, dayLabel: DAY_LABELS[day], lastDate: '',
				spend: 0, impressions: 0, clicks: 0, conversions: 0,
				ctr: 0, cpc: 0, costPerConversion: 0,
				ctrScore: 0, cpcScore: 0, conversionScore: 0
			});
			continue;
		}
		metrics.push({
			day,
			dayLabel: DAY_LABELS[day],
			lastDate: data.lastDate,
			spend: data.spend / data.days,
			impressions: data.impressions / data.days,
			clicks: data.clicks / data.days,
			conversions: data.conversions / data.days,
			ctr: data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0,
			cpc: data.clicks > 0 ? data.spend / data.clicks : 0,
			costPerConversion: data.conversions > 0 ? data.spend / data.conversions : 0,
			ctrScore: 0, cpcScore: 0, conversionScore: 0  // filled below
		});
	}

	// Calculate relative scores (0-1, 1 = best)
	const ctrs = metrics.map((m) => m.ctr).filter((v) => v > 0);
	const cpcs = metrics.map((m) => m.cpc).filter((v) => v > 0);
	const convs = metrics.map((m) => m.conversions).filter((v) => v > 0);

	const maxCtr = Math.max(...ctrs, 0.001);
	const minCpc = Math.min(...cpcs, Infinity);
	const maxCpc = Math.max(...cpcs, 0.001);
	const maxConv = Math.max(...convs, 0.001);

	for (const m of metrics) {
		m.ctrScore = maxCtr > 0 ? m.ctr / maxCtr : (m.ctr > 0 ? 1 : 0);
		// CPC: lower is better → invert. If all same value, score = 1 (ok)
		m.cpcScore = m.cpc > 0 && maxCpc > minCpc
			? 1 - ((m.cpc - minCpc) / (maxCpc - minCpc))
			: (m.cpc > 0 ? 1 : 0);
		m.conversionScore = maxConv > 0 ? m.conversions / maxConv : (m.conversions > 0 ? 1 : 0);
	}

	// Reorder: Monday first
	return [...metrics.slice(1), metrics[0]];
}

// ============================================================
// 7. Executive Summary
// ============================================================

export interface ExecutiveSummary {
	healthScore: number;
	healthLevel: string;
	totalSpend: number;
	totalImpressions: number;
	totalConversions: number;
	avgCpm: number;
	avgCtr: number;
	topCampaigns: { name: string; spend: number; conversions: number; roas: number }[];
	topIssues: string[];
	recommendation: string;
}

export function generateExecutiveSummary(
	campaigns: CampaignAggregate[],
	healthScores: Map<string, { score: number; level: string; issues: string[] }>,
	fatigue: Map<string, CreativeFatigueResult>
): ExecutiveSummary {
	const active = campaigns.filter((c) => c.spend > 0);
	const totalSpend = active.reduce((s, c) => s + c.spend, 0);
	const totalImpressions = active.reduce((s, c) => s + c.impressions, 0);
	const totalClicks = active.reduce((s, c) => s + c.clicks, 0);
	const totalConversions = active.reduce((s, c) => s + c.conversions, 0);
	const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
	const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

	// Health score average (weighted by spend)
	let weightedHealth = 0;
	let healthWeight = 0;
	for (const c of active) {
		const hs = healthScores.get(c.campaignId);
		if (hs) {
			weightedHealth += hs.score * c.spend;
			healthWeight += c.spend;
		}
	}
	const healthScore = healthWeight > 0 ? Math.round(weightedHealth / healthWeight) : 0;
	const healthLevel = healthScore >= 80 ? 'Bun' : healthScore >= 50 ? 'Atenție' : 'Critic';

	// Top 3 campaigns by spend
	const topCampaigns = [...active]
		.sort((a, b) => b.spend - a.spend)
		.slice(0, 3)
		.map((c) => ({
			name: c.campaignName,
			spend: c.spend,
			conversions: c.conversions,
			roas: c.spend > 0 ? c.conversionValue / c.spend : 0
		}));

	// Collect issues from health scores and fatigue
	const issueCount = new Map<string, number>();
	for (const hs of healthScores.values()) {
		for (const issue of hs.issues) {
			issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
		}
	}
	let fatiguedCount = 0;
	for (const f of fatigue.values()) {
		if (f.level === 'fatigued') fatiguedCount++;
	}
	if (fatiguedCount > 0) {
		issueCount.set(`${fatiguedCount} campanii cu creative fatigue`, fatiguedCount);
	}

	const topIssues = [...issueCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([issue]) => issue);

	// Generate main recommendation
	let recommendation = 'Contul performează bine — menține strategia actuală.';
	if (healthScore < 50) {
		recommendation = 'Performanță critică — revizuiește bugetele și audiențele pe campaniile cu scor scăzut.';
	} else if (healthScore < 80) {
		if (fatiguedCount > 0) {
			recommendation = `Pregătește creative-uri noi pentru ${fatiguedCount} campanii obosite și optimizează CPA-ul.`;
		} else {
			recommendation = 'Performanță medie — focus pe optimizarea campaniilor cu Health Score sub 50.';
		}
	} else if (fatiguedCount > 0) {
		recommendation = `Performanță bună, dar ${fatiguedCount} campanii arată semne de oboseală — rotește creative-urile preventiv.`;
	}

	return {
		healthScore, healthLevel, totalSpend, totalImpressions, totalConversions, avgCpm, avgCtr,
		topCampaigns, topIssues, recommendation
	};
}

// ============================================================
// Helpers
// ============================================================

function avg(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((s, v) => s + v, 0) / values.length;
}
