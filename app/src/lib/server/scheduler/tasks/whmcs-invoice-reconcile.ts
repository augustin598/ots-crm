/**
 * Periodic reconcile for the WHMCS invoice sync queue. Handles two failure
 * modes the inline + retry-task path can't recover from on its own:
 *
 *   1. Orphaned `in_flight` rows. The webhook trigger or a retry hop crashed
 *      mid-push (process restart, SIGKILL, OOM) before flipping the row to
 *      success/failure. Without intervention these stay 'in_flight' forever
 *      and the admin UI is misleading. Older than `STUCK_IN_FLIGHT_MINUTES`
 *      → reset to `failed` and re-enqueue a fresh push.
 *
 *   2. Lost retry hops. The DB says `keez_push_status='retrying'` and
 *      `next_retry_at` is in the past, but no BullMQ job is queued (Redis
 *      flush, pod replacement during the delay window). Re-enqueue with
 *      attempt=1 so the schedule restarts cleanly.
 *
 * Lives in scheduler/tasks/ so it runs on the standard cron cadence (registered
 * by the deploy step in scheduler/index.ts; suggested cadence: every 10 min).
 *
 * Idempotent — re-running this task during the next sweep is a no-op for any
 * row already healthy.
 */
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';

import { db } from '../../db';
import * as table from '../../db/schema';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { enqueueWhmcsKeezPushRetry } from './whmcs-keez-push-retry';

const STUCK_IN_FLIGHT_MINUTES = 15;
const MAX_RECONCILES_PER_RUN = 100;

interface ReconcileResult {
	success: boolean;
	stuckInFlightReset: number;
	missingRetryHopRescheduled: number;
	error?: string;
}

export async function processWhmcsInvoiceReconcile(): Promise<ReconcileResult> {
	const result: ReconcileResult = {
		success: true,
		stuckInFlightReset: 0,
		missingRetryHopRescheduled: 0
	};

	try {
		const stuckCutoff = new Date(Date.now() - STUCK_IN_FLIGHT_MINUTES * 60_000);
		const now = new Date();

		// 1. Find orphaned in_flight rows AND retrying rows whose nextRetryAt is past
		//    (meaning the BullMQ hop should have already run but didn't update us).
		// Three orphan classes:
		//   1. in_flight + lastPushAttemptAt > 15min ago — worker died mid-push
		//   2. retrying + nextRetryAt > 5min in the past — BullMQ hop never ran
		//      (Redis flush, pod replacement during the delay window)
		//   3. retrying + nextRetryAt IS NULL + lastPushAttemptAt > 15min ago —
		//      handler crashed before persisting nextRetryAt; otherwise invisible
		//      to query #2. SQL `lt(NULL, x)` is NULL not true, so this needs
		//      its own clause.
		const oldNextRetryCutoff = new Date(now.getTime() - 5 * 60_000);
		const candidates = await db
			.select({
				id: table.whmcsInvoiceSync.id,
				tenantId: table.whmcsInvoiceSync.tenantId,
				invoiceId: table.whmcsInvoiceSync.invoiceId,
				whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
				keezPushStatus: table.whmcsInvoiceSync.keezPushStatus,
				lastPushAttemptAt: table.whmcsInvoiceSync.lastPushAttemptAt,
				nextRetryAt: table.whmcsInvoiceSync.nextRetryAt
			})
			.from(table.whmcsInvoiceSync)
			.where(
				and(
					isNotNull(table.whmcsInvoiceSync.invoiceId),
					or(
						and(
							eq(table.whmcsInvoiceSync.keezPushStatus, 'in_flight'),
							lt(table.whmcsInvoiceSync.lastPushAttemptAt, stuckCutoff)
						),
						and(
							eq(table.whmcsInvoiceSync.keezPushStatus, 'retrying'),
							lt(table.whmcsInvoiceSync.nextRetryAt, oldNextRetryCutoff)
						),
						and(
							eq(table.whmcsInvoiceSync.keezPushStatus, 'retrying'),
							isNull(table.whmcsInvoiceSync.nextRetryAt),
							lt(table.whmcsInvoiceSync.lastPushAttemptAt, stuckCutoff)
						)
					)
				)
			)
			.limit(MAX_RECONCILES_PER_RUN);

		for (const row of candidates) {
			if (!row.invoiceId) continue;

			// Verify the integration is still active + push opted-in. If admin
			// disabled either, leave the row alone — manual replay only.
			const [integration] = await db
				.select({
					isActive: table.whmcsIntegration.isActive,
					enableKeezPush: table.whmcsIntegration.enableKeezPush
				})
				.from(table.whmcsIntegration)
				.where(eq(table.whmcsIntegration.tenantId, row.tenantId))
				.limit(1);

			if (!integration?.isActive || !integration.enableKeezPush) {
				continue;
			}

			try {
				await db
					.update(table.whmcsInvoiceSync)
					.set({
						keezPushStatus: 'retrying',
						nextRetryAt: null
					})
					.where(eq(table.whmcsInvoiceSync.id, row.id));

				// attempt=1 with delay=0 so the worker picks it up immediately and
				// the jobId hash is fresh (any old hop's id doesn't dedup us).
				await enqueueWhmcsKeezPushRetry(row.tenantId, row.invoiceId, row.whmcsInvoiceId, 0, 1);

				if (row.keezPushStatus === 'in_flight') {
					result.stuckInFlightReset += 1;
				} else {
					result.missingRetryHopRescheduled += 1;
				}

				logInfo('scheduler', `WHMCS reconcile: re-enqueued lost push hop`, {
					tenantId: row.tenantId,
					metadata: {
						invoiceId: row.invoiceId,
						whmcsInvoiceId: row.whmcsInvoiceId,
						originalStatus: row.keezPushStatus,
						stuckSinceMs:
							row.keezPushStatus === 'in_flight'
								? Date.now() - (row.lastPushAttemptAt?.getTime() ?? Date.now())
								: undefined
					}
				});
			} catch (err) {
				const e = serializeError(err);
				logWarning('scheduler', `WHMCS reconcile: failed to re-enqueue: ${e.message}`, {
					tenantId: row.tenantId,
					metadata: { invoiceId: row.invoiceId, whmcsInvoiceId: row.whmcsInvoiceId }
				});
			}
		}

		if (result.stuckInFlightReset + result.missingRetryHopRescheduled > 0) {
			logInfo('scheduler', `WHMCS reconcile complete`, {
				metadata: result
			});
		}

		return result;
	} catch (err) {
		const e = serializeError(err);
		result.success = false;
		result.error = e.message;
		logWarning('scheduler', `WHMCS reconcile crashed: ${e.message}`, {});
		return result;
	}
}
