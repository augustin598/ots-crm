import type { DailyAggregate } from './report-helpers';
import { formatCurrency, formatNumber, formatPercent, formatDecimal, formatROAS } from './report-helpers';

// ---- Chart spec types ----

export interface ChartDatasetSpec {
	label: string;
	key: keyof DailyAggregate;
	type: 'bar' | 'line';
	yAxisID: 'y' | 'y1';
	color: string;
	fillColor?: string;
	order?: number;
}

export interface ChartAxisSpec {
	label: string;
	formatter: (value: number, currency: string) => string;
}

export interface ChartSpec {
	title: string;
	datasets: ChartDatasetSpec[];
	yAxis: ChartAxisSpec;
	y1Axis?: ChartAxisSpec;
}

// ---- Color palette ----

const COLORS = {
	blue: { border: 'rgb(59, 130, 246)', fill: 'rgba(59, 130, 246, 0.2)' },
	green: { border: 'rgb(16, 185, 129)', fill: 'rgba(16, 185, 129, 0.2)' },
	orange: { border: 'rgb(249, 115, 22)', fill: 'rgba(249, 115, 22, 0.15)' },
	purple: { border: 'rgb(139, 92, 246)', fill: 'rgba(139, 92, 246, 0.15)' },
	pink: { border: 'rgb(236, 72, 153)', fill: 'rgba(236, 72, 153, 0.15)' },
	cyan: { border: 'rgb(6, 182, 212)', fill: 'rgba(6, 182, 212, 0.15)' },
	amber: { border: 'rgb(245, 158, 11)', fill: 'rgba(245, 158, 11, 0.15)' }
};

// ---- Formatters ----

const fmtNum = (v: number) => formatNumber(v);
const fmtCur = (v: number, c: string) => formatCurrency(v, c);
const fmtPct = (v: number) => formatPercent(v);
const fmtDec = (v: number) => formatDecimal(v);
const fmtRoas = (v: number) => formatROAS(v);

// ---- Objective → Chart specs ----

