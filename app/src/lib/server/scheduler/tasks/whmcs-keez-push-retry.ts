/**
 * BullMQ delayed-retry task for the WHMCS → Keez auto-push chain.
 *
 * Per-invoice granularity: jobId encodes (tenantId, invoiceId, attempt) so each
 * retry hop has a unique job and BullMQ can't silently dedup it against an
 * earlier still-running hop. See keez-invoice-sync-retry.ts for the original
 * pattern this mirrors.
 *
 * Lifecycle:
 *   webhook fails inline → handleWhmcsKeezPushFailure → enqueueWhmcsKeezPushRetry
 *     → BullMQ delays → processWhmcsKeezPushRetry runs the push again
 *     → on success: state → KEEZ_PUSHED + reset counters
 *     → on failure: handleWhmcsKeezPushFailure again (next hop or FAILED)
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../../db';
import * as table from '../../db/schema';
import { logInfo, logWarning } from '$lib/server/logger';
import { handleWhmcsKeezPushFailure, resetWhmcsConsecutiveFailures } from '$lib/server/whmcs/failure-handler';
import { MAX_PUSH_ATTEMPTS } from '$lib/server/whmcs/retry-policy';

export function whmcsKeezPushRetryJobId(
	tenantId: string,
	invoiceId: string,
	attempt: number
): string {
	// Mirror keez-invoice-sync-retry.retryJobId — attempt suffix prevents BullMQ
	// from deduping a re-enqueue while the prior hop is still active.
	return `whmcs-keez-push-retry-${tenantId}-${invoiceId}-${attempt}`;
}

export async function enqueueWhmcsKeezPushRetry(
	tenantId: string,
	invoiceId: string,
	whmcsInvoiceId: number,
	delayMs: number,
	attempt: number
): Promise<void> {
	const { schedulerQueue } = await import('../index');
	await schedulerQueue.add(
		'whmcs-keez-push-retry',
		{
			type: 'whmcs_keez_push_retry',
			params: { tenantId, invoiceId, whmcsInvoiceId }
		},
		{
			delay: delayMs,
			jobId: whmcsKeezPushRetryJobId(tenantId, invoiceId, attempt),
			attempts: 1,
			removeOnComplete: true,
			removeOnFail: true
		}
	);
}

/**
 * Cancel pending retry hops for an invoice — used by the manual replay
 * command so admin retry doesn't race with a scheduled one.
 */
export async function cancelPendingWhmcsKeezPushRetry(
	tenantId: string,
	invoiceId: string
): Promise<void> {
	const { schedulerQueue } = await import('../index');
	for (let attempt = 1; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
		try {
			await schedulerQueue.remove(whmcsKeezPushRetryJobId(tenantId, invoiceId, attempt));
		} catch {
			// no-op
		}
	}
}

/**
 * BullMQ handler invoked when a delayed retry fires.
 * Re-runs pushInvoiceToKeez → validateInvoiceInKeezForTenant. Same idempotent
 * shape as the inline trigger in invoice-handler.ts.
 */
export async function processWhmcsKeezPushRetry(params: Record<string, any> = {}) {
	const tenantId = String(params.tenantId || '');
	const invoiceId = String(params.invoiceId || '');
	const whmcsInvoiceId = Number(params.whmcsInvoiceId || 0);
	if (!tenantId || !invoiceId || !whmcsInvoiceId) {
		return { success: false, error: 'missing tenantId/invoiceId/whmcsInvoiceId' };
	}

	// Skip if integration was disabled or push opted-out since the schedule.
	const [integration] = await db
		.select({
			isActive: table.whmcsIntegration.isActive,
			enableKeezPush: table.whmcsIntegration.enableKeezPush
		})
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive || !integration.enableKeezPush) {
		logInfo('scheduler', `WHMCS push retry skipped: integration disabled / push off`, {
			tenantId,
			metadata: { invoiceId, whmcsInvoiceId }
		});
		return { success: true, skipped: true };
	}

	// Skip if state already advanced (manual push beat us, or a parallel hop won).
	const [syncRow] = await db
		.select({
			state: table.whmcsInvoiceSync.state,
			keezPushStatus: table.whmcsInvoiceSync.keezPushStatus
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				eq(table.whmcsInvoiceSync.whmcsInvoiceId, whmcsInvoiceId)
			)
		)
		.limit(1);

	if (!syncRow) {
		logWarning('scheduler', `WHMCS push retry: sync row missing — abandoning hop`, {
			tenantId,
			metadata: { invoiceId, whmcsInvoiceId }
		});
		return { success: false, error: 'sync row missing' };
	}

	if (syncRow.state === 'KEEZ_PUSHED' || syncRow.keezPushStatus === 'success') {
		logInfo('scheduler', `WHMCS push retry: already succeeded — skipping`, {
			tenantId,
			metadata: { invoiceId, whmcsInvoiceId }
		});
		return { success: true, skipped: true };
	}

	if (syncRow.state === 'DEAD_LETTER') {
		logInfo('scheduler', `WHMCS push retry: row is DEAD_LETTER — skipping`, {
			tenantId,
			metadata: { invoiceId, whmcsInvoiceId }
		});
		return { success: true, skipped: true };
	}

	logInfo('scheduler', `WHMCS push retry: starting`, {
		tenantId,
		metadata: { invoiceId, whmcsInvoiceId }
	});

	// Mark as in-flight — surfaces to admin UI ("retrying right now").
	await db
		.update(table.whmcsInvoiceSync)
		.set({ keezPushStatus: 'in_flight', lastPushAttemptAt: new Date() })
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, tenantId),
				eq(table.whmcsInvoiceSync.whmcsInvoiceId, whmcsInvoiceId)
			)
		);

	try {
		const { pushInvoiceToKeez, validateInvoiceInKeezForTenant } = await import(
			'$lib/server/plugins/keez/auto-push'
		);

		const pushResult = await pushInvoiceToKeez(tenantId, invoiceId);
		if (!pushResult.success) {
			throw new Error(`pushInvoiceToKeez: ${pushResult.error}`);
		}

		const validateResult = await validateInvoiceInKeezForTenant(tenantId, invoiceId);
		if (!validateResult.success) {
			throw new Error(`validateInvoiceInKeezForTenant: ${validateResult.error}`);
		}

		await db
			.update(table.whmcsInvoiceSync)
			.set({
				state: 'KEEZ_PUSHED',
				keezPushStatus: 'success',
				nextRetryAt: null,
				lastErrorClass: null,
				lastErrorMessage: null,
				processedAt: new Date()
			})
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.whmcsInvoiceId, whmcsInvoiceId)
				)
			);

		await resetWhmcsConsecutiveFailures(tenantId);

		logInfo('scheduler', `WHMCS push retry: succeeded — KEEZ_PUSHED`, {
			tenantId,
			metadata: { invoiceId, whmcsInvoiceId }
		});

		return { success: true };
	} catch (error) {
		await handleWhmcsKeezPushFailure(tenantId, invoiceId, whmcsInvoiceId, error, {
			enqueueRetry: enqueueWhmcsKeezPushRetry
		});
		return { success: false };
	}
}
