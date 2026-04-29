import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const status = url.searchParams.get('status');
	const conditions = [eq(table.adOptimizationRecommendation.tenantId, locals.tenant.id)];
	if (status) conditions.push(eq(table.adOptimizationRecommendation.status, status));

	const rows = await db
		.select({
			id: table.adOptimizationRecommendation.id,
			clientId: table.adOptimizationRecommendation.clientId,
			clientName: table.client.name,
			externalCampaignId: table.adOptimizationRecommendation.externalCampaignId,
			externalAdsetId: table.adOptimizationRecommendation.externalAdsetId,
			action: table.adOptimizationRecommendation.action,
			reason: table.adOptimizationRecommendation.reason,
			metricSnapshotJson: table.adOptimizationRecommendation.metricSnapshotJson,
			suggestedPayloadJson: table.adOptimizationRecommendation.suggestedPayloadJson,
			status: table.adOptimizationRecommendation.status,
			source: table.adOptimizationRecommendation.source,
			sourceWorkerId: table.adOptimizationRecommendation.sourceWorkerId,
			createdAt: table.adOptimizationRecommendation.createdAt,
			decidedAt: table.adOptimizationRecommendation.decidedAt,
			appliedAt: table.adOptimizationRecommendation.appliedAt,
			applyError: table.adOptimizationRecommendation.applyError
		})
		.from(table.adOptimizationRecommendation)
		.innerJoin(
			table.client,
			eq(table.client.id, table.adOptimizationRecommendation.clientId)
		)
		.where(and(...conditions))
		.orderBy(desc(table.adOptimizationRecommendation.createdAt))
		.limit(100);

	return json({ items: rows });
};
