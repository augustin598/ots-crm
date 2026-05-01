// Daily reaper that:
// 1. Reverts claimed-but-stale tasks (>1h) back to pending so they can be retried.
// 2. Expires pending tasks whose expiresAt has passed (7-day window).

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { sendTelegramMessage } from '$lib/server/telegram/sender';

const CLAIM_STALE_MS = 60 * 60 * 1000; // 1 hour
const STUCK_ALERT_THRESHOLD = 5;

async function notifyAdmins(tenantId: string, text: string): Promise<void> {
	const recipients = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenantId));

	for (const r of recipients) {
		try {
			await sendTelegramMessage({ tenantId, userId: r.userId, text });
		} catch (e) {
			logWarning('scheduler', `[task-reaper] Telegram alert failed for user ${r.userId}: ${serializeError(e).message}`);
		}
	}
}

export async function processAdsOptimizationTaskReaper(): Promise<{
	reverted: number;
	expired: number;
}> {
	logInfo('scheduler', 'ads-optimization-task-reaper: starting');

	const cutoff = new Date(Date.now() - CLAIM_STALE_MS);
	const now = new Date();

	// 1. Revert stale claimed tasks back to pending
	let reverted = 0;
	try {
		const result = await db
			.update(table.adsOptimizationTask)
			.set({ status: 'pending', claimedAt: null, claimedBy: null })
			.where(
				and(
					eq(table.adsOptimizationTask.status, 'claimed'),
					lt(table.adsOptimizationTask.claimedAt, cutoff)
				)
			)
			.returning({ id: table.adsOptimizationTask.id, tenantId: table.adsOptimizationTask.tenantId });

		reverted = result.length;

		if (reverted > 0) {
			logWarning('scheduler', `[task-reaper] Reverted ${reverted} stuck tasks back to pending`);

			if (reverted >= STUCK_ALERT_THRESHOLD) {
				// Group by tenant to send targeted alerts
				const byTenant = new Map<string, number>();
				for (const r of result) {
					byTenant.set(r.tenantId, (byTenant.get(r.tenantId) ?? 0) + 1);
				}
				for (const [tenantId, count] of byTenant) {
					await notifyAdmins(
						tenantId,
						`⚠️ ads-optimization-task-reaper: ${count} tasks were stuck in 'claimed' for >1h and reverted to pending. Possible PersonalOPS worker issue.`
					);
				}
			}
		}
	} catch (e) {
		logError('scheduler', `[task-reaper] Failed to revert stale tasks: ${serializeError(e).message}`);
	}

	// 2. Expire pending tasks past their 7-day window
	let expired = 0;
	try {
		const result = await db
			.update(table.adsOptimizationTask)
			.set({ status: 'expired' })
			.where(
				and(
					eq(table.adsOptimizationTask.status, 'pending'),
					lt(table.adsOptimizationTask.expiresAt, now)
				)
			)
			.returning({ id: table.adsOptimizationTask.id });

		expired = result.length;

		if (expired > 0) {
			logWarning('scheduler', `[task-reaper] Expired ${expired} pending tasks past 7d window`);
		}
	} catch (e) {
		logError('scheduler', `[task-reaper] Failed to expire stale tasks: ${serializeError(e).message}`);
	}

	logInfo('scheduler', 'ads-optimization-task-reaper: done', {
		metadata: { reverted, expired }
	});

	return { reverted, expired };
}
