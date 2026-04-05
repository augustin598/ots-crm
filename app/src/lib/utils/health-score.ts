import type { CampaignAggregate } from './report-helpers';

export interface HealthScoreResult {
	score: number;
	level: 'good' | 'warning' | 'critical';
	issues: string[];
}

// ---- Objective normalization (legacy → modern) ----

const LEGACY_TO_MODERN: Record<string, string> = {
	LINK_CLICKS: 'OUTCOME_TRAFFIC',
	LEAD_GENERATION: 'OUTCOME_LEADS',
	CONVERSIONS: 'OUTCOME_SALES',
	POST_ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
	REACH: 'OUTCOME_AWARENESS',
	BRAND_AWARENESS: 'OUTCOME_AWARENESS',
	VIDEO_VIEWS: 'OUTCOME_AWARENESS',
	MESSAGES: 'OUTCOME_ENGAGEMENT',
	APP_INSTALLS: 'OUTCOME_TRAFFIC'
};

function normalizeObjective(objective: string): string {
	if (objective.startsWith('OUTCOME_')) return objective;
	return LEGACY_TO_MODERN[objective] || 'GENERIC';
}

// ---- Metric check definition ----

interface MetricCheck {
	/** Key from CampaignAggregate, or 'computed:lpvRatio' / 'computed:reachRatio' for derived */
	metric: string;
	/** Threshold for "good" performance */
	threshold: number;
	/** 'above' = higher is better (CTR, ROAS), 'below' = lower is better (CPC, CPM, freq) */
	direction: 'above' | 'below';
	/** Max points for this metric (primary=25, secondary=15) */
	weight: number;
	/** Issue text in Romanian with recommendation */
	issue: string;
}

// ---- Benchmarks per objective ----

