import { json, error } from '@sveltejs/kit';
import { backfillTenantSnapshots } from '$lib/server/scheduler/tasks/ads-performance-monitor';
import { logInfo, serializeError } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
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
	const clientId = typeof body.clientId === 'string' && body.clientId.length > 0 ? body.clientId : null;

	if (clientId) {
		const [client] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, locals.tenant.id)))
			.limit(1);
		if (!client) throw error(404, 'Client inexistent');
	}

	logInfo('ads-monitor', `Manual backfill triggered by user ${locals.user.id} (${daysBack} days, includeToday=${includeToday}, clientId=${clientId ?? 'all'})`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		metadata: { daysBack, includeToday, clientId }
	});

	try {
		const result = await backfillTenantSnapshots(locals.tenant.id, daysBack, includeToday, clientId);
		return json({ ok: true, result });
	} catch (e) {
		const { message, stack } = serializeError(e);
		return json({ ok: false, error: message, stack }, { status: 500 });
	}
};
