import type { CampaignAggregate } from './report-helpers';
import { formatCurrency, formatPercent, formatNumber, formatDecimal, formatROAS } from './report-helpers';

export interface ColumnDef {
	key: string;
	label: string;
	align: 'left' | 'right';
	sortKey?: keyof CampaignAggregate;
	getValue: (c: CampaignAggregate & { status: string }, currency: string) => string;
	getSubtext?: (c: CampaignAggregate & { status: string }) => string;
	getTotalValue?: (campaigns: Array<CampaignAggregate & { status: string }>, currency: string) => string;
}

export interface ColumnPreset {
	key: string;
	label: string;
	columns: ColumnDef[];
}

// Reusable column definitions
const COL = {
	results: {
		key: 'results', label: 'Rezultate', align: 'right' as const, sortKey: 'conversions' as const,
		getValue: (c: any) => c.conversions > 0 ? formatNumber(c.conversions) : '-',
		getSubtext: (c: any) => c.resultType || '',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.conversions, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	costPerResult: {
		key: 'costPerResult', label: 'Cost/rezultat', align: 'right' as const, sortKey: 'costPerConversion' as const,
		getValue: (c: any, cur: string) => c.conversions > 0 ? formatCurrency(c.costPerConversion, cur) : '-',
		getSubtext: (c: any) => c.conversions > 0 ? c.cpaLabel : '',
		getTotalValue: (campaigns: any[], cur: string) => {
			const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
			const totalConv = campaigns.reduce((s: number, c: any) => s + c.conversions, 0);
			return totalConv > 0 ? formatCurrency(totalSpend / totalConv, cur) : '-';
		}
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
	reach: {
		key: 'reach', label: 'Reach', align: 'right' as const, sortKey: 'reach' as const,
		getValue: (c: any) => c.reach > 0 ? formatNumber(c.reach) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.reach, 0))
	},
	frequency: {
		key: 'frequency', label: 'Frecvență', align: 'right' as const, sortKey: 'frequency' as const,
		getValue: (c: any) => c.frequency > 0 ? formatDecimal(c.frequency) : '-',
		getTotalValue: (campaigns: any[]) => {
			const totalImp = campaigns.reduce((s: number, c: any) => s + c.impressions, 0);
			const totalReach = campaigns.reduce((s: number, c: any) => s + c.reach, 0);
			return totalReach > 0 ? formatDecimal(totalImp / totalReach) : '-';
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
	clicks: {
		key: 'clicks', label: 'Click-uri (toate)', align: 'right' as const, sortKey: 'clicks' as const,
		getValue: (c: any) => formatNumber(c.clicks),
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.clicks, 0))
	},
	ctr: {
		key: 'ctr', label: 'CTR (toate)', align: 'right' as const, sortKey: 'ctr' as const,
		getValue: (c: any) => formatPercent(c.ctr),
		getTotalValue: (campaigns: any[]) => {
			const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0);
			const totalImp = campaigns.reduce((s: number, c: any) => s + c.impressions, 0);
			return totalImp > 0 ? formatPercent((totalClicks / totalImp) * 100) : '-';
		}
	},
	linkClicks: {
		key: 'linkClicks', label: 'Link clicks', align: 'right' as const, sortKey: 'linkClicks' as const,
		getValue: (c: any) => c.linkClicks > 0 ? formatNumber(c.linkClicks) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.linkClicks, 0))
	},
	cpc: {
		key: 'cpc', label: 'CPC', align: 'right' as const, sortKey: 'cpc' as const,
		getValue: (c: any, cur: string) => c.linkClicks > 0 ? formatCurrency(c.spend / c.linkClicks, cur) : '-',
		getTotalValue: (campaigns: any[], cur: string) => {
			const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
			const totalLC = campaigns.reduce((s: number, c: any) => s + c.linkClicks, 0);
			return totalLC > 0 ? formatCurrency(totalSpend / totalLC, cur) : '-';
		}
	},
	ctrLink: {
		key: 'ctrLink', label: 'CTR (link)', align: 'right' as const,
		getValue: (c: any) => c.impressions > 0 && c.linkClicks > 0 ? formatPercent((c.linkClicks / c.impressions) * 100) : '-',
		getTotalValue: (campaigns: any[]) => {
			const totalLC = campaigns.reduce((s: number, c: any) => s + c.linkClicks, 0);
			const totalImp = campaigns.reduce((s: number, c: any) => s + c.impressions, 0);
			return totalImp > 0 ? formatPercent((totalLC / totalImp) * 100) : '-';
		}
	},
	landingPageViews: {
		key: 'landingPageViews', label: 'Landing page views', align: 'right' as const, sortKey: 'landingPageViews' as const,
		getValue: (c: any) => c.landingPageViews > 0 ? formatNumber(c.landingPageViews) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.landingPageViews, 0))
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
	pageEngagement: {
		key: 'pageEngagement', label: 'Page engagement', align: 'right' as const, sortKey: 'pageEngagement' as const,
		getValue: (c: any) => c.pageEngagement > 0 ? formatNumber(c.pageEngagement) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.pageEngagement, 0))
	},
	postReactions: {
		key: 'postReactions', label: 'Post reactions', align: 'right' as const, sortKey: 'postReactions' as const,
		getValue: (c: any) => c.postReactions > 0 ? formatNumber(c.postReactions) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.postReactions, 0))
	},
	postComments: {
		key: 'postComments', label: 'Post comments', align: 'right' as const, sortKey: 'postComments' as const,
		getValue: (c: any) => c.postComments > 0 ? formatNumber(c.postComments) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.postComments, 0))
	},
	postSaves: {
		key: 'postSaves', label: 'Post saves', align: 'right' as const, sortKey: 'postSaves' as const,
		getValue: (c: any) => c.postSaves > 0 ? formatNumber(c.postSaves) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.postSaves, 0))
	},
	postShares: {
		key: 'postShares', label: 'Post shares', align: 'right' as const, sortKey: 'postShares' as const,
		getValue: (c: any) => c.postShares > 0 ? formatNumber(c.postShares) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.postShares, 0))
	},
	videoViews: {
		key: 'videoViews', label: 'Video views', align: 'right' as const, sortKey: 'videoViews' as const,
		getValue: (c: any) => c.videoViews > 0 ? formatNumber(c.videoViews) : '-',
		getTotalValue: (campaigns: any[]) => formatNumber(campaigns.reduce((s: number, c: any) => s + c.videoViews, 0))
	}
};

export const COLUMN_PRESETS: ColumnPreset[] = [
	{
		key: 'performance_clicks',
		label: 'Performance and clicks',
		columns: [COL.results, COL.costPerResult, COL.reach, COL.frequency, COL.spend, COL.impressions, COL.cpm, COL.linkClicks, COL.cpc, COL.ctrLink, COL.clicks, COL.ctr]
	},
	{
		key: 'performance',
		label: 'Performance',
		columns: [COL.results, COL.costPerResult, COL.spend, COL.impressions, COL.reach, COL.roas]
	},
	{
		key: 'engagement',
		label: 'Engagement',
		columns: [COL.pageEngagement, COL.postReactions, COL.postComments, COL.postSaves, COL.postShares, COL.linkClicks, COL.cpc]
	},
	{
		key: 'delivery',
		label: 'Delivery',
		columns: [COL.reach, COL.frequency, COL.impressions, COL.cpm, COL.spend]
	},
	{
		key: 'video',
		label: 'Video engagement',
		columns: [COL.videoViews, COL.spend]
	}
];

export const DEFAULT_PRESET = 'performance_clicks';

export function getPreset(key: string): ColumnPreset {
	return COLUMN_PRESETS.find(p => p.key === key) || COLUMN_PRESETS[0];
}
