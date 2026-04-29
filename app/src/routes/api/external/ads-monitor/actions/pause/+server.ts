import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { applyRecommendation } from '$lib/server/ads/apply-recommendation';
import { logInfo } from '$lib/server/logger';

/**
 * POST /api/external/ads-monitor/actions/pause
 *
 * Emergency / immediate pause shortcut. Creates an `approved` recommendation,
 * applies it on Meta, and returns the result. No DRAFT step — use this only
 * when the worker has a pre-approved policy (e.g., "auto-pause if conv=0 and
 * spend > 100 RON for 2 days, severity=urgent").
 *
 * For decisions that need human review, use POST /recommendations instead.
 *
 * Body: { clientId, externalCampaignId, reason, externalAdsetId?, sourceWorkerId? }
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json' } };
		}

		const clientId = typeof body.clientId === 'string' ? body.clientId : null;
		const externalCampaignId =
			typeof body.externalCampaignId === 'string' ? body.externalCampaignId : null;
		const reason = typeof body.reason === 'string' ? body.reason : null;

		if (!clientId || !externalCampaignId || !reason) {
			return {
				status: 400,
				body: {
					error: 'missing_fields',
					message: 'clientId, externalCampaignId, reason are required'
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

		// Create as already-approved
		const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		const now = new Date();
		await db.insert(table.adOptimizationRecommendation).values({
			id,
			tenantId: ctx.tenantId,
			clientId,
			platform: 'meta',
			externalCampaignId,
			externalAdsetId: typeof body.externalAdsetId === 'string' ? body.externalAdsetId : null,
			action: 'pause_ad',
			reason,
			metricSnapshotJson: '{}',
			suggestedPayloadJson: '{}',
			status: 'approved',
			source: 'worker',
			sourceWorkerId: typeof body.sourceWorkerId === 'string' ? body.sourceWorkerId : null,
			sourceApiKeyId: ctx.apiKeyId,
			decidedAt: now
		});

		logInfo('ads-monitor', `Worker auto-paused campaign ${externalCampaignId}`, {
			tenantId: ctx.tenantId,
			metadata: { recommendationId: id, sourceWorkerId: body.sourceWorkerId }
		});

		const outcome = await applyRecommendation(id, ctx.tenantId);
		if (!outcome.ok) {
			return { status: 500, body: { id, ok: false, error: outcome.error } };
		}
		return { status: 200, body: { id, ok: true, appliedAt: outcome.appliedAt } };
	});