export const OBJECTIVE_CHARTS: Record<string, ChartSpec[]> = {
	OUTCOME_AWARENESS: [
		{
			title: 'Reach & Impresii în timp',
			datasets: [
				{ label: 'Reach', key: 'reach', type: 'bar', yAxisID: 'y', color: COLORS.cyan.border, fillColor: COLORS.cyan.fill, order: 2 },
				{ label: 'Impresii', key: 'impressions', type: 'line', yAxisID: 'y1', color: COLORS.blue.border, order: 1 }
			],
			yAxis: { label: 'Reach', formatter: fmtNum },
			y1Axis: { label: 'Impresii', formatter: fmtNum }
		},
		{
			title: 'CPM & Frecvență în timp',
			datasets: [
				{ label: 'CPM', key: 'cpm', type: 'line', yAxisID: 'y', color: COLORS.orange.border, order: 1 },
				{ label: 'Frecvență', key: 'frequency', type: 'line', yAxisID: 'y1', color: COLORS.purple.border, order: 2 }
			],
			yAxis: { label: 'CPM', formatter: fmtCur },
			y1Axis: { label: 'Frecvență', formatter: fmtDec }
		}
	],

	OUTCOME_TRAFFIC: [
		{
			title: 'Link Clicks & Landing Page Views în timp',
			datasets: [
				{ label: 'Link clicks', key: 'linkClicks', type: 'bar', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 2 },
				{ label: 'Landing page views', key: 'landingPageViews', type: 'line', yAxisID: 'y', color: COLORS.green.border, order: 1 }
			],
			yAxis: { label: 'Clicks / Views', formatter: fmtNum }
		},
		{
			title: 'CPC & CTR în timp',
			datasets: [
				{ label: 'CPC (link)', key: 'cpc', type: 'line', yAxisID: 'y', color: COLORS.orange.border, order: 1 },
				{ label: 'CTR (link)', key: 'ctrLink', type: 'line', yAxisID: 'y1', color: COLORS.purple.border, order: 2 }
			],
			yAxis: { label: 'CPC', formatter: fmtCur },
			y1Axis: { label: 'CTR link (%)', formatter: fmtPct }
		}
	],

	OUTCOME_ENGAGEMENT: [
		{
			title: 'Engagement în timp',
			datasets: [
				{ label: 'Engagement total', key: 'pageEngagement', type: 'bar', yAxisID: 'y', color: COLORS.pink.border, fillColor: COLORS.pink.fill, order: 2 },
				{ label: 'Reacții', key: 'postReactions', type: 'line', yAxisID: 'y', color: COLORS.amber.border, order: 1 }
			],
			yAxis: { label: 'Engagement', formatter: fmtNum }
		},
		{
			title: 'Shares & Comentarii în timp',
			datasets: [
				{ label: 'Shares', key: 'postShares', type: 'bar', yAxisID: 'y', color: COLORS.purple.border, fillColor: COLORS.purple.fill, order: 2 },
				{ label: 'Comentarii', key: 'postComments', type: 'line', yAxisID: 'y', color: COLORS.amber.border, order: 1 }
			],
			yAxis: { label: 'Interacțiuni', formatter: fmtNum }
		}
	],

	OUTCOME_LEADS: [
		{
			title: 'Leads & Cost per lead în timp',
			datasets: [
				{ label: 'Leads', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 2 },
				{ label: 'Cost/lead', key: 'costPerConversion', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Leads', formatter: fmtNum },
			y1Axis: { label: 'Cost/lead', formatter: fmtCur }
		},
		{
			title: 'Link Clicks & Landing Page Views în timp',
			datasets: [
				{ label: 'Link clicks', key: 'linkClicks', type: 'bar', yAxisID: 'y', color: COLORS.cyan.border, fillColor: COLORS.cyan.fill, order: 2 },
				{ label: 'Landing page views', key: 'landingPageViews', type: 'line', yAxisID: 'y', color: COLORS.green.border, order: 1 }
			],
			yAxis: { label: 'Clicks / Views', formatter: fmtNum }
		}
	],

	OUTCOME_SALES: [
		{
			title: 'Vânzări & ROAS în timp',
			datasets: [
				{ label: 'Vânzări', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.green.border, fillColor: COLORS.green.fill, order: 2 },
				{ label: 'ROAS', key: 'roas', type: 'line', yAxisID: 'y1', color: COLORS.amber.border, order: 1 }
			],
			yAxis: { label: 'Vânzări', formatter: fmtNum },
			y1Axis: { label: 'ROAS', formatter: fmtRoas }
		},
		{
			title: 'Venituri & Cost per conversie în timp',
			datasets: [
				{ label: 'Venituri', key: 'conversionValue', type: 'bar', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 2 },
				{ label: 'Cost/conversie', key: 'costPerConversion', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Venituri', formatter: fmtCur },
			y1Axis: { label: 'Cost/conversie', formatter: fmtCur }
		}
	],

	OUTCOME_APP_PROMOTION: [
		{
			title: 'Installs & Cost/install în timp',
			datasets: [
				{ label: 'Installs', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.green.border, fillColor: COLORS.green.fill, order: 2 },
				{ label: 'Cost/install', key: 'costPerConversion', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Installs', formatter: fmtNum },
			y1Axis: { label: 'Cost/install', formatter: fmtCur }
		},
		{
			title: 'Cheltuieli & CTR în timp',
			datasets: [
				{ label: 'Cheltuieli', key: 'spend', type: 'line', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 1 },
				{ label: 'CTR', key: 'ctr', type: 'line', yAxisID: 'y1', color: COLORS.purple.border, order: 2 }
			],
			yAxis: { label: 'Cheltuieli', formatter: fmtCur },
			y1Axis: { label: 'CTR (%)', formatter: fmtPct }
		}
	]
};

// Legacy objective aliases
OBJECTIVE_CHARTS['REACH'] = OBJECTIVE_CHARTS['OUTCOME_AWARENESS'];
OBJECTIVE_CHARTS['BRAND_AWARENESS'] = OBJECTIVE_CHARTS['OUTCOME_AWARENESS'];
OBJECTIVE_CHARTS['LINK_CLICKS'] = OBJECTIVE_CHARTS['OUTCOME_TRAFFIC'];
OBJECTIVE_CHARTS['POST_ENGAGEMENT'] = OBJECTIVE_CHARTS['OUTCOME_ENGAGEMENT'];
OBJECTIVE_CHARTS['LEAD_GENERATION'] = OBJECTIVE_CHARTS['OUTCOME_LEADS'];
OBJECTIVE_CHARTS['CONVERSIONS'] = OBJECTIVE_CHARTS['OUTCOME_SALES'];
OBJECTIVE_CHARTS['APP_INSTALLS'] = OBJECTIVE_CHARTS['OUTCOME_APP_PROMOTION'];

/** Default charts (spend + conversions) when mixed or unknown objective */
export const DEFAULT_CHARTS: ChartSpec[] = [
	{
		title: 'Cheltuieli în timp',
		datasets: [
			{ label: 'Cheltuieli', key: 'spend', type: 'line', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 1 }
		],
		yAxis: { label: 'Cheltuieli', formatter: fmtCur }
	},
	{
		title: 'Conversii & Cost/conversie în timp',
		datasets: [
			{ label: 'Conversii', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.green.border, fillColor: COLORS.green.fill, order: 2 },
			{ label: 'Cost/conversie', key: 'costPerConversion', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
		],
		yAxis: { label: 'Conversii', formatter: fmtNum },
		y1Axis: { label: 'Cost/conversie', formatter: fmtCur }
	}
];

/** Get chart specs for an objective. Returns DEFAULT_CHARTS for mixed/unknown. */
export function getChartsForObjective(objective: string): ChartSpec[] {
	return OBJECTIVE_CHARTS[objective] || DEFAULT_CHARTS;
}
