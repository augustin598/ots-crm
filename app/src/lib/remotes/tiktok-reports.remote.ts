import { query, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray, isNotNull } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/tiktok-ads/auth';
import { listCampaignInsights, listCampaigns, listDemographicInsights, TIKTOK_OBJECTIVE_MAP, OPTIMIZATION_GOAL_MAP } from '$lib/server/tiktok-ads/client';

// ---- Server-side cache (5 min TTL) ----

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
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
	if (cache.size >= MAX_CACHE_SIZE) {
		const firstKey = cache.keys().next().value;
		if (firstKey) cache.delete(firstKey);
	}
	cache.set(key, { data, timestamp: Date.now() });
}

// ---- Queries ----

/** Get all TikTok Ads accounts for the tenant (for the ad account filter dropdown) */
export const getTiktokReportAdAccounts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	const accounts = await db
		.select({
			id: table.tiktokAdsAccount.id,
			tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
			accountName: table.tiktokAdsAccount.accountName,
			integrationId: table.tiktokAdsAccount.integrationId,
			clientId: table.tiktokAdsAccount.clientId,
			clientName: table.client.name,
			isActive: table.tiktokAdsAccount.isActive,
			refreshTokenExpiresAt: table.tiktokAdsIntegration.refreshTokenExpiresAt
		})
		.from(table.tiktokAdsAccount)
		.leftJoin(table.client, eq(table.tiktokAdsAccount.clientId, table.client.id))
		.leftJoin(table.tiktokAdsIntegration, eq(table.tiktokAdsAccount.integrationId, table.tiktokAdsIntegration.id))
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
				isNotNull(table.tiktokAdsAccount.clientId)
			)
		)
		.orderBy(table.tiktokAdsAccount.accountName);

	// Batch lookup currency per ad account from spending data
	const accountIds = accounts.map(a => a.tiktokAdvertiserId);
	const currencyMap = new Map<string, string>();

	if (accountIds.length > 0) {
		const spendings = await db
			.select({ tiktokAdvertiserId: table.tiktokAdsSpending.tiktokAdvertiserId, currencyCode: table.tiktokAdsSpending.currencyCode })
			.from(table.tiktokAdsSpending)
			.where(inArray(table.tiktokAdsSpending.tiktokAdvertiserId, accountIds))
			.orderBy(desc(table.tiktokAdsSpending.periodStart));

		for (const s of spendings) {
			if (!currencyMap.has(s.tiktokAdvertiserId)) {
				currencyMap.set(s.tiktokAdvertiserId, s.currencyCode);
			}
		}
	}

	return accounts.map(acc => ({
		...acc,
		currency: currencyMap.get(acc.tiktokAdvertiserId) || 'RON',
		refreshTokenExpiresAt: acc.refreshTokenExpiresAt
	}));
});

/** Get the TikTok Ads account for the currently logged-in client user (client portal) — single account */
export const getMyTiktokAdAccount = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.isClientUser || !event?.locals.client) {
		return null;
	}

	const [account] = await db
		.select({
			id: table.tiktokAdsAccount.id,
			tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
			accountName: table.tiktokAdsAccount.accountName,
			integrationId: table.tiktokAdsAccount.integrationId,
			clientId: table.tiktokAdsAccount.clientId
		})
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
				eq(table.tiktokAdsAccount.clientId, event.locals.client.id)
			)
		)
		.limit(1);

	if (!account) return null;

	const [spending] = await db
		.select({ currencyCode: table.tiktokAdsSpending.currencyCode })
		.from(table.tiktokAdsSpending)
		.where(eq(table.tiktokAdsSpending.tiktokAdvertiserId, account.tiktokAdvertiserId))
		.orderBy(desc(table.tiktokAdsSpending.periodStart))
		.limit(1);

	return { ...account, currency: spending?.currencyCode || 'RON' };
});

/** Get ALL TikTok Ads accounts for the currently logged-in client user (multi-account support) */
export const getMyTiktokAdAccounts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.isClientUser || !event?.locals.client) {
		return [];
	}

	const accounts = await db
		.select({
			id: table.tiktokAdsAccount.id,
			tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
			accountName: table.tiktokAdsAccount.accountName,
			integrationId: table.tiktokAdsAccount.integrationId,
			clientId: table.tiktokAdsAccount.clientId
		})
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
				eq(table.tiktokAdsAccount.clientId, event.locals.client.id)
			)
		)
		.orderBy(table.tiktokAdsAccount.accountName);

	if (accounts.length === 0) return [];

	// Batch lookup currency
	const accountIds = accounts.map(a => a.tiktokAdvertiserId);
	const currencyMap = new Map<string, string>();

	if (accountIds.length > 0) {
		const spendings = await db
			.select({ tiktokAdvertiserId: table.tiktokAdsSpending.tiktokAdvertiserId, currencyCode: table.tiktokAdsSpending.currencyCode })
			.from(table.tiktokAdsSpending)
			.where(inArray(table.tiktokAdsSpending.tiktokAdvertiserId, accountIds))
			.orderBy(desc(table.tiktokAdsSpending.periodStart));

		for (const s of spendings) {
			if (!currencyMap.has(s.tiktokAdvertiserId)) {
				currencyMap.set(s.tiktokAdvertiserId, s.currencyCode);
			}
		}
	}

	return accounts.map(acc => ({
		...acc,
		currency: currencyMap.get(acc.tiktokAdvertiserId) || 'RON'
	}));
});

