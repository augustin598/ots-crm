import { json, error } from '@sveltejs/kit';
import { processHostingExpiryGuard } from '$lib/server/scheduler/tasks/hosting-expiry-guard';
import type { RequestHandler } from './$types';

/**
 * Hosting expiry-guard probe.
 *
 * GET  → DRY-RUN only (read-only): lists which active hosting accounts WOULD be
 *        suspended (unpaid renewal invoice past due + 10-day grace), scoped to
 *        this tenant. Never suspends.
 * POST ?confirm=yes → LIVE run: actually emits the suspend hook for the
 *        candidates. Admin-gated. Use only after reviewing the dry-run output.
 *
 * Suspension model "A": grace counted from the unpaid renewal invoice's due_date.
 * The dual-paid guard (CRM paidDate/status OR Keez remainingAmount=0) protects
 * paying customers.
 */
function assertAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = assertAdmin(event);
	const result = await processHostingExpiryGuard({ dryRun: true, tenantId });
	return json({ mode: 'dry-run', ...result });
};

export const POST: RequestHandler = async (event) => {
	const tenantId = assertAdmin(event);
	if (event.url.searchParams.get('confirm') !== 'yes') {
		throw error(400, 'Refusing live run without ?confirm=yes (use GET for a dry-run first)');
	}
	const result = await processHostingExpiryGuard({ dryRun: false, tenantId });
	return json({ mode: 'live', ...result });
};
