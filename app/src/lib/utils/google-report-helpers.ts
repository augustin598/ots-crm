import type { GoogleAdsCampaignInsight, GoogleAdsAdGroupInsight } from '$lib/server/google-ads/client';

export interface GoogleDailyAggregate {
	date: string;
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	conversionRate: number;
	costPerConversion: number;
	roas: number;
}

export interface GoogleCampaignAggregate {
	campaignId: string;
	campaignName: string;
	channelType: string;
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	conversionRate: number;
	costPerConversion: number;
	roas: number;
	videoViews: number;
	resultType: string;
	cpaLabel: string;
}

export interface GoogleAdGroupAggregate {
	adGroupId: string;
	adGroupName: string;
	campaignId: string;
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	conversionRate: number;
	costPerConversion: number;
	roas: number;
	videoViews: number;
	resultType: string;
	cpaLabel: string;
	dailyBudget: string | null;
}

/** Aggregate Google campaign insights by date for time-series charts */
export function aggregateGoogleInsightsByDate(insights: GoogleAdsCampaignInsight[]): GoogleDailyAggregate[] {
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
			conversionRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0,
			costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
			roas: d.spend > 0 ? d.conversionValue / d.spend : 0
		}));
}

/** Aggregate Google campaign insights by campaign for the table */
export function aggregateGoogleInsightsByCampaign(insights: GoogleAdsCampaignInsight[]): GoogleCampaignAggregate[] {
	type Acc = {
		name: string; channelType: string;
		spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
		videoViews: number; resultType: string; cpaLabel: string;
	};
	const byCampaign = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byCampaign.get(row.campaignId) || {
			name: row.campaignName, channelType: row.channelType,
			spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
			videoViews: 0, resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA'
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.videoViews += row.videoViews;
		if (row.resultType && !existing.resultType) existing.resultType = row.resultType;
		if (row.cpaLabel && existing.cpaLabel === 'CPA') existing.cpaLabel = row.cpaLabel;
		byCampaign.set(row.campaignId, existing);
	}

	return Array.from(byCampaign.entries()).map(([campaignId, d]) => ({
		campaignId,
		campaignName: d.name,
		channelType: d.channelType,
		spend: d.spend,
		impressions: d.impressions,
		clicks: d.clicks,
		conversions: d.conversions,
		conversionValue: d.conversionValue,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		conversionRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
		videoViews: d.videoViews,
		resultType: d.resultType,
		cpaLabel: d.cpaLabel
	}));
}

// ---- Totals computation ----

export interface GoogleTotals {
	totalSpend: number;
	totalImpressions: number;
	totalClicks: number;
	totalConversions: number;
	totalConversionValue: number;
	avgCpm: number;
	avgCpc: number;
	avgCtr: number;
	avgConversionRate: number;
	avgCostPerConversion: number;
	roas: number;
}

export function computeGoogleTotals(dailyData: GoogleDailyAggregate[]): GoogleTotals {
	const totalSpend = dailyData.reduce((s, d) => s + d.spend, 0);
	const totalImpressions = dailyData.reduce((s, d) => s + d.impressions, 0);
	const totalClicks = dailyData.reduce((s, d) => s + d.clicks, 0);
	const totalConversions = dailyData.reduce((s, d) => s + d.conversions, 0);
	const totalConversionValue = dailyData.reduce((s, d) => s + d.conversionValue, 0);
	return {
		totalSpend, totalImpressions, totalClicks, totalConversions, totalConversionValue,
		avgCpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
		avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
		avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
		avgConversionRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0,
		avgCostPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
		roas: totalSpend > 0 ? totalConversionValue / totalSpend : 0
	};
}

// ---- Formatting helpers ----

function fmtCur(v: number, currency: string): string {
	return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
}
function fmtNum(v: number): string { return new Intl.NumberFormat('ro-RO').format(Math.round(v)); }
function fmtPct(v: number): string { return `${v.toFixed(2)}%`; }
function fmtRoas(v: number): string { return v > 0 ? `${v.toFixed(2)}x` : '-'; }

// ---- KPI Cards per Channel Type ----

export interface GoogleKpiDescriptor {
	key: string;
	label: string;
	icon: string;
	value: string;
	subtext: string;
	change?: number;
	invertChange?: boolean;
}

