import { logWarning } from '$lib/server/logger';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { listCampaignInsights } from '$lib/server/meta-ads/client';

// =============================================================================
// Insights snapshot cache
// =============================================================================
//
// Workers / schedulers poll GET /campaigns/:id?withInsights=true to monitor
// active campaigns. Without caching that hammers Meta on every poll. We
// memoize per-campaign for 60s in-process — sufficient for MVP single-instance
// CRM.
// =============================================================================

const CACHE_TTL_MS = 60_000;

export interface InsightsSnapshot {
	spendCents: number;
	impressions: number;
	clicks: number;
	conversions: number;
	cpc: string | null;
	cpm: string | null;
	ctr: string | null;
	cplCents: number | null;
	periodSince: string;
	periodUntil: string;
	fetchedAt: string;
}

interface CacheEntry {
	snapshot: InsightsSnapshot;
	cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Get insights for a single campaign over the last 7 days. Caches 60s.
 * Returns null on any failure — caller should treat insights as best-effort.
 */
export async function getCampaignInsightsSnapshot(
	campaignId: string,
	tenantId: string
): Promise<InsightsSnapshot | null> {
	const cacheKey = `${tenantId}:${campaignId}`;
	const now = Date.now();
	const cached = cache.get(cacheKey);
	if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
		return cached.snapshot;
	}

	const [row] = await db
		.select({
			externalCampaignId: table.campaign.externalCampaignId,
			externalAdAccountId: table.campaign.externalAdAccountId,
			budgetCents: table.campaign.budgetCents
		})
		.from(table.campaign)
		.where(and(eq(table.campaign.id, campaignId), eq(table.campaign.tenantId, tenantId)))
		.limit(1);
	if (!row || !row.externalCampaignId || !row.externalAdAccountId) return null;

	const [adAccount] = await db
		.select({ integrationId: table.metaAdsAccount.integrationId })
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, tenantId),
				eq(table.metaAdsAccount.metaAdAccountId, row.externalAdAccountId)
			)
		)
		.limit(1);
	if (!adAccount) return null;

	const tokenInfo = await getAuthenticatedToken(adAccount.integrationId);
	if (!tokenInfo) return null;

	const appSecret = env.META_APP_SECRET;
	if (!appSecret) return null;

	const until = new Date();
	const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

	try {
		const insights = await listCampaignInsights(
			row.externalAdAccountId,
			tokenInfo.accessToken,
			appSecret,
			isoDate(since),
			isoDate(until),
			'monthly'
		);
		const match = insights.find((i) => i.campaignId === row.externalCampaignId);
		if (!match) {
			// No data yet (campaign just went live) — cache an empty snapshot.
			const empty: InsightsSnapshot = {
				spendCents: 0,
				impressions: 0,
				clicks: 0,
				conversions: 0,
				cpc: null,
				cpm: null,
				ctr: null,
				cplCents: null,
				periodSince: isoDate(since),
				periodUntil: isoDate(until),
				fetchedAt: new Date().toISOString()
			};
			cache.set(cacheKey, { snapshot: empty, cachedAt: now });
			return empty;
		}

		const spendCents = Math.round(parseFloat(match.spend) * 100);
		const conversions = match.conversions ?? 0;
		const cplCents =
			conversions > 0 && spendCents > 0 ? Math.round(spendCents / conversions) : null;

		const snapshot: InsightsSnapshot = {
			spendCents,
			impressions: parseInt(match.impressions, 10) || 0,
			clicks: parseInt(match.clicks, 10) || 0,
			conversions,
			cpc: match.cpc || null,
			cpm: match.cpm || null,
			ctr: match.ctr || null,
			cplCents,
			periodSince: isoDate(since),
			periodUntil: isoDate(until),
			fetchedAt: new Date().toISOString()
		};
		cache.set(cacheKey, { snapshot, cachedAt: now });
		return snapshot;
	} catch (err) {
		logWarning('meta-ads', 'getCampaignInsightsSnapshot failed', {
			metadata: {
				campaignId,
				externalCampaignId: row.externalCampaignId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		return null;
	}
}

/** Clear cache — used by tests or when a campaign is paused/archived. */
export function clearInsightsCache(campaignId?: string, tenantId?: string): void {
	if (campaignId && tenantId) {
		cache.delete(`${tenantId}:${campaignId}`);
		return;
	}
	cache.clear();
}
