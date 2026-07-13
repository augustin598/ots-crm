/** Helpers for the redesigned Facebook Ads report — format, metric aggregation,
 *  objective config and objective-aware KPI cards. Ported from the design's
 *  fb-report-presets.jsx but operating on the real CampaignAggregate shape. */
import type { CampaignAggregate } from '$lib/utils/report-helpers';
import { formatCurrency, formatPercent, formatNumber, formatDecimal, formatROAS } from '$lib/utils/report-helpers';

export { formatCurrency, formatPercent, formatNumber, formatDecimal, formatROAS };

const round = (n: number, d = 0) => {
	const f = 10 ** d;
	return Math.round(n * f) / f;
};

/** Compact number: 1.2M / 3.4k / 123. Returns "—" for 0/null. */
export function fmtCompact(n: number | null | undefined): string {
	if (n === 0 || n == null) return '—';
	if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
	if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'k';
	return Math.round(n).toLocaleString('ro-RO');
}

export interface RkMetrics {
	spend: number;
	impressions: number;
	reach: number;
	frequency: number;
	clicks: number;
	linkClicks: number;
	ctr: number;
	ctrLink: number;
	cpc: number;
	cpcAll: number;
	cpm: number;
	conversions: number;
	conversionValue: number;
	costPerConversion: number;
	roas: number;
	landingPageViews: number;
	costPerLPV: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
}

/** Aggregate a list of CampaignAggregate (or adset/ad) into one totals object, re-deriving ratios. */
export function aggregateMetrics(list: Array<Partial<CampaignAggregate>>): RkMetrics {
	const sum = (k: keyof CampaignAggregate) => list.reduce((s, m) => s + (Number(m[k]) || 0), 0);
	const spend = sum('spend'),
		impressions = sum('impressions'),
		reach = sum('reach'),
		clicks = sum('clicks'),
		linkClicks = sum('linkClicks'),
		conversions = sum('conversions'),
		conversionValue = sum('conversionValue'),
		landingPageViews = sum('landingPageViews');
	const r = (n: number, d: number) => (d > 0 ? n / d : 0);
	return {
		spend,
		impressions,
		reach,
		clicks,
		linkClicks,
		conversions,
		conversionValue,
		landingPageViews,
		frequency: r(impressions, reach),
		ctr: r(clicks, impressions) * 100,
		ctrLink: r(linkClicks, impressions) * 100,
		cpc: r(spend, linkClicks),
		cpcAll: r(spend, clicks),
		cpm: r(spend, impressions) * 1000,
		costPerConversion: r(spend, conversions),
		roas: r(conversionValue, spend),
		costPerLPV: r(spend, landingPageViews),
		pageEngagement: sum('pageEngagement'),
		postReactions: sum('postReactions'),
		postComments: sum('postComments'),
		postSaves: sum('postSaves'),
		postShares: sum('postShares'),
		videoViews: sum('videoViews'),
		callsPlaced: sum('callsPlaced')
	};
}

/* ---- Objective config (label / rk color key / icon name) ---- */
export interface ObjectiveConfig {
	label: string;
	color: string; // rk color key: blue|orange|green|cyan|pink|purple|amber|violet|gray
	icon: string; // RK_ICONS key
}
const OBJECTIVE_CONFIG: Record<string, ObjectiveConfig> = {
	OUTCOME_LEADS: { label: 'Leads', color: 'blue', icon: 'UserPlus' },
	LEAD_GENERATION: { label: 'Leads', color: 'blue', icon: 'UserPlus' },
	OUTCOME_TRAFFIC: { label: 'Trafic', color: 'orange', icon: 'MousePointer' },
	LINK_CLICKS: { label: 'Trafic', color: 'orange', icon: 'MousePointer' },
	OUTCOME_SALES: { label: 'Vânzări', color: 'green', icon: 'ShoppingBag' },
	CONVERSIONS: { label: 'Vânzări', color: 'green', icon: 'ShoppingBag' },
	OUTCOME_AWARENESS: { label: 'Awareness', color: 'cyan', icon: 'Megaphone' },
	REACH: { label: 'Reach', color: 'cyan', icon: 'Megaphone' },
	OUTCOME_ENGAGEMENT: { label: 'Engagement', color: 'pink', icon: 'Heart' },
	POST_ENGAGEMENT: { label: 'Engagement', color: 'pink', icon: 'Heart' },
	OUTCOME_VIDEO: { label: 'Video', color: 'purple', icon: 'Video' },
	VIDEO_VIEWS: { label: 'Video', color: 'purple', icon: 'Video' },
	OUTCOME_APP_PROMOTION: { label: 'App', color: 'violet', icon: 'Download' },
	APP_INSTALLS: { label: 'App', color: 'violet', icon: 'Download' },
	OUTCOME_MESSAGES: { label: 'Mesaje', color: 'violet', icon: 'MessageCircle' },
	MESSAGES: { label: 'Mesaje', color: 'violet', icon: 'MessageCircle' },
	OUTCOME_CALLS: { label: 'Apeluri', color: 'amber', icon: 'Phone' },
	CALLS: { label: 'Apeluri', color: 'amber', icon: 'Phone' }
};
export function getObjectiveConfig(objective: string): ObjectiveConfig {
	return OBJECTIVE_CONFIG[objective] || { label: objective || 'Altele', color: 'gray', icon: 'Target' };
}

