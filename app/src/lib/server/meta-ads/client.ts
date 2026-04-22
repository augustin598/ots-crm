import { logInfo, logError } from '$lib/server/logger';
import { createHmac } from 'crypto';

export const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

export interface MetaAdsAdAccount {
	adAccountId: string; // e.g. act_XXXXXXXXX
	accountName: string;
	accountStatus: number; // 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, 9=IN_GRACE_PERIOD, etc.
	isActive: boolean;
	disableReason: number; // 0=none, 3=RISK_PAYMENT (stopped for payment issues)
	/**
	 * Outstanding balance in account currency smallest unit (integer cents).
	 * Meta returns this as a positive string (amount owed). null if field absent.
	 */
	balanceCents: number | null;
	/** ISO currency code (RON, EUR, USD). null if not returned. */
	currencyCode: string | null;
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
	purchases: number;
	leads: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	/** Raw actions array from Meta API for conversion breakdown popover */
	rawActions: Array<{ action_type: string; value: string }>;
	dateStart: string;
	dateStop: string;
}

export interface MetaAdsCampaignInfo {
	campaignId: string;
	campaignName: string;
	status: string;
	objective: string;
	optimizationGoal: string;
	dailyBudget: string | null;
	lifetimeBudget: string | null;
	budgetSource: 'campaign' | 'adset'; // where budget comes from
	adsetId: string | null; // first ad set ID (for budget updates when budget is on ad set)
	startTime: string | null;
	stopTime: string | null;
	previewUrl: string | null; // first ad's shareable preview link
}

/**
 * Generate appsecret_proof for Meta API calls (HMAC-SHA256 of access_token with app secret)
 */
function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

/**
 * List all ad accounts accessible by a Business Manager (owned + client/shared)
 */
