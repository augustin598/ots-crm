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
	likes: number;
	comments: number;
	shares: number;
	follows: number;
	profileVisits: number;
	videoViewsP25: number;
	videoViewsP50: number;
	videoViewsP75: number;
	videoViewsP100: number;
	dateStart: string;
	dateStop: string;
}

export interface TiktokAdsCampaignInfo {
	campaignId: string;
	campaignName: string;
	status: string;
	objective: string;
	dailyBudget: string | null;
	lifetimeBudget: string | null;
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
				'spend', 'impressions', 'clicks', 'conversion',
				'cpc', 'cpm', 'ctr', 'cost_per_conversion'
			]),
			data_level: 'AUCTION_CAMPAIGN',
			start_date: startDate,
			end_date: endDate,
			page_size: String(pageSize),
			page: String(page)
		});

		const url = `${TIKTOK_API_URL}/report/integrated/get/?${params.toString()}`;
		console.log('[TIKTOK-ADS-DEBUG] Sending GET report request for', advertiserId);

		let res: Response;
		try {
			res = await fetch(url, {
				headers: { 'Access-Token': accessToken }
			});
		} catch (fetchErr) {
			console.error('[TIKTOK-ADS-DEBUG] Fetch failed:', fetchErr);
			throw fetchErr;
		}

		const responseText = await res.text();
		console.log('[TIKTOK-ADS-DEBUG] Response status:', res.status, 'body preview:', responseText.slice(0, 500));

		let json: any;
		try {
			json = JSON.parse(responseText);
		} catch {
			console.error('[TIKTOK-ADS-DEBUG] Failed to parse JSON. Full response:', responseText.slice(0, 2000));
			throw new Error(`TikTok API returned non-JSON response (HTTP ${res.status}): ${responseText.slice(0, 200)}`);
		}
		console.log('[TIKTOK-ADS-DEBUG] API response code:', json.code, 'message:', json.message, 'rows:', json.data?.list?.length ?? 0);

		if (json.code !== 0) {
			console.error('[TIKTOK-ADS-DEBUG] API ERROR:', JSON.stringify(json).slice(0, 1000));
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
		const conversions = parseInt(m.conversion || '0');

		return {
			campaignId: String(d.campaign_id || ''),
			campaignName: '', // filled later from listCampaigns
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
			costPerConversion: conversions > 0 ? spend / conversions : 0,
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
			dateStart: (d.stat_time_day || startDate).slice(0, 10),
			dateStop: (d.stat_time_day || endDate).slice(0, 10)
		};
	});

	logInfo('tiktok-ads', `Got ${insights.length} campaign insight rows for ${advertiserId}`);
	return insights;
}