/* ---- KPI cards ---- */
/** Polarity decides delta color: good = ↑green/↓red, bad (cost) = ↑red/↓green, neutral = gray. */
export type KpiPolarity = 'good' | 'bad' | 'neutral';
export interface RkKpi {
	label: string;
	value: string;
	icon: string;
	sub: string;
	change: number | null;
	polarity: KpiPolarity;
}
const pct = (c: number, p: number): number | null => (p > 0 ? round(((c - p) / p) * 100, 1) : null);

/** Map a real Meta objective to the design's KPI objective key (for objective-aware cards). */
function normObjective(objective: string): string {
	const cfg = getObjectiveConfig(objective);
	switch (cfg.label) {
		case 'Leads':
			return 'OUTCOME_LEADS';
		case 'Trafic':
			return 'OUTCOME_TRAFFIC';
		case 'Vânzări':
			return 'OUTCOME_SALES';
		case 'Awareness':
		case 'Reach':
			return 'OUTCOME_AWARENESS';
		case 'Engagement':
			return 'OUTCOME_ENGAGEMENT';
		case 'Video':
			return 'OUTCOME_VIDEO';
		case 'Mesaje':
			return 'OUTCOME_MESSAGES';
		case 'Apeluri':
			return 'OUTCOME_CALLS';
		default:
			return '';
	}
}

