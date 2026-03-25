import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray, isNotNull } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { listCampaignInsights, listActiveCampaigns, listCampaignReachFrequency, listDemographicInsights, listAdsetInsights, updateCampaignBudget as updateCampaignBudgetApi, toggleCampaignStatus as toggleCampaignStatusApi, OPTIMIZATION_GOAL_MAP } from '$lib/server/meta-ads/client';
import { env } from '$env/dynamic/private';

// ---- Server-side cache (5 min TTL) ----

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 200;

function getCached<T>(key: string): T | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > CACHE_TTL) {
		cache.delete(key);
		return null;
	}
	return entry.data as T;
}

function setCache(key: string, data: any): void {
	// Evict oldest entry if cache is full
	if (cache.size >= MAX_CACHE_SIZE) {
		const firstKey = cache.keys().next().value;
		if (firstKey) cache.delete(firstKey);
	}
	cache.set(key, { data, timestamp: Date.now() });
}

// ---- Queries ----

/** Get all Meta Ads accounts for the tenant (for the ad account filter dropdown) */
export const getReportAdAccounts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	const accounts = await db
		.select({
			id: table.metaAdsAccount.id,
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
			accountName: table.metaAdsAccount.accountName,
			integrationId: table.metaAdsAccount.integrationId,
			clientId: table.metaAdsAccount.clientId,
			clientName: table.client.name,
			isActive: table.metaAdsAccount.isActive,
			businessName: table.metaAdsIntegration.businessName,
			tokenExpiresAt: table.metaAdsIntegration.tokenExpiresAt
		})
		.from(table.metaAdsAccount)
		.leftJoin(table.client, eq(table.metaAdsAccount.clientId, table.client.id))
		.leftJoin(table.metaAdsIntegration, eq(table.metaAdsAccount.integrationId, table.metaAdsIntegration.id))
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, event.locals.tenant.id),
				isNotNull(table.metaAdsAccount.clientId)
			)
		)
		.orderBy(table.metaAdsAccount.accountName);

	// Batch lookup currency per ad account from spending data (single query)
	const accountIds = accounts.map(a => a.metaAdAccountId);
	const currencyMap = new Map<string, string>();

	if (accountIds.length > 0) {
		const spendings = await db
			.select({ metaAdAccountId: table.metaAdsSpending.metaAdAccountId, currencyCode: table.metaAdsSpending.currencyCode })
			.from(table.metaAdsSpending)
			.where(inArray(table.metaAdsSpending.metaAdAccountId, accountIds))
			.orderBy(desc(table.metaAdsSpending.periodStart));

		for (const s of spendings) {
			if (!currencyMap.has(s.metaAdAccountId)) {
				currencyMap.set(s.metaAdAccountId, s.currencyCode);
			}
		}
	}

	return accounts.map(acc => ({
		...acc,
		currency: currencyMap.get(acc.metaAdAccountId) || 'RON',
		tokenExpiresAt: acc.tokenExpiresAt
	}));
});

/** Get the Meta Ads account associated with a specific CRM client */
export const getClientAdAccount = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [account] = await db
			.select({
				id: table.metaAdsAccount.id,
				metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
				accountName: table.metaAdsAccount.accountName,
				integrationId: table.metaAdsAccount.integrationId,
				clientId: table.metaAdsAccount.clientId
			})
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, tenantId),
					eq(table.metaAdsAccount.clientId, clientId)
				)
			)
			.limit(1);

		if (!account) return null;

		// Lookup currency
		const [spending] = await db
			.select({ currencyCode: table.metaAdsSpending.currencyCode })
			.from(table.metaAdsSpending)
			.where(eq(table.metaAdsSpending.metaAdAccountId, account.metaAdAccountId))
			.orderBy(desc(table.metaAdsSpending.periodStart))
			.limit(1);

		return {
			...account,
			currency: spending?.currencyCode || 'RON'
		};
	}
);

/** Get the ad account for the currently logged-in client user (client portal) */
export const getMyAdAccount = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.isClientUser || !event?.locals.client) {
		return null;
	}

	const [account] = await db
		.select({
			id: table.metaAdsAccount.id,
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
			accountName: table.metaAdsAccount.accountName,
			integrationId: table.metaAdsAccount.integrationId,
			clientId: table.metaAdsAccount.clientId
		})
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, event.locals.tenant.id),
				eq(table.metaAdsAccount.clientId, event.locals.client.id)
			)
		)
		.limit(1);

	if (!account) return null;

	const [spending] = await db
		.select({ currencyCode: table.metaAdsSpending.currencyCode })
		.from(table.metaAdsSpending)
		.where(eq(table.metaAdsSpending.metaAdAccountId, account.metaAdAccountId))
		.orderBy(desc(table.metaAdsSpending.periodStart))
		.limit(1);

	return { ...account, currency: spending?.currencyCode || 'RON' };
});

