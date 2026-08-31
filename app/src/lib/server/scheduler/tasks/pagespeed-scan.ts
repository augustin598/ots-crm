// Handler BullMQ pentru scanarea manuală PageSpeed (declanșată din UI prin
// `startPagespeedScan`). Jobul e one-shot (fără repeat) — progresul se urmărește
// în Redis prin `getScanProgress`, nu prin starea jobului.
import { logWarning } from '$lib/server/logger';
import { runPagespeedScan, type ScanSummary } from '$lib/server/pagespeed/scan';

export async function processPagespeedScan(
	params: Record<string, unknown>
): Promise<ScanSummary | { skipped: true; reason: string }> {
	const tenantId = typeof params.tenantId === 'string' ? params.tenantId : null;
	if (!tenantId) {
		logWarning('scheduler', '[pagespeed-scan] job fără tenantId — ignorat');
		return { skipped: true, reason: 'tenantId lipsă' };
	}
	const siteIds = Array.isArray(params.siteIds)
		? params.siteIds.filter((s): s is string => typeof s === 'string')
		: undefined;
	return runPagespeedScan({ tenantId, siteIds: siteIds?.length ? siteIds : undefined });
}