const BENCHMARKS: Record<string, MetricCheck[]> = {
	OUTCOME_TRAFFIC: [
		// Primary (25 pts each)
		{ metric: 'ctr', threshold: 0.8, direction: 'above', weight: 25, issue: 'CTR sub medie — testează creative-uri noi sau ajustează audiența' },
		{ metric: 'cpc', threshold: 2, direction: 'below', weight: 25, issue: 'CPC prea mare — restrânge audiența sau ajustează licitarea' },
		// Secondary (15 pts each, total 45 → but we cap redistribution)
		{ metric: 'frequency', threshold: 3, direction: 'below', weight: 15, issue: 'Frecvență prea mare — extinde audiența sau rotește creative-urile' },
		{ metric: 'cpm', threshold: 40, direction: 'below', weight: 15, issue: 'CPM ridicat — verifică targetarea și plasamentele' },
		{ metric: 'computed:lpvRatio', threshold: 0.5, direction: 'above', weight: 20, issue: 'Rată landing page views scăzută — verifică viteza site-ului' }
	],
	OUTCOME_LEADS: [
		{ metric: 'costPerConversion', threshold: 50, direction: 'below', weight: 25, issue: 'CPL prea mare — optimizează formularul sau audiența' },
		{ metric: 'ctr', threshold: 0.8, direction: 'above', weight: 25, issue: 'CTR sub medie — testează creative-uri noi' },
		{ metric: 'cpc', threshold: 3, direction: 'below', weight: 15, issue: 'CPC prea mare — ajustează licitarea' },
		{ metric: 'frequency', threshold: 3, direction: 'below', weight: 15, issue: 'Frecvență prea mare — extinde audiența sau rotește creative-urile' },
		{ metric: 'cpm', threshold: 40, direction: 'below', weight: 20, issue: 'CPM ridicat — verifică targetarea și plasamentele' }
	],
	OUTCOME_SALES: [
		{ metric: 'roas', threshold: 3, direction: 'above', weight: 25, issue: 'ROAS slab — optimizează funnel-ul sau ajustează bugetul' },
		{ metric: 'costPerConversion', threshold: 100, direction: 'below', weight: 25, issue: 'CPA prea mare — îmbunătățește rata de conversie' },
		{ metric: 'ctr', threshold: 0.8, direction: 'above', weight: 15, issue: 'CTR sub medie — testează creative-uri noi' },
		{ metric: 'cpc', threshold: 3, direction: 'below', weight: 15, issue: 'CPC prea mare — ajustează licitarea' },
		{ metric: 'frequency', threshold: 3, direction: 'below', weight: 20, issue: 'Frecvență prea mare — extinde audiența sau rotește creative-urile' }
	],
	OUTCOME_ENGAGEMENT: [
		{ metric: 'costPerConversion', threshold: 0.5, direction: 'below', weight: 25, issue: 'Cost per engagement prea mare — testează conținut mai atractiv' },
		{ metric: 'ctr', threshold: 2, direction: 'above', weight: 25, issue: 'CTR sub medie — creative-urile nu atrag atenția' },
		{ metric: 'cpc', threshold: 1, direction: 'below', weight: 15, issue: 'CPC prea mare — ajustează licitarea' },
		{ metric: 'frequency', threshold: 3, direction: 'below', weight: 15, issue: 'Frecvență prea mare — extinde audiența' },
		{ metric: 'cpm', threshold: 25, direction: 'below', weight: 20, issue: 'CPM ridicat — verifică plasamentele' }
	],
	OUTCOME_AWARENESS: [
		{ metric: 'cpm', threshold: 30, direction: 'below', weight: 25, issue: 'CPM ridicat — verifică targetarea și plasamentele' },
		{ metric: 'frequency', threshold: 3.5, direction: 'below', weight: 25, issue: 'Frecvență prea mare — extinde audiența' },
		{ metric: 'ctr', threshold: 0.3, direction: 'above', weight: 15, issue: 'CTR foarte scăzut — creative-urile nu generează interes' },
		{ metric: 'computed:reachRatio', threshold: 0.4, direction: 'above', weight: 15, issue: 'Reach/Impressions scăzut — audiența e prea mică' },
		{ metric: 'impressions', threshold: 5000, direction: 'above', weight: 20, issue: 'Volum prea mic de impresii — crește bugetul' }
	],
	GENERIC: [
		{ metric: 'ctr', threshold: 0.5, direction: 'above', weight: 25, issue: 'CTR sub medie — testează creative-uri noi' },
		{ metric: 'costPerConversion', threshold: 200, direction: 'below', weight: 25, issue: 'Cost per conversie prea mare — optimizează funnel-ul' },
		{ metric: 'cpc', threshold: 5, direction: 'below', weight: 15, issue: 'CPC prea mare — ajustează licitarea' },
		{ metric: 'cpm', threshold: 50, direction: 'below', weight: 15, issue: 'CPM ridicat — verifică targetarea' },
		{ metric: 'frequency', threshold: 4, direction: 'below', weight: 20, issue: 'Frecvență prea mare — extinde audiența' }
	]
};

// ---- Metric value resolver ----

function getMetricValue(campaign: CampaignAggregate, metric: string): number | null {
	if (metric === 'computed:lpvRatio') {
		if (campaign.clicks <= 0) return null;
		return campaign.landingPageViews / campaign.clicks;
	}
	if (metric === 'computed:reachRatio') {
		if (campaign.impressions <= 0) return null;
		return campaign.reach / campaign.impressions;
	}
	const val = (campaign as unknown as Record<string, unknown>)[metric];
	if (typeof val !== 'number' || !isFinite(val)) return null;
	return val;
}

/** Check if metric has enough data to be meaningful */
function isMetricApplicable(campaign: CampaignAggregate, metric: string): boolean {
	const val = getMetricValue(campaign, metric);
	if (val === null) return false;
	// Cost metrics need spend > 0
	if (['cpc', 'cpm', 'costPerConversion', 'roas'].includes(metric)) {
		return campaign.spend > 0;
	}
	// CTR needs impressions
	if (metric === 'ctr') return campaign.impressions > 0;
	// Computed ratios already check denominators
	if (metric.startsWith('computed:')) return true;
	return true;
}

// ---- Formatting ----

