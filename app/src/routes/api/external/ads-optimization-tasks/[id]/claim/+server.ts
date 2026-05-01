import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * POST /api/external/ads-optimization-tasks/:id/claim
 * Atomically claims a pending task. Returns 409 if already claimed or not claimable.
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const { id } = event.params;
		if (!id) return { status: 400, body: { error: 'missing_id' } };

		let body: Record<string, unknown> = {};
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			// body is optional
		}
		const workerId = typeof body.workerId === 'string' ? body.workerId : 'unknown';
		const instanceId = typeof body.instanceId === 'string' ? body.instanceId : null;

		// Verify the task belongs to this tenant first
		const [existing] = await db
			.select()
			.from(table.adsOptimizationTask)
			.where(and(eq(table.adsOptimizationTask.id, id), eq(table.adsOptimizationTask.tenantId, ctx.tenantId)))
			.limit(1);

		if (!existing) {
			return { status: 409, body: { ok: false, error: 'task_not_claimable', reason: 'not_found' } };
		}

		if (existing.status !== 'pending') {
			const reason = existing.status === 'claimed' ? 'already_claimed' : existing.status;
			return { status: 409, body: { ok: false, error: 'task_not_claimable', reason } };
		}

		// Atomic claim: only succeeds if status is still 'pending'
		const updated = await db
			.update(table.adsOptimizationTask)
			.set({ status: 'claimed', claimedAt: new Date(), claimedBy: workerId, claimedByInstanceId: instanceId })
			.where(
				and(
					eq(table.adsOptimizationTask.id, id),
					eq(table.adsOptimizationTask.tenantId, ctx.tenantId),
					eq(table.adsOptimizationTask.status, 'pending')
				)
			)
			.returning();

		if (updated.length === 0) {
			// Race: another worker claimed it between our SELECT and UPDATE
			return { status: 409, body: { ok: false, error: 'task_not_claimable', reason: 'already_claimed' } };
		}

		const task = updated[0];
		return {
			status: 200,
			body: {
				...task,
				resultJson: task.resultJson ? (() => { try { return JSON.parse(task.resultJson!); } catch { return null; } })() : null
			}
		};
	});
