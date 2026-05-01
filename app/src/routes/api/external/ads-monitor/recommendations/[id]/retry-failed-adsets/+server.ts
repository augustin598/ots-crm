import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { updateAdsetBudget } from '$lib/server/meta-ads/client';
import { env } from '$env/dynamic/private';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * POST /api/external/ads-monitor/recommendations/[id]/retry-failed-adsets
 *
 * B12: Reads partial_apply_state.failed from decision_rationale_json and retries
 * the updateAdsetBudget call for each failed adset.
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const id = event.params.id;
		if (!id) {
			return { status: 400, body: { error: 'missing_id', message: 'Missing recommendation id' } };
		}

		const [rec] = await db
			.select()
			.from(table.adOptimizationRecommendation)
			.where(
				and(
					eq(table.adOptimizationRecommendation.id, id),
					eq(table.adOptimizationRecommendation.tenantId, ctx.tenantId)
				)
			)
			.limit(1);

		if (!rec) {
			return { status: 404, body: { error: 'not_found', message: 'Recommendation not found' } };
		}
		if (rec.status !== 'applied') {
			return {
				status: 400,
				body: { error: 'invalid_status', message: `Cannot retry: status is ${rec.status}` }
			};
		}

		let rationale: Record<string, unknown> | null = null;
		try {
			rationale = rec.decisionRationaleJson ? JSON.parse(rec.decisionRationaleJson) : null;
		} catch {
			return {
				status: 400,
				body: { error: 'invalid_rationale', message: 'decision_rationale_json is not valid JSON' }
			};
		}

		const partialState = rationale?.partial_apply_state as
			| { successful: string[]; failed: Array<{ adsetId?: string; error: string }> }
			| undefined;

		if (!partialState || partialState.failed.length === 0) {
			return { status: 200, body: { retried: 0, results: [] } };
		}

		// Find which Meta integration owns this campaign
		const accounts = await db
			.select({ integrationId: table.metaAdsAccount.integrationId })
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, ctx.tenantId),
					eq(table.metaAdsAccount.isActive, true)
				)
			)
			.limit(1);

		if (accounts.length === 0) {
			return { status: 422, body: { error: 'no_meta_integration', message: 'No active Meta integration' } };
		}

		const auth = await getAuthenticatedToken(accounts[0]!.integrationId);
		if (!auth) {
			return { status: 422, body: { error: 'no_auth_token', message: 'Failed to get Meta auth token' } };
		}

		const appSecret = env.META_APP_SECRET;
		if (!appSecret) {
			return { status: 500, body: { error: 'no_app_secret', message: 'META_APP_SECRET not configured' } };
		}

		const payload = rec.suggestedPayloadJson ? JSON.parse(rec.suggestedPayloadJson) : {};
		const newBudget: number | undefined = payload?.newDailyBudgetCents;
		if (typeof newBudget !== 'number') {
			return {
				status: 400,
				body: { error: 'invalid_payload', message: 'newDailyBudgetCents missing from suggestedPayload' }
			};
		}

		const retryResults: Array<{ adsetId: string; status: 'success' | 'failed'; error?: string }> = [];

		for (const failed of partialState.failed) {
			if (!failed.adsetId) continue;
			try {
				await updateAdsetBudget(failed.adsetId, newBudget, auth.accessToken, appSecret);
				retryResults.push({ adsetId: failed.adsetId, status: 'success' });
				partialState.successful.push(failed.adsetId);
			} catch (err) {
				retryResults.push({ adsetId: failed.adsetId, status: 'failed', error: serializeError(err).message });
			}
		}

		// Update partial_apply_state in decisionRationaleJson
		const newFailed = partialState.failed.filter(
			(f) => f.adsetId && !retryResults.find((r) => r.adsetId === f.adsetId && r.status === 'success')
		);
		const updatedRationale = {
			...rationale,
			partial_apply_state: {
				successful: partialState.successful,
				failed: newFailed
			},
			partial: newFailed.length > 0
		};

		await db
			.update(table.adOptimizationRecommendation)
			.set({
				decisionRationaleJson: JSON.stringify(updatedRationale),
				updatedAt: new Date()
			})
			.where(eq(table.adOptimizationRecommendation.id, id));

		logInfo('ads-monitor', `retry-failed-adsets for rec ${id}: ${retryResults.filter(r => r.status === 'success').length} succeeded`, {
			tenantId: ctx.tenantId,
			metadata: { recommendationId: id, results: retryResults }
		});

		return {
			status: 200,
			body: { retried: retryResults.length, results: retryResults }
		};
	});
