import type { TiktokCampaignAggregate } from './tiktok-report-helpers';
import { formatCurrency, formatPercent, formatNumber, formatDecimal } from './report-helpers';

export interface TiktokColumnDef {
	key: string;
	label: string;
	align: 'left' | 'right';
	sortKey?: keyof TiktokCampaignAggregate;
	getValue: (c: TiktokCampaignAggregate & { status: string }, currency: string) => string;
	getSubtext?: (c: TiktokCampaignAggregate & { status: string }) => string;
	getTotalValue?: (campaigns: Array<TiktokCampaignAggregate & { status: string }>, currency: string) => string;
}

export interface TiktokColumnPreset {
	key: string;
	label: string;
	columns: TiktokColumnDef[];
}

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
	budget: {
		key: 'budget', label: 'Buget', align: 'right' as const,
		getValue: (c: any, cur: string) => {
			if (c.dailyBudget) return `${formatCurrency(parseFloat(c.dailyBudget), cur)}/zi`;
			if (c.lifetimeBudget) return formatCurrency(parseFloat(c.lifetimeBudget), cur);
			return '-';
		},
		getSubtext: (c: any) => {
			if (c.dailyBudget) return 'Zilnic';
			if (c.lifetimeBudget) return 'Total';
			return '';
		},
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
	reach: {
		key: 'reach', label: 'Reach', align: 'right' as const, sortKey: 'reach' as const,
		getValue: (c: any) => c.reach > 0 ? formatNumber(c.reach) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.reach, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
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
	ctr: {
		key: 'ctr', label: 'CTR', align: 'right' as const, sortKey: 'ctr' as const,
		getValue: (c: any) => formatPercent(c.ctr),
		getTotalValue: (campaigns: any[]) => {
			const totalClicks = campaigns.reduce((s: number, c: any) => s + c.clicks, 0);
			const totalImp = campaigns.reduce((s: number, c: any) => s + c.impressions, 0);
			return totalImp > 0 ? formatPercent((totalClicks / totalImp) * 100) : '-';
		}
	},
	likes: {
		key: 'likes', label: 'Likes', align: 'right' as const, sortKey: 'likes' as const,
		getValue: (c: any) => c.likes > 0 ? formatNumber(c.likes) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.likes, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	comments: {
		key: 'comments', label: 'Comentarii', align: 'right' as const, sortKey: 'comments' as const,
		getValue: (c: any) => c.comments > 0 ? formatNumber(c.comments) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.comments, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	shares: {
		key: 'shares', label: 'Shares', align: 'right' as const, sortKey: 'shares' as const,
		getValue: (c: any) => c.shares > 0 ? formatNumber(c.shares) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.shares, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	follows: {
		key: 'follows', label: 'Followers', align: 'right' as const, sortKey: 'follows' as const,
		getValue: (c: any) => c.follows > 0 ? formatNumber(c.follows) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.follows, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	profileVisits: {
		key: 'profileVisits', label: 'Vizite profil', align: 'right' as const, sortKey: 'profileVisits' as const,
		getValue: (c: any) => c.profileVisits > 0 ? formatNumber(c.profileVisits) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.profileVisits, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	videoViews: {
		key: 'videoViews', label: 'Video views (100%)', align: 'right' as const, sortKey: 'videoViewsP100' as const,
		getValue: (c: any) => c.videoViewsP100 > 0 ? formatNumber(c.videoViewsP100) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViewsP100, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	}
};

export const TIKTOK_COLUMN_PRESETS: TiktokColumnPreset[] = [
	{
		key: 'performance_clicks',
		label: 'Performance and clicks',
		columns: [COL.results, COL.costPerResult, COL.budget, COL.spend, COL.reach, COL.impressions, COL.cpm, COL.clicks, COL.cpc, COL.ctr]
	},
	{
		key: 'performance',
		label: 'Performance',
		columns: [COL.results, COL.costPerResult, COL.budget, COL.spend, COL.impressions, COL.reach]
	},
	{
		key: 'engagement',
		label: 'Engagement',
		columns: [COL.likes, COL.comments, COL.shares, COL.follows, COL.profileVisits, COL.clicks, COL.cpc]
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

export const TIKTOK_DEFAULT_PRESET = 'performance_clicks';

export function getTiktokPreset(key: string): TiktokColumnPreset {
	return TIKTOK_COLUMN_PRESETS.find(p => p.key === key) || TIKTOK_COLUMN_PRESETS[0];
}
