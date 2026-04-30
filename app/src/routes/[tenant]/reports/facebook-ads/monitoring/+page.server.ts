import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) throw redirect(302, '/login');

	const targets = await db
		.select({
			id: table.adMonitorTarget.id,
			clientId: table.adMonitorTarget.clientId,
			clientName: table.client.name,
			externalCampaignId: table.adMonitorTarget.externalCampaignId,
			externalAdsetId: table.adMonitorTarget.externalAdsetId,
			objective: table.adMonitorTarget.objective,
			targetCplCents: table.adMonitorTarget.targetCplCents,
			targetCpaCents: table.adMonitorTarget.targetCpaCents,
			targetRoas: table.adMonitorTarget.targetRoas,
			targetCtr: table.adMonitorTarget.targetCtr,
			targetDailyBudgetCents: table.adMonitorTarget.targetDailyBudgetCents,
			deviationThresholdPct: table.adMonitorTarget.deviationThresholdPct,
			isActive: table.adMonitorTarget.isActive,
			isMuted: table.adMonitorTarget.isMuted,
			mutedUntil: table.adMonitorTarget.mutedUntil,
			notifyTelegram: table.adMonitorTarget.notifyTelegram,
			notifyEmail: table.adMonitorTarget.notifyEmail,
			notifyInApp: table.adMonitorTarget.notifyInApp,
			updatedAt: table.adMonitorTarget.updatedAt
		})
		.from(table.adMonitorTarget)
		.innerJoin(table.client, eq(table.client.id, table.adMonitorTarget.clientId))
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, locals.tenant.id),
				eq(table.adMonitorTarget.platform, 'meta')
			)
		)
		.orderBy(desc(table.adMonitorTarget.updatedAt));

	const clients = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, locals.tenant.id))
		.orderBy(table.client.name);

	const recommendations = await db
		.select({
			id: table.adOptimizationRecommendation.id,
			clientId: table.adOptimizationRecommendation.clientId,
			clientName: table.client.name,
			externalCampaignId: table.adOptimizationRecommendation.externalCampaignId,
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
		.where(eq(table.adOptimizationRecommendation.tenantId, locals.tenant.id))
		.orderBy(desc(table.adOptimizationRecommendation.createdAt))
		.limit(50);

	return {
		targets,
		clients,
		recommendations,
		tenantSlug: params.tenant
	};
};
