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

// Helper to format seconds as mm:ss or just seconds
function formatDuration(seconds: number): string {
	if (seconds <= 0) return '-';
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.round(seconds % 60);
	return `${mins}:${String(secs).padStart(2, '0')}`;
}

const COL = {
	// ---- Core Performance ----
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

	// ---- Delivery ----
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

	// ---- Clicks ----
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

	// ---- Engagement (TikTok-specific) ----
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
		key: 'follows', label: 'Followers noi', align: 'right' as const, sortKey: 'follows' as const,
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

	// ---- Video (TikTok-specific) ----
	videoViews2s: {
		key: 'videoViews2s', label: 'Video views (2s)', align: 'right' as const, sortKey: 'videoViews2s' as const,
		getValue: (c: any) => c.videoViews2s > 0 ? formatNumber(c.videoViews2s) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViews2s, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	videoViews6s: {
		key: 'videoViews6s', label: 'Focused views (6s)', align: 'right' as const, sortKey: 'focusedView6s' as const,
		getValue: (c: any) => c.focusedView6s > 0 ? formatNumber(c.focusedView6s) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.focusedView6s, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	videoViewsP25: {
		key: 'videoViewsP25', label: 'Video 25%', align: 'right' as const, sortKey: 'videoViewsP25' as const,
		getValue: (c: any) => c.videoViewsP25 > 0 ? formatNumber(c.videoViewsP25) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViewsP25, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	videoViewsP50: {
		key: 'videoViewsP50', label: 'Video 50%', align: 'right' as const, sortKey: 'videoViewsP50' as const,
		getValue: (c: any) => c.videoViewsP50 > 0 ? formatNumber(c.videoViewsP50) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViewsP50, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	videoViewsP75: {
		key: 'videoViewsP75', label: 'Video 75%', align: 'right' as const, sortKey: 'videoViewsP75' as const,
		getValue: (c: any) => c.videoViewsP75 > 0 ? formatNumber(c.videoViewsP75) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViewsP75, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	videoViewsP100: {
		key: 'videoViewsP100', label: 'Video 100%', align: 'right' as const, sortKey: 'videoViewsP100' as const,
		getValue: (c: any) => c.videoViewsP100 > 0 ? formatNumber(c.videoViewsP100) : '-',
		getTotalValue: (campaigns: any[]) => {
			const total = campaigns.reduce((s: number, c: any) => s + c.videoViewsP100, 0);
			return total > 0 ? formatNumber(total) : '-';
		}
	},
	avgWatchTime: {
		key: 'avgWatchTime', label: 'Durată medie vizionare', align: 'right' as const, sortKey: 'averageVideoPlayPerUser' as const,
		getValue: (c: any) => formatDuration(c.averageVideoPlayPerUser),
		getTotalValue: (campaigns: any[]) => {
			const withData = campaigns.filter((c: any) => c.averageVideoPlayPerUser > 0);
			if (withData.length === 0) return '-';
			const avg = withData.reduce((s: number, c: any) => s + c.averageVideoPlayPerUser, 0) / withData.length;
			return formatDuration(avg);
		}
	}
};

export const TIKTOK_COLUMN_PRESETS: TiktokColumnPreset[] = [
	{
		key: 'performance_clicks',
		label: 'Performanță și click-uri',
		columns: [COL.results, COL.costPerResult, COL.budget, COL.spend, COL.reach, COL.impressions, COL.cpm, COL.clicks, COL.cpc, COL.ctr]
	},
	{
		key: 'performance',
		label: 'Performanță',
		columns: [COL.results, COL.costPerResult, COL.budget, COL.spend, COL.impressions, COL.reach]
	},
	{
		key: 'engagement',
		label: 'Engagement',
		columns: [COL.likes, COL.comments, COL.shares, COL.follows, COL.profileVisits, COL.clicks, COL.cpc]
	},
	{
		key: 'delivery',
		label: 'Livrare',
		columns: [COL.reach, COL.frequency, COL.impressions, COL.cpm, COL.spend]
	},
	{
		key: 'video',
		label: 'Video',
		columns: [COL.videoViews2s, COL.videoViews6s, COL.videoViewsP25, COL.videoViewsP50, COL.videoViewsP75, COL.videoViewsP100, COL.avgWatchTime, COL.spend]
	}
];

export const TIKTOK_DEFAULT_PRESET = 'performance_clicks';

export function getTiktokPreset(key: string): TiktokColumnPreset {
	return TIKTOK_COLUMN_PRESETS.find(p => p.key === key) || TIKTOK_COLUMN_PRESETS[0];
}
