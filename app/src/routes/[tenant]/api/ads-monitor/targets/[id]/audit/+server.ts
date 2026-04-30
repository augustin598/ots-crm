import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	// Confirm target belongs to tenant before exposing audit
	const [exists] = await db
		.select({ id: table.adMonitorTarget.id })
		.from(table.adMonitorTarget)
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!exists) throw error(404, 'Target inexistent');

	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const rows = await db
		.select({
			id: table.adMonitorTargetAudit.id,
			actorType: table.adMonitorTargetAudit.actorType,
			actorId: table.adMonitorTargetAudit.actorId,
			action: table.adMonitorTargetAudit.action,
			changesJson: table.adMonitorTargetAudit.changesJson,
			note: table.adMonitorTargetAudit.note,
			metadataJson: table.adMonitorTargetAudit.metadataJson,
			at: table.adMonitorTargetAudit.at,
			actorName: table.user.email
		})
		.from(table.adMonitorTargetAudit)
		.leftJoin(
			table.user,
			and(
				eq(table.user.id, table.adMonitorTargetAudit.actorId),
				eq(table.adMonitorTargetAudit.actorType, 'user')
			)
		)
		.where(eq(table.adMonitorTargetAudit.targetId, params.id))
		.orderBy(desc(table.adMonitorTargetAudit.at))
		.limit(limit)
		.offset(offset);

	return json({ entries: rows, limit, offset });
};
