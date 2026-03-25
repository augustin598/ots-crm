import type { GoogleCampaignAggregate } from './google-report-helpers';
import { formatCurrency, formatPercent, formatNumber, formatDecimal, formatROAS } from './report-helpers';

export interface GoogleColumnDef {
	key: string;
	label: string;
	align: 'left' | 'right';
	sortKey?: keyof GoogleCampaignAggregate;
	getValue: (c: GoogleCampaignAggregate & { status: string }, currency: string) => string;
	getSubtext?: (c: GoogleCampaignAggregate & { status: string }) => string;
	getTotalValue?: (campaigns: Array<GoogleCampaignAggregate & { status: string }>, currency: string) => string;
}

export interface GoogleColumnPreset {
	key: string;
	label: string;
	columns: GoogleColumnDef[];
}

const COL = {
	results: {
		key: 'results', label: 'Conversii', align: 'right' as const, sortKey: 'conversions' as const,
		getValue: (c: any) => c.conversions > 0 ? formatNumber(c.conversions) : '-',
		getSubtext: (c: any) => c.resultType || '',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.conversions, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	costPerResult: {
		key: 'costPerResult', label: 'Cost/conversie', align: 'right' as const, sortKey: 'costPerConversion' as const,
		getValue: (c: any, cur: string) => c.conversions > 0 ? formatCurrency(c.costPerConversion, cur) : '-',
		getSubtext: (c: any) => c.conversions > 0 ? c.cpaLabel : '',
		getTotalValue: (campaigns: any[], cur: string) => {
			const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
			const totalConv = campaigns.reduce((s: number, c: any) => s + c.conversions, 0);
			return totalConv > 0 ? formatCurrency(totalSpend / totalConv, cur) : '-';
		}
	},
	budget: {
		key: 'budget', label: 'Buget', align: 'right' as const,
		getValue: (c: any, cur: string) => {
			if (c.dailyBudget) return `${formatCurrency(parseFloat(c.dailyBudget), cur)}/zi`;
			return '-';
		},
		getSubtext: (c: any) => c.dailyBudget ? 'Zilnic' : '',
		getTotalValue: () => '-'
	},
	spend: {
		key: 'spend', label: 'Cheltuieli', align: 'right' as const, sortKey: 'spend' as const,
		getValue: (c: any, cur: string) => formatCurrency(c.spend, cur),
		getTotalValue: (campaigns: any[], cur: string) => formatCurrency(campaigns.reduce((s: number, c: any) => s + c.spend, 0), cur)
	},
	impressions: {
		key: 'impressions', label: 'Impresii', align: 'right' as const, sortKey: 'impressions' as const,
		getValue: (c: any) => formatNumber(c.impressions),
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.impressions, 0))
	},
	clicks: {
		key: 'clicks', label: 'Click-uri', align: 'right' as const, sortKey: 'clicks' as const,
		getValue: (c: any) => formatNumber(c.clicks),
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.clicks, 0))
	},
	cpc: {
		key: 'cpc', label: 'CPC', align: 'right' as const, sortKey: 'cpc' as const,
		getValue: (c: any, cur: string) => c.clicks > 0 ? formatCurrency(c.cpc, cur) : '-',
		getTotalValue: (campaigns: any[], cur: string) => {
			const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
			const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0);
			return totalClicks > 0 ? formatCurrency(totalSpend / totalClicks, cur) : '-';
		}
	},
	cpm: {
		key: 'cpm', label: 'CPM', align: 'right' as const, sortKey: 'cpm' as const,
		getValue: (c: any, cur: string) => c.impressions > 0 ? formatCurrency(c.cpm, cur) : '-',
		getTotalValue: (campaigns: any[], cur: string) => {
			const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
			const totalImp = campaigns.reduce((s: number, c: any) => s + c.impressions, 0);
			return totalImp > 0 ? formatCurrency((totalSpend / totalImp) * 1000, cur) : '-';
		}
	},
	ctr: {
		key: 'ctr', label: 'CTR', align: 'right' as const, sortKey: 'ctr' as const,
		getValue: (c: any) => formatPercent(c.ctr),
		getTotalValue: (campaigns: any[]) => {
			const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0);
			const totalImp = campaigns.reduce((s: number, c: any) => s + c.impressions, 0);
			return totalImp > 0 ? formatPercent((totalClicks / totalImp) * 100) : '-';
		}
	},
	roas: {
		key: 'roas', label: 'ROAS', align: 'right' as const, sortKey: 'roas' as const,
		getValue: (c: any) => c.roas > 0 ? formatROAS(c.roas) : '-',
		getTotalValue: (campaigns: any[]) => {
			const totalValue = campaigns.reduce((s: number, c: any) => s + c.conversionValue, 0);
			const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
			return totalSpend > 0 && totalValue > 0 ? formatROAS(totalValue / totalSpend) : '-';
		}
	},
	conversionValue: {
		key: 'conversionValue', label: 'Valoare conversii', align: 'right' as const, sortKey: 'conversionValue' as const,
		getValue: (c: any, cur: string) => c.conversionValue > 0 ? formatCurrency(c.conversionValue, cur) : '-',
		getTotalValue: (campaigns: any[], cur: string) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.conversionValue, 0);
			return total > 0 ? formatCurrency(total, cur) : '-';
		}
	},
	videoViews: {
		key: 'videoViews', label: 'Video views', align: 'right' as const, sortKey: 'videoViews' as const,
		getValue: (c: any) => c.videoViews > 0 ? formatNumber(c.videoViews) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViews, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	conversionRate: {
		key: 'conversionRate', label: 'Rată conv.', align: 'right' as const, sortKey: 'conversionRate' as const,
		getValue: (c: any) => c.conversionRate > 0 ? formatPercent(c.conversionRate) : '-',
		getSubtext: () => 'Conv. / Click-uri',
		getTotalValue: (campaigns: any[]) => {
			const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0);
			const totalConv = campaigns.reduce((s: number, c: any) => s + c.conversions, 0);
			return totalClicks > 0 ? formatPercent((totalConv / totalClicks) * 100) : '-';
		}
	}
};

export const GOOGLE_COLUMN_PRESETS: GoogleColumnPreset[] = [
	{
		key: 'performance_clicks',
		label: 'Performanță și click-uri',
		columns: [COL.results, COL.costPerResult, COL.budget, COL.spend, COL.impressions, COL.cpm, COL.clicks, COL.cpc, COL.ctr, COL.conversionRate]
	},
	{
		key: 'performance',
		label: 'Performanță',
		columns: [COL.results, COL.costPerResult, COL.conversionRate, COL.budget, COL.spend, COL.impressions]
	},
	{
		key: 'conversions',
		label: 'Conversii',
		columns: [COL.results, COL.conversionRate, COL.costPerResult, COL.conversionValue, COL.roas, COL.spend]
	},
	{
		key: 'delivery',
		label: 'Livrare',
		columns: [COL.impressions, COL.cpm, COL.clicks, COL.cpc, COL.ctr, COL.spend]
	},
	{
		key: 'video',
		label: 'Video',
		columns: [COL.videoViews, COL.impressions, COL.cpm, COL.clicks, COL.cpc, COL.spend]
	}
];

export const GOOGLE_DEFAULT_PRESET = 'performance_clicks';

export function getGooglePreset(key: string): GoogleColumnPreset {
	return GOOGLE_COLUMN_PRESETS.find(p => p.key === key) || GOOGLE_COLUMN_PRESETS[0];
}