export function getGoogleChannelKpiCards(
	channelType: string,
	totals: GoogleTotals,
	currency: string,
	prevTotals?: GoogleTotals
): GoogleKpiDescriptor[] {
	const pct = (cur: number, prev: number | undefined): number | undefined => {
		if (prev === undefined || prev === 0) return undefined;
		return ((cur - prev) / prev) * 100;
	};
	const pt = prevTotals;

	switch (channelType) {
		case 'SEARCH':
			return [
				{ key: 'conversions', label: 'Conversii', icon: 'target', value: fmtNum(totals.totalConversions), subtext: `${fmtCur(totals.avgCostPerConversion, currency)} cost/conversie`, change: pct(totals.totalConversions, pt?.totalConversions) },
				{ key: 'costPerConv', label: 'Cost/conversie', icon: 'dollar-sign', value: fmtCur(totals.avgCostPerConversion, currency), subtext: `${fmtNum(totals.totalConversions)} conversii`, change: pct(totals.avgCostPerConversion, pt?.avgCostPerConversion), invertChange: true },
				{ key: 'ctr', label: 'CTR', icon: 'percent', value: fmtPct(totals.avgCtr), subtext: 'Click-through rate', change: pct(totals.avgCtr, pt?.avgCtr) },
				{ key: 'cpc', label: 'CPC', icon: 'mouse-pointer-click', value: fmtCur(totals.avgCpc, currency), subtext: `${fmtNum(totals.totalClicks)} click-uri`, change: pct(totals.avgCpc, pt?.avgCpc), invertChange: true },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: fmtCur(totals.totalSpend, currency), subtext: `${fmtNum(totals.totalImpressions)} impresii`, change: pct(totals.totalSpend, pt?.totalSpend), invertChange: true }
			];

		case 'SHOPPING':
			return [
				{ key: 'roas', label: 'ROAS', icon: 'trending-up', value: fmtRoas(totals.roas), subtext: `${fmtCur(totals.totalConversionValue, currency)} venituri`, change: pct(totals.roas, pt?.roas) },
				{ key: 'revenue', label: 'Venituri', icon: 'dollar-sign', value: fmtCur(totals.totalConversionValue, currency), subtext: `din ${fmtNum(totals.totalConversions)} conversii`, change: pct(totals.totalConversionValue, pt?.totalConversionValue) },
				{ key: 'conversions', label: 'Conversii', icon: 'shopping-cart', value: fmtNum(totals.totalConversions), subtext: `${fmtCur(totals.avgCostPerConversion, currency)} cost/conversie`, change: pct(totals.totalConversions, pt?.totalConversions) },
				{ key: 'costPerConv', label: 'Cost/conversie', icon: 'dollar-sign', value: fmtCur(totals.avgCostPerConversion, currency), subtext: `ROAS ${fmtRoas(totals.roas)}`, change: pct(totals.avgCostPerConversion, pt?.avgCostPerConversion), invertChange: true },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: fmtCur(totals.totalSpend, currency), subtext: `${fmtNum(totals.totalClicks)} click-uri`, change: pct(totals.totalSpend, pt?.totalSpend), invertChange: true }
			];

		case 'DISPLAY':
			return [
				{ key: 'impressions', label: 'Impresii', icon: 'eye', value: fmtNum(totals.totalImpressions), subtext: `${fmtCur(totals.avgCpm, currency)} CPM`, change: pct(totals.totalImpressions, pt?.totalImpressions) },
				{ key: 'cpm', label: 'CPM', icon: 'eye', value: fmtCur(totals.avgCpm, currency), subtext: 'Cost per 1000 impresii', change: pct(totals.avgCpm, pt?.avgCpm), invertChange: true },
				{ key: 'clicks', label: 'Click-uri', icon: 'mouse-pointer-click', value: fmtNum(totals.totalClicks), subtext: `${fmtPct(totals.avgCtr)} CTR`, change: pct(totals.totalClicks, pt?.totalClicks) },
				{ key: 'ctr', label: 'CTR', icon: 'percent', value: fmtPct(totals.avgCtr), subtext: 'Click-through rate', change: pct(totals.avgCtr, pt?.avgCtr) },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: fmtCur(totals.totalSpend, currency), subtext: `${fmtNum(totals.totalConversions)} conversii`, change: pct(totals.totalSpend, pt?.totalSpend), invertChange: true }
			];

		case 'PERFORMANCE_MAX':
			return [
				{ key: 'conversions', label: 'Conversii', icon: 'target', value: fmtNum(totals.totalConversions), subtext: `${fmtCur(totals.avgCostPerConversion, currency)} cost/conversie`, change: pct(totals.totalConversions, pt?.totalConversions) },
				{ key: 'roas', label: 'ROAS', icon: 'trending-up', value: fmtRoas(totals.roas), subtext: `${fmtCur(totals.totalConversionValue, currency)} venituri`, change: pct(totals.roas, pt?.roas) },
				{ key: 'costPerConv', label: 'Cost/conversie', icon: 'dollar-sign', value: fmtCur(totals.avgCostPerConversion, currency), subtext: `${fmtNum(totals.totalConversions)} conversii`, change: pct(totals.avgCostPerConversion, pt?.avgCostPerConversion), invertChange: true },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: fmtCur(totals.totalSpend, currency), subtext: `${fmtNum(totals.totalImpressions)} impresii`, change: pct(totals.totalSpend, pt?.totalSpend), invertChange: true },
				{ key: 'impressions', label: 'Impresii', icon: 'eye', value: fmtNum(totals.totalImpressions), subtext: `${fmtPct(totals.avgCtr)} CTR`, change: pct(totals.totalImpressions, pt?.totalImpressions) }
			];

		case 'VIDEO':
			return [
				{ key: 'impressions', label: 'Impresii', icon: 'eye', value: fmtNum(totals.totalImpressions), subtext: `${fmtCur(totals.avgCpm, currency)} CPM`, change: pct(totals.totalImpressions, pt?.totalImpressions) },
				{ key: 'cpm', label: 'CPM', icon: 'eye', value: fmtCur(totals.avgCpm, currency), subtext: 'Cost per 1000 impresii', change: pct(totals.avgCpm, pt?.avgCpm), invertChange: true },
				{ key: 'clicks', label: 'Click-uri', icon: 'mouse-pointer-click', value: fmtNum(totals.totalClicks), subtext: `${fmtPct(totals.avgCtr)} CTR`, change: pct(totals.totalClicks, pt?.totalClicks) },
				{ key: 'ctr', label: 'CTR', icon: 'percent', value: fmtPct(totals.avgCtr), subtext: 'Click-through rate', change: pct(totals.avgCtr, pt?.avgCtr) },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: fmtCur(totals.totalSpend, currency), subtext: `${fmtNum(totals.totalConversions)} conversii`, change: pct(totals.totalSpend, pt?.totalSpend), invertChange: true }
			];

		case 'DEMAND_GEN':
			return [
				{ key: 'conversions', label: 'Conversii', icon: 'target', value: fmtNum(totals.totalConversions), subtext: `${fmtCur(totals.avgCostPerConversion, currency)} cost/conversie`, change: pct(totals.totalConversions, pt?.totalConversions) },
				{ key: 'costPerConv', label: 'Cost/conversie', icon: 'dollar-sign', value: fmtCur(totals.avgCostPerConversion, currency), subtext: `${fmtNum(totals.totalConversions)} conversii`, change: pct(totals.avgCostPerConversion, pt?.avgCostPerConversion), invertChange: true },
				{ key: 'ctr', label: 'CTR', icon: 'percent', value: fmtPct(totals.avgCtr), subtext: 'Click-through rate', change: pct(totals.avgCtr, pt?.avgCtr) },
				{ key: 'clicks', label: 'Click-uri', icon: 'mouse-pointer-click', value: fmtNum(totals.totalClicks), subtext: `${fmtCur(totals.avgCpc, currency)} CPC`, change: pct(totals.totalClicks, pt?.totalClicks) },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: fmtCur(totals.totalSpend, currency), subtext: `${fmtNum(totals.totalImpressions)} impresii`, change: pct(totals.totalSpend, pt?.totalSpend), invertChange: true }
			];

		default:
			// Mixed / all — generic KPIs
			return [];
	}
}

/** Aggregate Google ad group insights by ad group */
export function aggregateGoogleInsightsByAdGroup(insights: GoogleAdsAdGroupInsight[]): GoogleAdGroupAggregate[] {
	type Acc = {
		name: string; campaignId: string;
		spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
		videoViews: number; resultType: string; cpaLabel: string; dailyBudget: string | null;
	};
	const byAdGroup = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byAdGroup.get(row.adGroupId) || {
			name: row.adGroupName, campaignId: row.campaignId,
			spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
			videoViews: 0, resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			dailyBudget: row.dailyBudget
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.videoViews += row.videoViews;
		byAdGroup.set(row.adGroupId, existing);
	}

	return Array.from(byAdGroup.entries()).map(([adGroupId, d]) => ({
		adGroupId,
		adGroupName: d.name,
		campaignId: d.campaignId,
		spend: d.spend,
		impressions: d.impressions,
		clicks: d.clicks,
		conversions: d.conversions,
		conversionValue: d.conversionValue,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		conversionRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
		videoViews: d.videoViews,
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		dailyBudget: d.dailyBudget
	}));
}
