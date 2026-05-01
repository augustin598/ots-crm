// Daily job that creates one adsOptimizationTask row per active, non-muted
// ad_monitor_target. Runs at 00:15 Europe/Bucharest so tasks are ready before
// PersonalOPS polls in the morning. INSERT uses ON CONFLICT DO NOTHING so
// re-runs are safe (idempotent per unique(tenant,target,day)).

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, count, eq, gte, lt } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { sendTelegramMessage } from '$lib/server/telegram/sender';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

async function processCreatorForTenant(
	tenantId: string,
	scheduledFor: Date,
	expiresAt: Date
): Promise<{ created: number; skipped: number }> {
	const targets = await db
		.select()
		.from(table.adMonitorTarget)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, tenantId),
				eq(table.adMonitorTarget.isActive, true),
				eq(table.adMonitorTarget.isMuted, false)
			)
		);

	if (targets.length === 0) {
		return { created: 0, skipped: 0 };
	}

	let created = 0;
	for (const target of targets) {
		const result = await db
			.insert(table.adsOptimizationTask)
			.values({
				id: generateId(),
				tenantId: target.tenantId,
				targetId: target.id,
				externalCampaignId: target.externalCampaignId,
				clientId: target.clientId,
				type: 'analyze_for_suggestions',
				status: 'pending',
				scheduledFor,
				expiresAt
			})
			.onConflictDoNothing();
		const inserted = (result as { rowsAffected?: number })?.rowsAffected ?? 0;
		if (inserted > 0) created++;
	}
	const skipped = targets.length - created;

	// Negative monitoring — fail-loud if zero tasks were created despite active targets
	const nextDay = new Date(scheduledFor.getTime() + 24 * 3600 * 1000);
	const [row] = await db
		.select({ count: count() })
		.from(table.adsOptimizationTask)
		.where(
			and(
				eq(table.adsOptimizationTask.tenantId, tenantId),
				gte(table.adsOptimizationTask.scheduledFor, scheduledFor),
				lt(table.adsOptimizationTask.scheduledFor, nextDay)
			)
		);

	const todayCount = row?.count ?? 0;
	if (targets.length > 0 && todayCount === 0) {
		const alertText = `⚠️ ads-optimization-task-creator: 0 tasks exist for today with ${targets.length} active targets. Check job health.`;
		logError('scheduler', `[task-creator] CRITICAL: tenant=${tenantId} expected=${targets.length} today=0`);

		// Resolve admin user IDs for Telegram
		const recipients = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(eq(table.tenantUser.tenantId, tenantId));

		for (const r of recipients) {
			try {
				await sendTelegramMessage({ tenantId, userId: r.userId, text: alertText });
			} catch (e) {
				logWarning('scheduler', `[task-creator] Telegram alert failed for user ${r.userId}: ${serializeError(e).message}`);
			}
		}
	}

	return { created, skipped };
}

export async function processAdsOptimizationTaskCreator(
	params: { tenantId?: string } = {}
): Promise<{ tenantsProcessed: number; totalCreated: number; totalSkipped: number }> {
	logInfo('scheduler', 'ads-optimization-task-creator: starting');

	const now = new Date();
	// Normalise to start-of-day UTC — matches the unique index on scheduledFor
	const scheduledFor = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
	);
	const expiresAt = new Date(scheduledFor.getTime() + 7 * 24 * 3600 * 1000);

	let tenantIds: string[];
	if (params.tenantId) {
		tenantIds = [params.tenantId];
	} else {
		const rows = await db
			.selectDistinct({ tenantId: table.adMonitorTarget.tenantId })
			.from(table.adMonitorTarget)
			.where(eq(table.adMonitorTarget.isActive, true));
		tenantIds = rows.map((r) => r.tenantId);
	}

	let totalCreated = 0;
	let totalSkipped = 0;

	for (const tenantId of tenantIds) {
		try {
			const { created, skipped } = await processCreatorForTenant(tenantId, scheduledFor, expiresAt);
			totalCreated += created;
			totalSkipped += skipped;
			logInfo('scheduler', `[task-creator] tenant=${tenantId} created=${created} skipped=${skipped} (existing)`);
		} catch (e) {
			logError('scheduler', `[task-creator] tenant=${tenantId} failed: ${serializeError(e).message}`);
		}
	}

	logInfo('scheduler', 'ads-optimization-task-creator: done', {
		metadata: { tenantsProcessed: tenantIds.length, totalCreated, totalSkipped }
	});

	return { tenantsProcessed: tenantIds.length, totalCreated, totalSkipped };
}
