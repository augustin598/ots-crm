import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, gte, lte, isNotNull } from 'drizzle-orm';
import { sendDailyWorkReminderEmail } from '../../email';

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
				console.warn(`Cannot send reminder for user ${workHours.userId}: email not found`);
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
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(
					`Error sending work reminder for user ${workHours.userId} in tenant ${workHours.tenantId}:`,
					errorMessage
				);
				errors.push({
					userId: workHours.userId,
					tenantId: workHours.tenantId,
					error: errorMessage
				});
			}
		}

		console.log(`Daily work reminders processed: ${remindersSent} reminders sent`);
		if (errors.length > 0) {
			console.error(`Work reminder errors: ${errors.length}`, errors);
		}

		return {
			success: true,
			remindersSent,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		console.error('Process daily work reminders error:', error);
		return {
			success: false,
			remindersSent: 0,
			error: 'Failed to process daily work reminders'
		};
	}
}