/** Get campaign-level insights from Meta API (live, cached 5 min) */
export const getMetaCampaignInsights = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		timeIncrement: v.picklist(['daily', 'monthly'])
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		// Client users can only access their own ad account
		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId })
				.from(table.metaAdsAccount)
				.where(and(
					eq(table.metaAdsAccount.clientId, event.locals.client.id),
					eq(table.metaAdsAccount.tenantId, event.locals.tenant.id)
				))
				.limit(1);
			if (!clientAccount || clientAccount.metaAdAccountId !== params.adAccountId) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;

		// Check cache
		const cacheKey = `insights:${tenantId}:${params.adAccountId}:${params.since}:${params.until}:${params.timeIncrement}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		// Verify account belongs to tenant
		const [account] = await db
			.select({ id: table.metaAdsAccount.id })
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.metaAdAccountId, params.adAccountId),
					eq(table.metaAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!account) {
			throw error(404, 'Cont Meta Ads negăsit');
		}

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul Meta Ads. Verifică conexiunea din Settings.');
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			throw error(500, 'META_APP_SECRET nu este configurat');
		}

		try {
			// Fetch insights, campaigns, and aggregated reach/frequency in parallel
			const [insights, campaigns, reachMap] = await Promise.all([
				listCampaignInsights(
					params.adAccountId,
					authResult.accessToken,
					appSecret,
					params.since,
					params.until,
					params.timeIncrement
				),
				listActiveCampaigns(
					params.adAccountId,
					authResult.accessToken,
					appSecret
				),
				listCampaignReachFrequency(
					params.adAccountId,
					authResult.accessToken,
					appSecret,
					params.since,
					params.until
				)
			]);

			// Build optimization_goal map from campaigns
			const goalMap = new Map<string, string>();
			for (const c of campaigns) {
				if (c.optimizationGoal) {
					goalMap.set(c.campaignId, c.optimizationGoal);
				}
			}
			// Enrich insights with correct result type based on optimization_goal
			for (const insight of insights) {
				const goal = goalMap.get(insight.campaignId);
				if (goal) {
					const goalDef = OPTIMIZATION_GOAL_MAP[goal];
					if (goalDef) {
						if (goalDef.actionType) {
							// Map actionType to the pre-extracted field on insight
							const ACTION_TO_FIELD: Record<string, keyof typeof insight> = {
								'click_to_call_native_call_placed': 'callsPlaced',
								'link_click': 'linkClicks',
								'landing_page_view': 'landingPageViews',
								'video_view': 'videoViews',
								'post_engagement': 'pageEngagement',
								'page_engagement': 'pageEngagement'
							};
							const field = ACTION_TO_FIELD[goalDef.actionType];
							const count = field ? (insight[field] as number) : insight.conversions;
							insight.conversions = count;
							const cpc = count > 0 ? parseFloat(insight.spend) / count : 0;
							insight.costPerConversion = isFinite(cpc) ? cpc : 0;
						}
						insight.resultType = goalDef.label;
						insight.cpaLabel = goalDef.cpaLabel;
					}
				}
			}

			// Override reach/frequency with aggregated values (daily reach can't be summed)
			// Sort by campaignId to ensure consistent first-row placement
			insights.sort((a, b) => a.campaignId.localeCompare(b.campaignId) || a.dateStart.localeCompare(b.dateStart));

			const seenCampaigns = new Set<string>();
			for (const insight of insights) {
				const rf = reachMap.get(insight.campaignId);
				if (!seenCampaigns.has(insight.campaignId)) {
					seenCampaigns.add(insight.campaignId);
					if (rf) {
						insight.reach = String(rf.reach);
						insight.frequency = String(rf.frequency);
					}
				} else {
					// Zero out reach on subsequent daily rows to prevent double-counting
					insight.reach = '0';
					insight.frequency = '0';
				}
			}

			setCache(cacheKey, insights);
			return insights;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('validating access token') || msg.includes('session has been invalidated')) {
				throw error(401, 'Tokenul Meta Ads a expirat sau a fost revocat. Reconectează din Settings → Meta Ads.');
			}
			throw error(500, msg);
		}
	}
);

/** Get active campaigns for an ad account (live, cached 5 min) */
export const getMetaActiveCampaigns = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		// Client users can only access their own ad account
		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId })
				.from(table.metaAdsAccount)
				.where(and(
					eq(table.metaAdsAccount.clientId, event.locals.client.id),
					eq(table.metaAdsAccount.tenantId, event.locals.tenant.id)
				))
				.limit(1);
			if (!clientAccount || clientAccount.metaAdAccountId !== params.adAccountId) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;

		const cacheKey = `campaigns:${tenantId}:${params.adAccountId}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul Meta Ads. Verifică conexiunea din Settings.');
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			throw error(500, 'META_APP_SECRET nu este configurat');
		}

		try {
			const campaigns = await listActiveCampaigns(
				params.adAccountId,
				authResult.accessToken,
				appSecret
			);

			setCache(cacheKey, campaigns);
			return campaigns;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('validating access token') || msg.includes('session has been invalidated')) {
				throw error(401, 'Tokenul Meta Ads a expirat sau a fost revocat. Reconectează din Settings → Meta Ads.');
			}
			throw error(500, msg);
		}
	}
);

