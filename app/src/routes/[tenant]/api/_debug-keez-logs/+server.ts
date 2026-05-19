/**
 * Dump recent keez-source debug log entries for the tenant.
 *
 *   GET /[tenant]/api/_debug-keez-logs?limit=30
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const limit = Math.min(200, Math.max(1, Number(event.url.searchParams.get('limit') ?? '30')));

	const rows = await db
		.select({
			id: table.debugLog.id,
			level: table.debugLog.level,
			source: table.debugLog.source,
			message: table.debugLog.message,
			action: table.debugLog.action,
			metadata: table.debugLog.metadata,
			createdAt: table.debugLog.createdAt
		})
		.from(table.debugLog)
		.where(
			and(eq(table.debugLog.tenantId, tenantId), eq(table.debugLog.source, 'keez'))
		)
		.orderBy(desc(table.debugLog.createdAt))
		.limit(limit);

	return json({ ok: true, count: rows.length, rows });
};
