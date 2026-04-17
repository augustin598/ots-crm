import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { lt, or } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Scheduled task: clean up expired/used authentication tokens.
 *
 * Retention: 7 days after expiry (keeps recent tokens for audit trail).
 * Covers: magicLinkToken, adminMagicLinkToken, passwordResetToken
 */
export async function processTokenCleanup(): Promise<{
	success: boolean;
	deleted: { magicLink: number; adminMagicLink: number; passwordReset: number };
}> {
	logInfo('scheduler', 'Token cleanup starting');

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const deleted = { magicLink: 0, adminMagicLink: 0, passwordReset: 0 };

	try {
		// Delete magic link tokens expired > 7 days ago
		const mlResult = await db
			.delete(table.magicLinkToken)
			.where(lt(table.magicLinkToken.expiresAt, sevenDaysAgo));
		deleted.magicLink = (mlResult as { rowsAffected?: number })?.rowsAffected ?? 0;

		// Delete admin magic link tokens expired > 7 days ago
		const amlResult = await db
			.delete(table.adminMagicLinkToken)
			.where(lt(table.adminMagicLinkToken.expiresAt, sevenDaysAgo));
		deleted.adminMagicLink = (amlResult as { rowsAffected?: number })?.rowsAffected ?? 0;

		// Delete password reset tokens expired > 7 days ago
		const prResult = await db
			.delete(table.passwordResetToken)
			.where(lt(table.passwordResetToken.expiresAt, sevenDaysAgo));
		deleted.passwordReset = (prResult as { rowsAffected?: number })?.rowsAffected ?? 0;

		const total = deleted.magicLink + deleted.adminMagicLink + deleted.passwordReset;
		if (total > 0) {
			logInfo('scheduler', `Token cleanup completed: deleted ${total} expired tokens`, {
				metadata: { deleted }
			});
		}

		return { success: true, deleted };
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Token cleanup failed: ${message}`, { stackTrace: stack });
		return { success: false, deleted };
	}
}
