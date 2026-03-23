import type { MetaAdsCampaignInsight } from '$lib/server/meta-ads/client';

export interface DailyAggregate {
	date: string;
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	costPerConversion: number;
	roas: number;
}

export interface CampaignAggregate {
	campaignId: string;
	campaignName: string;
	objective: string;
	spend: number;
	impressions: number;
	reach: number;
	frequency: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	costPerConversion: number;
	roas: number;
	resultType: string;
	cpaLabel: string;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
}

export function calculateROAS(revenue: number, spend: number): number {
	if (spend <= 0) return 0;
	return revenue / spend;
}

/** Aggregate campaign insights by date for time-series charts */
export function aggregateInsightsByDate(insights: MetaAdsCampaignInsight[]): DailyAggregate[] {
	const byDate = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();

	for (const row of insights) {
		const date = row.dateStart;
		const existing = byDate.get(date) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		byDate.set(date, existing);
	}

	return Array.from(byDate.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, d]) => ({
			date,
			spend: d.spend,
			impressions: d.impressions,
			clicks: d.clicks,
			conversions: d.conversions,
			conversionValue: d.conversionValue,
			cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
			cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
			ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
			costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
			roas: calculateROAS(d.conversionValue, d.spend)
		}));
}

/** Aggregate campaign insights by campaign for the table */
export function aggregateInsightsByCampaign(insights: MetaAdsCampaignInsight[]): CampaignAggregate[] {
	type Acc = { name: string; objective: string; spend: number; impressions: number; reach: number; frequency: number; clicks: number; conversions: number; conversionValue: number; resultType: string; cpaLabel: string; linkClicks: number; landingPageViews: number; pageEngagement: number; postReactions: number; postComments: number; postSaves: number; postShares: number; videoViews: number; callsPlaced: number };
	const byCampaign = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byCampaign.get(row.campaignId) || {
			name: row.campaignName, objective: row.objective,
			spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, conversions: 0, conversionValue: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			linkClicks: 0, landingPageViews: 0, pageEngagement: 0, postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.reach += parseInt(row.reach || '0');
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.linkClicks += row.linkClicks;
		existing.landingPageViews += row.landingPageViews;
		existing.pageEngagement += row.pageEngagement;
		existing.postReactions += row.postReactions;
		existing.postComments += row.postComments;
		existing.postSaves += row.postSaves;
		existing.postShares += row.postShares;
		existing.videoViews += row.videoViews;
		existing.callsPlaced += row.callsPlaced;
		if (row.resultType && !existing.resultType) existing.resultType = row.resultType;
		if (row.cpaLabel && existing.cpaLabel === 'CPA') existing.cpaLabel = row.cpaLabel;
		byCampaign.set(row.campaignId, existing);
	}

	return Array.from(byCampaign.entries()).map(([campaignId, d]) => ({
		campaignId,
		campaignName: d.name,
		objective: d.objective,
		spend: d.spend,
		impressions: d.impressions,
		reach: d.reach,
		frequency: d.impressions > 0 ? d.impressions / (d.reach || 1) : 0,
		clicks: d.clicks,
		conversions: d.conversions,
		conversionValue: d.conversionValue,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: calculateROAS(d.conversionValue, d.spend),
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		linkClicks: d.linkClicks,
		landingPageViews: d.landingPageViews,
		pageEngagement: d.pageEngagement,
		postReactions: d.postReactions,
		postComments: d.postComments,
		postSaves: d.postSaves,
		postShares: d.postShares,
		videoViews: d.videoViews,
		callsPlaced: d.callsPlaced
	}));
}

/** Compute totals from daily aggregates for KPI cards */
export function computeTotals(dailyData: DailyAggregate[]): {
	totalSpend: number;
	totalImpressions: number;
	totalClicks: number;
	totalConversions: number;
	totalConversionValue: number;
	avgCpc: number;
	avgCpm: number;
	avgCtr: number;
	avgCostPerConversion: number;
	roas: number;
} {
	let totalSpend = 0;
	let totalImpressions = 0;
	let totalClicks = 0;
	let totalConversions = 0;
	let totalConversionValue = 0;

	for (const d of dailyData) {
		totalSpend += d.spend;
		totalImpressions += d.impressions;
		totalClicks += d.clicks;
		totalConversions += d.conversions;
		totalConversionValue += d.conversionValue;
	}

	return {
		totalSpend,
		totalImpressions,
		totalClicks,
		totalConversions,
		totalConversionValue,
		avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
		avgCpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
		avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
		avgCostPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
		roas: calculateROAS(totalConversionValue, totalSpend)
	};
}

export function formatCurrency(value: number, currency = 'EUR'): string {
	return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number): string {
	return new Intl.NumberFormat('ro-RO', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(value);
}

export function formatDecimal(value: number, digits = 2): string {
	return new Intl.NumberFormat('ro-RO', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatROAS(value: number): string {
	if (value <= 0) return '-';
	return `${value.toFixed(2)}x`;
}

/** Get date presets for the date range picker (Facebook Ads Manager style) */
export function getDatePresets(): { label: string; since: string; until: string }[] {
	const today = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	const todayStr = fmt(today);

	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayStr = fmt(yesterday);

	// FB Ads Manager uses yesterday as "until" for "Last X days" presets
	// because today's data is incomplete
	const daysAgo = (n: number) => {
		const d = new Date(yesterday);
		d.setDate(d.getDate() - (n - 1));
		return fmt(d);
	};

	// This week (Monday to today)
	const thisWeekStart = new Date(today);
	const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1; // Monday = 0
	thisWeekStart.setDate(today.getDate() - dayOfWeek);

	// Last week (Monday to Sunday)
	const lastWeekEnd = new Date(thisWeekStart);
	lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
	const lastWeekStart = new Date(lastWeekEnd);
	lastWeekStart.setDate(lastWeekStart.getDate() - 6);

	const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

	const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

	// Maximum = last 2 years
	const maximum = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());

	return [
		{ label: 'Maximum', since: fmt(maximum), until: todayStr },
		{ label: 'Azi', since: todayStr, until: todayStr },
		{ label: 'Ieri', since: fmt(yesterday), until: fmt(yesterday) },
		{ label: 'Azi și ieri', since: fmt(yesterday), until: todayStr },
		{ label: 'Ultimele 7 zile', since: daysAgo(7), until: yesterdayStr },
		{ label: 'Ultimele 14 zile', since: daysAgo(14), until: yesterdayStr },
		{ label: 'Ultimele 28 zile', since: daysAgo(28), until: yesterdayStr },
		{ label: 'Ultimele 30 zile', since: daysAgo(30), until: yesterdayStr },
		{ label: 'Săptămâna aceasta', since: fmt(thisWeekStart), until: todayStr },
		{ label: 'Săptămâna trecută', since: fmt(lastWeekStart), until: fmt(lastWeekEnd) },
		{ label: 'Luna aceasta', since: fmt(thisMonthStart), until: todayStr },
		{ label: 'Luna trecută', since: fmt(lastMonthStart), until: fmt(lastMonthEnd) }
	];
}

/** Get default date range (last 30 days) */
export function getDefaultDateRange(): { since: string; until: string } {
	const presets = getDatePresets();
	const last30 = presets.find(p => p.label === 'Ultimele 30 zile');
	return last30 ? { since: last30.since, until: last30.until } : { since: presets[7].since, until: presets[7].until };
}
