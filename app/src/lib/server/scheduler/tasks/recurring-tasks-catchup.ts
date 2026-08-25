import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, ne, and, isNull, isNotNull, lt } from 'drizzle-orm';
import {
	currentRecurringDueDate,
	startOfToday
} from '$lib/server/recurring-tasks';
import { recordTaskActivity } from '$lib/server/task-activity';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Pulls open recurring occurrences forward to the period they actually represent.
 *
 * A recurring task only ever spawned its successor on completion, so a chain that
 * nobody ticked stayed as ONE row whose due date kept sliding further into the
 * past — a weekly task untouched for two months read as "-60 days overdue" and
 * dominated the overdue card on the tasks page. Here each such row is re-anchored
 * on the latest occurrence that is still <= today: the periods that went by
 * unfinished are recorded in the task activity, and the remaining lateness is
 * capped at under one interval instead of accumulating without bound.
 *
 * Deliberately never moves a due date into the future — a deadline that really
 * has passed must stay visible as late. Runs daily.
 */
export async function processRecurringTasksCatchup(_params: Record<string, any> = {}) {
	try {
		const today = startOfToday();
		logInfo('scheduler', `Recurring tasks catch-up: checking at ${new Date().toISOString()}`, { action: 'recurring_catchup_start' });

		const stale = await db
			.select({
				id: table.task.id,
				tenantId: table.task.tenantId,
				title: table.task.title,
				dueDate: table.task.dueDate,
				recurringType: table.task.recurringType,
				recurringInterval: table.task.recurringInterval,
				recurringEndDate: table.task.recurringEndDate,
				createdByUserId: table.task.createdByUserId
			})
			.from(table.task)
			.where(
				and(
					eq(table.task.isRecurring, true),
					ne(table.task.status, 'done'),
					ne(table.task.status, 'cancelled'),
					isNull(table.task.recurringSpawnedAt),
					isNotNull(table.task.dueDate),
					isNotNull(table.task.recurringType),
					// A task with a meeting slot has a real, agreed-upon date backed by a
					// Google Calendar event this job does not update. Silently sliding its
					// due date would desync the two, so leave those to a human.
					isNull(table.task.meetTime),
					lt(table.task.dueDate, today)
				)
			);

		if (stale.length === 0) {
			logInfo('scheduler', 'Recurring tasks catch-up: 0 stale occurrences found', { action: 'recurring_catchup_zero' });
			return { success: true, rolled: 0 };
		}

		let rolled = 0;
		let chainsEnded = 0;
		const errors: Array<{ id: string; error: string }> = [];

		for (const taskRow of stale) {
			try {
				const previousDueDate = new Date(taskRow.dueDate!);
				const current = currentRecurringDueDate(
					previousDueDate,
					taskRow.recurringType!,
					taskRow.recurringInterval || 1,
					today
				);

				// Less than one full period has elapsed — the row is still the current
				// occurrence, merely late. Leave it alone.
				if (!current) continue;

				// Past the chain's end date there is no "current period" any more; the
				// leftover row is the operator's to close, not ours to reschedule.
				if (
					taskRow.recurringEndDate &&
					current.dueDate.getTime() > new Date(taskRow.recurringEndDate).getTime()
				) {
					chainsEnded++;
					continue;
				}

				const now = new Date();
				await db
					.update(table.task)
					.set({ dueDate: current.dueDate, updatedAt: now })
					.where(eq(table.task.id, taskRow.id));

				await recordTaskActivity({
					taskId: taskRow.id,
					userId: taskRow.createdByUserId || '',
					tenantId: taskRow.tenantId,
					action: 'recurring_occurrence_rolled',
					newValue: JSON.stringify({
						from: previousDueDate.toISOString(),
						to: current.dueDate.toISOString(),
						missed: current.missed
					})
				});

				rolled++;
				logInfo('scheduler', `Recurring tasks catch-up: rolled ${taskRow.id} from ${previousDueDate.toISOString()} to ${current.dueDate.toISOString()} (${current.missed} missed)`, { tenantId: taskRow.tenantId, action: 'recurring_catchup_roll' });
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Recurring tasks catch-up: failed for ${taskRow.id}: ${message}`, { tenantId: taskRow.tenantId, stackTrace: stack });
				errors.push({ id: taskRow.id, error: message });
			}
		}

		const logFn = rolled === 0 ? logWarning : logInfo;
		logFn('scheduler', `Recurring tasks catch-up: ${rolled} rolled from ${stale.length} candidates`, { metadata: { rolled, chainsEnded, total: stale.length, errorCount: errors.length } });

		return { success: true, rolled, chainsEnded, errors: errors.length > 0 ? errors : undefined };
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Recurring tasks catch-up: process error: ${message}`, { stackTrace: stack });
		return { success: false, rolled: 0, error: 'Failed to process recurring tasks catch-up' };
	}
}
