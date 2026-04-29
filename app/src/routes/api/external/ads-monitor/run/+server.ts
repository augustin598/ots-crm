import type { RequestHandler } from './$types';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { processAdsPerformanceMonitor } from '$lib/server/scheduler/tasks/ads-performance-monitor';
import { logInfo, serializeError } from '$lib/server/logger';

/**
 * POST /api/external/ads-monitor/run
 *
 * Trigger the daily performance monitor on-demand for the current tenant.
 * Used by PersonalOPS CEO when it wants fresh data before drafting a
 * recommendation or generating a weekly review.
 *
 * Returns the same shape as the cron run: { tenantsProcessed, alerted, processed }.
 *
 * Note: this hits Meta API directly with skipCache, so don't spam — the daily
 * cron is enough for steady state.
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (_event, ctx) => {
		logInfo('ads-monitor', `External run triggered for tenant ${ctx.tenantId}`, {
			tenantId: ctx.tenantId,
			metadata: { apiKeyId: ctx.apiKeyId }
		});

		try {
			const result = await processAdsPerformanceMonitor({ tenantId: ctx.tenantId });
			return {
				status: 200,
				body: { ok: true, result }
			};
		} catch (e) {
			const { message } = serializeError(e);
			return {
				status: 500,
				body: { ok: false, error: 'monitor_run_failed', message }
			};
		}
	});
