import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, gte, lte, isNotNull } from 'drizzle-orm';
import { sendDailyWorkReminderEmail } from '../../email';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Process daily work reminders - finds users whose work start time matches current hour
 * and sends reminder emails with tasks scheduled for today
 */
export async function processDailyWorkReminders(params: Record<string, any> = {}) {
	try {
		const now = new Date();
		const currentHour = now.getHours();
		const currentMinute = now.getMinutes();

		// Format current time as "HH:MM" (e.g., "09:00")
		const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

		// Get day name (lowercase, e.g., "monday")
		const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
		const currentDayName = dayNames[now.getDay()];

		// Find all user work hours where:
		// 1. Work start time matches current time (HH:MM)
		// 2. Reminders are enabled
		// 3. Current day is in work days
		const allWorkHours = await db
			.select()
			.from(table.userWorkHours)
			.where(eq(table.userWorkHours.remindersEnabled, true));

		let remindersSent = 0;
		const errors: Array<{ userId: string; tenantId: string; error: string }> = [];

		// Filter work hours that match current time and day
		for (const workHours of allWorkHours) {
			// Check if work start time matches current time
			if (workHours.workStartTime !== currentTimeStr) {
				continue;
			}

			// Check if today is a work day
			const workDays = workHours.workDays || [];
			if (!workDays.includes(currentDayName)) {
				continue;
			}

			// Get user
			const [user] = await db
				.select()
				.from(table.user)
				.where(eq(table.user.id, workHours.userId))
				.limit(1);

			if (!user?.email) {
				logWarning('scheduler', `Daily work reminders: cannot send reminder, user email not found`, { tenantId: workHours.tenantId, metadata: { userId: workHours.userId } });
				continue;
			}

			// Get tasks for today assigned to this user in this tenant
			const todayStart = new Date(now);
			todayStart.setHours(0, 0, 0, 0);
			const todayEnd = new Date(now);
			todayEnd.setHours(23, 59, 59, 999);

			const tasks = await db
				.select()
				.from(table.task)
				.where(
					and(
						eq(table.task.tenantId, workHours.tenantId),
						eq(table.task.assignedToUserId, workHours.userId),
						isNotNull(table.task.dueDate),
						gte(table.task.dueDate, todayStart),
						lte(table.task.dueDate, todayEnd)
					)
				);

			// Only send email if there are tasks
			if (tasks.length === 0) {
				continue;
			}

			try {
				const userName = `${user.firstName} ${user.lastName}`.trim() || user.email;
				await sendDailyWorkReminderEmail(workHours.userId, workHours.tenantId, tasks, userName);

				remindersSent++;
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Daily work reminders: error sending reminder: ${message}`, { tenantId: workHours.tenantId, metadata: { userId: workHours.userId }, stackTrace: stack });
				errors.push({
					userId: workHours.userId,
					tenantId: workHours.tenantId,
					error: message
				});
			}
		}

		logInfo('scheduler', `Daily work reminders processed: ${remindersSent} reminders sent`, { metadata: { remindersSent, errorCount: errors.length } });
		if (errors.length > 0) {
			logError('scheduler', `Daily work reminders: ${errors.length} errors`, { metadata: { errorCount: errors.length } });
		}

		return {
			success: true,
			remindersSent,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Daily work reminders: process error: ${message}`, { stackTrace: stack });
		return {
			success: false,
			remindersSent: 0,
			error: 'Failed to process daily work reminders'
		};
	}
}
