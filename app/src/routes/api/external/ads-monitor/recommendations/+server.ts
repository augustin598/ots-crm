import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { withApiKey } from '$lib/server/api-keys/middleware';
import {
	AD_RECOMMENDATION_ACTIONS,
	AD_RECOMMENDATION_STATUSES,
	type AdRecommendationAction,
	type AdRecommendationStatus
} from '$lib/server/db/schema';
import { createNotification } from '$lib/server/notifications';
import { logInfo } from '$lib/server/logger';

/**
 * GET /api/external/ads-monitor/recommendations
 *
 * Returns recommendations submitted by workers. Lets the CEO see what's
 * pending, what was applied, what failed.
 *
 * Query: status=draft|approved|applied|... clientId, campaignId, limit
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const url = event.url;
		const status = url.searchParams.get('status');
		const clientId = url.searchParams.get('clientId');
		const campaignId = url.searchParams.get('campaignId');
		const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

		const conditions = [eq(table.adOptimizationRecommendation.tenantId, ctx.tenantId)];
		if (status) {
			if (!(AD_RECOMMENDATION_STATUSES as readonly string[]).includes(status)) {
				return {
					status: 400,
					body: {
						error: 'invalid_status',
						message: `status must be one of ${AD_RECOMMENDATION_STATUSES.join(', ')}`
					}
				};
			}
			conditions.push(eq(table.adOptimizationRecommendation.status, status));
		}
		if (clientId) conditions.push(eq(table.adOptimizationRecommendation.clientId, clientId));
		if (campaignId)
			conditions.push(eq(table.adOptimizationRecommendation.externalCampaignId, campaignId));

		const rows = await db
			.select()
			.from(table.adOptimizationRecommendation)
			.where(and(...conditions))
			.orderBy(desc(table.adOptimizationRecommendation.createdAt))
			.limit(limit);

		return { status: 200, body: { items: rows, total: rows.length } };
	});

/**
 * POST /api/external/ads-monitor/recommendations
 *
 * Worker submits a DRAFT recommendation. Status is forced to 'draft' on
 * creation — applying happens via approve flow (UI or PATCH).
 *
 * Body: {
 *   clientId: string,
 *   externalCampaignId: string,
 *   action: 'pause_ad' | 'resume_ad' | 'increase_budget' | 'decrease_budget' | 'refresh_creative' | 'change_audience',
 *   reason: string,                             // why the worker proposes this
 *   metricSnapshot?: object,                    // observed metrics, free-form
 *   suggestedPayload?: { newDailyBudgetCents?: number, ... },
 *   targetId?: string,                          // optional: link to ad_monitor_target
 *   externalAdsetId?: string,
 *   externalAdId?: string,
 *   sourceWorkerId?: string                     // PersonalOPS worker id for traceability
 * }
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json', message: 'Body must be JSON' } };
		}

		const clientId = typeof body.clientId === 'string' ? body.clientId : null;
		const externalCampaignId =
			typeof body.externalCampaignId === 'string' ? body.externalCampaignId : null;
		const action = typeof body.action === 'string' ? body.action : null;
		const reason = typeof body.reason === 'string' ? body.reason : null;

		if (!clientId || !externalCampaignId || !action || !reason) {
			return {
				status: 400,
				body: {
					error: 'missing_fields',
					message: 'clientId, externalCampaignId, action, reason are required'
				}
			};
		}

		if (!(AD_RECOMMENDATION_ACTIONS as readonly string[]).includes(action)) {
			return {
				status: 400,
				body: {
					error: 'invalid_action',
					message: `action must be one of ${AD_RECOMMENDATION_ACTIONS.join(', ')}`
				}
			};
		}

		// Verify client belongs to tenant
		const [clientRow] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, ctx.tenantId)))
			.limit(1);
		if (!clientRow) {
			return { status: 404, body: { error: 'client_not_found' } };
		}

		// Verify targetId (if provided) exists in this tenant. Without this check
		// a worker could orphan a recommendation against a deleted target, or worse,
		// reference a target from another tenant.
		const targetIdRaw = typeof body.targetId === 'string' ? body.targetId : null;
		if (targetIdRaw) {
			const [targetRow] = await db
				.select({ id: table.adMonitorTarget.id })
				.from(table.adMonitorTarget)
				.where(
					and(
						eq(table.adMonitorTarget.id, targetIdRaw),
						eq(table.adMonitorTarget.tenantId, ctx.tenantId)
					)
				)
				.limit(1);
			if (!targetRow) {
				return {
					status: 400,
					body: {
						error: 'target_not_found',
						message: `targetId ${targetIdRaw} does not belong to this tenant`
					}
				};
			}
		}

		const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

		await db.insert(table.adOptimizationRecommendation).values({
			id,
			tenantId: ctx.tenantId,
			clientId,
			targetId: targetIdRaw,
			platform: 'meta',
			externalCampaignId,
			externalAdsetId: typeof body.externalAdsetId === 'string' ? body.externalAdsetId : null,
			externalAdId: typeof body.externalAdId === 'string' ? body.externalAdId : null,
			action: action as AdRecommendationAction,
			reason,
			metricSnapshotJson:
				body.metricSnapshot && typeof body.metricSnapshot === 'object'
					? JSON.stringify(body.metricSnapshot)
					: '{}',
			suggestedPayloadJson:
				body.suggestedPayload && typeof body.suggestedPayload === 'object'
					? JSON.stringify(body.suggestedPayload)
					: '{}',
			status: 'draft',
			source: 'worker',
			sourceWorkerId:
				typeof body.sourceWorkerId === 'string' ? body.sourceWorkerId : null,
			sourceApiKeyId: ctx.apiKeyId
		});

		// Notify all tenant admins so they see the pending recommendation.
		try {
			const [tenantRow] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, ctx.tenantId))
				.limit(1);
			const slug = tenantRow?.slug ?? ctx.tenantId;

			const recipients = await db
				.select({ userId: table.tenantUser.userId })
				.from(table.tenantUser)
				.where(eq(table.tenantUser.tenantId, ctx.tenantId));
			for (const r of recipients) {
				await createNotification({
					tenantId: ctx.tenantId,
					userId: r.userId,
					clientId,
					type: 'approval.requested',
					title: 'Recomandare optimizare Meta — necesită aprobare',
					message: `${action} pentru campania ${externalCampaignId}: ${reason}`,
					link: `/${slug}/reports/facebook-ads/monitoring?recId=${id}`,
					priority: 'high',
					metadata: { recommendationId: id, action, externalCampaignId, source: 'worker' }
				});
			}
		} catch {
			// non-fatal — recommendation is still in DB
		}

		logInfo('ads-monitor', `Worker submitted recommendation ${id}`, {
			tenantId: ctx.tenantId,
			metadata: {
				recommendationId: id,
				action,
				externalCampaignId,
				sourceWorkerId: body.sourceWorkerId
			}
		});

		return { status: 201, body: { id, status: 'draft' } };
	});
