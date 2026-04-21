import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { handleKeezSyncFailure } from '../../plugins/keez/failure-handler';
import { logInfo } from '$lib/server/logger';

/**
 * BullMQ jobId for per-tenant retry dedup. Only one retry job can be queued
 * per tenant at a time, so repeated failures don't stack up.
 */
export function retryJobId(tenantId: string): string {
	return `keez-invoice-sync-retry:${tenantId}`;
}

/**
 * Enqueue a delayed retry job for a single tenant.
 * Uses a lazy import of the scheduler queue to avoid the circular import
 * chain index.ts → task → failure-handler → enqueueRetry → index.ts.
 */
export async function enqueueKeezRetry(tenantId: string, delayMs: number): Promise<void> {
	const { schedulerQueue } = await import('../index');
	await schedulerQueue.add(
		'keez-invoice-sync-retry',
		{ type: 'keez_invoice_sync_retry', params: { tenantId } },
		{ delay: delayMs, jobId: retryJobId(tenantId), attempts: 1 }
	);
}

/**
 * Cancel a pending retry job for a tenant (no-op if none queued).
 * Called from the manual remote command so a user-triggered sync
 * doesn't run at the same time as a queued retry.
 */
export async function cancelPendingKeezRetry(tenantId: string): Promise<void> {
	try {
		const { schedulerQueue } = await import('../index');
		await schedulerQueue.remove(retryJobId(tenantId));
	} catch {
		// No-op: stale removals are fine (job already ran, or queue transient error).
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
			metadata: { imported: result.imported, updated: result.updated, skipped: result.skipped }
		});
		return { success: true, ...result };
	} catch (error) {
		await handleKeezSyncFailure(tenantId, error, { enqueueRetry: enqueueKeezRetry });
		return { success: false };
	}
}
