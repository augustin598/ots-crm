/**
 * Chart configurations per Google Ads channel type.
 * Reuses ChartSpec interface from Meta chart-config.
 */

import type { ChartSpec } from './chart-config';

const fmtNum = (v: number) => new Intl.NumberFormat('ro-RO').format(Math.round(v));
const fmtCur = (v: number, c: string) => new Intl.NumberFormat('ro-RO', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(v);
const fmtPct = (v: number) => `${v.toFixed(2)}%`;
const fmtRoas = (v: number) => v > 0 ? `${v.toFixed(2)}x` : '-';

const COLORS = {
	blue: { border: 'rgb(59, 130, 246)', fill: 'rgba(59, 130, 246, 0.2)' },
	green: { border: 'rgb(16, 185, 129)', fill: 'rgba(16, 185, 129, 0.2)' },
	orange: { border: 'rgb(249, 115, 22)', fill: 'rgba(249, 115, 22, 0.15)' },
	purple: { border: 'rgb(139, 92, 246)', fill: 'rgba(139, 92, 246, 0.15)' },
	amber: { border: 'rgb(245, 158, 11)', fill: 'rgba(245, 158, 11, 0.15)' },
	cyan: { border: 'rgb(6, 182, 212)', fill: 'rgba(6, 182, 212, 0.15)' }
};

export const GOOGLE_CHANNEL_CHARTS: Record<string, ChartSpec[]> = {
	SEARCH: [
		{
			title: 'Conversii & Cost/conversie în timp',
			datasets: [
				{ label: 'Conversii', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.green.border, fillColor: COLORS.green.fill, order: 2 },
				{ label: 'Cost/conversie', key: 'costPerConversion', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Conversii', formatter: fmtNum },
			y1Axis: { label: 'Cost/conversie', formatter: fmtCur }
		},
		{
			title: 'CTR & CPC în timp',
			datasets: [
				{ label: 'CTR', key: 'ctr', type: 'line', yAxisID: 'y', color: COLORS.purple.border, order: 1 },
				{ label: 'CPC', key: 'cpc', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 2 }
			],
			yAxis: { label: 'CTR (%)', formatter: fmtPct },
			y1Axis: { label: 'CPC', formatter: fmtCur }
		}
	],

	SHOPPING: [
		{
			title: 'Venituri & ROAS în timp',
			datasets: [
				{ label: 'Venituri', key: 'conversionValue', type: 'bar', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 2 },
				{ label: 'ROAS', key: 'roas', type: 'line', yAxisID: 'y1', color: COLORS.amber.border, order: 1 }
			],
			yAxis: { label: 'Venituri', formatter: fmtCur },
			y1Axis: { label: 'ROAS', formatter: fmtRoas }
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
	],

	DISPLAY: [
		{
			title: 'Impresii & CPM în timp',
			datasets: [
				{ label: 'Impresii', key: 'impressions', type: 'bar', yAxisID: 'y', color: COLORS.cyan.border, fillColor: COLORS.cyan.fill, order: 2 },
				{ label: 'CPM', key: 'cpm', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Impresii', formatter: fmtNum },
			y1Axis: { label: 'CPM', formatter: fmtCur }
		},
		{
			title: 'Click-uri & CTR în timp',
			datasets: [
				{ label: 'Click-uri', key: 'clicks', type: 'bar', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 2 },
				{ label: 'CTR', key: 'ctr', type: 'line', yAxisID: 'y1', color: COLORS.purple.border, order: 1 }
			],
			yAxis: { label: 'Click-uri', formatter: fmtNum },
			y1Axis: { label: 'CTR (%)', formatter: fmtPct }
		}
	],

	PERFORMANCE_MAX: [
		{
			title: 'Conversii & ROAS în timp',
			datasets: [
				{ label: 'Conversii', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.green.border, fillColor: COLORS.green.fill, order: 2 },
				{ label: 'ROAS', key: 'roas', type: 'line', yAxisID: 'y1', color: COLORS.amber.border, order: 1 }
			],
			yAxis: { label: 'Conversii', formatter: fmtNum },
			y1Axis: { label: 'ROAS', formatter: fmtRoas }
		},
		{
			title: 'Cheltuieli & CPM în timp',
			datasets: [
				{ label: 'Cheltuieli', key: 'spend', type: 'line', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 1 },
				{ label: 'CPM', key: 'cpm', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 2 }
			],
			yAxis: { label: 'Cheltuieli', formatter: fmtCur },
			y1Axis: { label: 'CPM', formatter: fmtCur }
		}
	],

	VIDEO: [
		{
			title: 'Impresii & CPM în timp',
			datasets: [
				{ label: 'Impresii', key: 'impressions', type: 'bar', yAxisID: 'y', color: COLORS.cyan.border, fillColor: COLORS.cyan.fill, order: 2 },
				{ label: 'CPM', key: 'cpm', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Impresii', formatter: fmtNum },
			y1Axis: { label: 'CPM', formatter: fmtCur }
		},
		{
			title: 'Click-uri & CTR în timp',
			datasets: [
				{ label: 'Click-uri', key: 'clicks', type: 'bar', yAxisID: 'y', color: COLORS.blue.border, fillColor: COLORS.blue.fill, order: 2 },
				{ label: 'CTR', key: 'ctr', type: 'line', yAxisID: 'y1', color: COLORS.purple.border, order: 1 }
			],
			yAxis: { label: 'Click-uri', formatter: fmtNum },
			y1Axis: { label: 'CTR (%)', formatter: fmtPct }
		}
	],

	DEMAND_GEN: [
		{
			title: 'Conversii & Cost/conversie în timp',
			datasets: [
				{ label: 'Conversii', key: 'conversions', type: 'bar', yAxisID: 'y', color: COLORS.green.border, fillColor: COLORS.green.fill, order: 2 },
				{ label: 'Cost/conversie', key: 'costPerConversion', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 1 }
			],
			yAxis: { label: 'Conversii', formatter: fmtNum },
			y1Axis: { label: 'Cost/conversie', formatter: fmtCur }
		},
		{
			title: 'CTR & CPC în timp',
			datasets: [
				{ label: 'CTR', key: 'ctr', type: 'line', yAxisID: 'y', color: COLORS.purple.border, order: 1 },
				{ label: 'CPC', key: 'cpc', type: 'line', yAxisID: 'y1', color: COLORS.orange.border, order: 2 }
			],
			yAxis: { label: 'CTR (%)', formatter: fmtPct },
			y1Axis: { label: 'CPC', formatter: fmtCur }
		}
	]
};

export const GOOGLE_DEFAULT_CHARTS: ChartSpec[] = [
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

export function getGoogleChartsForChannel(channelType: string): ChartSpec[] {
	return GOOGLE_CHANNEL_CHARTS[channelType] || GOOGLE_DEFAULT_CHARTS;
}
