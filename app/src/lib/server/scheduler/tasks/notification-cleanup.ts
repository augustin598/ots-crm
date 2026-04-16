import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, lt, eq } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';

/**
 * Delete old notifications:
 * - Read notifications older than 30 days
 * - All notifications older than 90 days
 */
export async function cleanupOldNotifications(): Promise<void> {
	try {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

		const deletedRead = await db
			.delete(table.notification)
			.where(
				and(
					eq(table.notification.isRead, true),
					lt(table.notification.createdAt, thirtyDaysAgo)
				)
			);

		const deletedExpired = await db
			.delete(table.notification)
			.where(lt(table.notification.createdAt, ninetyDaysAgo));

		logInfo('scheduler', 'Notification cleanup completed', {
			metadata: {
				deletedRead: deletedRead.rowsAffected,
				deletedExpired: deletedExpired.rowsAffected,
			}
		});
	} catch (error) {
		logError('scheduler', `Notification cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
