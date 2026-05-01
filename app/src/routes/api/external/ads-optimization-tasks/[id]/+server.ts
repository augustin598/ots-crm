import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * GET /api/external/ads-optimization-tasks/:id
 * Fetch a single task by id regardless of status.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const { id } = event.params;
		if (!id) return { status: 400, body: { error: 'missing_id' } };

		const [task] = await db
			.select()
			.from(table.adsOptimizationTask)
			.where(and(eq(table.adsOptimizationTask.id, id), eq(table.adsOptimizationTask.tenantId, ctx.tenantId)))
			.limit(1);

		if (!task) {
			return { status: 404, body: { error: 'task_not_found' } };
		}

		return {
			status: 200,
			body: {
				...task,
				resultJson: task.resultJson ? (() => { try { return JSON.parse(task.resultJson!); } catch { return null; } })() : null
			}
		};
	});

/**
 * PATCH /api/external/ads-optimization-tasks/:id
 * Completes or fails a claimed task. Body: { status: 'done'|'failed', result?: {...} }
 */
export const PATCH: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const { id } = event.params;
		if (!id) return { status: 400, body: { error: 'missing_id' } };

		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json', message: 'Body must be JSON' } };
		}

		const status = typeof body.status === 'string' ? body.status : null;
		if (status !== 'done' && status !== 'failed') {
			return {
				status: 400,
				body: { error: 'invalid_status', message: 'status must be done or failed' }
			};
		}

		const [existing] = await db
			.select({ id: table.adsOptimizationTask.id, status: table.adsOptimizationTask.status })
			.from(table.adsOptimizationTask)
			.where(and(eq(table.adsOptimizationTask.id, id), eq(table.adsOptimizationTask.tenantId, ctx.tenantId)))
			.limit(1);

		if (!existing) {
			return { status: 404, body: { error: 'not_found' } };
		}

		if (existing.status !== 'claimed') {
			return {
				status: 409,
				body: {
					error: 'task_not_claimable',
					reason: `task is ${existing.status}, must be claimed to complete`
				}
			};
		}

		const resultJson =
			body.result && typeof body.result === 'object' ? JSON.stringify(body.result) : null;

		const updated = await db
			.update(table.adsOptimizationTask)
			.set({
				status: status as 'done' | 'failed',
				completedAt: new Date(),
				...(resultJson !== null ? { resultJson } : {})
			})
			.where(eq(table.adsOptimizationTask.id, id))
			.returning();

		const task = updated[0];
		return {
			status: 200,
			body: {
				...task,
				resultJson: task.resultJson ? (() => { try { return JSON.parse(task.resultJson!); } catch { return null; } })() : null
			}
		};
	});