function formatMetricValue(metric: string, value: number): string {
	if (metric === 'ctr') return `${value.toFixed(2)}%`;
	if (metric === 'roas') return `${value.toFixed(1)}x`;
	if (metric === 'frequency') return value.toFixed(2);
	if (metric === 'impressions') return new Intl.NumberFormat('ro-RO').format(Math.round(value));
	if (metric === 'computed:lpvRatio' || metric === 'computed:reachRatio') return `${(value * 100).toFixed(1)}%`;
	if (['cpc', 'cpm', 'costPerConversion'].includes(metric)) return `${value.toFixed(2)} RON`;
	return value.toFixed(2);
}

// ---- Scoring functions ----

function scoreMetric(value: number, threshold: number, direction: 'above' | 'below', maxPoints: number): number {
	if (direction === 'above') {
		// Higher is better: 0 at value=0, maxPoints at value>=threshold
		if (value >= threshold) return maxPoints;
		if (value <= 0) return 0;
		return (value / threshold) * maxPoints;
	}
	// Lower is better: maxPoints at value<=threshold, 0 at value>=2×threshold
	if (value <= threshold) return maxPoints;
	const badThreshold = threshold * 2;
	if (value >= badThreshold) return 0;
	return ((badThreshold - value) / (badThreshold - threshold)) * maxPoints;
}

export function calculateHealthScore(campaign: CampaignAggregate): HealthScoreResult {
	// Pre-filters
	if (campaign.spend <= 0 || campaign.impressions < 1000) {
		return { score: 0, level: 'critical', issues: ['Date insuficiente pentru evaluare'] };
	}

	const objective = normalizeObjective(campaign.objective);
	const checks = BENCHMARKS[objective] || BENCHMARKS.GENERIC;

	// Filter applicable metrics and redistribute weights
	const applicable = checks.filter((c) => isMetricApplicable(campaign, c.metric));
	if (applicable.length === 0) {
		return { score: 0, level: 'critical', issues: ['Nu s-au putut evalua metricile'] };
	}

	const totalOriginalWeight = applicable.reduce((sum, c) => sum + c.weight, 0);
	const scaleFactor = totalOriginalWeight > 0 ? 100 / totalOriginalWeight : 1;

	let totalScore = 0;
	const issues: string[] = [];

	for (const check of applicable) {
		const value = getMetricValue(campaign, check.metric)!;
		const scaledWeight = check.weight * scaleFactor;
		const metricScore = scoreMetric(value, check.threshold, check.direction, scaledWeight);
		totalScore += metricScore;

		// Add issue with real data if score < 50% of max for this metric
		if (metricScore < scaledWeight * 0.5) {
			const actual = formatMetricValue(check.metric, value);
			const target = formatMetricValue(check.metric, check.threshold);
			const direction = check.direction === 'above' ? '↑' : '↓';
			issues.push(`${check.issue} (actual: ${actual}, target: ${direction} ${target})`);
		}
	}

	const score = Math.round(Math.min(100, Math.max(0, totalScore)));
	const level: HealthScoreResult['level'] =
		score >= 80 ? 'good' : score >= 50 ? 'warning' : 'critical';

	return { score, level, issues };
}

export function calculateAverageHealthScore(campaigns: CampaignAggregate[]): HealthScoreResult {
	const eligible = campaigns.filter((c) => c.spend > 0 && c.impressions >= 1000);
	if (eligible.length === 0) {
		return { score: 0, level: 'critical', issues: ['Nicio campanie eligibilă'] };
	}

	const totalSpend = eligible.reduce((sum, c) => sum + c.spend, 0);
	let weightedScore = 0;
	const allIssues = new Map<string, number>(); // issue → count

	for (const campaign of eligible) {
		const result = calculateHealthScore(campaign);
		const weight = totalSpend > 0 ? campaign.spend / totalSpend : 1 / eligible.length;
		weightedScore += result.score * weight;

		for (const issue of result.issues) {
			allIssues.set(issue, (allIssues.get(issue) || 0) + 1);
		}
	}

	const score = Math.round(weightedScore);
	const level: HealthScoreResult['level'] =
		score >= 80 ? 'good' : score >= 50 ? 'warning' : 'critical';

	// Top 3 most common issues
	const topIssues = [...allIssues.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([issue, count]) => count > 1 ? `${issue} (${count} campanii)` : issue);

	return { score, level, issues: topIssues };
}
