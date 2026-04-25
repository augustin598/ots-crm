/**
 * Per-invoice failure handler for the WHMCS → Keez auto-push chain.
 *
 * Counterpart to plugins/keez/failure-handler.ts but operates at *invoice*
 * granularity (one row in whmcs_invoice_sync) instead of *tenant* granularity
 * (one row in keez_integration). Each WHMCS invoice has its own retry budget;
 * a transient blip on one doesn't taint the others.
 *
 * Integration-level circuit-breaker still lives on whmcs_integration —
 * incremented on every push failure so admins see "many invoices failing"
 * without inspecting each row.
 *
 * Never throws — worst case logs and returns `{ scheduled: false }` so a
 * malformed invoice can't stall the rest of a webhook batch.
 */
import { and, eq, sql } from 'drizzle-orm';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';

import { decidePushAction, humanizePushDelay } from './retry-policy';
import { classifyWhmcsPushError } from './error-classification';

export interface WhmcsPushFailureOutcome {
	/** True if a retry job was enqueued. */
	scheduled: boolean;
	/** Wall-clock time at which the next retry will run, or null if marked FAILED. */
	retryAt: Date | null;
	/** Attempt count after this failure. */
	attempt: number;
	/** Either 'transient' or 'permanent' — surfaces to admin UI tooltips. */
	classification: 'transient' | 'permanent';
}

export async function handleWhmcsKeezPushFailure(
	tenantId: string,
	invoiceId: string,
	whmcsInvoiceId: number,
	error: unknown,
	options: {
		correlationId?: string;
		enqueueRetry: (
			tenantId: string,
			invoiceId: string,
			whmcsInvoiceId: number,
			delayMs: number,
			attempt: number
		) => Promise<void>;
	}
): Promise<WhmcsPushFailureOutcome> {
	const { message, stack } = serializeError(error);
	const classification = classifyWhmcsPushError(error);

	logError('whmcs', `Auto-push to Keez failed: ${message}`, {
		tenantId,
		stackTrace: stack,
		metadata: {
			invoiceId,
			whmcsInvoiceId,
			classification,
			correlationId: options.correlationId
		}
	});

	// Read current attempt count from the sync row.
	let priorAttempts = 0;
	try {
		const [row] = await db
			.select({ retryCount: table.whmcsInvoiceSync.retryCount })
			.from(table.whmcsInvoiceSync)
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.whmcsInvoiceId, whmcsInvoiceId)
				)
			)
			.limit(1);
		priorAttempts = row?.retryCount ?? 0;
	} catch (readErr) {
		const e = serializeError(readErr);
		logWarning('whmcs', `Failed to read retryCount, assuming 0: ${e.message}`, {
			tenantId,
			metadata: { invoiceId, whmcsInvoiceId }
		});
	}

	const action = decidePushAction(error, priorAttempts);
	const newAttempt = priorAttempts + 1;
	const now = new Date();

	if (action.kind === 'schedule_retry') {
		try {
			await options.enqueueRetry(
				tenantId,
				invoiceId,
				whmcsInvoiceId,
				action.delayMs,
				newAttempt
			);
			const retryAt = new Date(Date.now() + action.delayMs);
			await persistSyncRowFailure(tenantId, whmcsInvoiceId, {
				retryCount: newAttempt,
				lastErrorClass: 'TRANSIENT',
				lastErrorMessage: message.substring(0, 500),
				nextRetryAt: retryAt,
				lastPushAttemptAt: now,
				keezPushStatus: 'retrying'
			});
			logInfo(
				'whmcs',
				`Scheduled push retry in ${humanizePushDelay(action.delayMs)} (attempt ${newAttempt})`,
				{ tenantId, metadata: { invoiceId, whmcsInvoiceId } }
			);
			return { scheduled: true, retryAt, attempt: newAttempt, classification };
		} catch (queueErr) {
			const e = serializeError(queueErr);
			logError(
				'whmcs',
				`Failed to enqueue push retry, escalating to FAILED: ${e.message}`,
				{ tenantId, metadata: { invoiceId, whmcsInvoiceId } }
			);
			// Fall through to mark_failed — without this we'd ghost (counter
			// incremented, no retry queued, no operator visibility).
		}
	}

	// mark_failed (or queue failure) → freeze in admin UI for manual replay.
	await persistSyncRowFailure(tenantId, whmcsInvoiceId, {
		retryCount: newAttempt,
		lastErrorClass: classification === 'permanent' ? 'PERMANENT' : 'TRANSIENT',
		lastErrorMessage: message.substring(0, 500),
		nextRetryAt: null,
		lastPushAttemptAt: now,
		keezPushStatus: 'failed'
	});

	// Only on terminal failure do we bump the integration-level counter so the
	// degraded badge reflects sustained problems. Transient retries that succeed
	// later don't need to scare the admin.
	try {
		await db
			.update(table.whmcsIntegration)
			.set({
				consecutiveFailures: sql`${table.whmcsIntegration.consecutiveFailures} + 1`,
				lastFailureReason: message.substring(0, 500),
				updatedAt: now
			})
			.where(eq(table.whmcsIntegration.tenantId, tenantId));
	} catch (writeErr) {
		const e = serializeError(writeErr);
		logWarning('whmcs', `Failed to bump integration consecutiveFailures: ${e.message}`, {
			tenantId
		});
	}

	logWarning(
		'whmcs',
		classification === 'permanent'
			? `Permanent push failure — admin replay required`
			: `Push retry budget exhausted — admin replay required`,
		{ tenantId, metadata: { invoiceId, whmcsInvoiceId, attempt: newAttempt } }
	);

	return { scheduled: false, retryAt: null, attempt: newAttempt, classification };
}

