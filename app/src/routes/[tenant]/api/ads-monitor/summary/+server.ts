import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const tenantId = locals.tenant.id;

	const [activeRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.adMonitorTarget)
		.where(and(eq(table.adMonitorTarget.tenantId, tenantId), eq(table.adMonitorTarget.isActive, true)));

	const [pendingRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.tenantId, tenantId),
				eq(table.adOptimizationRecommendation.status, 'draft')
			)
		);

	const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
	const [spendRow] = await db
		.select({
			spend7dCents: sql<number>`coalesce(sum(${table.adMetricSnapshot.spendCents}), 0)`
		})
		.from(table.adMetricSnapshot)
		.where(
			and(
				eq(table.adMetricSnapshot.tenantId, tenantId),
				gte(table.adMetricSnapshot.date, cutoff)
			)
		);

	// Avg CPL last 30d (per active target with CPL target set)
	const cutoff30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
	const cplRows = await db
		.select({
			cplCents: table.adMetricSnapshot.cplCents,
			targetCplCents: table.adMonitorTarget.targetCplCents
		})
		.from(table.adMetricSnapshot)
		.innerJoin(
			table.adMonitorTarget,
			and(
				eq(table.adMonitorTarget.tenantId, table.adMetricSnapshot.tenantId),
				eq(table.adMonitorTarget.externalCampaignId, table.adMetricSnapshot.externalCampaignId)
			)
		)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, tenantId),
				eq(table.adMonitorTarget.isActive, true),
				gte(table.adMetricSnapshot.date, cutoff30)
			)
		);

	let cplSum = 0,
		cplCount = 0,
		targetSum = 0,
		targetCount = 0;
	for (const r of cplRows) {
		if (typeof r.cplCents === 'number') {
			cplSum += r.cplCents;
			cplCount += 1;
		}
		if (typeof r.targetCplCents === 'number') {
			targetSum += r.targetCplCents;
			targetCount += 1;
		}
	}

	return json({
		activeTargets: Number(activeRow?.count ?? 0),
		pendingRecs: Number(pendingRow?.count ?? 0),
		spend7dCents: Number(spendRow?.spend7dCents ?? 0),
		avgCpl30dCents: cplCount > 0 ? Math.round(cplSum / cplCount) : null,
		avgTargetCplCents: targetCount > 0 ? Math.round(targetSum / targetCount) : null
	});
};
