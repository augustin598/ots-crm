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

export interface TiktokAdsCampaignInsight {
	campaignId: string;
	campaignName: string;
	objective: string;
	spend: string;
	impressions: string;
	reach: string;
	frequency: string;
	clicks: string;
	cpc: string;
	cpm: string;
	ctr: string;
	conversions: number;
	costPerConversion: number;
	resultType: string;
	cpaLabel: string;
	// Engagement
	likes: number;
	comments: number;
	shares: number;
	follows: number;
	profileVisits: number;
	// Video metrics
	videoViewsP25: number;
	videoViewsP50: number;
	videoViewsP75: number;
	videoViewsP100: number;
	videoViews2s: number;
	videoViews6s: number;
	focusedView6s: number;
	averageVideoPlayPerUser: number;
	dateStart: string;
	dateStop: string;
}

export interface TiktokAdsCampaignInfo {
	campaignId: string;
	campaignName: string;
	status: string;
	objective: string;
	optimizationGoal: string;
	dailyBudget: string | null;
	lifetimeBudget: string | null;
	createTime: string | null;
	modifyTime: string | null;
}

export interface TiktokAdsAdGroupInsight {
	adgroupId: string;
	adgroupName: string;
	campaignId: string;
	spend: string;
	impressions: string;
	reach: string;
	frequency: string;
	clicks: string;
	cpc: string;
	cpm: string;
	ctr: string;
	conversions: number;
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
	dateStart: string;
	dateStop: string;
}

export interface DemographicSegment {
	label: string;
	spend: number;
	impressions: number;
	clicks: number;
	results: number;
}

export interface TiktokDemographicBreakdown {
	gender: DemographicSegment[];
	age: DemographicSegment[];
	region: DemographicSegment[];
	devicePlatform: DemographicSegment[];
}

/** Map TikTok objective types to result labels */
/** Fallback: campaign objective → result label (used when optimization_goal is unknown) */
export const TIKTOK_OBJECTIVE_MAP: Record<string, { label: string; cpaLabel: string }> = {
	TRAFFIC: { label: 'Click-uri', cpaLabel: 'Cost/click' },
	CONVERSIONS: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	APP_INSTALL: { label: 'Instalări app', cpaLabel: 'Cost/instalare' },
	APP_PROMOTION: { label: 'Instalări app', cpaLabel: 'Cost/instalare' },
	LEAD_GENERATION: { label: 'Lead-uri', cpaLabel: 'Cost/lead' },
	VIDEO_VIEWS: { label: 'Vizualizări video', cpaLabel: 'Cost/vizualizare' },
	REACH: { label: 'Reach', cpaLabel: 'Cost/1000 persoane' },
	PRODUCT_SALES: { label: 'Vânzări', cpaLabel: 'Cost/vânzare' },
	ENGAGEMENT: { label: 'Interacțiuni', cpaLabel: 'Cost/interacțiune' },
	WEB_CONVERSIONS: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	CATALOG_SALES: { label: 'Vânzări catalog', cpaLabel: 'Cost/vânzare' },
};

/** Ad group optimization_goal → precise result label (more accurate than objective) */
export const OPTIMIZATION_GOAL_MAP: Record<string, { label: string; cpaLabel: string }> = {
	CLICK: { label: 'Click-uri', cpaLabel: 'Cost/click' },
	CONVERT: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	INSTALL: { label: 'Instalări app', cpaLabel: 'Cost/instalare' },
	SHOW: { label: 'Impresii', cpaLabel: 'Cost/1000 impresii' },
	REACH: { label: 'Reach', cpaLabel: 'Cost/1000 persoane' },
	VIDEO_VIEW: { label: 'Vizualizări video', cpaLabel: 'Cost/vizualizare' },
	LANDING_PAGE_VIEW: { label: 'Vizite pagină', cpaLabel: 'Cost/vizită' },
	ENGAGED_VIEW: { label: 'Vizualizări 6s+', cpaLabel: 'Cost/vizualizare' },
	LEAD_GENERATION: { label: 'Lead-uri', cpaLabel: 'Cost/lead' },
	VALUE: { label: 'Conversii (valoare)', cpaLabel: 'Cost/conversie' },
	IN_APP_EVENT: { label: 'Evenimente app', cpaLabel: 'Cost/eveniment' },
	COMPLETE_PAYMENT: { label: 'Achiziții', cpaLabel: 'Cost/achiziție' },
	SUBSCRIBE: { label: 'Abonamente', cpaLabel: 'Cost/abonament' },
	ADD_TO_CART: { label: 'Adăugări coș', cpaLabel: 'Cost/adăugare' },
	MT_LIVE_STREAMING_ROOM: { label: 'Vizite live', cpaLabel: 'Cost/vizită live' },
	PRODUCT_CATALOG_SALES: { label: 'Vânzări catalog', cpaLabel: 'Cost/vânzare' },
};

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
	const rawList = json.data?.list || [];
	const advertiserIds: string[] = rawList.map((item: any) =>
		typeof item === 'string' ? item : String(item.advertiser_id || item)
	);

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

	// TikTok API limits stat_time_day to max 30 days per request — split into monthly chunks
	const chunks = splitIntoMonthlyChunks(startDate, endDate);
	const monthlyMap = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; start: string; end: string }>();

	for (const chunk of chunks) {
		const params = new URLSearchParams({
			advertiser_id: advertiserId,
			report_type: 'BASIC',
			dimensions: JSON.stringify(['stat_time_day']),
			metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
			data_level: 'AUCTION_ADVERTISER',
			start_date: chunk.start,
			end_date: chunk.end,
			page_size: '1000'
		});

		const res = await fetch(`${TIKTOK_API_URL}/report/integrated/get/?${params.toString()}`, {
			headers: { 'Access-Token': accessToken }
		});

		const json = await res.json();

		if (json.code !== 0) {
			logError('tiktok-ads', `Insights API error for ${advertiserId}`, {
				metadata: { errorMessage: json.message, errorCode: json.code, chunk }
			});
			throw new Error(`TikTok API error: ${json.message || 'Unknown error'}`);
		}

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
		metadata: { startDate, endDate, chunks: chunks.length }
	});
	return insights;
}

