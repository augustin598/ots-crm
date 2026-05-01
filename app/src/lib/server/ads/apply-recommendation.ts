// Applies an approved optimization recommendation against the relevant ad platform.
// Currently Meta-only. Returns success/failure; updates DB row.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import {
	toggleCampaignStatus,
	updateCampaignBudget,
	getCampaignWithAdsets,
	updateAdsetBudget
} from '$lib/server/meta-ads/client';
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

const MIN_DAILY_BUDGET_CENTS = 500; // 5 RON — absolute floor
const ADSET_BUDGET_FLOOR_CENTS = MIN_DAILY_BUDGET_CENTS;

interface BudgetChangeResult {
	strategy: string;
	isCBO: boolean;
	adsetCount: number;
	changes: Array<{
		adsetId?: string;
		name?: string;
		oldBudget?: number;
		newBudget?: number;
		cpl?: number | null;
		spendShare?: number;
		status?: string;
		error?: string;
	}>;
	partial?: boolean;
	partial_apply_state?: {
		successful: string[];
		failed: Array<{ adsetId: string | undefined; error: string }>;
	};
	warnings?: string[];
}

async function applyBudgetChange(
	campaignId: string,
	newDailyBudgetCents: number,
	accessToken: string,
	appSecret: string
): Promise<BudgetChangeResult> {
	const campaignInfo = await getCampaignWithAdsets(campaignId, accessToken, appSecret);
	const isCBO = campaignInfo.daily_budget != null;

	if (isCBO) {
		const warnings: string[] = [];
		const safeBudget = Math.max(newDailyBudgetCents, MIN_DAILY_BUDGET_CENTS);
		if (safeBudget !== newDailyBudgetCents) {
			warnings.push(
				`Budget floor: clamped from ${newDailyBudgetCents} to ${safeBudget}`
			);
		}
		await updateCampaignBudget(campaignId, accessToken, appSecret, 'daily', safeBudget);
		return {
			strategy: 'cbo_campaign',
			isCBO: true,
			adsetCount: campaignInfo.adsets.length,
			changes: [{ newBudget: safeBudget }],
			warnings: warnings.length > 0 ? warnings : undefined
		};
	}

	// ABO — budget is on adsets
	const activeAdsets = campaignInfo.adsets.filter((a) => a.status === 'ACTIVE');

	if (activeAdsets.length === 0) {
		throw new Error(
			JSON.stringify({ error: 'no_active_adsets', message: 'Campaign has no active adsets to update' })
		);
	}

	if (activeAdsets.length === 1) {
		const adset = activeAdsets[0];
		const safeBudget = Math.max(newDailyBudgetCents, ADSET_BUDGET_FLOOR_CENTS);
		await updateAdsetBudget(adset.id, safeBudget, accessToken, appSecret);
		return {
			strategy: 'single_adset',
			isCBO: false,
			adsetCount: 1,
			changes: [{ adsetId: adset.id, name: adset.name, oldBudget: adset.daily_budget ?? undefined, newBudget: safeBudget }]
		};
	}

	// Multi-adset: rank by CPL (worst first)
	const ranked = activeAdsets
		.filter((a) => a.daily_budget != null && a.cpl != null)
		.sort((a, b) => (b.cpl ?? 0) - (a.cpl ?? 0));

	if (ranked.length === 0) {
		throw new Error(
			JSON.stringify({
				error: 'no_ranked_adsets',
				message: 'No adsets have both daily_budget and cpl data'
			})
		);
	}

	const avgCpl = ranked.reduce((s, a) => s + (a.cpl ?? 0), 0) / ranked.length;
	const totalSpend = ranked.reduce((s, a) => s + (a.spend ?? 0), 0);
	const worst = ranked[0];
	const worstSpendShare = totalSpend > 0 ? (worst.spend ?? 0) / totalSpend : 0;

	// Hybrid Option C: cut worst if it's >1.5× avg CPL AND has >20% spend share
	if ((worst.cpl ?? 0) >= 1.5 * avgCpl && worstSpendShare >= 0.2) {
		const adsetNewBudget = Math.max(Math.floor((worst.daily_budget ?? newDailyBudgetCents) * 0.7), ADSET_BUDGET_FLOOR_CENTS);
		try {
			await updateAdsetBudget(worst.id, adsetNewBudget, accessToken, appSecret);
			return {
				strategy: 'cut_worst_adset',
				isCBO: false,
				adsetCount: activeAdsets.length,
				changes: [{
					adsetId: worst.id,
					name: worst.name,
					oldBudget: worst.daily_budget ?? undefined,
					newBudget: adsetNewBudget,
					cpl: worst.cpl,
					spendShare: worstSpendShare,
					status: 'success'
				}]
			};
		} catch (err) {
			const errMsg = String(err);
			return {
				strategy: 'cut_worst_adset',
				isCBO: false,
				adsetCount: activeAdsets.length,
				changes: [{
					adsetId: worst.id,
					name: worst.name,
					oldBudget: worst.daily_budget ?? undefined,
					cpl: worst.cpl,
					spendShare: worstSpendShare,
					status: 'failed',
					error: errMsg
				}],
				partial: true,
				partial_apply_state: {
					successful: [],
					failed: [{ adsetId: worst.id, error: errMsg }]
				}
			};
		}
	}

	// All adsets statistically tied — proportional cut
	const allTied = ranked.every(
		(a) => Math.abs((a.cpl ?? 0) - avgCpl) / avgCpl < 0.2
	);

	if (allTied) {
		const changes: BudgetChangeResult['changes'] = [];
		for (const adset of activeAdsets) {
			if (adset.daily_budget == null) continue;
			const newAdsetBudget = Math.max(Math.floor(adset.daily_budget * 0.7), ADSET_BUDGET_FLOOR_CENTS);
			try {
				await updateAdsetBudget(adset.id, newAdsetBudget, accessToken, appSecret);
				changes.push({ adsetId: adset.id, name: adset.name, oldBudget: adset.daily_budget, newBudget: newAdsetBudget, status: 'success' });
			} catch (err) {
				changes.push({ adsetId: adset.id, name: adset.name, status: 'failed', error: String(err) });
			}
		}
		const isPartial = changes.some((c) => c.status === 'failed');
		return {
			strategy: 'proportional_cut_all_adsets',
			isCBO: false,
			adsetCount: activeAdsets.length,
			changes,
			partial: isPartial,
			partial_apply_state: isPartial ? {
				successful: changes.filter((c) => c.status === 'success').map((c) => c.adsetId).filter((id): id is string => Boolean(id)),
				failed: changes.filter((c) => c.status === 'failed').map((c) => ({ adsetId: c.adsetId, error: c.error ?? 'unknown' }))
			} : undefined
		};
	}

	// Ambiguous — manual review needed
	throw new Error(
		JSON.stringify({
			error: 'multi_adset_ambiguous',
			message: 'Multi-adset campaign needs manual review',
			adsets: ranked.map((a) => ({ id: a.id, cpl: a.cpl, spend: a.spend, budget: a.daily_budget }))
		})
	);
}

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

	// B9: investigate is a manual-review advisory — close with rationale, no platform call
	if (action === 'investigate') {
		const now = new Date();
		await db
			.update(table.adOptimizationRecommendation)
			.set({
				status: 'applied',
				appliedAt: now,
				updatedAt: now,
				decisionRationaleJson: JSON.stringify({ strategy: 'manual_review', changes: [] })
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

	let decisionRationale: Record<string, unknown> | null = null;

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
			const budgetResult = await applyBudgetChange(
				rec.externalCampaignId,
				budget.newDailyBudgetCents,
				auth.accessToken,
				appSecret
			);
			decisionRationale = {
				strategy: budgetResult.strategy,
				isCBO: budgetResult.isCBO,
				adset_count: budgetResult.adsetCount,
				changes: budgetResult.changes,
				partial: budgetResult.partial ?? false,
				...(budgetResult.partial_apply_state
					? { partial_apply_state: budgetResult.partial_apply_state }
					: {}),
				...(budgetResult.warnings && budgetResult.warnings.length > 0
					? { warnings: budgetResult.warnings }
					: {})
			};
		} else {
			await markFailure(recommendationId, `Unknown action: ${action}`);
			return { ok: false, error: 'unknown_action' };
		}

		const now = new Date();
		await db
			.update(table.adOptimizationRecommendation)
			.set({
				status: 'applied',
				appliedAt: now,
				updatedAt: now,
				applyError: null,
				decisionRationaleJson: decisionRationale ? JSON.stringify(decisionRationale) : null
			})
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
