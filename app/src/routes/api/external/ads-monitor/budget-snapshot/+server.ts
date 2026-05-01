import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { getCampaignWithAdsets } from '$lib/server/meta-ads/client';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
	data: BudgetSnapshot;
	cachedAt: number;
}

interface BudgetSnapshot {
	currentDailyBudgetCents: number;
	source: 'campaign' | 'adsets';
	adsets?: Array<{ id: string; name: string; dailyBudgetCents: number }>;
}

const cache = new Map<string, CacheEntry>();

async function resolveIntegrationForTenant(tenantId: string): Promise<string | null> {
	const accounts = await db
		.select({ integrationId: table.metaAdsAccount.integrationId })
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, tenantId),
				eq(table.metaAdsAccount.isActive, true)
			)
		)
		.limit(1);
	return accounts[0]?.integrationId ?? null;
}

/**
 * GET /api/external/ads-monitor/budget-snapshot?campaignId=X
 * Auth: X-API-Key (ads_monitor:read)
 *
 * Returns the live current Meta budget for a campaign.
 * CBO campaigns return campaign-level daily budget.
 * ABO campaigns return sum of active adset daily budgets.
 * Result cached 60s to avoid spamming Meta.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const campaignId = event.url.searchParams.get('campaignId');
		if (!campaignId) {
			return {
				status: 400,
				body: { error: 'missing_param', message: 'campaignId is required' }
			};
		}

		const cacheKey = `${ctx.tenantId}:${campaignId}`;
		const now = Date.now();
		const cached = cache.get(cacheKey);
		if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
			return { status: 200, body: cached.data };
		}

		const integrationId = await resolveIntegrationForTenant(ctx.tenantId);
		if (!integrationId) {
			return {
				status: 422,
				body: { error: 'no_meta_integration', message: 'No active Meta integration for tenant' }
			};
		}

		const auth = await getAuthenticatedToken(integrationId);
		if (!auth) {
			return {
				status: 422,
				body: { error: 'no_auth_token', message: 'Failed to get Meta auth token' }
			};
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			return {
				status: 500,
				body: { error: 'config_error', message: 'META_APP_SECRET not configured' }
			};
		}

		let campaign;
		try {
			campaign = await getCampaignWithAdsets(campaignId, auth.accessToken, appSecret);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				status: 502,
				body: { error: 'meta_api_error', message }
			};
		}

		let snapshot: BudgetSnapshot;

		if (campaign.daily_budget !== null) {
			// CBO — budget is at campaign level
			snapshot = {
				currentDailyBudgetCents: campaign.daily_budget,
				source: 'campaign'
			};
		} else {
			// ABO — sum adset budgets
			const activeAdsets = campaign.adsets.filter(
				(a) => a.daily_budget !== null && a.status !== 'DELETED' && a.status !== 'ARCHIVED'
			);
			const total = activeAdsets.reduce((sum, a) => sum + (a.daily_budget ?? 0), 0);
			snapshot = {
				currentDailyBudgetCents: total,
				source: 'adsets',
				adsets: activeAdsets.map((a) => ({
					id: a.id,
					name: a.name,
					dailyBudgetCents: a.daily_budget ?? 0
				}))
			};
		}

		cache.set(cacheKey, { data: snapshot, cachedAt: now });

		return { status: 200, body: snapshot };
	});
