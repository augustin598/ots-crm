import { env } from '$env/dynamic/private';
import { logInfo, logError } from '$lib/server/logger';

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3';

export interface TiktokAdsAdAccount {
	advertiserId: string;
	accountName: string;
	isActive: boolean;
}

export interface TiktokAdsInsightData {
	spend: string; // e.g. "2207.59"
	impressions: string;
	clicks: string;
	conversions: string;
	dateStart: string; // "2026-02-01"
	dateStop: string; // "2026-02-28"
}

/**
 * List all advertiser accounts authorized via OAuth.
 * GET /open_api/v1.3/oauth2/advertiser/get/
 */
export async function listAdvertiserAccounts(accessToken: string): Promise<TiktokAdsAdAccount[]> {
	logInfo('tiktok-ads', 'Listing advertiser accounts');

	const params = new URLSearchParams({
		app_id: env.TIKTOK_APP_ID!,
		secret: env.TIKTOK_APP_SECRET!
	});

	const res = await fetch(`${TIKTOK_API_URL}/oauth2/advertiser/get/?${params.toString()}`, {
		headers: { 'Access-Token': accessToken }
	});

	const json = await res.json();

	if (json.code !== 0) {
		throw new Error(`TikTok API error: ${json.message || 'Unknown error'}`);
	}

	const accounts: TiktokAdsAdAccount[] = [];
	const advertiserIds: string[] = json.data?.list || [];

	if (advertiserIds.length === 0) {
		return accounts;
	}

	// Get advertiser info for each ID
	const infoParams = new URLSearchParams({
		advertiser_ids: JSON.stringify(advertiserIds)
	});

	const infoRes = await fetch(`${TIKTOK_API_URL}/advertiser/info/?${infoParams.toString()}`, {
		headers: { 'Access-Token': accessToken }
	});

	const infoJson = await infoRes.json();

	if (infoJson.code === 0 && infoJson.data?.list) {
		for (const adv of infoJson.data.list) {
			accounts.push({
				advertiserId: String(adv.advertiser_id),
				accountName: adv.advertiser_name || adv.name || `Advertiser ${adv.advertiser_id}`,
				isActive: adv.status === 'STATUS_ENABLE' || adv.status === undefined
			});
		}
	} else {
		// Fallback: use IDs without names
		for (const id of advertiserIds) {
			accounts.push({
				advertiserId: String(id),
				accountName: `Advertiser ${id}`,
				isActive: true
			});
		}
	}

	logInfo('tiktok-ads', `Found ${accounts.length} advertiser accounts`);
	return accounts;
}

/**
 * Fetch daily reporting data for an advertiser, aggregated to monthly.
 * POST /open_api/v1.3/report/integrated/get/
 */
export async function listAdvertiserInsights(
	advertiserId: string,
	accessToken: string,
	startDate: string,
	endDate: string
): Promise<TiktokAdsInsightData[]> {
	logInfo('tiktok-ads', `Fetching insights for ${advertiserId}`, { metadata: { startDate, endDate } });

	const body = {
		advertiser_id: advertiserId,
		report_type: 'BASIC',
		dimensions: ['stat_time_day'],
		metrics: ['spend', 'impressions', 'clicks', 'conversion'],
		data_level: 'AUCTION_ADVERTISER',
		start_date: startDate,
		end_date: endDate,
		page_size: 1000
	};

	const res = await fetch(`${TIKTOK_API_URL}/report/integrated/get/`, {
		method: 'POST',
		headers: {
			'Access-Token': accessToken,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	const json = await res.json();

	if (json.code !== 0) {
		logError('tiktok-ads', `Insights API error for ${advertiserId}`, {
			metadata: { errorMessage: json.message, errorCode: json.code }
		});
		throw new Error(`TikTok API error: ${json.message || 'Unknown error'}`);
	}

	// Aggregate daily data into monthly buckets
	const monthlyMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; start: string; end: string }>();

	for (const row of json.data?.list || []) {
		const dayStr = row.dimensions?.stat_time_day; // "2026-02-15"
		if (!dayStr) continue;

		const monthKey = dayStr.slice(0, 7); // "2026-02"
		const existing = monthlyMap.get(monthKey);
		const spend = parseFloat(row.metrics?.spend || '0');
		const impressions = parseInt(row.metrics?.impressions || '0');
		const clicks = parseInt(row.metrics?.clicks || '0');
		const conversions = parseInt(row.metrics?.conversion || '0');

		if (existing) {
			existing.spend += spend;
			existing.impressions += impressions;
			existing.clicks += clicks;
			existing.conversions += conversions;
			if (dayStr > existing.end) existing.end = dayStr;
		} else {
			// Calculate month boundaries
			const [y, m] = monthKey.split('-').map(Number);
			const lastDay = new Date(y, m, 0).getDate();
			const pad = (n: number) => String(n).padStart(2, '0');
			monthlyMap.set(monthKey, {
				spend,
				impressions,
				clicks,
				conversions,
				start: `${y}-${pad(m)}-01`,
				end: `${y}-${pad(m)}-${pad(lastDay)}`
			});
		}
	}

	const insights: TiktokAdsInsightData[] = [];
	for (const [, agg] of monthlyMap) {
		insights.push({
			spend: agg.spend.toFixed(2),
			impressions: String(agg.impressions),
			clicks: String(agg.clicks),
			conversions: String(agg.conversions),
			dateStart: agg.start,
			dateStop: agg.end
		});
	}

	// Sort by date ascending
	insights.sort((a, b) => a.dateStart.localeCompare(b.dateStart));

	logInfo('tiktok-ads', `Got ${insights.length} monthly periods for ${advertiserId}`, {
		metadata: { startDate, endDate }
	});
	return insights;
}

/**
 * Get the date range for sync (current + previous 2 months).
 * Returns YYYY-MM-DD strings.
 */
export function getSyncDateRange(referenceDate?: Date): { startDate: string; endDate: string } {
	const date = referenceDate || new Date();
	const startMonth = new Date(date.getFullYear(), date.getMonth() - 2, 1);
	const pad = (n: number) => String(n).padStart(2, '0');
	const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	return {
		startDate: formatLocal(startMonth),
		endDate: formatLocal(date)
	};
}
