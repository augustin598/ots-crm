import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, gte, lte } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Default to current month
	const now = new Date();
	const defaultSince = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	const defaultUntil = now.toISOString().split('T')[0];

	const since = url.searchParams.get('since') ?? defaultSince;
	const until = url.searchParams.get('until') ?? defaultUntil;

	if (!locals.tenant || !locals.client) {
		return {
			adSpend: { meta: 0, google: 0, tiktok: 0, total: 0, currency: 'RON' },
			since,
			until
		};
	}

	const tenantId = locals.tenant.id;
	const clientId = locals.client.id;

	// Overlap filter: include any month whose period overlaps the selected range
	// periodStart <= until AND periodEnd >= since
	const [metaResult, googleResult, tiktokResult] = await Promise.all([
		// Meta Ads spend for this client
		db
			.select({
				total: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`.as('total')
			})
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.tenantId, tenantId),
					eq(table.metaAdsSpending.clientId, clientId),
					lte(table.metaAdsSpending.periodStart, until),
					gte(table.metaAdsSpending.periodEnd, since)
				)
			),

		// Google Ads spend for this client
		db
			.select({
				total: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`.as('total')
			})
			.from(table.googleAdsSpending)
			.where(
				and(
					eq(table.googleAdsSpending.tenantId, tenantId),
					eq(table.googleAdsSpending.clientId, clientId),
					lte(table.googleAdsSpending.periodStart, until),
					gte(table.googleAdsSpending.periodEnd, since)
				)
			),

		// TikTok Ads spend for this client
		db
			.select({
				total: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`.as('total')
			})
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.tenantId, tenantId),
					eq(table.tiktokAdsSpending.clientId, clientId),
					lte(table.tiktokAdsSpending.periodStart, until),
					gte(table.tiktokAdsSpending.periodEnd, since)
				)
			)
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
		since,
		until
	};
};
