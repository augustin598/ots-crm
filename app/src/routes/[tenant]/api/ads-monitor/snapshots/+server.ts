import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const externalCampaignId = url.searchParams.get('campaignId');
	if (!externalCampaignId) throw error(400, 'campaignId obligatoriu');

	const days = Math.min(parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 90);
	const sinceDate = new Date(Date.now() - days * 86400_000);
	const since = sinceDate.toISOString().slice(0, 10);

	const rows = await db
		.select({
			date: table.adMetricSnapshot.date,
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
			maturity: table.adMetricSnapshot.maturity
		})
		.from(table.adMetricSnapshot)
		.where(
			and(
				eq(table.adMetricSnapshot.tenantId, locals.tenant.id),
				eq(table.adMetricSnapshot.externalCampaignId, externalCampaignId),
				gte(table.adMetricSnapshot.date, since)
			)
		)
		.orderBy(asc(table.adMetricSnapshot.date));

	return json({ snapshots: rows });
};
