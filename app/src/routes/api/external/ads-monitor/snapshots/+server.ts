import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * GET /api/external/ads-monitor/snapshots
 *
 * Returns daily metric snapshots for analysis. Used by PersonalOPS workers
 * to do their own trend/anomaly analysis on top of CRM data.
 *
 * Query:
 *   campaignId  — required, externalCampaignId
 *   days        — default 30, max 90
 *   adsetId     — optional, filter to specific adset
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const url = event.url;
		const externalCampaignId = url.searchParams.get('campaignId');
		if (!externalCampaignId) {
			return {
				status: 400,
				body: { error: 'missing_param', message: 'campaignId is required' }
			};
		}

		const daysRaw = parseInt(url.searchParams.get('days') ?? '30', 10);
		const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 30;
		const sinceDate = new Date(Date.now() - days * 86400_000);
		const since = sinceDate.toISOString().slice(0, 10);

		const adsetId = url.searchParams.get('adsetId');

		const conditions = [
			eq(table.adMetricSnapshot.tenantId, ctx.tenantId),
			eq(table.adMetricSnapshot.externalCampaignId, externalCampaignId),
			gte(table.adMetricSnapshot.date, since)
		];
		if (adsetId) conditions.push(eq(table.adMetricSnapshot.externalAdsetId, adsetId));

		const rows = await db
			.select({
				date: table.adMetricSnapshot.date,
				externalCampaignId: table.adMetricSnapshot.externalCampaignId,
				externalAdsetId: table.adMetricSnapshot.externalAdsetId,
				spendCents: table.adMetricSnapshot.spendCents,
				impressions: table.adMetricSnapshot.impressions,
				clicks: table.adMetricSnapshot.clicks,
				conversions: table.adMetricSnapshot.conversions,
				cpcCents: table.adMetricSnapshot.cpcCents,
				cpmCents: table.adMetricSnapshot.cpmCents,
				cpaCents: table.adMetricSnapshot.cpaCents,
				cplCents: table.adMetricSnapshot.cplCents,
				ctr: table.adMetricSnapshot.ctr,
				roas: table.adMetricSnapshot.roas,
				frequency: table.adMetricSnapshot.frequency,
				maturity: table.adMetricSnapshot.maturity,
				fetchedAt: table.adMetricSnapshot.fetchedAt
			})
			.from(table.adMetricSnapshot)
			.where(and(...conditions))
			.orderBy(asc(table.adMetricSnapshot.date));

		// Compute simple aggregates so CEO doesn't need to do math
		const totals = rows.reduce(
			(acc, r) => {
				acc.spendCents += r.spendCents;
				acc.impressions += r.impressions;
				acc.clicks += r.clicks;
				acc.conversions += r.conversions;
				return acc;
			},
			{ spendCents: 0, impressions: 0, clicks: 0, conversions: 0 }
		);

		const aggregate = {
			...totals,
			cpcCents: totals.clicks > 0 ? Math.round(totals.spendCents / totals.clicks) : null,
			cpmCents:
				totals.impressions > 0
					? Math.round((totals.spendCents / totals.impressions) * 1000)
					: null,
			cpaCents: totals.conversions > 0 ? Math.round(totals.spendCents / totals.conversions) : null,
			ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
			days,
			daysWithData: rows.length
		};

		return {
			status: 200,
			body: {
				snapshots: rows,
				aggregate,
				query: { campaignId: externalCampaignId, adsetId, days }
			}
		};
	});
