import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lte, gte, or, isNull, isNotNull, inArray } from 'drizzle-orm';
import { sendTaskReminderEmail } from '../../email';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Process task reminders - finds tasks with due dates in the next 24 hours
 * and sends reminder emails to assignees
 */
export async function processTaskReminders(params: Record<string, any> = {}) {
	try {
		const now = new Date();
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(23, 59, 59, 999);

		// Get all tenants with task reminders enabled
		const tenantsWithRemindersEnabled = await db
			.select({ tenantId: table.taskSettings.tenantId })
			.from(table.taskSettings)
			.where(eq(table.taskSettings.taskRemindersEnabled, true));

		if (tenantsWithRemindersEnabled.length === 0) {
			logInfo('scheduler', 'Task reminders: no tenants have reminders enabled, skipping');
			return {
				success: true,
				remindersSent: 0
			};
		}

		const enabledTenantIds = tenantsWithRemindersEnabled.map((t) => t.tenantId);

		// Find tasks with dueDate in next 24 hours
		// Filter out tasks that have been reminded in the last 12 hours
		// Only for tenants with reminders enabled
		const twelveHoursAgo = new Date(now);
		twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

		const tasks = await db
			.select()
			.from(table.task)
			.where(
				and(
					inArray(table.task.tenantId, enabledTenantIds),
					isNotNull(table.task.dueDate),
					isNotNull(table.task.assignedToUserId),
					gte(table.task.dueDate, now),
					lte(table.task.dueDate, tomorrow),
					// Only tasks that haven't been reminded in the last 12 hours
					or(
						isNull(table.task.lastReminderSentAt),
						lte(table.task.lastReminderSentAt, twelveHoursAgo)
					)
				)
			);

		let remindersSent = 0;
		const errors: Array<{ id: string; error: string }> = [];

		// Send reminder emails for each task
		for (const task of tasks) {
			if (!task.assignedToUserId || !task.dueDate) {
				continue;
			}

			try {
				// Get assignee details
				const [assignee] = await db
					.select()
					.from(table.user)
					.where(eq(table.user.id, task.assignedToUserId))
					.limit(1);

				if (!assignee?.email) {
					logWarning('scheduler', `Task reminders: cannot send reminder, assignee email not found`, { tenantId: task.tenantId, metadata: { taskId: task.id } });
					continue;
				}

				// Send reminder email
				const assigneeName = `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email;
				await sendTaskReminderEmail(task.id, assignee.email, assigneeName);

				// Update lastReminderSentAt
				await db
					.update(table.task)
					.set({
						lastReminderSentAt: now,
						updatedAt: now
					})
					.where(eq(table.task.id, task.id));

				remindersSent++;
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Task reminders: error sending reminder for task ${task.id}: ${message}`, { tenantId: task.tenantId, stackTrace: stack });
				errors.push({ id: task.id, error: message });
			}
		}

		logInfo('scheduler', `Task reminders processed: ${remindersSent} reminders sent`, { metadata: { remindersSent, errorCount: errors.length } });
		if (errors.length > 0) {
			logError('scheduler', `Task reminders: ${errors.length} errors`, { metadata: { errorCount: errors.length } });
		}

		return {
			success: true,
			remindersSent,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Task reminders: process error: ${message}`, { stackTrace: stack });
		return {
			success: false,
			remindersSent: 0,
			error: 'Failed to process task reminders'
		};
	}
}