/** Split a date range into monthly chunks of max 30 days for TikTok API */
function splitIntoMonthlyChunks(startDate: string, endDate: string): { start: string; end: string }[] {
	const chunks: { start: string; end: string }[] = [];
	const end = new Date(endDate);
	let cursor = new Date(startDate);

	while (cursor <= end) {
		const y = cursor.getFullYear();
		const m = cursor.getMonth();
		const lastDay = new Date(y, m + 1, 0).getDate();
		const monthEnd = new Date(y, m, lastDay);
		const chunkEnd = monthEnd < end ? monthEnd : end;

		const pad = (n: number) => String(n).padStart(2, '0');
		chunks.push({
			start: `${y}-${pad(m + 1)}-${pad(cursor.getDate())}`,
			end: `${chunkEnd.getFullYear()}-${pad(chunkEnd.getMonth() + 1)}-${pad(chunkEnd.getDate())}`
		});

		// Move to 1st of next month
		cursor = new Date(y, m + 1, 1);
	}

	return chunks;
}

/**
 * Fetch campaign-level daily reporting data for an advertiser.
 * POST /open_api/v1.3/report/integrated/get/
 */
export async function listCampaignInsights(
	advertiserId: string,
	accessToken: string,
	startDate: string,
	endDate: string
): Promise<TiktokAdsCampaignInsight[]> {
	logInfo('tiktok-ads', `Fetching campaign insights for ${advertiserId}`, { metadata: { startDate, endDate } });

	const allRows: any[] = [];
	let page = 1;
	const pageSize = 1000;

	while (true) {
		const params = new URLSearchParams({
			advertiser_id: advertiserId,
			report_type: 'BASIC',
			dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
			metrics: JSON.stringify([
				'spend', 'impressions', 'clicks',
				'result', 'cost_per_result', 'result_rate',
				'conversion', 'cost_per_conversion',
				'cpc', 'cpm', 'ctr',
				'reach', 'frequency',
				'complete_payment', 'real_time_result',
				'likes', 'comments', 'shares', 'follows', 'profile_visits',
				'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100',
				'video_play_actions', 'engaged_view', 'engaged_view_15s',
				'average_video_play_per_user'
			]),
			data_level: 'AUCTION_CAMPAIGN',
			start_date: startDate,
			end_date: endDate,
			page_size: String(pageSize),
			page: String(page)
		});

		const url = `${TIKTOK_API_URL}/report/integrated/get/?${params.toString()}`;

		const res = await fetch(url, {
			headers: { 'Access-Token': accessToken }
		});

		const responseText = await res.text();
		let json: any;
		try {
			json = JSON.parse(responseText);
		} catch {
			throw new Error(`TikTok API returned non-JSON response (HTTP ${res.status}): ${responseText.slice(0, 200)}`);
		}

		if (json.code !== 0) {
			logError('tiktok-ads', `Campaign insights API error for ${advertiserId}`, {
				metadata: { errorMessage: json.message, errorCode: json.code, requestId: json.request_id }
			});
			throw new Error(`TikTok API error: ${json.message || 'Unknown error'}`);
		}

		const rows = json.data?.list || [];
		allRows.push(...rows);

		const totalNumber = json.data?.page_info?.total_number || 0;
		if (allRows.length >= totalNumber || rows.length < pageSize) break;
		page++;
	}

	const insights: TiktokAdsCampaignInsight[] = allRows.map(row => {
		const m = row.metrics || {};
		const d = row.dimensions || {};
		const spend = parseFloat(m.spend || '0');
		// `result` = primary optimization goal (leads for LEAD_GENERATION, purchases for CONVERSIONS, etc.)
		// `conversion` = secondary goal. Fallback chain covers all objective types.
		const conversions = parseInt(m.result || '0')
			|| parseInt(m.conversion || '0')
			|| parseInt(m.complete_payment || '0')
			|| parseInt(m.real_time_result || '0');
		const costPerResult = parseFloat(m.cost_per_result || '0');

		return {
			campaignId: String(d.campaign_id || ''),
			campaignName: '',
			objective: '',
			spend: m.spend || '0',
			impressions: m.impressions || '0',
			reach: m.reach || '0',
			frequency: m.frequency || '0',
			clicks: m.clicks || '0',
			cpc: m.cpc || '0',
			cpm: m.cpm || '0',
			ctr: m.ctr || '0',
			conversions,
			costPerConversion: costPerResult > 0 ? costPerResult : (conversions > 0 ? spend / conversions : 0),
			resultType: '',
			cpaLabel: 'CPA',
			likes: parseInt(m.likes || '0'),
			comments: parseInt(m.comments || '0'),
			shares: parseInt(m.shares || '0'),
			follows: parseInt(m.follows || '0'),
			profileVisits: parseInt(m.profile_visits || '0'),
			videoViewsP25: parseInt(m.video_views_p25 || '0'),
			videoViewsP50: parseInt(m.video_views_p50 || '0'),
			videoViewsP75: parseInt(m.video_views_p75 || '0'),
			videoViewsP100: parseInt(m.video_views_p100 || '0'),
			videoViews2s: parseInt(m.video_play_actions || '0'),
			videoViews6s: parseInt(m.engaged_view || '0'),
			focusedView6s: parseInt(m.engaged_view || '0'),
			averageVideoPlayPerUser: parseFloat(m.average_video_play_per_user || '0'),
			dateStart: (d.stat_time_day || startDate).slice(0, 10),
			dateStop: (d.stat_time_day || endDate).slice(0, 10)
		};
	});

	// Debug: log sample row to help diagnose metric availability
	if (allRows.length > 0) {
		const sample = allRows[0].metrics || {};
		logInfo('tiktok-ads', `Got ${insights.length} rows for ${advertiserId}. Sample: result=${sample.result}, conversion=${sample.conversion}, cost_per_result=${sample.cost_per_result}, complete_payment=${sample.complete_payment}, reach=${sample.reach}`);
	} else {
		logInfo('tiktok-ads', `Got 0 rows for ${advertiserId} in period ${startDate}..${endDate}`);
	}
	return insights;
}

