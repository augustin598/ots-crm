import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { handleKeezSyncFailure } from '../../plugins/keez/failure-handler';
import { MAX_CONSECUTIVE_FAILURES } from '../../plugins/keez/retry-policy';
import { logInfo } from '$lib/server/logger';

/**
 * BullMQ jobId for the next retry hop.
 *
 * Must include `attempt`. BullMQ's `Queue.add()` is silently idempotent on
 * jobId — calling it with an existing jobId returns the existing job and does
 * NOT create the new delayed one. Without the attempt suffix, when the first
 * retry job is *active* and re-enqueues itself for the next hop, the new add
 * would dedup against the still-running job and the chain would break after
 * the first hop. With the suffix, each hop gets its own jobId.
 *
 * (Within a single hop the id is still stable, so concurrent enqueue attempts
 * for the same (tenant, attempt) pair are still deduplicated correctly.)
 */
export function retryJobId(tenantId: string, attempt: number): string {
	return `keez-invoice-sync-retry-${tenantId}-${attempt}`;
}

/**
 * Enqueue a delayed retry job for a single tenant.
 * `attempt` is the post-increment failure count (1, 2, 3 for the three retry
 * hops; degraded fires at MAX_CONSECUTIVE_FAILURES = 4).
 * Uses a lazy import of the scheduler queue to avoid the circular import
 * chain index.ts → task → failure-handler → enqueueRetry → index.ts.
 */
export async function enqueueKeezRetry(
	tenantId: string,
	delayMs: number,
	attempt: number
): Promise<void> {
	const { schedulerQueue } = await import('../index');
	await schedulerQueue.add(
		'keez-invoice-sync-retry',
		{ type: 'keez_invoice_sync_retry', params: { tenantId } },
		{
			delay: delayMs,
			jobId: retryJobId(tenantId, attempt),
			attempts: 1,
			// Drop the jobId hash from Redis as soon as the hop finishes so it
			// can never linger and dedup a future enqueue for the same tenant.
			removeOnComplete: true,
			removeOnFail: true,
		}
	);
}

/**
 * Cancel any pending retry hops for a tenant (no-op if none queued).
 * Called from the manual remote command so a user-triggered sync doesn't run
 * concurrently with a queued retry. We don't know which hop is queued, so try
 * removing every possible attempt-suffixed id.
 *
 * Bound is `attempt < MAX_CONSECUTIVE_FAILURES` because `decideFailureAction`
 * in retry-policy.ts short-circuits to `mark_degraded` when
 * `nextCount >= MAX_CONSECUTIVE_FAILURES`, so `enqueueKeezRetry` is only ever
 * called with `attempt` ∈ [1, MAX-1]. Keep the two in sync if MAX changes.
 */
export async function cancelPendingKeezRetry(tenantId: string): Promise<void> {
	const { schedulerQueue } = await import('../index');
	for (let attempt = 1; attempt < MAX_CONSECUTIVE_FAILURES; attempt++) {
		// BullMQ's Queue.remove() returns 0 (not present) / 1 (removed) and
		// does not throw for missing ids; the try/catch is purely defensive
		// against connection blips.
		try {
			await schedulerQueue.remove(retryJobId(tenantId, attempt));
		} catch {
			// No-op
		}
	}
}

/**
 * BullMQ handler for a delayed retry job. Runs one tenant's sync.
 * On failure, handleKeezSyncFailure re-classifies and either enqueues
 * another retry or marks the integration degraded.
 */
export async function processKeezInvoiceSyncRetry(params: Record<string, any> = {}) {
	const tenantId = String(params.tenantId || '');
	if (!tenantId) {
		return { success: false, error: 'missing tenantId' };
	}

	const [integration] = await db
		.select({ isActive: table.keezIntegration.isActive })
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		logInfo('scheduler', `Keez retry: integration no longer active, skipping`, { tenantId });
		return { success: true, skipped: true };
	}

	try {
		logInfo('scheduler', `Keez retry: starting`, { tenantId });
		const result = await syncKeezInvoicesForTenant(tenantId);
		logInfo('scheduler', `Keez retry: succeeded`, {
			tenantId,
			metadata: {
				imported: result.imported,
				updated: result.updated,
				unchanged: result.unchanged,
				skipped: result.skipped
			}
		});
		return { success: true, ...result };
	} catch (error) {
		await handleKeezSyncFailure(tenantId, error, { enqueueRetry: enqueueKeezRetry });
		return { success: false };
	}
}
