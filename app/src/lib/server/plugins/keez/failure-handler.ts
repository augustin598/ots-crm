import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { serializeError, logInfo, logWarning, logError } from '$lib/server/logger';
import { createNotification } from '$lib/server/notifications';
import { decideFailureAction, MAX_CONSECUTIVE_FAILURES } from './retry-policy';

/**
 * Handle a Keez sync failure for a single tenant:
 *   1. Classify the error
 *   2. Atomically update failure columns on keez_integration
 *   3. Either enqueue a retry job OR create an admin notification and mark degraded
 *
 * Called from the daily cron task and the retry task. Never throws —
 * worst case logs and moves on, so one tenant's bad state can't stall others.
 *
 * `enqueueRetry` is injected to avoid a circular import between this module
 * and the scheduler/tasks folder.
 */
export async function handleKeezSyncFailure(
	tenantId: string,
	error: unknown,
	options: { enqueueRetry: (tenantId: string, delayMs: number) => Promise<void> }
): Promise<void> {
	const { message, stack } = serializeError(error);
	logError('keez', `Sync failure: ${message}`, { tenantId, stackTrace: stack });

	let priorCount = 0;
	try {
		const [row] = await db
			.select({ consecutiveFailures: table.keezIntegration.consecutiveFailures })
			.from(table.keezIntegration)
			.where(eq(table.keezIntegration.tenantId, tenantId))
			.limit(1);
		priorCount = row?.consecutiveFailures ?? 0;
	} catch (readErr) {
		const e = serializeError(readErr);
		logWarning('keez', `Failed to read consecutiveFailures, assuming 0: ${e.message}`, { tenantId });
	}

	const action = decideFailureAction(error, priorCount);
	const newCount = priorCount + 1;

	try {
		await db
			.update(table.keezIntegration)
			.set({
				consecutiveFailures: newCount,
				lastFailureAt: new Date(),
				lastFailureReason: message.substring(0, 500),
				isDegraded: action.kind === 'mark_degraded',
				updatedAt: new Date()
			})
			.where(eq(table.keezIntegration.tenantId, tenantId));
	} catch (writeErr) {
		const e = serializeError(writeErr);
		logWarning('keez', `Failed to persist failure state: ${e.message}`, { tenantId });
		// Don't abort — still try to enqueue retry / notify below.
	}

	if (action.kind === 'schedule_retry') {
		try {
			await options.enqueueRetry(tenantId, action.delayMs);
			logInfo('keez', `Scheduled retry in ${action.delayMs / 60_000} min (failure ${newCount}/${MAX_CONSECUTIVE_FAILURES})`, { tenantId });
			return;
		} catch (queueErr) {
			const e = serializeError(queueErr);
			logError('keez', `Failed to enqueue retry, escalating to degraded: ${e.message}`, { tenantId });
			// Force-degrade: without this, the integration would be a "ghost" —
			// counter incremented, no retry queued, no operator visibility until
			// the next daily cron. Fall through to the notification path below.
			try {
				await db
					.update(table.keezIntegration)
					.set({ isDegraded: true, updatedAt: new Date() })
					.where(eq(table.keezIntegration.tenantId, tenantId));
			} catch (writeErr) {
				const we = serializeError(writeErr);
				logWarning('keez', `Failed to mark degraded after enqueue failure: ${we.message}`, { tenantId });
			}
		}
	}

	// mark_degraded → create admin notification
	await createAdminNotificationsForTenant(tenantId, message).catch(() => {});
}

async function createAdminNotificationsForTenant(tenantId: string, reason: string): Promise<void> {
	const admins = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(
			eq(table.tenantUser.tenantId, tenantId),
			or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
		));

	const [tenantRow] = await db
		.select({ slug: table.tenant.slug })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	for (const admin of admins) {
		await createNotification({
			tenantId,
			userId: admin.userId,
			type: 'keez.sync_error',
			title: 'Eroare sincronizare Keez',
			message: `Sincronizarea facturilor Keez a eșuat: ${reason.substring(0, 100)}`,
			link: tenantRow ? `/${tenantRow.slug}/settings/keez` : undefined,
			priority: 'high'
		}).catch(() => {});
	}
}