interface SyncRowFailureUpdate {
	retryCount: number;
	lastErrorClass: 'TRANSIENT' | 'PERMANENT';
	lastErrorMessage: string;
	nextRetryAt: Date | null;
	lastPushAttemptAt: Date;
	keezPushStatus: 'retrying' | 'failed';
}

async function persistSyncRowFailure(
	tenantId: string,
	whmcsInvoiceId: number,
	patch: SyncRowFailureUpdate
): Promise<void> {
	try {
		await db
			.update(table.whmcsInvoiceSync)
			.set({
				retryCount: patch.retryCount,
				lastErrorClass: patch.lastErrorClass,
				lastErrorMessage: patch.lastErrorMessage,
				nextRetryAt: patch.nextRetryAt,
				lastPushAttemptAt: patch.lastPushAttemptAt,
				keezPushStatus: patch.keezPushStatus,
				processedAt: patch.lastPushAttemptAt
			})
			.where(
				and(
					eq(table.whmcsInvoiceSync.tenantId, tenantId),
					eq(table.whmcsInvoiceSync.whmcsInvoiceId, whmcsInvoiceId)
				)
			);
	} catch (err) {
		const e = serializeError(err);
		logWarning('whmcs', `Failed to persist sync-row failure state: ${e.message}`, {
			tenantId,
			metadata: { whmcsInvoiceId }
		});
	}
}

/**
 * Reset the integration-level failure counter on a successful push.
 * Called by the retry task after a clean run, and by the inline trigger.
 */
export async function resetWhmcsConsecutiveFailures(tenantId: string): Promise<void> {
	try {
		await db
			.update(table.whmcsIntegration)
			.set({
				consecutiveFailures: 0,
				lastSuccessfulSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.whmcsIntegration.tenantId, tenantId));
	} catch (err) {
		// Non-fatal — counter will eventually drift but doesn't affect functional
		// correctness; logged at warn so the noise is contained.
		const e = serializeError(err);
		logWarning('whmcs', `Failed to reset consecutiveFailures: ${e.message}`, { tenantId });
	}
}
