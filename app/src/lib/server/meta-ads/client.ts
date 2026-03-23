import { logInfo, logError } from '$lib/server/logger';
import { createHmac } from 'crypto';

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

export interface MetaAdsAdAccount {
	adAccountId: string; // e.g. act_XXXXXXXXX
	accountName: string;
	accountStatus: number; // 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, etc.
	isActive: boolean;
}

export interface MetaAdsInsightData {
	spend: string; // e.g. "2207.59"
	impressions: string;
	clicks: string;
	dateStart: string; // "2026-02-01"
	dateStop: string; // "2026-02-28"
}

export interface MetaAdsCampaignInsight {
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
	conversionValue: number;
	costPerConversion: number;
	resultType: string;
	cpaLabel: string;
	// Individual action metrics
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	dateStart: string;
	dateStop: string;
}

export interface MetaAdsCampaignInfo {
	campaignId: string;
	campaignName: string;
	status: string;
	objective: string;
	optimizationGoal: string; // from first ad set: CALL, LINK_CLICKS, REACH, etc.
	dailyBudget: string | null;
	lifetimeBudget: string | null;
	startTime: string | null;
	stopTime: string | null;
}

/**
 * Generate appsecret_proof for Meta API calls (HMAC-SHA256 of access_token with app secret)
 */
function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

/**
 * List all ad accounts owned by a Business Manager
 */