export async function listBusinessAdAccounts(
	businessId: string,
	accessToken: string
): Promise<MetaAdsAdAccount[]> {
	logInfo('meta-ads', `Listing ad accounts for BM`, { metadata: { businessId } });

	const accounts: MetaAdsAdAccount[] = [];
	// Fields include: balance (outstanding, cents), currency (ISO), amount_spent
	// (lifetime, cents). These let us show "430 RON outstanding" directly to the
	// client, matching what Meta shows inside Ads Manager.
	let url: string | null = `${META_GRAPH_URL}/${businessId}/client_ad_accounts?fields=id,name,account_status,disable_reason,balance,currency&limit=100&access_token=${accessToken}`;

	try {
		while (url) {
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const acc of data.data || []) {
				// Meta returns balance as a stringified integer in smallest unit.
				const rawBalance = acc.balance;
				const balanceCents =
					rawBalance != null && rawBalance !== ''
						? Number.isFinite(Number(rawBalance))
							? Math.trunc(Number(rawBalance))
							: null
						: null;
				accounts.push({
					adAccountId: acc.id || '',
					accountName: acc.name || '',
					accountStatus: acc.account_status || 0,
					isActive: acc.account_status === 1,
					disableReason: acc.disable_reason ?? 0,
					balanceCents,
					currencyCode: acc.currency ?? null,
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
		const res: Response = await fetch(url);
		const data: any = await res.json();

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
	'OFFSITE_CONVERSIONS': { actionType: 'offsite_conversion.fb_pixel_purchase', label: 'Purchases', cpaLabel: 'Cost per purchase' },
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

	// Strategy 2: Objective-based mapping — use first matching action type (priority order)
	// to avoid double-counting when Meta API returns both 'purchase' and 'offsite_conversion.fb_pixel_purchase'
	const map = OBJECTIVE_ACTION_MAP[objective];
	if (map && map.actionTypes.length > 0) {
		for (const actionType of map.actionTypes) {
			const count = getActionCount(actions, actionType);
			if (count > 0) {
				return { count, resultType: map.label, cpaLabel: map.cpaLabel };
			}
		}
	}

	if (objective === 'OUTCOME_AWARENESS') {
		return { count: 0, resultType: 'Reach', cpaLabel: 'Per 1,000 people reached' };
	}

	// Strategy 3: Fallback to highest-value known action (use its count, not sum of all)
	let bestAction = '';
	let bestValue = 0;
	for (const action of actions) {
		const type = action.action_type as string;
		const value = parseFloat(action.value || '0');
		if (ACTION_TYPE_LABELS[type] && value > bestValue) {
			bestValue = value;
			bestAction = type;
		}
	}

	const resultType = bestAction ? (ACTION_TYPE_LABELS[bestAction] || bestAction) : (map?.label || '');
	return { count: bestValue, resultType, cpaLabel: map?.cpaLabel || 'CPA' };
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
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				logError('meta-ads', `Campaign insights API error for ${adAccountId}`, {
					metadata: { errorMessage: data.error.message, errorCode: data.error.code, errorType: data.error.type, errorSubcode: data.error.error_subcode, fbTraceId: data.error.fbtrace_id }
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
					purchases: getActionCount(row.actions, 'offsite_conversion.fb_pixel_purchase') || getActionCount(row.actions, 'purchase'),
					leads: getActionCount(row.actions, 'offsite_conversion.fb_pixel_lead') || getActionCount(row.actions, 'lead'),
					linkClicks: getActionCount(row.actions, 'link_click'),
					landingPageViews: getActionCount(row.actions, 'landing_page_view'),
					pageEngagement: getActionCount(row.actions, 'page_engagement'),
					postReactions: getActionCount(row.actions, 'post_reaction'),
					postComments: getActionCount(row.actions, 'comment'),
					postSaves: getActionCount(row.actions, 'onsite_conversion.post_save'),
					postShares: getActionCount(row.actions, 'post_share'),
					videoViews: getActionCount(row.actions, 'video_view'),
					callsPlaced: getActionCount(row.actions, 'click_to_call_native_call_placed'),
					rawActions: (row.actions || []).map((a: any) => ({ action_type: a.action_type, value: a.value })),
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
			const res: Response = await fetch(url);
			const data: any = await res.json();
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
 * Toggle campaign status (ACTIVE/PAUSED) via Meta API.
 */
export async function toggleCampaignStatus(
	campaignId: string,
	accessToken: string,
	appSecret: string,
	newStatus: 'ACTIVE' | 'PAUSED'
): Promise<{ success: boolean }> {
	logInfo('meta-ads', `Toggling campaign ${campaignId} to ${newStatus}`);

	const proof = generateAppSecretProof(accessToken, appSecret);
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: proof,
		status: newStatus
	});

	try {
		const res: Response = await fetch(`${META_GRAPH_URL}/${campaignId}`, { method: 'POST', body: params });
		const data: any = await res.json();
		if (data.error) {
			logError('meta-ads', `Failed to toggle campaign ${campaignId}`, {
				metadata: { errorMessage: data.error.message, errorCode: data.error.code }
			});
			throw new Error(data.error.message);
		}
		logInfo('meta-ads', `Campaign ${campaignId} set to ${newStatus}`);
		return { success: true };
	} catch (err) {
		logError('meta-ads', `Toggle failed for ${campaignId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Update campaign budget via Meta API.
 * Budget values are in cents (e.g., 5000 = 50.00 RON).
 */
export async function updateCampaignBudget(
	campaignId: string,
	accessToken: string,
	appSecret: string,
	budgetType: 'daily' | 'lifetime',
	budgetCents: number
): Promise<{ success: boolean }> {
	logInfo('meta-ads', `Updating budget for campaign ${campaignId}`, { metadata: { budgetType, budgetCents } });

	const proof = generateAppSecretProof(accessToken, appSecret);

	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: proof,
		[budgetType === 'daily' ? 'daily_budget' : 'lifetime_budget']: String(budgetCents)
	});

	try {
		const res: Response = await fetch(`${META_GRAPH_URL}/${campaignId}`, {
			method: 'POST',
			body: params
		});
		const data: any = await res.json();

		if (data.error) {
			logError('meta-ads', `Failed to update budget for ${campaignId}`, {
				metadata: { errorMessage: data.error.message, errorCode: data.error.code }
			});
			throw new Error(data.error.message);
		}

		logInfo('meta-ads', `Budget updated for ${campaignId}`, { metadata: { budgetType, budgetCents } });
		return { success: true };
	} catch (err) {
		logError('meta-ads', `Budget update failed for ${campaignId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

export interface MetaAdsAdsetInsight {
	adsetId: string;
	adsetName: string;
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
	conversionValue: number;
	costPerConversion: number;
	resultType: string;
	cpaLabel: string;
	purchases: number;
	leads: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	dailyBudget: string | null;
	lifetimeBudget: string | null;
	optimizationGoal: string;
	dateStart: string;
	dateStop: string;
}

export interface MetaAdsAdInsight {
	adId: string;
	adName: string;
	adsetId: string;
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
	conversionValue: number;
	costPerConversion: number;
	resultType: string;
	cpaLabel: string;
	purchases: number;
	leads: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	previewUrl: string | null;
	dateStart: string;
	dateStop: string;
}

/**
 * Fetch ad set-level insights for a specific campaign.
 */
export async function listAdsetInsights(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	campaignId: string,
	since: string,
	until: string
): Promise<MetaAdsAdsetInsight[]> {
	logInfo('meta-ads', `Fetching ad set insights for campaign ${campaignId}`);

	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const fields = 'adset_id,adset_name,campaign_id,objective,spend,impressions,reach,frequency,clicks,cpc,cpm,ctr,actions,action_values,cost_per_action_type';
	const filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]);

	const insights: MetaAdsAdsetInsight[] = [];
	let url: string | null = `${META_GRAPH_URL}/${adAccountId}/insights?${new URLSearchParams({
		fields,
		level: 'adset',
		time_range: timeRange,
		time_increment: '1',
		filtering,
		access_token: accessToken,
		appsecret_proof: proof,
		limit: '500'
	}).toString()}`;

	try {
		while (url) {
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				logError('meta-ads', `Ad set insights API error`, {
					metadata: { errorMessage: data.error.message, campaignId }
				});
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const row of data.data || []) {
				const objective = row.objective || '';
				const { count: conversions, resultType, cpaLabel } = parseConversions(row.actions, objective, '');
				const conversionValue = parseConversionValue(row.action_values);
				const spend = parseFloat(row.spend || '0');

				insights.push({
					adsetId: row.adset_id || '',
					adsetName: row.adset_name || '',
					campaignId: row.campaign_id || campaignId,
					spend: row.spend || '0',
					impressions: row.impressions || '0',
					reach: row.reach || '0',
					frequency: row.frequency || '0',
					clicks: row.clicks || '0',
					cpc: row.cpc || '0',
					cpm: row.cpm || '0',
					ctr: row.ctr || '0',
					conversions,
					conversionValue,
					costPerConversion: conversions > 0 ? spend / conversions : 0,
					resultType,
					cpaLabel,
					purchases: getActionCount(row.actions, 'offsite_conversion.fb_pixel_purchase') || getActionCount(row.actions, 'purchase'),
					leads: getActionCount(row.actions, 'offsite_conversion.fb_pixel_lead') || getActionCount(row.actions, 'lead'),
					linkClicks: getActionCount(row.actions, 'link_click'),
					landingPageViews: getActionCount(row.actions, 'landing_page_view'),
					pageEngagement: getActionCount(row.actions, 'page_engagement'),
					postReactions: getActionCount(row.actions, 'post_reaction'),
					postComments: getActionCount(row.actions, 'comment'),
					postSaves: getActionCount(row.actions, 'onsite_conversion.post_save'),
					postShares: getActionCount(row.actions, 'post_share'),
					videoViews: getActionCount(row.actions, 'video_view'),
					callsPlaced: getActionCount(row.actions, 'click_to_call_native_call_placed'),
					dailyBudget: null, // filled from campaign info
					lifetimeBudget: null,
					optimizationGoal: '',
					dateStart: row.date_start,
					dateStop: row.date_stop
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Got ${insights.length} ad set insight rows for campaign ${campaignId}`);
		return insights;
	} catch (err) {
		logError('meta-ads', `Failed to fetch ad set insights for campaign ${campaignId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Fetch ad-level insights for a specific ad set.
 */
export async function listAdInsights(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	adsetId: string,
	since: string,
	until: string
): Promise<MetaAdsAdInsight[]> {
	logInfo('meta-ads', `Fetching ad insights for ad set ${adsetId}`);

	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const fields = 'ad_id,ad_name,adset_id,campaign_id,objective,spend,impressions,reach,frequency,clicks,cpc,cpm,ctr,actions,action_values,cost_per_action_type';
	const filtering = JSON.stringify([{ field: 'adset.id', operator: 'IN', value: [adsetId] }]);

	const insights: MetaAdsAdInsight[] = [];
	let url: string | null = `${META_GRAPH_URL}/${adAccountId}/insights?${new URLSearchParams({
		fields,
		level: 'ad',
		time_range: timeRange,
		time_increment: '1',
		filtering,
		access_token: accessToken,
		appsecret_proof: proof,
		limit: '500'
	}).toString()}`;

	try {
		while (url) {
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				logError('meta-ads', `Ad insights API error`, {
					metadata: { errorMessage: data.error.message, adsetId }
				});
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const row of data.data || []) {
				const objective = row.objective || '';
				const { count: conversions, resultType, cpaLabel } = parseConversions(row.actions, objective, '');
				const conversionValue = parseConversionValue(row.action_values);
				const spend = parseFloat(row.spend || '0');

				insights.push({
					adId: row.ad_id || '',
					adName: row.ad_name || '',
					adsetId: row.adset_id || adsetId,
					campaignId: row.campaign_id || '',
					spend: row.spend || '0',
					impressions: row.impressions || '0',
					reach: row.reach || '0',
					frequency: row.frequency || '0',
					clicks: row.clicks || '0',
					cpc: row.cpc || '0',
					cpm: row.cpm || '0',
					ctr: row.ctr || '0',
					conversions,
					conversionValue,
					costPerConversion: conversions > 0 ? spend / conversions : 0,
					resultType,
					cpaLabel,
					purchases: getActionCount(row.actions, 'offsite_conversion.fb_pixel_purchase') || getActionCount(row.actions, 'purchase'),
					leads: getActionCount(row.actions, 'offsite_conversion.fb_pixel_lead') || getActionCount(row.actions, 'lead'),
					linkClicks: getActionCount(row.actions, 'link_click'),
					landingPageViews: getActionCount(row.actions, 'landing_page_view'),
					pageEngagement: getActionCount(row.actions, 'page_engagement'),
					postReactions: getActionCount(row.actions, 'post_reaction'),
					postComments: getActionCount(row.actions, 'comment'),
					postSaves: getActionCount(row.actions, 'onsite_conversion.post_save'),
					postShares: getActionCount(row.actions, 'post_share'),
					videoViews: getActionCount(row.actions, 'video_view'),
					callsPlaced: getActionCount(row.actions, 'click_to_call_native_call_placed'),
					previewUrl: null,
					dateStart: row.date_start,
					dateStop: row.date_stop
				});
			}

			url = data.paging?.next || null;
		}

		// Fetch preview URLs for each unique ad
		const adIds = [...new Set(insights.map(i => i.adId).filter(Boolean))];
		if (adIds.length > 0) {
			try {
				const previewMap = new Map<string, string>();
				let previewUrl: string | null = `${META_GRAPH_URL}/${adAccountId}/ads?${new URLSearchParams({
					fields: 'id,preview_shareable_link',
					filtering: JSON.stringify([{ field: 'id', operator: 'IN', value: adIds }]),
					limit: '500',
					access_token: accessToken,
					appsecret_proof: proof
				}).toString()}`;
				while (previewUrl) {
					const res: Response = await fetch(previewUrl);
					const data: any = await res.json();
					if (data.error) break;
					for (const ad of data.data || []) {
						if (ad.id && ad.preview_shareable_link) {
							previewMap.set(ad.id, ad.preview_shareable_link);
						}
					}
					previewUrl = data.paging?.next || null;
				}
				for (const insight of insights) {
					insight.previewUrl = previewMap.get(insight.adId) || null;
				}
			} catch {
				// Preview fetch is non-critical, ignore errors
			}
		}

		logInfo('meta-ads', `Got ${insights.length} ad insight rows for ad set ${adsetId}`);
		return insights;
	} catch (err) {
		logError('meta-ads', `Failed to fetch ad insights for ad set ${adsetId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
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
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				logError('meta-ads', `Campaigns API error for ${adAccountId}`, {
					metadata: { errorMessage: data.error.message, errorCode: data.error.code, errorType: data.error.type, errorSubcode: data.error.error_subcode }
				});
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const c of data.data || []) {
				campaigns.push({
					campaignId: c.id || '',
					campaignName: c.name || '',
					status: c.status || 'UNKNOWN',
					objective: c.objective || '',
					optimizationGoal: '',
					dailyBudget: c.daily_budget || null,
					lifetimeBudget: c.lifetime_budget || null,
					budgetSource: (c.daily_budget || c.lifetime_budget) ? 'campaign' : 'adset',
					adsetId: null,
					startTime: c.start_time || null,
					stopTime: c.stop_time || null,
					previewUrl: null
				});
			}

			url = data.paging?.next || null;
		}

		// Fetch optimization_goal for all ad sets in one request at account level
		try {
			const campaignIds = new Set(campaigns.map(c => c.campaignId));
			let adsetUrl: string | null = `${META_GRAPH_URL}/${adAccountId}/adsets?fields=id,campaign_id,optimization_goal,daily_budget,lifetime_budget&limit=500&access_token=${accessToken}&appsecret_proof=${proof}`;
			const adsetByCampaign = new Map<string, { adsetId: string; goal: string; dailyBudget: string | null; lifetimeBudget: string | null }>();

			while (adsetUrl) {
				const adsetRes: Response = await fetch(adsetUrl);
				const adsetData: any = await adsetRes.json();
				if (adsetData.error) break;

				for (const adset of adsetData.data || []) {
					const cid = adset.campaign_id;
					if (cid && campaignIds.has(cid) && !adsetByCampaign.has(cid)) {
						adsetByCampaign.set(cid, {
							adsetId: adset.id || '',
							goal: adset.optimization_goal || '',
							dailyBudget: adset.daily_budget || null,
							lifetimeBudget: adset.lifetime_budget || null
						});
					}
				}

				if (adsetByCampaign.size >= campaignIds.size) break;
				adsetUrl = adsetData.paging?.next || null;
			}

			for (const campaign of campaigns) {
				const adsetInfo = adsetByCampaign.get(campaign.campaignId);
				if (adsetInfo) {
					if (adsetInfo.goal) campaign.optimizationGoal = adsetInfo.goal;
					campaign.adsetId = adsetInfo.adsetId;
					// If campaign has no budget, use ad set budget
					if (!campaign.dailyBudget && !campaign.lifetimeBudget) {
						campaign.dailyBudget = adsetInfo.dailyBudget;
						campaign.lifetimeBudget = adsetInfo.lifetimeBudget;
						campaign.budgetSource = 'adset';
					}
				}
			}
		} catch {
			// Non-critical — fallback to objective-based detection
		}

		// Fetch ad preview links (first ad per campaign)
		try {
			let adUrl: string | null = `${META_GRAPH_URL}/${adAccountId}/ads?fields=id,campaign_id,preview_shareable_link&limit=500&access_token=${accessToken}&appsecret_proof=${proof}`;
			const adPreviewMap = new Map<string, string>();
			const campaignIds = new Set(campaigns.map(c => c.campaignId));

			while (adUrl) {
				const adRes: Response = await fetch(adUrl);
				const adData: any = await adRes.json();
				if (adData.error) break;

				for (const ad of adData.data || []) {
					const cid = ad.campaign_id;
					if (cid && campaignIds.has(cid) && !adPreviewMap.has(cid) && ad.preview_shareable_link) {
						adPreviewMap.set(cid, ad.preview_shareable_link);
					}
				}

				if (adPreviewMap.size >= campaignIds.size) break;
				adUrl = adData.paging?.next || null;
			}

			for (const campaign of campaigns) {
				campaign.previewUrl = adPreviewMap.get(campaign.campaignId) || null;
			}
		} catch {
			// Non-critical — preview links are optional
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

// ---- Demographics ----

export interface DemographicSegment {
	label: string; // "male", "18-24", "RO", "mobile_app"
	spend: number;
	impressions: number;
	clicks: number;
	results: number;
}

export interface MetaDemographicBreakdown {
	gender: DemographicSegment[];
	age: DemographicSegment[];
	region: DemographicSegment[];
	devicePlatform: DemographicSegment[];
}

/**
 * Fetch demographic breakdowns (gender, age, country, device_platform) for an ad account.
 * Makes 4 parallel API calls, one per breakdown type.
 * NOTE: Do NOT request `reach` — incompatible with some breakdowns.
 */
export async function listDemographicInsights(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	since: string,
	until: string,
	campaignIds?: string[],
	resultActionTypes?: string[]
): Promise<MetaDemographicBreakdown> {
	logInfo('meta-ads', `Fetching demographics for ${adAccountId}`, { metadata: { since, until } });

	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const hasResultTypes = resultActionTypes && resultActionTypes.length > 0;
	const fields = hasResultTypes ? 'spend,impressions,clicks,actions' : 'spend,impressions,clicks';
	const resultSet = hasResultTypes ? new Set(resultActionTypes) : null;

	const breakdownTypes = ['gender', 'age', 'region', 'device_platform'] as const;

	function parseSegments(data: any, breakdownKey: string): DemographicSegment[] {
		if (!data?.data) return [];
		// When filtering by campaign, API returns per-campaign rows — aggregate by breakdown key
		const byLabel = new Map<string, DemographicSegment>();
		for (const row of data.data as any[]) {
			const label = row[breakdownKey] || 'unknown';
			const existing = byLabel.get(label) || { label, spend: 0, impressions: 0, clicks: 0, results: 0 };
			existing.spend += parseFloat(row.spend || '0');
			existing.impressions += parseInt(row.impressions || '0', 10);
			existing.clicks += parseInt(row.clicks || '0', 10);
			if (resultSet && row.actions) {
				for (const action of row.actions) {
					if (resultSet.has(action.action_type)) {
						existing.results += parseFloat(action.value || '0');
					}
				}
			}
			byLabel.set(label, existing);
		}
		return Array.from(byLabel.values()).sort((a, b) => b.spend - a.spend);
	}

	const results = await Promise.allSettled(
		breakdownTypes.map(async (breakdown) => {
			const params = new URLSearchParams({
				fields,
				breakdowns: breakdown,
				time_range: timeRange,
				level: campaignIds && campaignIds.length > 0 ? 'campaign' : 'account',
				access_token: accessToken,
				appsecret_proof: proof
			});
			if (campaignIds && campaignIds.length > 0) {
				params.set('filtering', JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]));
			}
			const res: Response = await fetch(`${META_GRAPH_URL}/${adAccountId}/insights?${params.toString()}`);
			const data: any = await res.json();
			if (data.error) {
				logError('meta-ads', `Demographics ${breakdown} error for ${adAccountId}`, {
					metadata: { errorMessage: data.error.message }
				});
				throw new Error(data.error.message);
			}
			return { breakdown, data };
		})
	);

	const breakdown: MetaDemographicBreakdown = {
		gender: [],
		age: [],
		region: [],
		devicePlatform: []
	};

	for (const result of results) {
		if (result.status === 'fulfilled') {
			const { breakdown: type, data } = result.value;
			switch (type) {
				case 'gender': breakdown.gender = parseSegments(data, 'gender'); break;
				case 'age': breakdown.age = parseSegments(data, 'age'); break;
				case 'region': breakdown.region = parseSegments(data, 'region'); break;
				case 'device_platform': breakdown.devicePlatform = parseSegments(data, 'device_platform'); break;
			}
		} else {
			logError('meta-ads', `Demographics breakdown failed for ${adAccountId}`, {
				metadata: { reason: result.reason instanceof Error ? result.reason.message : String(result.reason) }
			});
		}
	}

	logInfo('meta-ads', `Demographics loaded for ${adAccountId}`, {
		metadata: { gender: breakdown.gender.length, age: breakdown.age.length, region: breakdown.region.length, devicePlatform: breakdown.devicePlatform.length }
	});

	return breakdown;
}

// ---- Lead Ads API ----

export interface MetaPage {
	pageId: string;
	pageName: string;
	pageAccessToken: string;
}

export interface MetaLeadForm {
	formId: string;
	formName: string;
	status: string;
	createdTime: string;
}

export interface MetaLeadData {
	leadId: string;
	formId: string;
	adId: string | null;
	createdTime: string;
	fieldData: Array<{ name: string; values: string[] }>;
}

/**
 * List Facebook Pages the user has admin access to (with page access tokens).
 */
export async function listPages(
	accessToken: string,
	appSecret: string
): Promise<MetaPage[]> {
	logInfo('meta-ads', 'Listing Facebook Pages');

	const pages: MetaPage[] = [];
	const proof = generateAppSecretProof(accessToken, appSecret);
	let url: string | null = `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token&limit=100&access_token=${accessToken}&appsecret_proof=${proof}`;

	try {
		while (url) {
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const page of data.data || []) {
				pages.push({
					pageId: page.id || '',
					pageName: page.name || '',
					pageAccessToken: page.access_token || ''
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Found ${pages.length} Facebook Pages`);
		return pages;
	} catch (err) {
		logError('meta-ads', 'Failed to list Facebook Pages', {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * List lead generation forms for a Facebook Page.
 */
export async function listLeadForms(
	pageId: string,
	pageAccessToken: string,
	appSecret: string
): Promise<MetaLeadForm[]> {
	logInfo('meta-ads', `Listing lead forms for page`, { metadata: { pageId } });

	const forms: MetaLeadForm[] = [];
	const proof = generateAppSecretProof(pageAccessToken, appSecret);
	let url: string | null = `${META_GRAPH_URL}/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${pageAccessToken}&appsecret_proof=${proof}`;

	try {
		while (url) {
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const form of data.data || []) {
				forms.push({
					formId: form.id || '',
					formName: form.name || '',
					status: form.status || '',
					createdTime: form.created_time || ''
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Found ${forms.length} lead forms`, { metadata: { pageId } });
		return forms;
	} catch (err) {
		logError('meta-ads', `Failed to list lead forms`, {
			metadata: { pageId, error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Bulk-read leads from a lead form. Optionally filter by time_created > since (Unix timestamp).
 */
export async function getLeadsByForm(
	formId: string,
	pageAccessToken: string,
	appSecret: string,
	since?: number
): Promise<MetaLeadData[]> {
	logInfo('meta-ads', `Fetching leads for form`, { metadata: { formId, since } });

	const leads: MetaLeadData[] = [];
	const proof = generateAppSecretProof(pageAccessToken, appSecret);
	let url: string | null = `${META_GRAPH_URL}/${formId}/leads?fields=created_time,id,ad_id,form_id,field_data&limit=100&access_token=${pageAccessToken}&appsecret_proof=${proof}`;

	if (since) {
		const filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]);
		url += `&filtering=${encodeURIComponent(filtering)}`;
	}

	try {
		while (url) {
			const res: Response = await fetch(url);
			const data: any = await res.json();

			if (data.error) {
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const lead of data.data || []) {
				leads.push({
					leadId: lead.id || '',
					formId: lead.form_id || formId,
					adId: lead.ad_id || null,
					createdTime: lead.created_time || '',
					fieldData: lead.field_data || []
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Fetched ${leads.length} leads from form`, { metadata: { formId } });
		return leads;
	} catch (err) {
		logError('meta-ads', `Failed to fetch leads`, {
			metadata: { formId, error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Get a single lead's details by ID.
 */
export async function getLeadDetail(
	leadId: string,
	pageAccessToken: string,
	appSecret: string
): Promise<MetaLeadData> {
	const proof = generateAppSecretProof(pageAccessToken, appSecret);
	const res: Response = await fetch(
		`${META_GRAPH_URL}/${leadId}?fields=created_time,id,ad_id,form_id,field_data&access_token=${pageAccessToken}&appsecret_proof=${proof}`
	);
	const data: any = await res.json();

	if (data.error) {
		throw new Error(`Meta API error: ${data.error.message}`);
	}

	return {
		leadId: data.id || '',
		formId: data.form_id || '',
		adId: data.ad_id || null,
		createdTime: data.created_time || '',
		fieldData: data.field_data || []
	};
}

/**
 * Fetch the name of a Facebook ad by its ID.
 * Returns null if the ad is not found or the request fails.
 */
export async function getAdName(
	adId: string,
	accessToken: string,
	appSecret: string
): Promise<string | null> {
	try {
		const proof = generateAppSecretProof(accessToken, appSecret);
		const res: Response = await fetch(
			`${META_GRAPH_URL}/${adId}?fields=name&access_token=${accessToken}&appsecret_proof=${proof}`
		);
		const data: any = await res.json();
		return data.name || null;
	} catch {
		return null;
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
