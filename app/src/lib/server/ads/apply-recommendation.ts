// Applies an approved optimization recommendation against the relevant ad platform.
// Currently Meta-only. Returns success/failure; updates DB row.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { toggleCampaignStatus, updateCampaignBudget } from '$lib/server/meta-ads/client';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import type { AdRecommendationAction } from '$lib/server/db/schema';

export type ApplyOutcome =
	| { ok: true; appliedAt: Date }
	| { ok: false; error: string };

interface PausePayload {}
interface ResumePayload {}
interface BudgetPayload {
	newDailyBudgetCents: number;
}

export type RecommendationPayload = PausePayload | ResumePayload | BudgetPayload | Record<string, unknown>;

async function resolveMetaIntegration(
	tenantId: string,
	externalCampaignId: string
): Promise<string | null> {
	// Find which active Meta integration owns this campaign by scanning the
	// tenant's active ad accounts. We don't store the integrationId on the
	// recommendation directly because it can rotate (token refresh, account
	// reassignment) — resolving at apply-time is more robust.
	const accounts = await db
		.select({
			integrationId: table.metaAdsAccount.integrationId,
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId
		})
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, tenantId),
				eq(table.metaAdsAccount.isActive, true)
			)
		);

	if (accounts.length === 0) return null;

	// Try first integration — if Meta returns "campaign not found" we'd fail.
	// For a tenant with multiple integrations and the wrong one tried first,
	// we'd need a probe loop. Defer that complexity to phase 2.
	return accounts[0]!.integrationId;
}

export async function applyRecommendation(
	recommendationId: string,
	tenantId: string
): Promise<ApplyOutcome> {
	const [rec] = await db
		.select()
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.id, recommendationId),
				eq(table.adOptimizationRecommendation.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!rec) return { ok: false, error: 'recommendation_not_found' };
	if (rec.status !== 'approved') {
		return { ok: false, error: `cannot apply: status is ${rec.status}` };
	}
	if (rec.platform !== 'meta') {
		return { ok: false, error: `platform ${rec.platform} not supported (Meta-only MVP)` };
	}

	const action = rec.action as AdRecommendationAction;
	const payload = JSON.parse(rec.suggestedPayloadJson || '{}') as RecommendationPayload;

	// Actions that aren't auto-appliable just close the recommendation.
	if (action === 'refresh_creative' || action === 'change_audience') {
		const now = new Date();
		await db
			.update(table.adOptimizationRecommendation)
			.set({
				status: 'applied',
				appliedAt: now,
				updatedAt: now,
				applyError: 'Manual action required — closed without auto-apply'
			})
			.where(eq(table.adOptimizationRecommendation.id, recommendationId));
		return { ok: true, appliedAt: now };
	}

	const integrationId = await resolveMetaIntegration(tenantId, rec.externalCampaignId);
	if (!integrationId) {
		await markFailure(recommendationId, 'No active Meta integration for tenant');
		return { ok: false, error: 'no_meta_integration' };
	}

	const auth = await getAuthenticatedToken(integrationId);
	if (!auth) {
		await markFailure(recommendationId, 'Failed to get Meta auth token');
		return { ok: false, error: 'no_auth_token' };
	}

	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		await markFailure(recommendationId, 'META_APP_SECRET not configured');
		return { ok: false, error: 'no_app_secret' };
	}

	try {
		if (action === 'pause_ad') {
			await toggleCampaignStatus(rec.externalCampaignId, auth.accessToken, appSecret, 'PAUSED');
		} else if (action === 'resume_ad') {
			await toggleCampaignStatus(rec.externalCampaignId, auth.accessToken, appSecret, 'ACTIVE');
		} else if (action === 'increase_budget' || action === 'decrease_budget') {
			const budget = payload as BudgetPayload;
			if (typeof budget.newDailyBudgetCents !== 'number' || budget.newDailyBudgetCents <= 0) {
				await markFailure(recommendationId, 'Invalid newDailyBudgetCents in suggested payload');
				return { ok: false, error: 'invalid_budget_payload' };
			}
			await updateCampaignBudget(
				rec.externalCampaignId,
				auth.accessToken,
				appSecret,
				'daily',
				budget.newDailyBudgetCents
			);
		} else {
			await markFailure(recommendationId, `Unknown action: ${action}`);
			return { ok: false, error: 'unknown_action' };
		}

		const now = new Date();
		await db
			.update(table.adOptimizationRecommendation)
			.set({ status: 'applied', appliedAt: now, updatedAt: now, applyError: null })
			.where(eq(table.adOptimizationRecommendation.id, recommendationId));

		logInfo('ads-monitor', `Applied recommendation ${recommendationId} action=${action}`, {
			tenantId,
			metadata: { recommendationId, action, externalCampaignId: rec.externalCampaignId }
		});
		return { ok: true, appliedAt: now };
	} catch (e) {
		const { message } = serializeError(e);
		await markFailure(recommendationId, message);
		logError('ads-monitor', `Apply failed for ${recommendationId}: ${message}`, {
			tenantId,
			metadata: { recommendationId, action, externalCampaignId: rec.externalCampaignId }
		});
		return { ok: false, error: message };
	}
}

async function markFailure(recommendationId: string, error: string): Promise<void> {
	await db
		.update(table.adOptimizationRecommendation)
		.set({ status: 'failed', applyError: error, updatedAt: new Date() })
		.where(eq(table.adOptimizationRecommendation.id, recommendationId));
}