export function getObjectiveKpis(objective: string, m: RkMetrics, prev: RkMetrics, cur: string): RkKpi[] | null {
	const card = (label: string, value: string, icon: string, sub: string, change: number | null, polarity: KpiPolarity = 'good'): RkKpi => ({ label, value, icon, sub, change, polarity });
	const key = normObjective(objective);
	const base: Record<string, RkKpi[]> = {
		OUTCOME_CALLS: [
			card('Apeluri', fmtCompact(m.callsPlaced), 'Phone', 'Click-to-call', pct(m.callsPlaced, prev.callsPlaced)),
			card('Cost/apel', formatCurrency(m.costPerConversion, cur), 'DollarSign', 'Per call placed', pct(m.costPerConversion, prev.costPerConversion), 'bad'),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.impressions) + ' impresii', pct(m.spend, prev.spend), 'neutral'),
			card('CTR (link)', formatPercent(m.ctrLink), 'Activity', fmtCompact(m.linkClicks) + ' click-uri', pct(m.ctrLink, prev.ctrLink)),
			card('CPM', formatCurrency(m.cpm, cur), 'Eye', 'Cost / 1000', pct(m.cpm, prev.cpm), 'bad')
		],
		OUTCOME_LEADS: [
			card('Lead-uri', fmtCompact(m.conversions), 'UserPlus', 'Total lead-uri', pct(m.conversions, prev.conversions)),
			card('Cost/lead', formatCurrency(m.costPerConversion, cur), 'DollarSign', 'Per lead', pct(m.costPerConversion, prev.costPerConversion), 'bad'),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.impressions) + ' impresii', pct(m.spend, prev.spend), 'neutral'),
			card('CTR (link)', formatPercent(m.ctrLink), 'Activity', fmtCompact(m.linkClicks) + ' click-uri', pct(m.ctrLink, prev.ctrLink)),
			card('Viz. pagină', fmtCompact(m.landingPageViews), 'FileText', formatCurrency(m.costPerLPV, cur) + ' /viz.', pct(m.landingPageViews, prev.landingPageViews))
		],
		OUTCOME_SALES: [
			card('Achiziții', fmtCompact(m.conversions), 'ShoppingBag', 'Conversii', pct(m.conversions, prev.conversions)),
			card('ROAS', formatROAS(m.roas), 'TrendingUp', 'Return on ad spend', pct(m.roas, prev.roas)),
			card('Valoare', formatCurrency(m.conversionValue, cur), 'DollarSign', 'Venit atribuit', pct(m.conversionValue, prev.conversionValue)),
			card('Cost/achiziție', formatCurrency(m.costPerConversion, cur), 'DollarSign', 'CPA', pct(m.costPerConversion, prev.costPerConversion), 'bad'),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.linkClicks) + ' click-uri', pct(m.spend, prev.spend), 'neutral')
		],
		OUTCOME_TRAFFIC: [
			card('Click-uri link', fmtCompact(m.linkClicks), 'MousePointer', 'Trafic', pct(m.linkClicks, prev.linkClicks)),
			card('CPC', formatCurrency(m.cpc, cur), 'DollarSign', 'Per click', pct(m.cpc, prev.cpc), 'bad'),
			card('CTR (link)', formatPercent(m.ctrLink), 'Activity', 'Click-through', pct(m.ctrLink, prev.ctrLink)),
			card('Viz. pagină', fmtCompact(m.landingPageViews), 'FileText', formatCurrency(m.costPerLPV, cur) + ' /viz.', pct(m.landingPageViews, prev.landingPageViews)),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.impressions) + ' impresii', pct(m.spend, prev.spend), 'neutral')
		],
		OUTCOME_AWARENESS: [
			card('Reach', fmtCompact(m.reach), 'Users', 'Persoane unice', pct(m.reach, prev.reach)),
			card('Impresii', fmtCompact(m.impressions), 'Eye', 'Afișări', pct(m.impressions, prev.impressions)),
			card('Frecvență', formatDecimal(m.frequency), 'Repeat', 'Per persoană', pct(m.frequency, prev.frequency), 'bad'),
			card('CPM', formatCurrency(m.cpm, cur), 'DollarSign', 'Cost / 1000', pct(m.cpm, prev.cpm), 'bad'),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.videoViews) + ' video views', pct(m.spend, prev.spend), 'neutral')
		],
		OUTCOME_ENGAGEMENT: [
			card('Interacțiuni', fmtCompact(m.pageEngagement), 'Heart', 'Total engagement', pct(m.pageEngagement, prev.pageEngagement)),
			card('Reacții', fmtCompact(m.postReactions), 'ThumbsUp', 'Like & reactions', pct(m.postReactions, prev.postReactions)),
			card('Salvări', fmtCompact(m.postSaves), 'Star', 'Saves', pct(m.postSaves, prev.postSaves)),
			card('Distribuiri', fmtCompact(m.postShares), 'Send', 'Shares', pct(m.postShares, prev.postShares)),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.impressions) + ' impresii', pct(m.spend, prev.spend), 'neutral')
		],
		OUTCOME_VIDEO: [
			card('Video views', fmtCompact(m.videoViews), 'Video', 'ThruPlays', pct(m.videoViews, prev.videoViews)),
			card('Cost/view', formatCurrency(m.videoViews > 0 ? m.spend / m.videoViews : 0, cur), 'DollarSign', 'Per ThruPlay', null, 'bad'),
			card('Reach', fmtCompact(m.reach), 'Users', 'Persoane unice', pct(m.reach, prev.reach)),
			card('CPM', formatCurrency(m.cpm, cur), 'Eye', 'Cost / 1000', pct(m.cpm, prev.cpm), 'bad'),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.impressions) + ' impresii', pct(m.spend, prev.spend), 'neutral')
		],
		OUTCOME_MESSAGES: [
			card('Conversații', fmtCompact(m.conversions), 'MessageCircle', 'Mesaje pornite', pct(m.conversions, prev.conversions)),
			card('Cost/conversație', formatCurrency(m.costPerConversion, cur), 'DollarSign', 'Per conversație', pct(m.costPerConversion, prev.costPerConversion), 'bad'),
			card('Click-uri link', fmtCompact(m.linkClicks), 'MousePointer', 'Trafic', pct(m.linkClicks, prev.linkClicks)),
			card('CTR (link)', formatPercent(m.ctrLink), 'Activity', 'Click-through', pct(m.ctrLink, prev.ctrLink)),
			card('Cheltuieli', formatCurrency(m.spend, cur), 'DollarSign', fmtCompact(m.impressions) + ' impresii', pct(m.spend, prev.spend), 'neutral')
		]
	};
	return base[key] || null;
}

export function getDefaultKpis(m: RkMetrics, prev: RkMetrics, cur: string): RkKpi[] {
	return [
		{ label: 'Cheltuieli totale', value: formatCurrency(m.spend, cur), icon: 'DollarSign', sub: fmtCompact(m.impressions) + ' impresii', change: pct(m.spend, prev.spend), polarity: 'neutral' },
		{ label: 'CPM', value: formatCurrency(m.cpm, cur), icon: 'Eye', sub: 'Cost / 1000 impresii', change: pct(m.cpm, prev.cpm), polarity: 'bad' },
		{ label: 'CPC', value: formatCurrency(m.cpc, cur), icon: 'MousePointer', sub: fmtCompact(m.linkClicks) + ' click-uri', change: pct(m.cpc, prev.cpc), polarity: 'bad' },
		{ label: 'CTR', value: formatPercent(m.ctr), icon: 'Activity', sub: 'Click-through rate', change: pct(m.ctr, prev.ctr), polarity: 'good' },
		{ label: 'Reach', value: fmtCompact(m.reach), icon: 'Users', sub: formatDecimal(m.frequency) + ' frecvență', change: pct(m.reach, prev.reach), polarity: 'good' }
	];
}

/** Romanian short date e.g. "7 iun" / full "7 iunie 2026". */
const MONTHS_SHORT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_RO = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
export const fmtDateShort = (s: string) => +s.slice(8) + ' ' + MONTHS_SHORT[+s.slice(5, 7) - 1];
export const fmtDateRo = (s: string) => +s.slice(8) + ' ' + MONTHS_RO[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4);
