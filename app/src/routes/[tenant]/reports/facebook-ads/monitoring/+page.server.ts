import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc, gte, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, fetch }) => {
	if (!locals.user || !locals.tenant) throw redirect(302, '/login');

	const since7 = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

	const targetRows = await db
		.select({
			id: table.adMonitorTarget.id,
			clientId: table.adMonitorTarget.clientId,
			clientName: table.client.name,
			externalCampaignId: table.adMonitorTarget.externalCampaignId,
			externalAdsetId: table.adMonitorTarget.externalAdsetId,
			externalAdAccountId: table.adMonitorTarget.externalAdAccountId,
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
			version: table.adMonitorTarget.version,
			updatedAt: table.adMonitorTarget.updatedAt,
			accountName: table.metaAdsAccount.accountName,
			accountId: table.metaAdsAccount.metaAdAccountId
		})
		.from(table.adMonitorTarget)
		.innerJoin(table.client, eq(table.client.id, table.adMonitorTarget.clientId))
		.leftJoin(
			table.metaAdsAccount,
			and(
				eq(table.metaAdsAccount.clientId, table.adMonitorTarget.clientId),
				eq(table.metaAdsAccount.tenantId, locals.tenant.id),
				eq(table.metaAdsAccount.isPrimary, true)
			)
		)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, locals.tenant.id),
				eq(table.adMonitorTarget.platform, 'meta')
			)
		)
		.orderBy(desc(table.adMonitorTarget.updatedAt));

	const campaignIds = targetRows.map((t) => t.externalCampaignId);
	const snapshots =
		campaignIds.length > 0
			? await db
					.select({
						externalCampaignId: table.adMetricSnapshot.externalCampaignId,
						date: table.adMetricSnapshot.date,
						cplCents: table.adMetricSnapshot.cplCents,
						spendCents: table.adMetricSnapshot.spendCents
					})
					.from(table.adMetricSnapshot)
					.where(
						and(
							eq(table.adMetricSnapshot.tenantId, locals.tenant.id),
							gte(table.adMetricSnapshot.date, since7)
						)
					)
			: [];

	const sparkByCampaign = new Map<string, Array<number | null>>();
	const latestByCampaign = new Map<string, number | null>();
	for (const s of snapshots) {
		const arr = sparkByCampaign.get(s.externalCampaignId) ?? [];
		arr.push(s.cplCents);
		sparkByCampaign.set(s.externalCampaignId, arr);
		latestByCampaign.set(s.externalCampaignId, s.cplCents);
	}

	const targets = targetRows.map((t) => ({
		...t,
		spark7d: sparkByCampaign.get(t.externalCampaignId) ?? [],
		latestCplCents: latestByCampaign.get(t.externalCampaignId) ?? null,
		accountId: t.externalAdAccountId ?? t.accountId ?? null
	}));

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
		.innerJoin(table.client, eq(table.client.id, table.adOptimizationRecommendation.clientId))
		.where(eq(table.adOptimizationRecommendation.tenantId, locals.tenant.id))
		.orderBy(desc(table.adOptimizationRecommendation.createdAt))
		.limit(50);

	const summaryRes = await fetch(`/${params.tenant}/api/ads-monitor/summary`);
	const summary = summaryRes.ok
		? await summaryRes.json()
		: { activeTargets: 0, pendingRecs: 0, spend7dCents: 0, avgCpl30dCents: null, avgTargetCplCents: null };

	return { targets, clients, recommendations, summary, tenantSlug: params.tenant };
};
