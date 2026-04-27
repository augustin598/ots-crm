import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { spawnNextRecurringTask } from '$lib/server/recurring-tasks';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Safety-net for recurring tasks: picks up tasks that are marked done + recurring but
 * never spawned a child (e.g., updateTask hook crashed mid-write). Runs daily.
 */
export async function processRecurringTasksSafety(_params: Record<string, any> = {}) {
	try {
		const now = new Date();
		logInfo('scheduler', `Recurring tasks safety: checking at ${now.toISOString()}`, { action: 'recurring_tasks_start' });

		const orphans = await db
			.select({
				id: table.task.id,
				tenantId: table.task.tenantId,
				title: table.task.title
			})
			.from(table.task)
			.where(
				and(
					eq(table.task.isRecurring, true),
					eq(table.task.status, 'done'),
					isNull(table.task.recurringSpawnedAt)
				)
			);

		if (orphans.length === 0) {
			logInfo('scheduler', 'Recurring tasks safety: 0 orphans found', { action: 'recurring_tasks_zero' });
			return { success: true, spawned: 0 };
		}

		let spawned = 0;
		const errors: Array<{ id: string; error: string }> = [];

		for (const orphan of orphans) {
			try {
				const childId = await spawnNextRecurringTask(orphan.id);
				if (childId) {
					spawned++;
					logInfo('scheduler', `Recurring tasks safety: spawned child ${childId} from orphan ${orphan.id}`, { tenantId: orphan.tenantId, action: 'recurring_tasks_spawn' });
				}
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Recurring tasks safety: failed for ${orphan.id}: ${message}`, { tenantId: orphan.tenantId, stackTrace: stack });
				errors.push({ id: orphan.id, error: message });
			}
		}

		const logFn = spawned === 0 ? logWarning : logInfo;
		logFn('scheduler', `Recurring tasks safety: ${spawned} spawned from ${orphans.length} orphans`, { metadata: { spawned, total: orphans.length, errorCount: errors.length } });

		return { success: true, spawned, errors: errors.length > 0 ? errors : undefined };
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Recurring tasks safety: process error: ${message}`, { stackTrace: stack });
		return { success: false, spawned: 0, error: 'Failed to process recurring tasks safety-net' };
	}
}