/**
 * List campaigns for an advertiser with status, budget, and objective info.
 * GET /open_api/v1.3/campaign/get/
 */
/**
 * Fetch ad group-level daily reporting data for a specific campaign.
 * GET /open_api/v1.3/report/integrated/get/ with data_level=AUCTION_ADGROUP
 */
export async function listAdGroupInsights(
	advertiserId: string,
	accessToken: string,
	campaignId: string,
	startDate: string,
	endDate: string
): Promise<TiktokAdsAdGroupInsight[]> {
	logInfo('tiktok-ads', `Fetching ad group insights for campaign ${campaignId}`, { metadata: { advertiserId, startDate, endDate } });

	const allRows: any[] = [];
	let page = 1;
	const pageSize = 1000;

	while (true) {
		const params = new URLSearchParams({
			advertiser_id: advertiserId,
			report_type: 'BASIC',
			dimensions: JSON.stringify(['adgroup_id', 'stat_time_day']),
			metrics: JSON.stringify([
				'spend', 'impressions', 'clicks',
				'result', 'cost_per_result',
				'conversion', 'cost_per_conversion',
				'cpc', 'cpm', 'ctr',
				'reach', 'frequency',
				'complete_payment', 'real_time_result',
				'likes', 'comments', 'shares', 'follows', 'profile_visits',
				'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100',
				'video_play_actions', 'engaged_view', 'average_video_play_per_user'
			]),
			data_level: 'AUCTION_ADGROUP',
			start_date: startDate,
			end_date: endDate,
			page_size: String(pageSize),
			page: String(page),
			filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campaignId]) }])
		});

		const url = `${TIKTOK_API_URL}/report/integrated/get/?${params.toString()}`;
		const res = await fetch(url, { headers: { 'Access-Token': accessToken } });
		const responseText = await res.text();
		let json: any;
		try {
			json = JSON.parse(responseText);
		} catch {
			throw new Error(`TikTok API returned non-JSON response (HTTP ${res.status})`);
		}

		if (json.code !== 0) {
			logError('tiktok-ads', `Ad group insights API error`, {
				metadata: { errorMessage: json.message, errorCode: json.code, campaignId }
			});
			throw new Error(`TikTok API error: ${json.message || 'Unknown error'}`);
		}

		const rows = json.data?.list || [];
		allRows.push(...rows);

		const totalNumber = json.data?.page_info?.total_number || 0;
		if (allRows.length >= totalNumber || rows.length < pageSize) break;
		page++;
	}

	// Get ad group names from /adgroup/get/
	const adgroupNames = new Map<string, { name: string; budget: string | null; budgetMode: string; optimizationGoal: string }>();
	try {
		const agParams = new URLSearchParams({
			advertiser_id: advertiserId,
			page_size: '1000',
			fields: JSON.stringify(['adgroup_id', 'adgroup_name', 'campaign_id', 'budget', 'budget_mode', 'optimization_goal']),
			filtering: JSON.stringify({ campaign_ids: [campaignId] })
		});
		const agRes = await fetch(`${TIKTOK_API_URL}/adgroup/get/?${agParams.toString()}`, {
			headers: { 'Access-Token': accessToken }
		});
		const agJson = await agRes.json();
		if (agJson.code === 0 && agJson.data?.list) {
			const DAILY_MODES = new Set(['BUDGET_MODE_DAY', 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET']);
			for (const ag of agJson.data.list) {
				const budget = parseFloat(ag.budget || '0');
				const mode = ag.budget_mode || '';
				adgroupNames.set(String(ag.adgroup_id), {
					name: ag.adgroup_name || `Ad Group ${ag.adgroup_id}`,
					budget: budget > 0 && mode !== 'BUDGET_MODE_INFINITE' ? String(budget) : null,
					budgetMode: mode,
					optimizationGoal: ag.optimization_goal || ''
				});
			}
		}
	} catch { /* ad group names are optional */ }

	const insights: TiktokAdsAdGroupInsight[] = allRows.map(row => {
		const m = row.metrics || {};
		const d = row.dimensions || {};
		const spend = parseFloat(m.spend || '0');
		const conversions = parseInt(m.result || '0') || parseInt(m.conversion || '0') || parseInt(m.complete_payment || '0') || parseInt(m.real_time_result || '0');
		const costPerResult = parseFloat(m.cost_per_result || '0');
		const adgroupId = String(d.adgroup_id || '');
		const agInfo = adgroupNames.get(adgroupId);
		const DAILY_MODES = new Set(['BUDGET_MODE_DAY', 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET']);

		return {
			adgroupId,
			adgroupName: agInfo?.name || `Ad Group ${adgroupId}`,
			campaignId,
			spend: m.spend || '0',
			impressions: m.impressions || '0',
			reach: m.reach || '0',
			frequency: m.frequency || '0',
			clicks: m.clicks || '0',
			cpc: m.cpc || '0',
			cpm: m.cpm || '0',
			ctr: m.ctr || '0',
			conversions,
			costPerConversion: costPerResult > 0 ? costPerResult : (conversions > 0 ? spend / conversions : 0),
			resultType: '',
			cpaLabel: 'CPA',
			likes: parseInt(m.likes || '0'),
			comments: parseInt(m.comments || '0'),
			shares: parseInt(m.shares || '0'),
			follows: parseInt(m.follows || '0'),
			profileVisits: parseInt(m.profile_visits || '0'),
			videoViewsP25: parseInt(m.video_views_p25 || '0'),
			videoViewsP50: parseInt(m.video_views_p50 || '0'),
			videoViewsP75: parseInt(m.video_views_p75 || '0'),
			videoViewsP100: parseInt(m.video_views_p100 || '0'),
			videoViews2s: parseInt(m.video_play_actions || '0'),
			videoViews6s: parseInt(m.engaged_view || '0'),
			focusedView6s: parseInt(m.engaged_view || '0'),
			averageVideoPlayPerUser: parseFloat(m.average_video_play_per_user || '0'),
			dailyBudget: agInfo?.budget && DAILY_MODES.has(agInfo.budgetMode) ? agInfo.budget : null,
			lifetimeBudget: agInfo?.budget && agInfo.budgetMode === 'BUDGET_MODE_TOTAL' ? agInfo.budget : null,
			optimizationGoal: agInfo?.optimizationGoal || '',
			dateStart: (d.stat_time_day || startDate).slice(0, 10),
			dateStop: (d.stat_time_day || endDate).slice(0, 10)
		};
	});

	logInfo('tiktok-ads', `Got ${insights.length} ad group insight rows for campaign ${campaignId}`);
	return insights;
}

export async function listCampaigns(
	advertiserId: string,
	accessToken: string
): Promise<TiktokAdsCampaignInfo[]> {
	logInfo('tiktok-ads', `Listing campaigns for ${advertiserId}`);

	const allCampaigns: TiktokAdsCampaignInfo[] = [];
	let page = 1;
	const pageSize = 1000;

	// Normalize TikTok status to ACTIVE/PAUSED/DELETED
	const STATUS_MAP: Record<string, string> = {
		CAMPAIGN_STATUS_ENABLE: 'ACTIVE',
		CAMPAIGN_STATUS_DISABLE: 'PAUSED',
		CAMPAIGN_STATUS_DELETE: 'DELETED',
		CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY: 'REJECTED',
		CAMPAIGN_STATUS_ADVERTISER_AUDIT: 'IN_REVIEW',
		ENABLE: 'ACTIVE',
		DISABLE: 'PAUSED',
		DELETE: 'DELETED'
	};

	while (true) {
		const params = new URLSearchParams({
			advertiser_id: advertiserId,
			page_size: String(pageSize),
			page: String(page),
			fields: JSON.stringify([
				'campaign_id', 'campaign_name', 'operation_status', 'secondary_status',
				'objective_type', 'budget_mode', 'budget', 'budget_optimize_on', 'create_time', 'modify_time'
			])
		});

		const res = await fetch(`${TIKTOK_API_URL}/campaign/get/?${params.toString()}`, {
			headers: { 'Access-Token': accessToken }
		});

		const json = await res.json();

		if (json.code !== 0) {
			logError('tiktok-ads', `Campaigns API error for ${advertiserId}`, {
				metadata: { errorMessage: json.message, errorCode: json.code }
			});
			throw new Error(`TikTok API error: ${json.message || 'Unknown error'}`);
		}

		const list = json.data?.list || [];
		for (const c of list) {
			const rawStatus = c.operation_status || c.secondary_status || c.status || '';
			const budgetMode = c.budget_mode || '';
			const budget = c.budget ? String(c.budget) : null;

			allCampaigns.push({
				campaignId: String(c.campaign_id),
				campaignName: c.campaign_name || `Campaign ${c.campaign_id}`,
				status: STATUS_MAP[rawStatus] || rawStatus,
				objective: c.objective_type || c.objective || '',
				optimizationGoal: '', // filled from ad group level
				dailyBudget: (budgetMode === 'BUDGET_MODE_DAY' || budgetMode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET') ? budget : null,
				lifetimeBudget: budgetMode === 'BUDGET_MODE_TOTAL' ? budget : null,
				createTime: c.create_time ? String(c.create_time).slice(0, 10) : null,
				modifyTime: c.modify_time ? String(c.modify_time).slice(0, 10) : null
			});
		}

		const totalNumber = json.data?.page_info?.total_number || 0;
		if (allCampaigns.length >= totalNumber || list.length < pageSize) break;
		page++;
	}

	// For campaigns without budget (BUDGET_MODE_INFINITE), fetch from ad group level
	const noBudgetCampaigns = allCampaigns.filter(c => !c.dailyBudget && !c.lifetimeBudget);
	if (noBudgetCampaigns.length > 0) {
		try {
			const adgroupParams = new URLSearchParams({
				advertiser_id: advertiserId,
				page_size: '1000',
				fields: JSON.stringify(['adgroup_id', 'campaign_id', 'budget', 'budget_mode', 'optimization_goal'])
			});
			const adgroupRes = await fetch(`${TIKTOK_API_URL}/adgroup/get/?${adgroupParams.toString()}`, {
				headers: { 'Access-Token': accessToken }
			});
			const adgroupJson = await adgroupRes.json();

			if (adgroupJson.code === 0 && adgroupJson.data?.list) {
				const adgroups = adgroupJson.data.list;
				if (adgroups.length > 0) {
					const sample = adgroups[0];
					logInfo('tiktok-ads', `Ad groups: ${adgroups.length} found. Sample: budget=${sample.budget}, budget_mode=${sample.budget_mode}, optimization_goal=${sample.optimization_goal}, campaign_id=${sample.campaign_id}`);
				}

				// Apply optimization_goal from first ad group to ALL campaigns
				const campaignGoalMap = new Map<string, string>();
				for (const ag of adgroups) {
					const cid = String(ag.campaign_id);
					if (!campaignGoalMap.has(cid) && ag.optimization_goal) {
						campaignGoalMap.set(cid, ag.optimization_goal);
					}
				}
				for (const campaign of allCampaigns) {
					const goal = campaignGoalMap.get(campaign.campaignId);
					if (goal) campaign.optimizationGoal = goal;
				}

				// Group ad groups by campaign_id and sum budgets
				const campaignAdgroups = new Map<string, Array<{ budget: number; mode: string }>>();
				// Daily-type budget modes (all treated as daily budget)
				const DAILY_MODES = new Set(['BUDGET_MODE_DAY', 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET']);
				const LIFETIME_MODES = new Set(['BUDGET_MODE_TOTAL']);

				for (const ag of adgroups) {
					const cid = String(ag.campaign_id);
					const budget = parseFloat(ag.budget || '0');
					const mode = ag.budget_mode || '';
					if (budget > 0 && mode && mode !== 'BUDGET_MODE_INFINITE') {
						const list = campaignAdgroups.get(cid) || [];
						list.push({ budget, mode });
						campaignAdgroups.set(cid, list);
					}
				}

				// Apply summed ad group budgets to campaigns
				for (const campaign of noBudgetCampaigns) {
					const agList = campaignAdgroups.get(campaign.campaignId);
					if (!agList || agList.length === 0) continue;

					// Sum budgets — treat BUDGET_MODE_DYNAMIC_DAILY_BUDGET as daily
					const dailySum = agList.filter(a => DAILY_MODES.has(a.mode)).reduce((s, a) => s + a.budget, 0);
					const lifetimeSum = agList.filter(a => LIFETIME_MODES.has(a.mode)).reduce((s, a) => s + a.budget, 0);

					if (dailySum > 0) {
						campaign.dailyBudget = String(dailySum);
					} else if (lifetimeSum > 0) {
						campaign.lifetimeBudget = String(lifetimeSum);
					}
				}

				const resolved = noBudgetCampaigns.filter(c => c.dailyBudget || c.lifetimeBudget).length;
				logInfo('tiktok-ads', `Ad group budget: ${resolved}/${noBudgetCampaigns.length} campaigns resolved from ${adgroups.length} ad groups`);
			} else {
				logError('tiktok-ads', `Ad group API error`, {
					metadata: { errorCode: adgroupJson.code, errorMessage: adgroupJson.message }
				});
			}
		} catch (e) {
			logError('tiktok-ads', `Ad group budget fetch failed`, {
				metadata: { error: e instanceof Error ? e.message : String(e) }
			});
		}
	}

	const withBudget = allCampaigns.filter(c => c.dailyBudget || c.lifetimeBudget);
	logInfo('tiktok-ads', `Found ${allCampaigns.length} campaigns for ${advertiserId}. ${withBudget.length} with budget`);
	return allCampaigns;
}

/**
 * Fetch demographic breakdowns (gender, age, country, platform) for an advertiser.
 * Makes 4 parallel API calls, one per breakdown type.
 */
export async function listDemographicInsights(
	advertiserId: string,
	accessToken: string,
	startDate: string,
	endDate: string,
	campaignIds?: string[]
): Promise<TiktokDemographicBreakdown> {
	logInfo('tiktok-ads', `Fetching demographics for ${advertiserId}`, { metadata: { startDate, endDate } });

	async function fetchBreakdown(dimension: string): Promise<any[]> {
		const params = new URLSearchParams({
			advertiser_id: advertiserId,
			report_type: 'AUDIENCE',
			dimensions: JSON.stringify([dimension]),
			metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
			data_level: 'AUCTION_ADVERTISER',
			start_date: startDate,
			end_date: endDate,
			page_size: '1000'
		});

		// Note: TikTok AUDIENCE report_type does NOT support campaign_ids filtering
		// Demographics are always at advertiser level for the selected date range

		const url = `${TIKTOK_API_URL}/report/integrated/get/?${params.toString()}`;
		const res = await fetch(url, {
			headers: { 'Access-Token': accessToken }
		});

		const text = await res.text();
		let json: any;
		try {
			json = JSON.parse(text);
		} catch {
			logError('tiktok-ads', `Demographics JSON parse error for ${dimension}`, {
				metadata: { status: res.status, preview: text.slice(0, 200) }
			});
			return [];
		}

		if (json.code !== 0) {
			logError('tiktok-ads', `Demographics API error (${dimension})`, {
				metadata: { errorMessage: json.message, errorCode: json.code }
			});
			return [];
		}

		return json.data?.list || [];
	}

	function parseSegments(rows: any[], dimensionKey: string): DemographicSegment[] {
		const byLabel = new Map<string, DemographicSegment>();

		for (const row of rows) {
			const label = row.dimensions?.[dimensionKey] || 'unknown';
			const m = row.metrics || {};
			const existing = byLabel.get(label) || { label, spend: 0, impressions: 0, clicks: 0, results: 0 };
			existing.spend += parseFloat(m.spend || '0');
			existing.impressions += parseInt(m.impressions || '0');
			existing.clicks += parseInt(m.clicks || '0');
			existing.results += parseInt(m.conversion || '0');
			byLabel.set(label, existing);
		}

		return Array.from(byLabel.values()).sort((a, b) => b.spend - a.spend);
	}

	// Normalize labels
	const GENDER_MAP: Record<string, string> = { MALE: 'male', FEMALE: 'female', UNKNOWN: 'unknown', NONE: 'unknown', '': 'unknown' };
	const AGE_MAP: Record<string, string> = {
		AGE_13_17: '13-17', AGE_18_24: '18-24', AGE_25_34: '25-34',
		AGE_35_44: '35-44', AGE_45_54: '45-54', AGE_55_100: '55+',
		AGE_UNKNOWN: 'unknown', NONE: 'unknown', '': 'unknown'
	};
	const DEVICE_MAP: Record<string, string> = {
		ANDROID: 'mobile_app', IOS: 'mobile_app', IPHONE: 'mobile_app', IPAD: 'mobile_app',
		PC: 'desktop', DESKTOP: 'desktop', UNKNOWN: 'unknown',
		MOBILE_APP: 'mobile_app', MOBILE_WEB: 'mobile_web'
	};

	/**
	 * Resolve province IDs to names.
	 * Strategy 1: GET /tool/region/ with level_range=TO_PROVINCE (lists all provinces)
	 * Strategy 2: POST /tool/targeting/info/ with scene=GEO (resolves specific IDs)
	 * Docs: https://business-api.tiktok.com/portal/docs?id=1761237614418945
	 */
	async function resolveProvinceNames(provinceIds: string[]): Promise<Map<string, string>> {
		const nameMap = new Map<string, string>();
		if (provinceIds.length === 0) return nameMap;

		// Strategy 1: GET /tool/region/ — lists all provinces with IDs and names
		try {
			const regionParams = new URLSearchParams({
				advertiser_id: advertiserId,
				placements: JSON.stringify(['PLACEMENT_TIKTOK']),
				objective_type: 'TRAFFIC',
				level_range: 'TO_PROVINCE'
			});
			const regionRes = await fetch(`${TIKTOK_API_URL}/tool/region/?${regionParams.toString()}`, {
				headers: { 'Access-Token': accessToken }
			});
			const regionJson = await regionRes.json();

			if (regionJson.code === 0 && regionJson.data) {
				// Log first item structure for diagnostic
				const dataKeys = Object.keys(regionJson.data);
				logInfo('tiktok-ads', `Region API response keys: [${dataKeys.join(', ')}]`);

				// Try to find the list of locations — could be nested
				const findLocations = (obj: any, depth = 0): any[] => {
					if (depth > 3) return [];
					if (Array.isArray(obj)) return obj;
					if (obj && typeof obj === 'object') {
						for (const key of Object.keys(obj)) {
							const result = findLocations(obj[key], depth + 1);
							if (result.length > 0) return result;
						}
					}
					return [];
				};

				// Walk through the response tree to find province entries
				const walkTree = (node: any, depth = 0) => {
					if (!node || depth > 5) return;
					if (Array.isArray(node)) {
						for (const item of node) walkTree(item, depth);
						return;
					}
					if (typeof node === 'object') {
						// Try to extract ID and name from this node
						const id = String(node.location_id || node.id || node.geo_id || '');
						const name = node.name || node.display_name || node.location_name || '';
						const level = node.level || node.location_type || '';
						if (id && name && provinceIds.includes(id)) {
							nameMap.set(id, name);
						}
						// Recurse into children
						for (const key of Object.keys(node)) {
							if (Array.isArray(node[key]) || (typeof node[key] === 'object' && node[key] !== null)) {
								walkTree(node[key], depth + 1);
							}
						}
					}
				};

				walkTree(regionJson.data);

				// Diagnostic: log sample items to understand structure
				const allLocations = findLocations(regionJson.data);
				if (allLocations.length > 0) {
					const sample = allLocations.slice(0, 2).map((item: any) => JSON.stringify(item).slice(0, 200));
					logInfo('tiktok-ads', `Region API: ${allLocations.length} locations found. Samples: ${sample.join(' | ')}`);
				}

				if (nameMap.size > 0) {
					logInfo('tiktok-ads', `Resolved ${nameMap.size}/${provinceIds.length} provinces via /tool/region/`);
				}
			} else {
				logError('tiktok-ads', `Region API error`, {
					metadata: { errorCode: regionJson.code, errorMessage: regionJson.message }
				});
			}
		} catch (e) {
			logError('tiktok-ads', `Region API failed`, {
				metadata: { error: e instanceof Error ? e.message : String(e) }
			});
		}

		// Strategy 2: POST /tool/targeting/info/ for any remaining unresolved IDs
		const unresolvedIds = provinceIds.filter(id => !nameMap.has(id));
		if (unresolvedIds.length > 0) {
			try {
				const infoRes = await fetch(`${TIKTOK_API_URL}/tool/targeting/info/`, {
					method: 'POST',
					headers: {
						'Access-Token': accessToken,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						advertiser_id: advertiserId,
						targeting_ids: unresolvedIds,
						scene: 'GEO',
						objective_type: 'TRAFFIC',
						placements: ['PLACEMENT_TIKTOK']
					})
				});
				const infoJson = await infoRes.json();

				if (infoJson.code === 0 && infoJson.data) {
					// Log raw structure for diagnostic
					const dataStr = JSON.stringify(infoJson.data).slice(0, 500);
					logInfo('tiktok-ads', `Targeting info response: ${dataStr}`);

					// Try all possible response shapes
					const list = infoJson.data.list || infoJson.data.targeting_list || (Array.isArray(infoJson.data) ? infoJson.data : []);
					for (const item of list) {
						const id = String(item.id || item.targeting_id || item.location_id || '');
						const name = item.name || item.display_name || item.location_name || '';
						if (id && name && unresolvedIds.includes(id)) {
							nameMap.set(id, name);
						}
					}

					if (nameMap.size > unresolvedIds.length) {
						logInfo('tiktok-ads', `Resolved additional provinces via /tool/targeting/info/`);
					}
				}
			} catch (e) {
				logError('tiktok-ads', `Targeting info API failed`, {
					metadata: { error: e instanceof Error ? e.message : String(e) }
				});
			}
		}

		// Log final status
		const stillUnresolved = provinceIds.filter(id => !nameMap.has(id));
		if (stillUnresolved.length > 0) {
			logInfo('tiktok-ads', `Unresolved province IDs: ${stillUnresolved.join(', ')}`);
		}

		return nameMap;
	}

	const [genderRows, ageRows, regionRows, platformRows] = await Promise.all([
		fetchBreakdown('gender'),
		fetchBreakdown('age'),
		fetchBreakdown('province_id'),
		fetchBreakdown('platform')
	]);

	// Filter out zero-spend "unknown"/"none" segments that add noise
	const filterNoise = (segments: DemographicSegment[]) => segments.filter(s => !(s.label === 'unknown' && s.spend === 0));

	const genderSegments = filterNoise(
		parseSegments(genderRows, 'gender').map(s => ({ ...s, label: GENDER_MAP[s.label] || GENDER_MAP[s.label.toUpperCase()] || s.label.toLowerCase() }))
	);
	const ageSegments = filterNoise(
		parseSegments(ageRows, 'age').map(s => ({ ...s, label: AGE_MAP[s.label] || AGE_MAP[s.label.toUpperCase()] || s.label.replace('AGE_', '').replace('_', '-') }))
	);
	// Filter out invalid province IDs (-1, empty, etc.)
	const rawRegionSegments = parseSegments(regionRows, 'province_id')
		.filter(s => s.label && s.label !== '-1' && s.label !== '0' && s.label !== 'unknown' && s.spend > 0);

	// Resolve province IDs to human-readable names
	const provinceIds = rawRegionSegments.map(s => s.label);
	const provinceNames = await resolveProvinceNames(provinceIds);
	const regionSegments = rawRegionSegments.map(s => ({
		...s,
		label: provinceNames.get(s.label) || s.label
	}));

	// Log unknown province IDs for future mapping
	const unmapped = regionSegments.filter(s => /^\d+$/.test(s.label));
	if (unmapped.length > 0) {
		logInfo('tiktok-ads', `Unresolved province IDs for ${advertiserId}: ${unmapped.map(s => s.label).join(', ')} — /tool/targeting/info/ did not return names`);
	}
	const deviceSegments = parseSegments(platformRows, 'platform');

	// Merge Android+iOS into mobile_app for device platform
	const deviceMap = new Map<string, DemographicSegment>();
	for (const s of deviceSegments) {
		const label = DEVICE_MAP[s.label.toUpperCase()] || DEVICE_MAP[s.label] || s.label.toLowerCase();
		const existing = deviceMap.get(label);
		if (existing) {
			existing.spend += s.spend;
			existing.impressions += s.impressions;
			existing.clicks += s.clicks;
			existing.results += s.results;
		} else {
			deviceMap.set(label, { ...s, label });
		}
	}

	const result = {
		gender: genderSegments,
		age: ageSegments,
		region: regionSegments,
		devicePlatform: Array.from(deviceMap.values()).sort((a, b) => b.spend - a.spend)
	};

	logInfo('tiktok-ads', `Demographics loaded for ${advertiserId}`, {
		metadata: { gender: result.gender.length, age: result.age.length, region: result.region.length, devicePlatform: result.devicePlatform.length }
	});

	return result;
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

export interface TiktokAdvertiserStatusInfo {
	advertiserId: string;
	accountName: string;
	status: string;
}

/**
 * Fetch advertiser info with raw status strings for a list of advertiser IDs.
 * Uses /advertiser/info/ endpoint.
 */
export async function fetchAdvertiserStatuses(
	advertiserIds: string[],
	accessToken: string
): Promise<TiktokAdvertiserStatusInfo[]> {
	if (advertiserIds.length === 0) return [];

	const params = new URLSearchParams({
		advertiser_ids: JSON.stringify(advertiserIds)
	});

	const res = await fetch(`${TIKTOK_API_URL}/advertiser/info/?${params.toString()}`, {
		headers: { 'Access-Token': accessToken },
		signal: AbortSignal.timeout(10_000)
	});

	const json = await res.json();
	if (json.code !== 0 || !json.data?.list) {
		throw new Error(`TikTok advertiser/info error: ${json.message || 'Unknown'}`);
	}

	return (json.data.list as any[]).map((adv) => ({
		advertiserId: String(adv.advertiser_id),
		accountName: adv.advertiser_name || adv.name || `Advertiser ${adv.advertiser_id}`,
		status: adv.status || 'STATUS_ENABLE'
	}));
}
