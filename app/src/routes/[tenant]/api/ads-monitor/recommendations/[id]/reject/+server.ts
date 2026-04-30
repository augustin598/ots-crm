import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	const [rec] = await db
		.select({ status: table.adOptimizationRecommendation.status })
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.id, params.id),
				eq(table.adOptimizationRecommendation.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!rec) throw error(404, 'Recomandare inexistentă');
	if (rec.status !== 'draft') {
		return json({ ok: false, error: `cannot reject: status=${rec.status}` }, { status: 400 });
	}

	const now = new Date();
	await db
		.update(table.adOptimizationRecommendation)
		.set({
			status: 'rejected',
			decidedAt: now,
			decidedByUserId: locals.user.id,
			updatedAt: now
		})
		.where(eq(table.adOptimizationRecommendation.id, params.id));

	logInfo('ads-monitor', `User rejected recommendation ${params.id}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id
	});

	return json({ ok: true });
};
