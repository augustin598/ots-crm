import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Scheduled task: clean up old debug_log entries to prevent table bloat.
 *
 * Retention policy:
 *  - info    → 7 days
 *  - warning → 30 days
 *  - error   → 90 days
 */
export async function processDebugLogCleanup(): Promise<{
	success: boolean;
	deleted: { info: number; warning: number; error: number };
}> {
	logInfo('scheduler', 'Debug log cleanup starting');

	const now = Date.now();
	const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
	const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
	const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

	const deleted = { info: 0, warning: 0, error: 0 };

	try {
		// Delete old info logs (7 days)
		const infoResult = await db
			.delete(table.debugLog)
			.where(and(eq(table.debugLog.level, 'info'), lt(table.debugLog.createdAt, sevenDaysAgo)));
		deleted.info = infoResult.rowsAffected ?? 0;

		// Delete old warning logs (30 days)
		const warningResult = await db
			.delete(table.debugLog)
			.where(
				and(eq(table.debugLog.level, 'warning'), lt(table.debugLog.createdAt, thirtyDaysAgo))
			);
		deleted.warning = warningResult.rowsAffected ?? 0;

		// Delete old error logs (90 days)
		const errorResult = await db
			.delete(table.debugLog)
			.where(
				and(eq(table.debugLog.level, 'error'), lt(table.debugLog.createdAt, ninetyDaysAgo))
			);
		deleted.error = errorResult.rowsAffected ?? 0;

		logInfo('scheduler', `Debug log cleanup completed`, {
			metadata: { deleted }
		});

		return { success: true, deleted };
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Debug log cleanup failed: ${message}`, { stackTrace: stack });
		throw error;
	}
}
