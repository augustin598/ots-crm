import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { logWarning, logError } from '$lib/server/logger';
import { getAuthenticatedToken as getMetaToken } from '$lib/server/meta-ads/auth';
import { listCampaignInsights as listMetaCampaignInsights } from '$lib/server/meta-ads/client';
import { getAuthenticatedClient as getGoogleClient } from '$lib/server/google-ads/auth';
import { listCampaignInsights as listGoogleCampaignInsights } from '$lib/server/google-ads/client';
import { getAuthenticatedToken as getTiktokToken } from '$lib/server/tiktok-ads/auth';
import { listAdvertiserInsights as listTiktokAdvertiserInsights } from '$lib/server/tiktok-ads/client';
import type { ReportAccountData, ReportPlatformData } from '$lib/server/report-pdf-generator';

/**
 * Live spend aggregator for the PDF scheduler.
 *
 * Instead of reading from the monthly-grained `*_ads_spending` tables (which are
 * synced only once per month and therefore show 0 for the current month during
 * weekly windows), we hit Meta/Google/TikTok APIs live with a daily window and
 * aggregate on our side. This makes the PDF numbers identical to what clients
 * see in `/client/[tenant]/reports/...` dashboards.
 *
 * Every platform is wrapped in its own try/catch so a single broken integration
 * cannot poison the whole PDF. Failed platforms come back with
 * `fetchStatus='api-error'` and `errorMessage`, and the PDF renderer shows a
 * "live fetch failed" note on that row instead of silent zeroes.
 */

export type FetchStatus = 'ok' | 'api-error' | 'no-integration';

export interface LivePlatformResult extends ReportPlatformData {
	fetchStatus: FetchStatus;
	errorMessage?: string;
}

const PLATFORM_DISPLAY: Record<string, string> = {
	meta: 'Meta Ads',
	google: 'Google Ads',
	tiktok: 'TikTok Ads'
};

/**
 * Dispatcher. `platform` is one of 'meta' | 'google' | 'tiktok'.
 * Always returns a fully-populated result (never null) so upstream code can
 * render a row per platform regardless of success.
 */
export async function fetchLivePlatformSpend(
	tenantId: string,
	clientId: string,
	platform: string,
	since: string,
	until: string
): Promise<LivePlatformResult> {
	const displayName = PLATFORM_DISPLAY[platform] || platform;

	try {
		if (platform === 'meta') return await fetchMetaLive(tenantId, clientId, since, until);
		if (platform === 'google') return await fetchGoogleLive(tenantId, clientId, since, until);
		if (platform === 'tiktok') return await fetchTiktokLive(tenantId, clientId, since, until);
		return emptyPlatformResult(displayName, 'RON', 'no-integration');
	} catch (err) {
		const msg = (err as Error).message || String(err);
		logError('scheduler', `Live fetch threw for ${platform}`, {
			tenantId,
			metadata: { clientId, platform, since, until, error: msg.slice(0, 300) }
		});
		return {
			...emptyPlatformResult(displayName, 'RON', 'api-error'),
			errorMessage: msg.slice(0, 200)
		};
	}
}

function emptyPlatformResult(
	name: string,
	currency: string,
	status: FetchStatus,
	accounts: ReportAccountData[] = []
): LivePlatformResult {
	return {
		name,
		spend: 0,
		impressions: 0,
		clicks: 0,
		conversions: 0,
		currency,
		accounts,
		fetchStatus: status
	};
}

function sumAccounts(accounts: ReportAccountData[]): {
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
} {
	return accounts.reduce(
		(a, c) => ({
			spend: a.spend + c.spend,
			impressions: a.impressions + c.impressions,
			clicks: a.clicks + c.clicks,
			conversions: a.conversions + c.conversions
		}),
		{ spend: 0, impressions: 0, clicks: 0, conversions: 0 }
	);
}

// ===================== META =====================

