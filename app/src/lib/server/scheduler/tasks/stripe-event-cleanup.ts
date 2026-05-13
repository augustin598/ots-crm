import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { lt, eq, and, or } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Scheduled task: prune old `processed_stripe_event` rows.
 *
 * Retention:
 *  - 'completed' / 'failed'   → 90 zile (Stripe retry-uiește max 3 zile, deci e safe)
 *  - 'processing' > 1 oră     → eligible for cleanup (likely abandonată în mijloc
 *                                de proces care a murit; webhook-ul Stripe a retry
 *                                deja sau și-a expirat fereastra). Aceste rows ar
 *                                bloca claim-ul ulterior cu status='processing'.
 *
 * Tabelul crește unbounded altfel (~1 row per webhook event în viața platformei).
 */
export async function processStripeEventCleanup(): Promise<{
	success: boolean;
	deleted: { completed: number; failed: number; stuckProcessing: number };
}> {
	logInfo('scheduler', 'Stripe event cleanup starting', {
		metadata: { retentionDays: 90, stuckProcessingHours: 1 }
	});

	const now = Date.now();
	// `processedAt` e DATE (current_date), nu timestamp — comparăm cu o dată ISO.
	const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);
	const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

	const deleted = { completed: 0, failed: 0, stuckProcessing: 0 };

	try {
		const completedRes = await db
			.delete(table.processedStripeEvent)
			.where(
				and(
					eq(table.processedStripeEvent.status, 'completed'),
					lt(table.processedStripeEvent.processedAt, ninetyDaysAgo)
				)
			);
		deleted.completed = completedRes.rowsAffected ?? 0;

		const failedRes = await db
			.delete(table.processedStripeEvent)
			.where(
				and(
					eq(table.processedStripeEvent.status, 'failed'),
					lt(table.processedStripeEvent.processedAt, ninetyDaysAgo)
				)
			);
		deleted.failed = failedRes.rowsAffected ?? 0;

		// Stuck 'processing' — clean up dacă startedAt e mai vechi de 1h.
		// Stripe oricum nu mai consideră event-ul retry-able după 3 zile.
		const stuckRes = await db
			.delete(table.processedStripeEvent)
			.where(
				and(
					eq(table.processedStripeEvent.status, 'processing'),
					or(
						lt(table.processedStripeEvent.startedAt, oneHourAgo),
						// Failsafe: dacă startedAt e null (rows vechi pre-migrație 0298)
						lt(table.processedStripeEvent.processedAt, ninetyDaysAgo)
					)
				)
			);
		deleted.stuckProcessing = stuckRes.rowsAffected ?? 0;

		logInfo('scheduler', 'Stripe event cleanup completed', { metadata: { deleted } });
		return { success: true, deleted };
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('scheduler', `Stripe event cleanup failed: ${message}`, { stackTrace: stack });
		throw err;
	}
}
