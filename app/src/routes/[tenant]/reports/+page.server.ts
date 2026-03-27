import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, gte, lte, desc, inArray } from 'drizzle-orm';

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
			syncErrors: [],
			since,
			until
		};
	}

	const tenantId = locals.tenant.id;

	// Overlap filter: include any month whose period overlaps the selected range
	// periodStart <= until AND periodEnd >= since
	const [metaResult, googleResult, tiktokResult, syncErrors] = await Promise.all([
		// Meta Ads spend
		db
			.select({
				total: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`.as('total')
			})
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.tenantId, tenantId),
					lte(table.metaAdsSpending.periodStart, until),
					gte(table.metaAdsSpending.periodEnd, since)
				)
			),

		// Google Ads spend
		db
			.select({
				total: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`.as('total')
			})
			.from(table.googleAdsSpending)
			.where(
				and(
					eq(table.googleAdsSpending.tenantId, tenantId),
					lte(table.googleAdsSpending.periodStart, until),
					gte(table.googleAdsSpending.periodEnd, since)
				)
			),

		// TikTok Ads spend
		db
			.select({
				total: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`.as('total')
			})
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.tenantId, tenantId),
					lte(table.tiktokAdsSpending.periodStart, until),
					gte(table.tiktokAdsSpending.periodEnd, since)
				)
			),

		// Recent sync errors (max 5)
		db
			.select({
				id: table.debugLog.id,
				source: table.debugLog.source,
				message: table.debugLog.message,
				createdAt: table.debugLog.createdAt
			})
			.from(table.debugLog)
			.where(
				and(
					eq(table.debugLog.tenantId, tenantId),
					eq(table.debugLog.level, 'error'),
					inArray(table.debugLog.source, [
						'meta-ads-sync',
						'tiktok-ads-sync',
						'google-ads-sync'
					])
				)
			)
			.orderBy(desc(table.debugLog.createdAt))
			.limit(5)
	]);

	const meta = metaResult[0]?.total ?? 0;
	const google = googleResult[0]?.total ?? 0;
	const tiktok = tiktokResult[0]?.total ?? 0;

	return {
		adSpend: {
			meta,
			google,
			tiktok,
			total: meta + google + tiktok,
			currency: 'RON'
		},
		syncErrors,
		since,
		until
	};
};
