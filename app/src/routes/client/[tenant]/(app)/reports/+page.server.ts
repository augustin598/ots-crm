import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, gte, lte, isNotNull } from 'drizzle-orm';

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
		// Meta Ads total + currency
		db
			.select({
				total: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`.as('total'),
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

		// Google Ads total + currency
		db
			.select({
				total: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`.as('total'),
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

		// TikTok Ads total + currency
		db
			.select({
				total: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`.as('total'),
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

		// Meta Ads per account
		db
			.select({
				accountName: sql<string>`coalesce(${table.metaAdsAccount.accountName}, ${table.metaAdsSpending.metaAdAccountId})`.as('accountName'),
				spendCents: sql<number>`sum(${table.metaAdsSpending.spendCents})`.as('spendCents'),
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

		// Google Ads per account
		db
			.select({
				accountName: sql<string>`coalesce(${table.googleAdsAccount.accountName}, ${table.googleAdsSpending.googleAdsCustomerId})`.as('accountName'),
				spendCents: sql<number>`sum(${table.googleAdsSpending.spendCents})`.as('spendCents'),
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

		// TikTok Ads per account
		db
			.select({
				accountName: sql<string>`coalesce(${table.tiktokAdsAccount.accountName}, ${table.tiktokAdsSpending.tiktokAdvertiserId})`.as('accountName'),
				spendCents: sql<number>`sum(${table.tiktokAdsSpending.spendCents})`.as('spendCents'),
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

	const metaCurrency = metaResult[0]?.currency || 'RON';
	const googleCurrency = googleResult[0]?.currency || 'RON';
	const tiktokCurrency = tiktokResult[0]?.currency || 'RON';

	const metaAccountsWithSpend = metaByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents);
	const googleAccountsWithSpend = googleByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents);
	const tiktokAccountsWithSpend = tiktokByAccount.filter(a => a.spendCents > 0).sort((a, b) => b.spendCents - a.spendCents);

	return {
		metaAccounts,
		googleAccounts,
		tiktokAccounts,
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
