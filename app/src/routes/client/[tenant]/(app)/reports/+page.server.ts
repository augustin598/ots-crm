import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, gte, lte, isNotNull } from 'drizzle-orm';
import { getAuthenticatedClient } from '$lib/server/google-ads/auth';
import { listConversionActions, listCampaignInsights as listGoogleCampaignInsights } from '$lib/server/google-ads/client';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { listCampaignInsights } from '$lib/server/meta-ads/client';
import { env } from '$env/dynamic/private';
import { logError } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Default to current month
	const now = new Date();
	const defaultSince = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	const defaultUntil = now.toISOString().split('T')[0];

	const since = url.searchParams.get('since') ?? defaultSince;
	const until = url.searchParams.get('until') ?? defaultUntil;

	if (!locals.tenant || !locals.client) {
		return {
			metaAccounts: [] as { accountName: string; accountId: string; isActive: boolean }[],
			googleAccounts: [] as { accountName: string; accountId: string; isActive: boolean }[],
			tiktokAccounts: [] as { accountName: string; accountId: string; isActive: boolean }[],
			platformMetrics: [] as any[],
			apiConversions: Promise.resolve({ meta: { conversions: 0, revenue: 0, conversionLabel: '', accounts: {}, breakdown: [] }, google: { conversions: 0, revenue: 0, conversionLabel: '', accounts: {}, breakdown: [] } }),
			adSpend: {
				meta: 0, google: 0, tiktok: 0, total: 0,
				metaCurrency: 'RON', googleCurrency: 'RON', tiktokCurrency: 'RON',
				metaAccounts: [] as { accountName: string; spendCents: number; currency: string }[],
				googleAccounts: [] as { accountName: string; spendCents: number; currency: string }[],
				tiktokAccounts: [] as { accountName: string; spendCents: number; currency: string }[]
			},
			since,
			until
		};
	}

	const tenantId = locals.tenant.id;
	const clientId = locals.client.id;

	const dateFilter = { since, until };

	// Overlap filter: include any month whose period overlaps the selected range
	// periodStart <= until AND periodEnd >= since
	const [metaResult, googleResult, tiktokResult, metaByAccount, googleByAccount, tiktokByAccount, metaAccounts, googleAccounts, tiktokAccounts] = await Promise.all([
		// Meta Ads total + currency + impressions/clicks
		db
			.select({
				total: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`.as('total'),
				impressions: sql<number>`coalesce(sum(${table.metaAdsSpending.impressions}), 0)`.as('impressions'),
				clicks: sql<number>`coalesce(sum(${table.metaAdsSpending.clicks}), 0)`.as('clicks'),
				currency: sql<string>`${table.metaAdsSpending.currencyCode}`.as('currency')
			})
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.tenantId, tenantId),
					eq(table.metaAdsSpending.clientId, clientId),
					lte(table.metaAdsSpending.periodStart, dateFilter.until),
					gte(table.metaAdsSpending.periodEnd, dateFilter.since)
				)
			)
			.groupBy(table.metaAdsSpending.currencyCode),

		// Google Ads total + currency + impressions/clicks
		db
			.select({
				total: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`.as('total'),
				impressions: sql<number>`coalesce(sum(${table.googleAdsSpending.impressions}), 0)`.as('impressions'),
				clicks: sql<number>`coalesce(sum(${table.googleAdsSpending.clicks}), 0)`.as('clicks'),
				currency: sql<string>`${table.googleAdsSpending.currencyCode}`.as('currency')
			})
			.from(table.googleAdsSpending)
			.where(
				and(
					eq(table.googleAdsSpending.tenantId, tenantId),
					eq(table.googleAdsSpending.clientId, clientId),
					lte(table.googleAdsSpending.periodStart, dateFilter.until),
					gte(table.googleAdsSpending.periodEnd, dateFilter.since)
				)
			)
			.groupBy(table.googleAdsSpending.currencyCode),

		// TikTok Ads total + currency + impressions/clicks
		db
			.select({
				total: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`.as('total'),
				impressions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.impressions}), 0)`.as('impressions'),
				clicks: sql<number>`coalesce(sum(${table.tiktokAdsSpending.clicks}), 0)`.as('clicks'),
				currency: sql<string>`${table.tiktokAdsSpending.currencyCode}`.as('currency')
			})
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.tenantId, tenantId),
					eq(table.tiktokAdsSpending.clientId, clientId),
					lte(table.tiktokAdsSpending.periodStart, dateFilter.until),
					gte(table.tiktokAdsSpending.periodEnd, dateFilter.since)
				)
			)
			.groupBy(table.tiktokAdsSpending.currencyCode),

		// Meta Ads per account (conversions from API, not DB)
		db
			.select({
				accountName: sql<string>`coalesce(${table.metaAdsAccount.accountName}, ${table.metaAdsSpending.metaAdAccountId})`.as('accountName'),
				adAccountId: table.metaAdsSpending.metaAdAccountId,
				spendCents: sql<number>`sum(${table.metaAdsSpending.spendCents})`.as('spendCents'),
				impressions: sql<number>`coalesce(sum(${table.metaAdsSpending.impressions}), 0)`.as('impressions'),
				clicks: sql<number>`coalesce(sum(${table.metaAdsSpending.clicks}), 0)`.as('clicks'),
				conversions: sql<number>`0`.as('conversions'),
				currency: sql<string>`${table.metaAdsSpending.currencyCode}`.as('currency')
			})
			.from(table.metaAdsSpending)
			.leftJoin(table.metaAdsAccount, eq(table.metaAdsSpending.metaAdAccountId, table.metaAdsAccount.metaAdAccountId))
			.where(
				and(
					eq(table.metaAdsSpending.tenantId, tenantId),
					eq(table.metaAdsSpending.clientId, clientId),
					lte(table.metaAdsSpending.periodStart, dateFilter.until),
					gte(table.metaAdsSpending.periodEnd, dateFilter.since)
				)
			)
			.groupBy(table.metaAdsSpending.metaAdAccountId, table.metaAdsSpending.currencyCode),

		// Google Ads per account (has conversions)
		db
			.select({
				accountName: sql<string>`coalesce(${table.googleAdsAccount.accountName}, ${table.googleAdsSpending.googleAdsCustomerId})`.as('accountName'),
				spendCents: sql<number>`sum(${table.googleAdsSpending.spendCents})`.as('spendCents'),
				impressions: sql<number>`coalesce(sum(${table.googleAdsSpending.impressions}), 0)`.as('impressions'),
				clicks: sql<number>`coalesce(sum(${table.googleAdsSpending.clicks}), 0)`.as('clicks'),
				conversions: sql<number>`coalesce(sum(${table.googleAdsSpending.conversions}), 0)`.as('conversions'),
				currency: sql<string>`${table.googleAdsSpending.currencyCode}`.as('currency')
			})
			.from(table.googleAdsSpending)
			.leftJoin(table.googleAdsAccount, eq(table.googleAdsSpending.googleAdsCustomerId, table.googleAdsAccount.googleAdsCustomerId))
			.where(
				and(
					eq(table.googleAdsSpending.tenantId, tenantId),
					eq(table.googleAdsSpending.clientId, clientId),
					lte(table.googleAdsSpending.periodStart, dateFilter.until),
					gte(table.googleAdsSpending.periodEnd, dateFilter.since)
				)
			)
			.groupBy(table.googleAdsSpending.googleAdsCustomerId, table.googleAdsSpending.currencyCode),

		// TikTok Ads per account (has conversions)
		db
			.select({
				accountName: sql<string>`coalesce(${table.tiktokAdsAccount.accountName}, ${table.tiktokAdsSpending.tiktokAdvertiserId})`.as('accountName'),
				spendCents: sql<number>`sum(${table.tiktokAdsSpending.spendCents})`.as('spendCents'),
				impressions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.impressions}), 0)`.as('impressions'),
				clicks: sql<number>`coalesce(sum(${table.tiktokAdsSpending.clicks}), 0)`.as('clicks'),
				conversions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.conversions}), 0)`.as('conversions'),
				currency: sql<string>`${table.tiktokAdsSpending.currencyCode}`.as('currency')
			})
			.from(table.tiktokAdsSpending)
			.leftJoin(table.tiktokAdsAccount, eq(table.tiktokAdsSpending.tiktokAdvertiserId, table.tiktokAdsAccount.tiktokAdvertiserId))
			.where(
				and(
					eq(table.tiktokAdsSpending.tenantId, tenantId),
					eq(table.tiktokAdsSpending.clientId, clientId),
					lte(table.tiktokAdsSpending.periodStart, dateFilter.until),
					gte(table.tiktokAdsSpending.periodEnd, dateFilter.since)
				)
			)
			.groupBy(table.tiktokAdsSpending.tiktokAdvertiserId, table.tiktokAdsSpending.currencyCode),

		// Meta accounts for this client
		db
			.select({
				accountName: table.metaAdsAccount.accountName,
				accountId: table.metaAdsAccount.metaAdAccountId,
				isActive: table.metaAdsAccount.isActive
			})
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, tenantId),
					eq(table.metaAdsAccount.clientId, clientId)
				)
			)
			.orderBy(table.metaAdsAccount.accountName),

		// Google accounts for this client
		db
			.select({
				accountName: table.googleAdsAccount.accountName,
				accountId: table.googleAdsAccount.googleAdsCustomerId,
				isActive: table.googleAdsAccount.isActive
			})
			.from(table.googleAdsAccount)
			.where(
				and(
					eq(table.googleAdsAccount.tenantId, tenantId),
					eq(table.googleAdsAccount.clientId, clientId)
				)
			)
			.orderBy(table.googleAdsAccount.accountName),

		// TikTok accounts for this client
		db
			.select({
				accountName: table.tiktokAdsAccount.accountName,
				accountId: table.tiktokAdsAccount.tiktokAdvertiserId,
				isActive: table.tiktokAdsAccount.isActive
			})
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.tenantId, tenantId),
					eq(table.tiktokAdsAccount.clientId, clientId)
				)
			)
			.orderBy(table.tiktokAdsAccount.accountName)
	]);

	// Sum totals per platform (could have multiple currencies, take first non-empty)
	const metaTotal = metaResult.reduce((sum, r) => sum + (r.total ?? 0), 0);
	const googleTotal = googleResult.reduce((sum, r) => sum + (r.total ?? 0), 0);
	const tiktokTotal = tiktokResult.reduce((sum, r) => sum + (r.total ?? 0), 0);

	const metaImpressions = metaResult.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
	const googleImpressions = googleResult.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
	const tiktokImpressions = tiktokResult.reduce((sum, r) => sum + (r.impressions ?? 0), 0);

	const metaClicks = metaResult.reduce((sum, r) => sum + (r.clicks ?? 0), 0);
	const googleClicks = googleResult.reduce((sum, r) => sum + (r.clicks ?? 0), 0);
	const tiktokClicks = tiktokResult.reduce((sum, r) => sum + (r.clicks ?? 0), 0);

	const metaCurrency = metaResult[0]?.currency || 'RON';
	const googleCurrency = googleResult[0]?.currency || 'RON';
	const tiktokCurrency = tiktokResult[0]?.currency || 'RON';

	const metaAccountsWithSpend = metaByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents);
	const googleAccountsWithSpend = googleByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents);
	const tiktokAccountsWithSpend = tiktokByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents);

	// ---- Types (Record instead of Map for JSON serialization) ----
	type BreakdownRow = { type: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number };
	type AccountConvData = { conversions: number; revenue: number; label: string; breakdown: BreakdownRow[] };
	type PlatformConvData = { conversions: number; revenue: number; conversionLabel: string; accounts: Record<string, AccountConvData>; breakdown: BreakdownRow[] };

	const buildPlatformBreakdown = (accounts: AccountConvData[]): BreakdownRow[] => {
		const merged = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; revenue: number }>();
		for (const acc of accounts) {
			for (const b of acc.breakdown || []) {
				const ex = merged.get(b.type) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
				ex.spend += b.spend; ex.impressions += b.impressions; ex.clicks += b.clicks;
				ex.conversions += b.conversions; ex.revenue += b.revenue;
				merged.set(b.type, ex);
			}
		}
		return Array.from(merged.entries()).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.conversions - a.conversions);
	};

	// ---- STREAMED: API conversion data (not awaited — SvelteKit streams to client) ----
	const apiConversionsPromise = (async (): Promise<{ meta: PlatformConvData; google: PlatformConvData }> => {
		const meta: PlatformConvData = { conversions: 0, revenue: 0, conversionLabel: '', accounts: {}, breakdown: [] };
		const google: PlatformConvData = { conversions: 0, revenue: 0, conversionLabel: '', accounts: {}, breakdown: [] };

		// ---- Meta Ads (parallel per integration, then per account) ----
		if (metaAccounts.length > 0) {
			const appSecret = env.META_APP_SECRET;
			if (appSecret) {
				try {
					const metaAccountsWithIntegration = await db
						.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId, integrationId: table.metaAdsAccount.integrationId })
						.from(table.metaAdsAccount)
						.where(and(eq(table.metaAdsAccount.tenantId, tenantId), eq(table.metaAdsAccount.clientId, clientId)));

					const byIntegration = new Map<string, string[]>();
					for (const acc of metaAccountsWithIntegration) {
						const list = byIntegration.get(acc.integrationId) || [];
						list.push(acc.metaAdAccountId);
						byIntegration.set(acc.integrationId, list);
					}

					const globalResultTypes = new Map<string, number>();

					// Process all integrations in parallel
					await Promise.all(Array.from(byIntegration.entries()).map(async ([integrationId, accountIds]) => {
						try {
							const authResult = await getAuthenticatedToken(integrationId);
							if (!authResult) return;

							// Process all accounts under this integration in parallel
							await Promise.all(accountIds.map(async (adAccountId) => {
								try {
									const insights = await listCampaignInsights(adAccountId, authResult.accessToken, appSecret, since, until, 'monthly');
									let accConv = 0, accRevenue = 0;
									const accResultTypes = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; revenue: number }>();
									for (const row of insights) {
										accConv += row.conversions; accRevenue += row.conversionValue;
										const rType = row.resultType || row.objective || 'Other';
										if (row.conversions > 0 || parseFloat(row.spend) > 0) {
											const ex = accResultTypes.get(rType) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
											ex.spend += parseFloat(row.spend); ex.impressions += parseInt(row.impressions); ex.clicks += parseInt(row.clicks);
											ex.conversions += row.conversions; ex.revenue += row.conversionValue;
											accResultTypes.set(rType, ex);
											globalResultTypes.set(rType, (globalResultTypes.get(rType) || 0) + row.conversions);
										}
									}
									const breakdown = Array.from(accResultTypes.entries()).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.conversions - a.conversions);
									const accLabel = breakdown.filter(b => b.conversions > 0).slice(0, 3).map(b => `${Math.round(b.conversions)} ${b.type}`).join(', ');
									meta.accounts[adAccountId] = { conversions: accConv, revenue: accRevenue, label: accLabel, breakdown };
									meta.conversions += accConv; meta.revenue += accRevenue;
								} catch { /* skip individual account */ }
							}));
						} catch { /* skip integration */ }
					}));

					meta.conversionLabel = Array.from(globalResultTypes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${Math.round(c)} ${t}`).join(', ');
					meta.breakdown = buildPlatformBreakdown(Object.values(meta.accounts));
				} catch (err) {
					logError('meta-ads', 'Failed to fetch Meta insights for client reports', { metadata: { error: err instanceof Error ? err.message : String(err) } });
				}
			}
		}

		// ---- Google Ads (parallel per account) ----
		if (googleAccounts.length > 0) {
			try {
				const authResult = await getAuthenticatedClient(tenantId);
				if (authResult) {
					const { integration } = authResult;
					const globalResultTypes = new Map<string, number>();

					// Process all Google accounts in parallel
					await Promise.all(googleAccounts.map(async (acc) => {
						try {
							const [insights, convActions] = await Promise.all([
								listGoogleCampaignInsights(integration.mccAccountId, acc.accountId, integration.developerToken, integration.refreshToken!, since, until),
								listConversionActions(integration.mccAccountId, acc.accountId, integration.developerToken, integration.refreshToken!, since, until)
							]);
							let accSpend = 0, accImpressions = 0, accClicks = 0;
							for (const row of insights) {
								accSpend += parseFloat(row.spend); accImpressions += parseInt(row.impressions); accClicks += parseInt(row.clicks);
							}
							const totalConvFromActions = convActions.reduce((s, a) => s + a.conversions, 0);
							const totalRevFromActions = convActions.reduce((s, a) => s + a.conversionValue, 0);
							const breakdown: BreakdownRow[] = convActions.filter(a => a.conversions > 0).map(a => {
								const proportion = totalConvFromActions > 0 ? a.conversions / totalConvFromActions : 0;
								return { type: a.name, spend: accSpend * proportion, impressions: Math.round(accImpressions * proportion), clicks: Math.round(accClicks * proportion), conversions: a.conversions, revenue: a.conversionValue };
							}).sort((a, b) => b.conversions - a.conversions);
							for (const b of breakdown) globalResultTypes.set(b.type, (globalResultTypes.get(b.type) || 0) + b.conversions);
							const accLabel = breakdown.slice(0, 3).map(b => `${Math.round(b.conversions)} ${b.type}`).join(', ');
							google.accounts[acc.accountId] = { conversions: totalConvFromActions, revenue: totalRevFromActions, label: accLabel, breakdown };
							google.conversions += totalConvFromActions; google.revenue += totalRevFromActions;
						} catch { /* skip individual account */ }
					}));

					google.conversionLabel = Array.from(globalResultTypes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${Math.round(c)} ${t}`).join(', ') || 'Conversii Google';
					google.breakdown = buildPlatformBreakdown(Object.values(google.accounts));
				}
			} catch (err) {
				logError('google-ads', 'Failed to fetch Google insights for client reports', { metadata: { error: err instanceof Error ? err.message : String(err) } });
			}
		}

		return { meta, google };
	})();

	// ---- DB data returned instantly (no API await) ----

	// ---- Return DB data instantly + API data as streamed Promise ----
	return {
		metaAccounts,
		googleAccounts,
		tiktokAccounts,
		// Instant DB-only platformMetrics (no conversions — those come from streamed apiConversions)
		platformMetrics: [
			{
				name: 'Meta Ads', iconKey: 'meta', spend: metaTotal, impressions: metaImpressions, clicks: metaClicks,
				conversions: 0, revenue: 0, hasConversions: false, conversionLabel: '', currency: metaCurrency,
				breakdown: [] as BreakdownRow[],
				accounts: metaByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents).map(a => ({
					...a, conversions: 0, revenue: 0, conversionLabel: '', breakdown: [] as BreakdownRow[]
				}))
			},
			{
				name: 'Google Ads', iconKey: 'google', spend: googleTotal, impressions: googleImpressions, clicks: googleClicks,
				conversions: 0, revenue: 0, hasConversions: false, conversionLabel: '', currency: googleCurrency,
				breakdown: [] as BreakdownRow[],
				accounts: googleByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents).map(a => ({
					...a, conversions: 0, revenue: 0, conversionLabel: '', breakdown: [] as BreakdownRow[]
				}))
			},
			{
				name: 'TikTok Ads', iconKey: 'tiktok', spend: tiktokTotal, impressions: tiktokImpressions, clicks: tiktokClicks,
				conversions: tiktokByAccount.reduce((s, a) => s + (a.conversions ?? 0), 0),
				revenue: 0, hasConversions: true, conversionLabel: 'Conversii TikTok', currency: tiktokCurrency,
				breakdown: [] as BreakdownRow[],
				accounts: tiktokByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents)
			}
		].filter(p => p.spend > 0 || p.impressions > 0),
		// Streamed — not awaited, SvelteKit streams this to the client
		apiConversions: apiConversionsPromise,
		adSpend: {
			meta: metaTotal,
			google: googleTotal,
			tiktok: tiktokTotal,
			total: metaTotal + googleTotal + tiktokTotal,
			metaCurrency,
			googleCurrency,
			tiktokCurrency,
			metaAccounts: metaAccountsWithSpend,
			googleAccounts: googleAccountsWithSpend,
			tiktokAccounts: tiktokAccountsWithSpend
		},
		since,
		until
	};
};
