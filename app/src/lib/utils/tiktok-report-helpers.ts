import type { TiktokAdsCampaignInsight } from '$lib/server/tiktok-ads/client';
import type { DailyAggregate } from './report-helpers';

export interface TiktokCampaignAggregate {
	campaignId: string;
	campaignName: string;
	objective: string;
	spend: number;
	impressions: number;
	reach: number;
	frequency: number;
	clicks: number;
	conversions: number;
	cpc: number;
	cpm: number;
	ctr: number;
	costPerConversion: number;
	resultType: string;
	cpaLabel: string;
	likes: number;
	comments: number;
	shares: number;
	follows: number;
	profileVisits: number;
	videoViewsP100: number;
}

/** Aggregate TikTok campaign insights by date for time-series charts */
export function aggregateTiktokInsightsByDate(insights: TiktokAdsCampaignInsight[]): DailyAggregate[] {
	const byDate = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();

	for (const row of insights) {
		const date = row.dateStart;
		const existing = byDate.get(date) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
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
			conversionValue: 0,
			cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
			cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
			ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
			costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
			roas: 0
		}));
}

/** Aggregate TikTok campaign insights by campaign for the table */
export function aggregateTiktokInsightsByCampaign(insights: TiktokAdsCampaignInsight[]): TiktokCampaignAggregate[] {
	type Acc = {
		name: string; objective: string;
		spend: number; impressions: number; reach: number; clicks: number; conversions: number;
		resultType: string; cpaLabel: string;
		likes: number; comments: number; shares: number; follows: number; profileVisits: number; videoViewsP100: number;
	};
	const byCampaign = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byCampaign.get(row.campaignId) || {
			name: row.campaignName, objective: row.objective,
			spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			likes: 0, comments: 0, shares: 0, follows: 0, profileVisits: 0, videoViewsP100: 0
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.reach += parseInt(row.reach || '0');
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.likes += row.likes;
		existing.comments += row.comments;
		existing.shares += row.shares;
		existing.follows += row.follows;
		existing.profileVisits += row.profileVisits;
		existing.videoViewsP100 += row.videoViewsP100;
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
		frequency: d.reach > 0 ? d.impressions / d.reach : 0,
		clicks: d.clicks,
		conversions: d.conversions,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		likes: d.likes,
		comments: d.comments,
		shares: d.shares,
		follows: d.follows,
		profileVisits: d.profileVisits,
		videoViewsP100: d.videoViewsP100
	}));
}
