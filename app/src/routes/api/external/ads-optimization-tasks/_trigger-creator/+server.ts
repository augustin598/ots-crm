import type { RequestHandler } from './$types';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { processAdsOptimizationTaskCreator } from '$lib/server/scheduler/tasks/ads-optimization-task-creator';

/**
 * POST /api/external/ads-optimization-tasks/_trigger-creator
 * Manually triggers the daily task-creator for a specific tenant (or all tenants).
 * Scope: ads_monitor:write
 * Body: { tenantId?: string }
 * Useful for testing task creation without waiting for 00:15 RO.
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const result = await processAdsOptimizationTaskCreator({ tenantId: ctx.tenantId });
		return { status: 200, body: { ok: true, ...result } };
	});