/** Get campaign-level insights from TikTok API (live, cached 5 min) */
export const getTiktokCampaignInsights = query(
	v.object({
		advertiserId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		// Client users can only access their own ad accounts
		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId })
				.from(table.tiktokAdsAccount)
				.where(and(
					eq(table.tiktokAdsAccount.clientId, event.locals.client.id),
					eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.tiktokAdsAccount.tiktokAdvertiserId, params.advertiserId)
				))
				.limit(1);
			if (!clientAccount) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;

		const cacheKey = `tt-insights:${tenantId}:${params.advertiserId}:${params.since}:${params.until}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		// Verify account belongs to tenant
		const [account] = await db
			.select({ id: table.tiktokAdsAccount.id })
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.tiktokAdvertiserId, params.advertiserId),
					eq(table.tiktokAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!account) {
			throw error(404, 'Cont TikTok Ads negăsit');
		}

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul TikTok Ads. Verifică conexiunea din Settings.');
		}

		try {
			// Fetch insights and campaigns in parallel
			const [insights, campaigns] = await Promise.all([
				listCampaignInsights(
					params.advertiserId,
					authResult.accessToken,
					params.since,
					params.until
				),
				listCampaigns(
					params.advertiserId,
					authResult.accessToken
				)
			]);

			// Build campaign name + objective + optimization goal map
			const campaignInfoMap = new Map<string, { name: string; objective: string; optimizationGoal: string }>();
			for (const c of campaigns) {
				campaignInfoMap.set(c.campaignId, { name: c.campaignName, objective: c.objective, optimizationGoal: c.optimizationGoal });
			}

			// Enrich insights — optimization_goal (ad group level) takes priority over objective (campaign level)
			for (const insight of insights) {
				const info = campaignInfoMap.get(insight.campaignId);
				if (info) {
					insight.campaignName = info.name;
					insight.objective = info.objective;
					// Prefer ad group optimization_goal for precise label, fallback to campaign objective
					const goalDef = OPTIMIZATION_GOAL_MAP[info.optimizationGoal] || TIKTOK_OBJECTIVE_MAP[info.objective];
					if (goalDef) {
						insight.resultType = goalDef.label;
						insight.cpaLabel = goalDef.cpaLabel;
					}
				}
			}

			setCache(cacheKey, insights);
			return insights;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('Access token') || msg.includes('token')) {
				throw error(401, 'Token-ul TikTok Ads a expirat sau a fost revocat. Reconectează din Settings → TikTok Ads.');
			}
			throw error(500, msg);
		}
	}
);

/** Get active campaigns for an advertiser (live, cached 5 min) */
export const getTiktokActiveCampaigns = query(
	v.object({
		advertiserId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId })
				.from(table.tiktokAdsAccount)
				.where(and(
					eq(table.tiktokAdsAccount.clientId, event.locals.client.id),
					eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.tiktokAdsAccount.tiktokAdvertiserId, params.advertiserId)
				))
				.limit(1);
			if (!clientAccount) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;
		const cacheKey = `tt-campaigns:${tenantId}:${params.advertiserId}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul TikTok Ads. Verifică conexiunea din Settings.');
		}

		try {
			const campaigns = await listCampaigns(
				params.advertiserId,
				authResult.accessToken
			);

			setCache(cacheKey, campaigns);
			return campaigns;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw error(500, msg);
		}
	}
);

/** Get demographic breakdowns (gender, age, country, platform) for an advertiser */
export const getTiktokDemographicInsights = query(
	v.object({
		advertiserId: v.pipe(v.string(), v.minLength(1)),
		integrationId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		until: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		campaignIds: v.optional(v.array(v.string()))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		if (event.locals.isClientUser) {
			if (!event.locals.client) throw error(401, 'Unauthorized');
			const [clientAccount] = await db
				.select({ tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId })
				.from(table.tiktokAdsAccount)
				.where(and(
					eq(table.tiktokAdsAccount.clientId, event.locals.client.id),
					eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.tiktokAdsAccount.tiktokAdvertiserId, params.advertiserId)
				))
				.limit(1);
			if (!clientAccount) {
				throw error(401, 'Unauthorized');
			}
		}

		const tenantId = event.locals.tenant.id;
		const campaignKey = params.campaignIds?.length ? params.campaignIds.sort().join(',') : 'all';

		const cacheKey = `tt-demographics:${tenantId}:${params.advertiserId}:${params.since}:${params.until}:${campaignKey}`;
		const cached = getCached<any>(cacheKey);
		if (cached) return cached;

		const authResult = await getAuthenticatedToken(params.integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul TikTok Ads. Verifică conexiunea din Settings.');
		}

		try {
			const demographics = await listDemographicInsights(
				params.advertiserId,
				authResult.accessToken,
				params.since,
				params.until,
				params.campaignIds
			);

			setCache(cacheKey, demographics);
			return demographics;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw error(500, msg);
		}
	}
);