export async function listBusinessAdAccounts(
	businessId: string,
	accessToken: string
): Promise<MetaAdsAdAccount[]> {
	logInfo('meta-ads', `Listing ad accounts for BM`, { metadata: { businessId } });

	const accounts: MetaAdsAdAccount[] = [];
	let url: string | null = `${META_GRAPH_URL}/${businessId}/owned_ad_accounts?fields=id,name,account_status&limit=100&access_token=${accessToken}`;

	try {
		while (url) {
			const res = await fetch(url);
			const data = await res.json();

			if (data.error) {
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const acc of data.data || []) {
				accounts.push({
					adAccountId: acc.id || '',
					accountName: acc.name || '',
					accountStatus: acc.account_status || 0,
					isActive: acc.account_status === 1
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Found ${accounts.length} ad accounts`, { metadata: { businessId } });
		return accounts;
	} catch (err) {
		logError('meta-ads', `Failed to list ad accounts`, {
			metadata: { businessId, error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * List insights (spending data) for a specific ad account.
 * Uses time_increment=monthly to get per-month breakdowns.
 */
export async function listAdAccountInsights(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	since: string,
	until: string
): Promise<MetaAdsInsightData[]> {
	logInfo('meta-ads', `Fetching insights for ${adAccountId}`, { metadata: { since, until } });

	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const fields = 'spend,impressions,clicks';

	const params = new URLSearchParams({
		fields,
		time_range: timeRange,
		time_increment: 'monthly',
		access_token: accessToken,
		appsecret_proof: proof
	});

	const url = `${META_GRAPH_URL}/${adAccountId}/insights?${params.toString()}`;

	try {
		const res = await fetch(url);
		const data = await res.json();

		if (data.error) {
			logError('meta-ads', `Insights API error for ${adAccountId}`, {
				metadata: { errorMessage: data.error.message, errorCode: data.error.code }
			});
			throw new Error(`Meta API error: ${data.error.message}`);
		}

		const insights: MetaAdsInsightData[] = [];
		for (const row of data.data || []) {
			insights.push({
				spend: row.spend || '0',
				impressions: row.impressions || '0',
				clicks: row.clicks || '0',
				dateStart: row.date_start,
				dateStop: row.date_stop
			});
		}

		logInfo('meta-ads', `Got ${insights.length} insight periods for ${adAccountId}`, {
			metadata: { since, until }
		});
		return insights;
	} catch (err) {
		logError('meta-ads', `Failed to fetch insights for ${adAccountId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/** Objective → relevant action types + labels */
const OBJECTIVE_ACTION_MAP: Record<string, { actionTypes: string[]; label: string; cpaLabel: string }> = {
	'OUTCOME_SALES': {
		actionTypes: ['purchase', 'offsite_conversion.fb_pixel_purchase'],
		label: 'Purchases', cpaLabel: 'Cost per purchase'
	},
	'OUTCOME_LEADS': {
		actionTypes: ['lead', 'offsite_conversion.fb_pixel_lead', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'contact_total', 'submit_application_total'],
		label: 'Leads', cpaLabel: 'CPL'
	},
	'OUTCOME_TRAFFIC': {
		actionTypes: ['link_click', 'landing_page_view'],
		label: 'Link clicks', cpaLabel: 'CPC'
	},
	'LINK_CLICKS': {
		actionTypes: ['link_click', 'landing_page_view'],
		label: 'Link clicks', cpaLabel: 'CPC'
	},
	'OUTCOME_ENGAGEMENT': {
		actionTypes: ['post_engagement', 'page_engagement', 'onsite_conversion.post_save', 'comment', 'post_reaction'],
		label: 'Engagement', cpaLabel: 'CPE'
	},
	'OUTCOME_AWARENESS': {
		actionTypes: [], // Uses impressions/reach directly, not actions
		label: 'Impressions', cpaLabel: 'CPM'
	},
	'OUTCOME_APP_PROMOTION': {
		actionTypes: ['app_install', 'mobile_app_install'],
		label: 'App installs', cpaLabel: 'CPI'
	},
	'MESSAGES': {
		actionTypes: ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply'],
		label: 'Conversations', cpaLabel: 'Cost per conversation'
	},
	'CALLS': {
		actionTypes: ['call_confirm_grouped', 'click_to_call_call_confirm', 'click_to_call_native_call_placed', 'onsite_conversion.call_confirm'],
		label: 'Calls placed', cpaLabel: 'Cost per call'
	},
	'VIDEO_VIEWS': {
		actionTypes: ['video_view'],
		label: 'Video views', cpaLabel: 'Cost per view'
	}
};

/** Human-readable names for fallback action types */
const ACTION_TYPE_LABELS: Record<string, string> = {
	'call_confirm_grouped': 'Calls placed',
	'click_to_call_call_confirm': 'Calls placed',
	'click_to_call_native_call_placed': 'Calls placed',
	'onsite_conversion.call_confirm': 'Calls placed',
	'offsite_conversion.fb_pixel_purchase': 'Purchases',
	'offsite_conversion.fb_pixel_lead': 'Leads',
	'offsite_conversion.fb_pixel_complete_registration': 'Registrations',
	'purchase': 'Purchases',
	'lead': 'Leads',
	'complete_registration': 'Registrations',
	'onsite_conversion.messaging_conversation_started_7d': 'Conversations',
	'onsite_conversion.post_save': 'Post saves',
	'link_click': 'Link clicks',
	'landing_page_view': 'Landing page views',
	'page_engagement': 'Page engagement',
	'post_engagement': 'Post engagement',
	'video_view': 'Video views',
	'app_install': 'App installs',
	'contact_total': 'Contacts',
	'submit_application_total': 'Applications'
};

/** Extract a single action count from actions array */
export function getActionCount(actions: any[] | undefined, actionType: string): number {
	if (!actions) return 0;
	const action = actions.find((a: any) => a.action_type === actionType);
	return action ? parseFloat(action.value || '0') : 0;
}

/** Map optimization_goal (from ad set) → action type + labels */
export const OPTIMIZATION_GOAL_MAP: Record<string, { actionType: string; label: string; cpaLabel: string }> = {
	'CALL': { actionType: 'click_to_call_native_call_placed', label: 'Calls placed', cpaLabel: 'Per call placed' },
	'QUALITY_CALL': { actionType: 'click_to_call_native_call_placed', label: 'Calls placed', cpaLabel: 'Per call placed' },
	'OFFSITE_CONVERSIONS': { actionType: 'offsite_conversion.fb_pixel_purchase', label: 'Conversions', cpaLabel: 'Per conversion' },
	'LINK_CLICKS': { actionType: 'link_click', label: 'Link clicks', cpaLabel: 'Per link click' },
	'LANDING_PAGE_VIEWS': { actionType: 'landing_page_view', label: 'Landing page views', cpaLabel: 'Per landing page view' },
	'REACH': { actionType: '', label: 'Reach', cpaLabel: 'Per 1,000 people reached' },
	'IMPRESSIONS': { actionType: '', label: 'Impressions', cpaLabel: 'CPM' },
	'POST_ENGAGEMENT': { actionType: 'post_engagement', label: 'Post engagement', cpaLabel: 'Per engagement' },
	'THRUPLAY': { actionType: 'video_view', label: 'Video views', cpaLabel: 'Per view' },
	'VIDEO_VIEWS': { actionType: 'video_view', label: 'Video views', cpaLabel: 'Per view' },
	'LEAD_GENERATION': { actionType: 'lead', label: 'Leads', cpaLabel: 'Per lead' },
	'CONVERSATIONS': { actionType: 'onsite_conversion.messaging_conversation_started_7d', label: 'Conversations', cpaLabel: 'Per conversation' },
	'APP_INSTALLS': { actionType: 'app_install', label: 'App installs', cpaLabel: 'Per install' },
	'VALUE': { actionType: 'offsite_conversion.fb_pixel_purchase', label: 'Purchases', cpaLabel: 'Per purchase' }
};

/**
 * Parse results using optimization_goal (most accurate), then objective fallback.
 */
function parseConversions(
	actions: any[] | undefined,
	objective: string,
	optimizationGoal: string
): { count: number; resultType: string; cpaLabel: string } {
	// Strategy 1: Use optimization_goal from ad set — this is exactly what FB Ads Manager uses
	if (optimizationGoal) {
		const goalMap = OPTIMIZATION_GOAL_MAP[optimizationGoal];
		if (goalMap) {
			if (goalMap.actionType && actions) {
				const count = getActionCount(actions, goalMap.actionType);
				return { count, resultType: goalMap.label, cpaLabel: goalMap.cpaLabel };
			}
			// For REACH/IMPRESSIONS, no specific action type
			return { count: 0, resultType: goalMap.label, cpaLabel: goalMap.cpaLabel };
		}
	}

	if (!actions || actions.length === 0) {
		const map = OBJECTIVE_ACTION_MAP[objective];
		return { count: 0, resultType: map?.label || '', cpaLabel: map?.cpaLabel || 'CPA' };
	}

	// Strategy 2: Objective-based mapping
	const map = OBJECTIVE_ACTION_MAP[objective];
	if (map && map.actionTypes.length > 0) {
		const targetSet = new Set(map.actionTypes);
		let total = 0;
		for (const action of actions) {
			if (targetSet.has(action.action_type)) {
				total += parseFloat(action.value || '0');
			}
		}
		if (total > 0) {
			return { count: total, resultType: map.label, cpaLabel: map.cpaLabel };
		}
	}

	if (objective === 'OUTCOME_AWARENESS') {
		return { count: 0, resultType: 'Reach', cpaLabel: 'Per 1,000 people reached' };
	}

	// Strategy 3: Fallback to highest-value known action
	let bestAction = '';
	let bestValue = 0;
	let totalRelevant = 0;
	for (const action of actions) {
		const type = action.action_type as string;
		const value = parseFloat(action.value || '0');
		if (ACTION_TYPE_LABELS[type]) {
			totalRelevant += value;
			if (value > bestValue) { bestValue = value; bestAction = type; }
		}
	}

	const resultType = bestAction ? (ACTION_TYPE_LABELS[bestAction] || bestAction) : (map?.label || '');
	return { count: totalRelevant, resultType, cpaLabel: map?.cpaLabel || 'CPA' };
}

/**
 * Parse conversion value (revenue) from Meta API `action_values` array.
 */
function parseConversionValue(actionValues: any[] | undefined): number {
	if (!actionValues) return 0;
	const valueTypes = [
		'offsite_conversion.fb_pixel_purchase',
		'purchase'
	];
	let total = 0;
	for (const av of actionValues) {
		if (valueTypes.includes(av.action_type)) {
			total += parseFloat(av.value || '0');
		}
	}
	return total;
}

/**
 * List campaign-level insights for an ad account.
 * Returns daily or monthly breakdowns with full performance metrics.
 */
export async function listCampaignInsights(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	since: string,
	until: string,
	timeIncrement: 'daily' | 'monthly' = 'daily'
): Promise<MetaAdsCampaignInsight[]> {
	logInfo('meta-ads', `Fetching campaign insights for ${adAccountId}`, { metadata: { since, until, timeIncrement } });

	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const fields = 'campaign_name,campaign_id,objective,spend,impressions,reach,frequency,clicks,cpc,cpm,ctr,actions,action_values,cost_per_action_type';

	const insights: MetaAdsCampaignInsight[] = [];
	let url: string | null = `${META_GRAPH_URL}/${adAccountId}/insights?${new URLSearchParams({
		fields,
		level: 'campaign',
		time_range: timeRange,
		time_increment: timeIncrement === 'daily' ? '1' : 'monthly',
		access_token: accessToken,
		appsecret_proof: proof,
		limit: '500'
	}).toString()}`;

	try {
		while (url) {
			const res = await fetch(url);
			const data = await res.json();

			if (data.error) {
				logError('meta-ads', `Campaign insights API error for ${adAccountId}`, {
					metadata: { errorMessage: data.error.message, errorCode: data.error.code }
				});
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const row of data.data || []) {
				const objective = row.objective || '';
				const { count: conversions, resultType, cpaLabel } = parseConversions(row.actions, objective, '');
				const conversionValue = parseConversionValue(row.action_values);
				const spend = parseFloat(row.spend || '0');

				const finalConversions = conversions;

				insights.push({
					campaignId: row.campaign_id || '',
					campaignName: row.campaign_name || '',
					objective,
					spend: row.spend || '0',
					impressions: row.impressions || '0',
					reach: row.reach || '0',
					frequency: row.frequency || '0',
					clicks: row.clicks || '0',
					cpc: row.cpc || '0',
					cpm: row.cpm || '0',
					ctr: row.ctr || '0',
					conversions: finalConversions,
					conversionValue,
					costPerConversion: finalConversions > 0 ? spend / finalConversions : 0,
					resultType,
					cpaLabel,
					linkClicks: getActionCount(row.actions, 'link_click'),
					landingPageViews: getActionCount(row.actions, 'landing_page_view'),
					pageEngagement: getActionCount(row.actions, 'page_engagement'),
					postReactions: getActionCount(row.actions, 'post_reaction'),
					postComments: getActionCount(row.actions, 'comment'),
					postSaves: getActionCount(row.actions, 'onsite_conversion.post_save'),
					postShares: getActionCount(row.actions, 'post'),
					videoViews: getActionCount(row.actions, 'video_view'),
					callsPlaced: getActionCount(row.actions, 'click_to_call_native_call_placed'),
					dateStart: row.date_start,
					dateStop: row.date_stop
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Got ${insights.length} campaign insight rows for ${adAccountId}`, {
			metadata: { since, until }
		});
		return insights;
	} catch (err) {
		logError('meta-ads', `Failed to fetch campaign insights for ${adAccountId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Fetch aggregated reach and frequency per campaign (NOT daily — daily reach can't be summed).
 * Returns a map of campaignId → { reach, frequency }.
 */
export async function listCampaignReachFrequency(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	since: string,
	until: string
): Promise<Map<string, { reach: number; frequency: number }>> {
	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const result = new Map<string, { reach: number; frequency: number }>();

	let url: string | null = `${META_GRAPH_URL}/${adAccountId}/insights?${new URLSearchParams({
		fields: 'campaign_id,reach,frequency',
		level: 'campaign',
		time_range: timeRange,
		access_token: accessToken,
		appsecret_proof: proof,
		limit: '500'
	}).toString()}`;

	try {
		while (url) {
			const res = await fetch(url);
			const data = await res.json();
			if (data.error) break;

			for (const row of data.data || []) {
				result.set(row.campaign_id, {
					reach: parseInt(row.reach || '0'),
					frequency: parseFloat(row.frequency || '0')
				});
			}
			url = data.paging?.next || null;
		}
	} catch (err) {
		logError('meta-ads', `Failed to fetch reach/frequency for ${adAccountId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
	}

	return result;
}

/**
 * List active/paused campaigns for an ad account.
 */
export async function listActiveCampaigns(
	adAccountId: string,
	accessToken: string,
	appSecret: string
): Promise<MetaAdsCampaignInfo[]> {
	logInfo('meta-ads', `Fetching campaigns for ${adAccountId}`);

	const proof = generateAppSecretProof(accessToken, appSecret);
	const fields = 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time';

	const campaigns: MetaAdsCampaignInfo[] = [];
	let url: string | null = `${META_GRAPH_URL}/${adAccountId}/campaigns?${new URLSearchParams({
		fields,
		effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'IN_PROCESS']),
		access_token: accessToken,
		appsecret_proof: proof,
		limit: '200'
	}).toString()}`;

	try {
		while (url) {
			const res = await fetch(url);
			const data = await res.json();

			if (data.error) {
				logError('meta-ads', `Campaigns API error for ${adAccountId}`, {
					metadata: { errorMessage: data.error.message, errorCode: data.error.code }
				});
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const c of data.data || []) {
				campaigns.push({
					campaignId: c.id || '',
					campaignName: c.name || '',
					status: c.status || 'UNKNOWN',
					objective: c.objective || '',
					optimizationGoal: '', // filled below
					dailyBudget: c.daily_budget || null,
					lifetimeBudget: c.lifetime_budget || null,
					startTime: c.start_time || null,
					stopTime: c.stop_time || null
				});
			}

			url = data.paging?.next || null;
		}

		// Fetch optimization_goal for all ad sets in one request at account level
		try {
			const campaignIds = new Set(campaigns.map(c => c.campaignId));
			let adsetUrl: string | null = `${META_GRAPH_URL}/${adAccountId}/adsets?fields=campaign_id,optimization_goal&limit=500&access_token=${accessToken}&appsecret_proof=${proof}`;
			// Map campaign_id → optimization_goal (first ad set wins)
			const goalByCampaign = new Map<string, string>();

			while (adsetUrl) {
				const adsetRes = await fetch(adsetUrl);
				const adsetData = await adsetRes.json();
				if (adsetData.error) break;

				for (const adset of adsetData.data || []) {
					const cid = adset.campaign_id;
					if (cid && adset.optimization_goal && campaignIds.has(cid) && !goalByCampaign.has(cid)) {
						goalByCampaign.set(cid, adset.optimization_goal);
					}
				}

				// Stop paginating once we have all campaigns covered
				if (goalByCampaign.size >= campaignIds.size) break;
				adsetUrl = adsetData.paging?.next || null;
			}

			for (const campaign of campaigns) {
				const goal = goalByCampaign.get(campaign.campaignId);
				if (goal) campaign.optimizationGoal = goal;
			}
		} catch {
			// Non-critical — fallback to objective-based detection
		}

		logInfo('meta-ads', `Found ${campaigns.length} campaigns for ${adAccountId}`);
		return campaigns;
	} catch (err) {
		logError('meta-ads', `Failed to fetch campaigns for ${adAccountId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Get the date range for sync (current + previous 2 months).
 * Returns YYYY-MM-DD strings (local timezone).
 */
export function getSyncDateRange(referenceDate?: Date): { startDate: string; endDate: string } {
	const date = referenceDate || new Date();

	// Start: 2 months ago, 1st day
	const startMonth = new Date(date.getFullYear(), date.getMonth() - 2, 1);
	// End: today (insights are available up to current day)
	const pad = (n: number) => String(n).padStart(2, '0');
	const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	return {
		startDate: formatLocal(startMonth),
		endDate: formatLocal(date)
	};
}
