import { json, error } from '@sveltejs/kit';
import { backfillTenantSnapshots } from '$lib/server/scheduler/tasks/ads-performance-monitor';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: admin access required');
	}

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch { /* empty body OK */ }

	const daysBack = typeof body.daysBack === 'number' && body.daysBack > 0 && body.daysBack <= 90
		? Math.floor(body.daysBack)
		: 30;
	const includeToday = body.includeToday === true;

	logInfo('ads-monitor', `Manual backfill triggered by user ${locals.user.id} (${daysBack} days, includeToday=${includeToday})`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		metadata: { daysBack, includeToday }
	});

	try {
		const result = await backfillTenantSnapshots(locals.tenant.id, daysBack, includeToday);
		return json({ ok: true, result });
	} catch (e) {
		const { message, stack } = serializeError(e);
		return json({ ok: false, error: message, stack }, { status: 500 });
	}
};
