import type { GoogleAdsCampaignInsight, GoogleAdsAdGroupInsight } from '$lib/server/google-ads/client';
import type { DailyAggregate } from './report-helpers';

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
	costPerConversion: number;
	roas: number;
	videoViews: number;
	resultType: string;
	cpaLabel: string;
	dailyBudget: string | null;
}

/** Aggregate Google campaign insights by date for time-series charts */
export function aggregateGoogleInsightsByDate(insights: GoogleAdsCampaignInsight[]): DailyAggregate[] {
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
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
		videoViews: d.videoViews,
		resultType: d.resultType,
		cpaLabel: d.cpaLabel
	}));
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
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
		videoViews: d.videoViews,
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		dailyBudget: d.dailyBudget
	}));
}