/** Get demographic breakdowns (gender, age, country, device) for an ad account */
export const getMetaDemographicInsights = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		campaignIds: v.optional(v.array(v.string())),
		resultActionTypes: v.optional(v.array(v.string()))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		// Client users can only access their own ad account
		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId })
				.from(table.metaAdsAccount)
				.where(and(
					eq(table.metaAdsAccount.clientId, event.locals.client.id),
					eq(table.metaAdsAccount.tenantId, event.locals.tenant.id)
				))
				.limit(1);
			if (!clientAccount || clientAccount.metaAdAccountId !== params.adAccountId) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;
		const campaignKey = params.campaignIds?.length ? params.campaignIds.sort().join(',') : 'all';
		const resultKey = params.resultActionTypes?.length ? params.resultActionTypes.sort().join(',') : 'none';

		const cacheKey = `demographics:${tenantId}:${params.adAccountId}:${params.since}:${params.until}:${campaignKey}:${resultKey}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul Meta Ads. Verifică conexiunea din Settings.');
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			throw error(500, 'META_APP_SECRET nu este configurat');
		}

		try {
			const demographics = await listDemographicInsights(
				params.adAccountId,
				authResult.accessToken,
				appSecret,
				params.since,
				params.until,
				params.campaignIds,
				params.resultActionTypes
			);

			setCache(cacheKey, demographics);
			return demographics;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('validating access token') || msg.includes('session has been invalidated')) {
				throw error(401, 'Tokenul Meta Ads a expirat sau a fost revocat. Reconectează din Settings → Meta Ads.');
			}
			throw error(500, msg);
		}
	}
);

/** Update campaign budget via Meta API (admin only) */
export const updateBudget = command(
	v.object({
		targetId: v.pipe(v.string(), v.minLength(1)), // campaign ID or ad set ID
		integrationId: v.pipe(v.string(), v.minLength(1)),
		budgetType: v.picklist(['daily', 'lifetime']),
		budgetAmount: v.pipe(v.number(), v.minValue(1))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Doar adminii pot modifica bugetul');
		}

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul Meta Ads.');
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			throw error(500, 'META_APP_SECRET nu este configurat');
		}

		const budgetCents = Math.round(params.budgetAmount * 100);

		try {
			await updateCampaignBudgetApi(
				params.targetId,
				authResult.accessToken,
				appSecret,
				params.budgetType,
				budgetCents
			);

			// Clear all cache so refresh shows updated budget
			cache.clear();

			return { success: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw error(500, `Eroare la actualizare buget: ${msg}`);
		}
	}
);

/** Toggle campaign on/off (ACTIVE/PAUSED) via Meta API (admin only) */
export const toggleCampaignStatus = command(
	v.object({
		campaignId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1)),
		newStatus: v.picklist(['ACTIVE', 'PAUSED'])
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Doar adminii pot schimba statusul campaniilor');
		}

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) throw error(500, 'Nu s-a putut obține token-ul Meta Ads.');

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) throw error(500, 'META_APP_SECRET nu este configurat');

		try {
			await toggleCampaignStatusApi(params.campaignId, authResult.accessToken, appSecret, params.newStatus);
			cache.clear();
			return { success: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw error(500, `Eroare la schimbarea statusului: ${msg}`);
		}
	}
);

/** Get ad set-level insights for a specific campaign (on-demand, cached 5 min) */
export const getMetaAdsetInsights = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1)),
		campaignId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId })
				.from(table.metaAdsAccount)
				.where(and(
					eq(table.metaAdsAccount.clientId, event.locals.client.id),
					eq(table.metaAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.metaAdsAccount.metaAdAccountId, params.adAccountId)
				))
				.limit(1);
			if (!clientAccount) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;
		const cacheKey = `adset-insights:${tenantId}:${params.adAccountId}:${params.campaignId}:${params.since}:${params.until}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul Meta Ads.');
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			throw error(500, 'META_APP_SECRET nu este configurat');
		}

		try {
			const insights = await listAdsetInsights(
				params.adAccountId,
				authResult.accessToken,
				appSecret,
				params.campaignId,
				params.since,
				params.until
			);

			setCache(cacheKey, insights);
			return insights;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('validating access token') || msg.includes('session has been invalidated')) {
				throw error(401, 'Tokenul Meta Ads a expirat sau a fost revocat.');
			}
			throw error(500, msg);
		}
	}
);