/**
 * List campaigns for an advertiser with status, budget, and objective info.
 * GET /open_api/v1.3/campaign/get/
 */
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
			page: String(page)
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
				dailyBudget: budgetMode === 'BUDGET_MODE_DAY' ? budget : null,
				lifetimeBudget: budgetMode === 'BUDGET_MODE_TOTAL' ? budget : null
			});
		}

		const totalNumber = json.data?.page_info?.total_number || 0;
		if (allCampaigns.length >= totalNumber || list.length < pageSize) break;
		page++;
	}

	logInfo('tiktok-ads', `Found ${allCampaigns.length} campaigns for ${advertiserId}`);
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

		if (campaignIds && campaignIds.length > 0) {
			params.set('filtering', JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify(campaignIds) }]));
		}

		const url = `${TIKTOK_API_URL}/report/integrated/get/?${params.toString()}`;
		const res = await fetch(url, {
			headers: { 'Access-Token': accessToken }
		});

		const text = await res.text();
		let json: any;
		try {
			json = JSON.parse(text);
		} catch {
			console.error('[TIKTOK-ADS-DEBUG] Demographics parse error for', dimension, text.slice(0, 300));
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
	const GENDER_MAP: Record<string, string> = { MALE: 'male', FEMALE: 'female', UNKNOWN: 'unknown' };
	const AGE_MAP: Record<string, string> = {
		AGE_13_17: '13-17', AGE_18_24: '18-24', AGE_25_34: '25-34',
		AGE_35_44: '35-44', AGE_45_54: '45-54', AGE_55_100: '55+',
		AGE_UNKNOWN: 'unknown'
	};
	const DEVICE_MAP: Record<string, string> = {
		ANDROID: 'mobile_app', IOS: 'mobile_app', PC: 'desktop', UNKNOWN: 'unknown'
	};

	// Romanian province ID → name mapping (TikTok Ads targeting IDs)
	const ROMANIA_PROVINCES: Record<string, string> = {
		'665849': 'Suceava', '672460': 'Neamț', '684039': 'Botoșani',
		'665850': 'Iași', '665851': 'Bacău', '665852': 'Vaslui',
		'665853': 'Galați', '665854': 'Vrancea', '665855': 'Buzău',
		'665856': 'Brăila', '665857': 'Tulcea', '665858': 'Constanța',
		'665859': 'Călărași', '665860': 'Ialomița', '665861': 'Prahova',
		'665862': 'Dâmbovița', '665863': 'Argeș', '665864': 'Teleorman',
		'665865': 'Giurgiu', '665866': 'Ilfov', '665867': 'București',
		'665868': 'Olt', '665869': 'Dolj', '665870': 'Mehedinți',
		'665871': 'Gorj', '665872': 'Vâlcea', '665873': 'Sibiu',
		'665874': 'Brașov', '665875': 'Covasna', '665876': 'Harghita',
		'665877': 'Mureș', '665878': 'Alba', '665879': 'Hunedoara',
		'665880': 'Timiș', '665881': 'Caraș-Severin', '665882': 'Arad',
		'665883': 'Bihor', '665884': 'Sălaj', '665885': 'Satu Mare',
		'665886': 'Maramureș', '665887': 'Bistrița-Năsăud', '665888': 'Cluj',
	};

	// Resolve province IDs to names — try TikTok API first, fall back to hardcoded map
	async function resolveProvinceNames(provinceIds: string[]): Promise<Map<string, string>> {
		const nameMap = new Map<string, string>();
		if (provinceIds.length === 0) return nameMap;

		// Try TikTok targeting search API for each unknown ID
		const unknownIds = provinceIds.filter(id => !ROMANIA_PROVINCES[id]);
		if (unknownIds.length > 0) {
			try {
				for (const locationId of unknownIds.slice(0, 10)) {
					const params = new URLSearchParams({
						advertiser_id: advertiserId,
						location_types: JSON.stringify(['PROVINCE']),
						keyword: locationId,
						language: 'ro'
					});
					const res = await fetch(`${TIKTOK_API_URL}/tool/targeting/search/?${params.toString()}`, {
						headers: { 'Access-Token': accessToken }
					});
					const text = await res.text();
					try {
						const json = JSON.parse(text);
						if (json.code === 0 && json.data?.list) {
							for (const loc of json.data.list) {
								if (String(loc.id) === locationId || String(loc.location_id) === locationId) {
									nameMap.set(locationId, loc.name || loc.display_name || locationId);
								}
							}
						}
					} catch { /* ignore parse errors */ }
				}
			} catch { /* ignore API errors */ }
		}

		// Apply hardcoded mapping for known Romanian provinces
		for (const id of provinceIds) {
			if (!nameMap.has(id) && ROMANIA_PROVINCES[id]) {
				nameMap.set(id, ROMANIA_PROVINCES[id]);
			}
		}

		return nameMap;
	}

	const [genderRows, ageRows, regionRows, platformRows] = await Promise.all([
		fetchBreakdown('gender'),
		fetchBreakdown('age'),
		fetchBreakdown('province_id'),
		fetchBreakdown('platform')
	]);

	const genderSegments = parseSegments(genderRows, 'gender').map(s => ({ ...s, label: GENDER_MAP[s.label] || s.label.toLowerCase() }));
	const ageSegments = parseSegments(ageRows, 'age').map(s => ({ ...s, label: AGE_MAP[s.label] || s.label.replace('AGE_', '').replace('_', '-') }));
	const rawRegionSegments = parseSegments(regionRows, 'province_id');

	// Resolve province IDs to human-readable names
	const provinceIds = rawRegionSegments.map(s => s.label);
	const provinceNames = await resolveProvinceNames(provinceIds);
	const regionSegments = rawRegionSegments.map(s => ({
		...s,
		label: provinceNames.get(s.label) || s.label
	}));
	const deviceSegments = parseSegments(platformRows, 'platform');

	// Merge Android+iOS into mobile_app for device platform
	const deviceMap = new Map<string, DemographicSegment>();
	for (const s of deviceSegments) {
		const label = DEVICE_MAP[s.label] || s.label.toLowerCase();
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

	return {
		gender: genderSegments,
		age: ageSegments,
		region: regionSegments,
		devicePlatform: Array.from(deviceMap.values()).sort((a, b) => b.spend - a.spend)
	};
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
