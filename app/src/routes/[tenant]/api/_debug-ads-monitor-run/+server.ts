import { json, error } from '@sveltejs/kit';
import { processAdsPerformanceMonitor } from '$lib/server/scheduler/tasks/ads-performance-monitor';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Manual trigger for the ads performance monitor — admin only.
 * Useful for debugging deviation detection without waiting for the daily 07:00 cron.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: admin access required');
	}

	logInfo('ads-monitor', `Manual run triggered by user ${locals.user.id}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id
	});

	try {
		const result = await processAdsPerformanceMonitor({ tenantId: locals.tenant.id });
		return json({ ok: true, result });
	} catch (e) {
		const { message, stack } = serializeError(e);
		return json({ ok: false, error: message, stack }, { status: 500 });
	}
};
