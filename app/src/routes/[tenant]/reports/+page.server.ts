import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, gte, lte, desc, inArray, isNotNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Default to current month
	const now = new Date();
	const defaultSince = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	const defaultUntil = now.toISOString().split('T')[0];

	const since = url.searchParams.get('since') ?? defaultSince;
	const until = url.searchParams.get('until') ?? defaultUntil;

	if (!locals.tenant) {
		return {
			adSpend: { meta: 0, google: 0, tiktok: 0, total: 0, currency: 'RON' },
			platformMetrics: { meta: { spend: 0, impressions: 0, clicks: 0, conversions: 0 }, google: { spend: 0, impressions: 0, clicks: 0, conversions: 0 }, tiktok: { spend: 0, impressions: 0, clicks: 0, conversions: 0 } },
			dailySpend: [] as { date: string; meta: number; google: number; tiktok: number }[],
			syncErrors: [],
			metaAccounts: [] as { accountName: string; accountId: string; isActive: boolean }[],
			googleAccounts: [] as { accountName: string; accountId: string; isActive: boolean }[],
			tiktokAccounts: [] as { accountName: string; accountId: string; isActive: boolean }[],
			since,
			until,
			prevSince: '',
			prevUntil: ''
		};
	}

	const tenantId = locals.tenant.id;

	// Previous period for comparison
	const sinceDate = new Date(since + 'T00:00:00');
	const untilDate = new Date(until + 'T00:00:00');
	const durationMs = untilDate.getTime() - sinceDate.getTime() + 86400000;
	const prevEndDate = new Date(sinceDate.getTime() - 86400000);
	const prevStartDate = new Date(prevEndDate.getTime() - durationMs + 86400000);
	const pad = (n: number) => String(n).padStart(2, '0');
	const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const prevSince = fmt(prevStartDate);
	const prevUntil = fmt(prevEndDate);

	// Overlap filter helper
	const overlapMeta = (tbl: typeof table.metaAdsSpending) => and(
		eq(tbl.tenantId, tenantId),
		lte(tbl.periodStart, until),
		gte(tbl.periodEnd, since)
	);
	const overlapGoogle = (tbl: typeof table.googleAdsSpending) => and(
		eq(tbl.tenantId, tenantId),
		lte(tbl.periodStart, until),
		gte(tbl.periodEnd, since)
	);
	const overlapTiktok = (tbl: typeof table.tiktokAdsSpending) => and(
		eq(tbl.tenantId, tenantId),
		lte(tbl.periodStart, until),
		gte(tbl.periodEnd, since)
	);

	const [
		metaAgg, googleAgg, tiktokAgg,
		prevMetaAgg, prevGoogleAgg, prevTiktokAgg,
		metaDailyRows, googleDailyRows, tiktokDailyRows,
		metaAccounts, googleAccounts, tiktokAccounts, syncErrors
	] = await Promise.all([
		// Current period aggregates
		db.select({
			spend: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.metaAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.metaAdsSpending.clicks}), 0)`
		}).from(table.metaAdsSpending).where(overlapMeta(table.metaAdsSpending)),

		db.select({
			spend: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.googleAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.googleAdsSpending.clicks}), 0)`,
			conversions: sql<number>`coalesce(sum(${table.googleAdsSpending.conversions}), 0)`
		}).from(table.googleAdsSpending).where(overlapGoogle(table.googleAdsSpending)),

		db.select({
			spend: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.tiktokAdsSpending.clicks}), 0)`,
			conversions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.conversions}), 0)`
		}).from(table.tiktokAdsSpending).where(overlapTiktok(table.tiktokAdsSpending)),

		// Previous period aggregates (for comparison)
		db.select({
			spend: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.metaAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.metaAdsSpending.clicks}), 0)`
		}).from(table.metaAdsSpending).where(and(
			eq(table.metaAdsSpending.tenantId, tenantId),
			lte(table.metaAdsSpending.periodStart, prevUntil),
			gte(table.metaAdsSpending.periodEnd, prevSince)
		)),

		db.select({
			spend: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.googleAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.googleAdsSpending.clicks}), 0)`
		}).from(table.googleAdsSpending).where(and(
			eq(table.googleAdsSpending.tenantId, tenantId),
			lte(table.googleAdsSpending.periodStart, prevUntil),
			gte(table.googleAdsSpending.periodEnd, prevSince)
		)),

		db.select({
			spend: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.tiktokAdsSpending.clicks}), 0)`
		}).from(table.tiktokAdsSpending).where(and(
			eq(table.tiktokAdsSpending.tenantId, tenantId),
			lte(table.tiktokAdsSpending.periodStart, prevUntil),
			gte(table.tiktokAdsSpending.periodEnd, prevSince)
		)),

		// Daily breakdown per platform (for stacked chart)
		db.select({
			date: table.metaAdsSpending.periodStart,
			spend: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`
		}).from(table.metaAdsSpending).where(overlapMeta(table.metaAdsSpending))
			.groupBy(table.metaAdsSpending.periodStart).orderBy(table.metaAdsSpending.periodStart),

		db.select({
			date: table.googleAdsSpending.periodStart,
			spend: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`
		}).from(table.googleAdsSpending).where(overlapGoogle(table.googleAdsSpending))
			.groupBy(table.googleAdsSpending.periodStart).orderBy(table.googleAdsSpending.periodStart),

		db.select({
			date: table.tiktokAdsSpending.periodStart,
			spend: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`
		}).from(table.tiktokAdsSpending).where(overlapTiktok(table.tiktokAdsSpending))
			.groupBy(table.tiktokAdsSpending.periodStart).orderBy(table.tiktokAdsSpending.periodStart),

		// Accounts
		db.select({
			accountName: table.metaAdsAccount.accountName,
			accountId: table.metaAdsAccount.metaAdAccountId,
			isActive: table.metaAdsAccount.isActive
		}).from(table.metaAdsAccount).where(and(
			eq(table.metaAdsAccount.tenantId, tenantId),
			isNotNull(table.metaAdsAccount.clientId)
		)).orderBy(table.metaAdsAccount.accountName),

		db.select({
			accountName: table.googleAdsAccount.accountName,
			accountId: table.googleAdsAccount.googleAdsCustomerId,
			isActive: table.googleAdsAccount.isActive
		}).from(table.googleAdsAccount).where(and(
			eq(table.googleAdsAccount.tenantId, tenantId),
			isNotNull(table.googleAdsAccount.clientId)
		)).orderBy(table.googleAdsAccount.accountName),

		db.select({
			accountName: table.tiktokAdsAccount.accountName,
			accountId: table.tiktokAdsAccount.tiktokAdvertiserId,
			isActive: table.tiktokAdsAccount.isActive
		}).from(table.tiktokAdsAccount).where(and(
			eq(table.tiktokAdsAccount.tenantId, tenantId),
			isNotNull(table.tiktokAdsAccount.clientId)
		)).orderBy(table.tiktokAdsAccount.accountName),

		// Recent sync errors
		db.select({
			id: table.debugLog.id,
			source: table.debugLog.source,
			message: table.debugLog.message,
			createdAt: table.debugLog.createdAt
		}).from(table.debugLog).where(and(
			eq(table.debugLog.tenantId, tenantId),
			eq(table.debugLog.level, 'error'),
			inArray(table.debugLog.source, ['meta-ads-sync', 'tiktok-ads-sync', 'google-ads-sync'])
		)).orderBy(desc(table.debugLog.createdAt)).limit(5)
	]);

	const meta = { spend: metaAgg[0]?.spend ?? 0, impressions: metaAgg[0]?.impressions ?? 0, clicks: metaAgg[0]?.clicks ?? 0, conversions: 0 };
	const google = { spend: googleAgg[0]?.spend ?? 0, impressions: googleAgg[0]?.impressions ?? 0, clicks: googleAgg[0]?.clicks ?? 0, conversions: googleAgg[0]?.conversions ?? 0 };
	const tiktok = { spend: tiktokAgg[0]?.spend ?? 0, impressions: tiktokAgg[0]?.impressions ?? 0, clicks: tiktokAgg[0]?.clicks ?? 0, conversions: tiktokAgg[0]?.conversions ?? 0 };

	const prevMeta = { spend: prevMetaAgg[0]?.spend ?? 0, impressions: prevMetaAgg[0]?.impressions ?? 0, clicks: prevMetaAgg[0]?.clicks ?? 0 };
	const prevGoogle = { spend: prevGoogleAgg[0]?.spend ?? 0, impressions: prevGoogleAgg[0]?.impressions ?? 0, clicks: prevGoogleAgg[0]?.clicks ?? 0 };
	const prevTiktok = { spend: prevTiktokAgg[0]?.spend ?? 0, impressions: prevTiktokAgg[0]?.impressions ?? 0, clicks: prevTiktokAgg[0]?.clicks ?? 0 };

	// Merge daily data from all platforms into unified daily breakdown
	const dailyMap = new Map<string, { meta: number; google: number; tiktok: number }>();
	for (const r of metaDailyRows) { const e = dailyMap.get(r.date) || { meta: 0, google: 0, tiktok: 0 }; e.meta += r.spend; dailyMap.set(r.date, e); }
	for (const r of googleDailyRows) { const e = dailyMap.get(r.date) || { meta: 0, google: 0, tiktok: 0 }; e.google += r.spend; dailyMap.set(r.date, e); }
	for (const r of tiktokDailyRows) { const e = dailyMap.get(r.date) || { meta: 0, google: 0, tiktok: 0 }; e.tiktok += r.spend; dailyMap.set(r.date, e); }
	const dailySpend = Array.from(dailyMap.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, d]) => ({ date, meta: d.meta / 100, google: d.google / 100, tiktok: d.tiktok / 100 }));

	return {
		adSpend: {
			meta: meta.spend,
			google: google.spend,
			tiktok: tiktok.spend,
			total: meta.spend + google.spend + tiktok.spend,
			currency: 'RON'
		},
		platformMetrics: { meta, google, tiktok },
		prevMetrics: {
			totalSpend: prevMeta.spend + prevGoogle.spend + prevTiktok.spend,
			totalImpressions: prevMeta.impressions + prevGoogle.impressions + prevTiktok.impressions,
			totalClicks: prevMeta.clicks + prevGoogle.clicks + prevTiktok.clicks
		},
		dailySpend,
		syncErrors,
		metaAccounts,
		googleAccounts,
		tiktokAccounts,
		since,
		until,
		prevSince,
		prevUntil
	};
};