async function fetchMetaLive(
	tenantId: string,
	clientId: string,
	since: string,
	until: string
): Promise<LivePlatformResult> {
	const rows = await db
		.select({
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
			accountName: table.metaAdsAccount.accountName,
			integrationId: table.metaAdsAccount.integrationId
		})
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, tenantId),
				eq(table.metaAdsAccount.clientId, clientId),
				eq(table.metaAdsAccount.isActive, true)
			)
		);

	if (rows.length === 0) {
		return emptyPlatformResult('Meta Ads', 'RON', 'no-integration');
	}

	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		logError('scheduler', 'META_APP_SECRET missing, cannot fetch Meta insights', { tenantId });
		return {
			...emptyPlatformResult(
				'Meta Ads',
				'RON',
				'api-error',
				rows.map((r) => zeroAccount(r.accountName))
			),
			errorMessage: 'META_APP_SECRET not configured'
		};
	}

	// Reuse one token per integration across all its accounts.
	const tokenCache = new Map<string, string | null>();
	const accounts: ReportAccountData[] = [];
	let apiErrors = 0;
	let lastError = '';

	for (const acct of rows) {
		let token = tokenCache.get(acct.integrationId);
		if (token === undefined) {
			try {
				const auth = await getMetaToken(acct.integrationId);
				token = auth?.accessToken ?? null;
			} catch (err) {
				lastError = (err as Error).message;
				token = null;
			}
			tokenCache.set(acct.integrationId, token);
		}

		if (!token) {
			apiErrors++;
			accounts.push(zeroAccount(acct.accountName));
			continue;
		}

		try {
			const insights = await listMetaCampaignInsights(
				acct.metaAdAccountId,
				token,
				appSecret,
				since,
				until,
				'daily'
			);
			let spend = 0;
			let impressions = 0;
			let clicks = 0;
			let conversions = 0;
			for (const row of insights) {
				spend += parseFloat(row.spend) || 0;
				impressions += parseInt(row.impressions, 10) || 0;
				clicks += parseInt(row.clicks, 10) || 0;
				conversions += row.conversions || 0;
			}
			accounts.push({
				accountName: acct.accountName,
				spend,
				currency: 'RON',
				impressions,
				clicks,
				conversions
			});
		} catch (err) {
			apiErrors++;
			lastError = (err as Error).message;
			logWarning('scheduler', `Meta insights failed for ${acct.metaAdAccountId}`, {
				tenantId,
				metadata: { clientId, error: lastError.slice(0, 200) }
			});
			accounts.push(zeroAccount(acct.accountName));
		}
	}

	// If every account failed, surface as api-error so the PDF can flag the row.
	if (apiErrors === rows.length) {
		return {
			...emptyPlatformResult('Meta Ads', 'RON', 'api-error', accounts),
			errorMessage: lastError ? `Meta API: ${lastError.slice(0, 150)}` : 'Meta API error'
		};
	}

	const totals = sumAccounts(accounts);
	return {
		name: 'Meta Ads',
		spend: totals.spend,
		impressions: totals.impressions,
		clicks: totals.clicks,
		conversions: totals.conversions,
		currency: 'RON',
		accounts,
		fetchStatus: 'ok'
	};
}

// ===================== GOOGLE =====================

async function fetchGoogleLive(
	tenantId: string,
	clientId: string,
	since: string,
	until: string
): Promise<LivePlatformResult> {
	const rows = await db
		.select({
			customerId: table.googleAdsAccount.googleAdsCustomerId,
			accountName: table.googleAdsAccount.accountName,
			currency: table.googleAdsAccount.currencyCode
		})
		.from(table.googleAdsAccount)
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, tenantId),
				eq(table.googleAdsAccount.clientId, clientId),
				eq(table.googleAdsAccount.isActive, true)
			)
		);

	if (rows.length === 0) {
		return emptyPlatformResult('Google Ads', 'RON', 'no-integration');
	}

	const auth = await getGoogleClient(tenantId);
	if (!auth) {
		return {
			...emptyPlatformResult(
				'Google Ads',
				rows[0]?.currency || 'RON',
				'api-error',
				rows.map((r) => zeroAccount(r.accountName, r.currency))
			),
			errorMessage: 'Google Ads integration not active or token refresh failed'
		};
	}

	const { integration } = auth;
	const accounts: ReportAccountData[] = [];
	let apiErrors = 0;
	let lastError = '';

	for (const acct of rows) {
		const cleanCustomerId = acct.customerId.replace(/-/g, '');
		try {
			const insights = await listGoogleCampaignInsights(
				integration.mccAccountId,
				cleanCustomerId,
				integration.developerToken,
				integration.refreshToken,
				since,
				until
			);
			let spend = 0;
			let impressions = 0;
			let clicks = 0;
			let conversions = 0;
			for (const row of insights) {
				spend += parseFloat(row.spend) || 0;
				impressions += parseInt(row.impressions, 10) || 0;
				clicks += parseInt(row.clicks, 10) || 0;
				conversions += row.conversions || 0;
			}
			accounts.push({
				accountName: acct.accountName,
				spend,
				currency: acct.currency || 'RON',
				impressions,
				clicks,
				conversions
			});
		} catch (err) {
			apiErrors++;
			lastError = (err as Error).message;
			logWarning('scheduler', `Google insights failed for ${cleanCustomerId}`, {
				tenantId,
				metadata: { clientId, error: lastError.slice(0, 200) }
			});
			accounts.push(zeroAccount(acct.accountName, acct.currency));
		}
	}

	const currency = rows[0]?.currency || 'RON';
	if (apiErrors === rows.length) {
		return {
			...emptyPlatformResult('Google Ads', currency, 'api-error', accounts),
			errorMessage: lastError ? `Google Ads API: ${lastError.slice(0, 150)}` : 'Google Ads API error'
		};
	}

	const totals = sumAccounts(accounts);
	return {
		name: 'Google Ads',
		spend: totals.spend,
		impressions: totals.impressions,
		clicks: totals.clicks,
		conversions: totals.conversions,
		currency,
		accounts,
		fetchStatus: 'ok'
	};
}

