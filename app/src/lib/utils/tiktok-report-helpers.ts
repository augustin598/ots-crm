import type { TiktokAdsCampaignInsight, TiktokAdsAdGroupInsight } from '$lib/server/tiktok-ads/client';
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
	// Engagement
	likes: number;
	comments: number;
	shares: number;
	follows: number;
	profileVisits: number;
	// Video
	videoViewsP25: number;
	videoViewsP50: number;
	videoViewsP75: number;
	videoViewsP100: number;
	videoViews2s: number;
	videoViews6s: number;
	focusedView6s: number;
	averageVideoPlayPerUser: number;
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
		likes: number; comments: number; shares: number; follows: number; profileVisits: number;
		videoViewsP25: number; videoViewsP50: number; videoViewsP75: number; videoViewsP100: number;
		videoViews2s: number; videoViews6s: number; focusedView6s: number;
		totalVideoPlayTime: number; videoPlayCount: number;
	};
	const byCampaign = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byCampaign.get(row.campaignId) || {
			name: row.campaignName, objective: row.objective,
			spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			likes: 0, comments: 0, shares: 0, follows: 0, profileVisits: 0,
			videoViewsP25: 0, videoViewsP50: 0, videoViewsP75: 0, videoViewsP100: 0,
			videoViews2s: 0, videoViews6s: 0, focusedView6s: 0,
			totalVideoPlayTime: 0, videoPlayCount: 0
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
		existing.videoViewsP25 += row.videoViewsP25;
		existing.videoViewsP50 += row.videoViewsP50;
		existing.videoViewsP75 += row.videoViewsP75;
		existing.videoViewsP100 += row.videoViewsP100;
		existing.videoViews2s += row.videoViews2s;
		existing.videoViews6s += row.videoViews6s;
		existing.focusedView6s += row.focusedView6s;
		// For average: accumulate total play time and count
		if (row.averageVideoPlayPerUser > 0) {
			existing.totalVideoPlayTime += row.averageVideoPlayPerUser;
			existing.videoPlayCount += 1;
		}
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
		videoViewsP25: d.videoViewsP25,
		videoViewsP50: d.videoViewsP50,
		videoViewsP75: d.videoViewsP75,
		videoViewsP100: d.videoViewsP100,
		videoViews2s: d.videoViews2s,
		videoViews6s: d.videoViews6s,
		focusedView6s: d.focusedView6s,
		averageVideoPlayPerUser: d.videoPlayCount > 0 ? d.totalVideoPlayTime / d.videoPlayCount : 0
	}));
}

export interface TiktokAdGroupAggregate {
	adgroupId: string;
	adgroupName: string;
	campaignId: string;
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
	videoViewsP25: number;
	videoViewsP50: number;
	videoViewsP75: number;
	videoViewsP100: number;
	videoViews2s: number;
	videoViews6s: number;
	focusedView6s: number;
	averageVideoPlayPerUser: number;
	dailyBudget: string | null;
	lifetimeBudget: string | null;
	optimizationGoal: string;
}

/** Aggregate TikTok ad group insights by ad group for expandable table rows */
export function aggregateTiktokInsightsByAdGroup(insights: TiktokAdsAdGroupInsight[]): TiktokAdGroupAggregate[] {
	type Acc = {
		name: string; campaignId: string;
		spend: number; impressions: number; reach: number; clicks: number; conversions: number;
		resultType: string; cpaLabel: string;
		likes: number; comments: number; shares: number; follows: number; profileVisits: number;
		videoViewsP25: number; videoViewsP50: number; videoViewsP75: number; videoViewsP100: number;
		videoViews2s: number; videoViews6s: number; focusedView6s: number;
		totalVideoPlayTime: number; videoPlayCount: number;
		dailyBudget: string | null; lifetimeBudget: string | null; optimizationGoal: string;
	};
	const byAdGroup = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byAdGroup.get(row.adgroupId) || {
			name: row.adgroupName, campaignId: row.campaignId,
			spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			likes: 0, comments: 0, shares: 0, follows: 0, profileVisits: 0,
			videoViewsP25: 0, videoViewsP50: 0, videoViewsP75: 0, videoViewsP100: 0,
			videoViews2s: 0, videoViews6s: 0, focusedView6s: 0,
			totalVideoPlayTime: 0, videoPlayCount: 0,
			dailyBudget: row.dailyBudget, lifetimeBudget: row.lifetimeBudget, optimizationGoal: row.optimizationGoal
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
		existing.videoViewsP25 += row.videoViewsP25;
		existing.videoViewsP50 += row.videoViewsP50;
		existing.videoViewsP75 += row.videoViewsP75;
		existing.videoViewsP100 += row.videoViewsP100;
		existing.videoViews2s += row.videoViews2s;
		existing.videoViews6s += row.videoViews6s;
		existing.focusedView6s += row.focusedView6s;
		if (row.averageVideoPlayPerUser > 0) {
			existing.totalVideoPlayTime += row.averageVideoPlayPerUser;
			existing.videoPlayCount += 1;
		}
		if (row.resultType && !existing.resultType) existing.resultType = row.resultType;
		if (row.cpaLabel && existing.cpaLabel === 'CPA') existing.cpaLabel = row.cpaLabel;
		byAdGroup.set(row.adgroupId, existing);
	}

	return Array.from(byAdGroup.entries()).map(([adgroupId, d]) => ({
		adgroupId,
		adgroupName: d.name,
		campaignId: d.campaignId,
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
		videoViewsP25: d.videoViewsP25,
		videoViewsP50: d.videoViewsP50,
		videoViewsP75: d.videoViewsP75,
		videoViewsP100: d.videoViewsP100,
		videoViews2s: d.videoViews2s,
		videoViews6s: d.videoViews6s,
		focusedView6s: d.focusedView6s,
		averageVideoPlayPerUser: d.videoPlayCount > 0 ? d.totalVideoPlayTime / d.videoPlayCount : 0,
		dailyBudget: d.dailyBudget,
		lifetimeBudget: d.lifetimeBudget,
		optimizationGoal: d.optimizationGoal
	}));
}
