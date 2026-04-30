import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { logInfo } from '$lib/server/logger';
import {
	fetchRecsForFeedback,
	computeRejectionRates
} from '$lib/server/ads-monitor/feedback-aggregate';
import { evaluateAutoUnsuppress } from '$lib/server/ads-monitor/audit-writer';

const ALLOWED_UPDATE_FIELDS = new Set([
	'targetCplCents',
	'targetCpaCents',
	'targetRoas',
	'targetCtr',
	'targetDailyBudgetCents',
	'deviationThresholdPct',
	'isActive',
	'isMuted',
	'mutedUntil',
	'notifyTelegram',
	'notifyEmail',
	'notifyInApp'
]);

async function fetchTarget(id: string | undefined, tenantId: string) {
	if (!id) return null;
	const [row] = await db
		.select()
		.from(table.adMonitorTarget)
		.where(and(eq(table.adMonitorTarget.id, id), eq(table.adMonitorTarget.tenantId, tenantId)))
		.limit(1);
	return row ?? null;
}

/**
 * GET /api/external/ads-monitor/targets/[id]
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const { id } = event.params;
		const row = await fetchTarget(id, ctx.tenantId);
		if (!row) {
			return { status: 404, body: { error: 'not_found', message: 'Target not found' } };
		}

		const withOverrides = event.url.searchParams.get('withOverrides') === 'true';
		if (!withOverrides) {
			return { status: 200, body: row };
		}

		// Parse suppressedActions JSON array (default '[]')
		let suppressed: string[] = [];
		try {
			const parsed = JSON.parse(row.suppressedActions ?? '[]');
			if (Array.isArray(parsed)) {
				suppressed = parsed.filter((x): x is string => typeof x === 'string');
			}
		} catch {
			suppressed = [];
		}

		const cleaned = await evaluateAutoUnsuppress(
			ctx.tenantId,
			row.id,
			suppressed,
			row.version
		);
		suppressed = cleaned.suppressedActions;

		const recs = await fetchRecsForFeedback(ctx.tenantId, row.clientId);
		const rates = computeRejectionRates(recs);

		return {
			status: 200,
			body: {
				...row,
				overrides: {
					customCooldownHours: row.customCooldownHours ?? null,
					suppressedActions: suppressed,
					severityOverride: row.severityOverride ?? null,
					minConversionsThreshold: row.minConversionsThreshold ?? null,
					version: cleaned.version
				},
				feedback: { rejectionRateLast30d: rates }
			}
		};
	});

/**
 * PATCH /api/external/ads-monitor/targets/[id]
 * Updates mutable fields on a target. Immutable fields (id, tenantId, clientId,
 * externalCampaignId, platform, objective) are silently ignored.
 */
export const PATCH: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const { id } = event.params;

		const row = await fetchTarget(id, ctx.tenantId);
		if (!row) {
			return { status: 404, body: { error: 'not_found', message: 'Target not found' } };
		}

		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json', message: 'Body must be JSON' } };
		}

		const patch: Record<string, unknown> = {};
		const ignored: string[] = [];

		for (const [key, value] of Object.entries(body)) {
			if (ALLOWED_UPDATE_FIELDS.has(key)) {
				patch[key] = value;
			} else {
				ignored.push(key);
			}
		}

		if (ignored.length > 0) {
			logInfo('ads-monitor', `PATCH target ${id}: ignoring immutable fields`, {
				tenantId: ctx.tenantId,
				metadata: { ignored }
			});
		}

		if (Object.keys(patch).length === 0) {
			return {
				status: 400,
				body: { error: 'no_fields', message: 'No updatable fields provided' }
			};
		}

		patch.updatedAt = new Date();

		await db
			.update(table.adMonitorTarget)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.set(patch as any)
			.where(eq(table.adMonitorTarget.id, id!));

		const updated = await fetchTarget(id, ctx.tenantId);
		return { status: 200, body: updated };
	});

/**
 * DELETE /api/external/ads-monitor/targets/[id]
 * Soft-deletes by setting isActive=false.
 */
export const DELETE: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const { id } = event.params;

		const row = await fetchTarget(id, ctx.tenantId);
		if (!row) {
			return { status: 404, body: { error: 'not_found', message: 'Target not found' } };
		}

		await db
			.update(table.adMonitorTarget)
			.set({ isActive: false, updatedAt: new Date() })
			.where(eq(table.adMonitorTarget.id, id!));

		return { status: 200, body: { id, deleted: true } };
	});