// ===================== TIKTOK =====================

async function fetchTiktokLive(
	tenantId: string,
	clientId: string,
	since: string,
	until: string
): Promise<LivePlatformResult> {
	const rows = await db
		.select({
			advertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
			accountName: table.tiktokAdsAccount.accountName,
			integrationId: table.tiktokAdsAccount.integrationId
		})
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, tenantId),
				eq(table.tiktokAdsAccount.clientId, clientId),
				eq(table.tiktokAdsAccount.isActive, true)
			)
		);

	if (rows.length === 0) {
		return emptyPlatformResult('TikTok Ads', 'RON', 'no-integration');
	}

	const tokenCache = new Map<string, string | null>();
	const accounts: ReportAccountData[] = [];
	let apiErrors = 0;
	let lastError = '';

	for (const acct of rows) {
		let token = tokenCache.get(acct.integrationId);
		if (token === undefined) {
			try {
				const auth = await getTiktokToken(acct.integrationId);
				token = auth?.accessToken ?? null;
			} catch (err) {
				lastError = (err as Error).message;
				token = null;
			}
			tokenCache.set(acct.integrationId, token);
		}

		if (!token) {
			apiErrors++;
			accounts.push(zeroAccount(acct.accountName));
			continue;
		}

		try {
			const insights = await listTiktokAdvertiserInsights(acct.advertiserId, token, since, until);
			let spend = 0;
			let impressions = 0;
			let clicks = 0;
			let conversions = 0;
			for (const row of insights) {
				spend += parseFloat(row.spend) || 0;
				impressions += parseInt(row.impressions, 10) || 0;
				clicks += parseInt(row.clicks, 10) || 0;
				conversions += parseInt(row.conversions, 10) || 0;
			}
			accounts.push({
				accountName: acct.accountName,
				spend,
				currency: 'RON',
				impressions,
				clicks,
				conversions
			});
		} catch (err) {
			apiErrors++;
			lastError = (err as Error).message;
			logWarning('scheduler', `TikTok insights failed for ${acct.advertiserId}`, {
				tenantId,
				metadata: { clientId, error: lastError.slice(0, 200) }
			});
			accounts.push(zeroAccount(acct.accountName));
		}
	}

	if (apiErrors === rows.length) {
		return {
			...emptyPlatformResult('TikTok Ads', 'RON', 'api-error', accounts),
			errorMessage: lastError ? `TikTok API: ${lastError.slice(0, 150)}` : 'TikTok API error'
		};
	}

	const totals = sumAccounts(accounts);
	return {
		name: 'TikTok Ads',
		spend: totals.spend,
		impressions: totals.impressions,
		clicks: totals.clicks,
		conversions: totals.conversions,
		currency: 'RON',
		accounts,
		fetchStatus: 'ok'
	};
}

function zeroAccount(name: string, currency = 'RON'): ReportAccountData {
	return { accountName: name, spend: 0, currency, impressions: 0, clicks: 0, conversions: 0 };
}
