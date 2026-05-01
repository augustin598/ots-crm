import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

const VALID_STATUSES = ['pending', 'claimed', 'done', 'failed', 'expired'] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];

/**
 * GET /api/external/ads-optimization-tasks
 * Returns optimization tasks. Used by PersonalOPS to poll for work.
 * Query: status (default 'pending'), clientId, limit (default 50, max 200)
 * Ordered by createdAt ASC — fair queue.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const url = event.url;
		const statusParam = url.searchParams.get('status') ?? 'pending';
		const clientId = url.searchParams.get('clientId');
		const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

		if (!(VALID_STATUSES as readonly string[]).includes(statusParam)) {
			return {
				status: 400,
				body: {
					error: 'invalid_status',
					message: `status must be one of ${VALID_STATUSES.join(', ')}`
				}
			};
		}

		const conditions = [
			eq(table.adsOptimizationTask.tenantId, ctx.tenantId),
			eq(table.adsOptimizationTask.status, statusParam as TaskStatus)
		];
		if (clientId) conditions.push(eq(table.adsOptimizationTask.clientId, clientId));

		const rows = await db
			.select()
			.from(table.adsOptimizationTask)
			.where(and(...conditions))
			.orderBy(asc(table.adsOptimizationTask.createdAt))
			.limit(limit);

		const items = rows.map((r) => ({
			...r,
			resultJson: r.resultJson ? (() => { try { return JSON.parse(r.resultJson!); } catch { return null; } })() : null
		}));

		return { status: 200, body: { items, total: items.length } };
	});
