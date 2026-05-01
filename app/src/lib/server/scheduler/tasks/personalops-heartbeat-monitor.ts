import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt, ne } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { sendTelegramMessage } from '$lib/server/telegram/sender';

const SILENT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const STALE_CLAIM_THRESHOLD_MS = 30 * 60 * 1000; // tasks claimed by a silent instance

async function notifyAdmins(tenantId: string, text: string): Promise<void> {
	const recipients = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenantId));

	for (const r of recipients) {
		try {
			await sendTelegramMessage({ tenantId, userId: r.userId, text });
		} catch (e) {
			logWarning(
				'scheduler',
				`[heartbeat-monitor] Telegram alert failed for user ${r.userId}: ${serializeError(e).message}`
			);
		}
	}
}

export async function processPersonalopsHeartbeatMonitor(): Promise<{
	checked: number;
	silentFound: number;
}> {
	logInfo('scheduler', 'personalops-heartbeat-monitor: starting');

	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const threshold = new Date(Date.now() - SILENT_THRESHOLD_MS);

	const candidates = await db
		.select()
		.from(table.personalopsInstance)
		.where(
			and(
				lt(table.personalopsInstance.lastHeartbeatAt, threshold),
				ne(table.personalopsInstance.version, 'test')
			)
		);

	// Also filter out instances whose instanceId is not a valid UUID (test/legacy rows)
	const silentInstances = candidates.filter((r) => UUID_REGEX.test(r.instanceId));

	let silentFound = 0;

	for (const instance of silentInstances) {
		silentFound++;
		const minutesSilent = Math.round(
			(Date.now() - instance.lastHeartbeatAt.getTime()) / 60_000
		);

		logWarning(
			'scheduler',
			`[heartbeat-monitor] Instance ${instance.instanceId} silent for ${minutesSilent}min`,
			{ tenantId: instance.tenantId, metadata: { instanceId: instance.instanceId, minutesSilent } }
		);

		try {
			await notifyAdmins(
				instance.tenantId,
				`⚠️ PersonalOPS instance ${instance.instanceId} silent for ${minutesSilent}min — verifică worker-ul`
			);
		} catch (e) {
			logError(
				'scheduler',
				`[heartbeat-monitor] notify failed for ${instance.instanceId}: ${serializeError(e).message}`
			);
		}

		// Flag tasks claimed by this silent instance so the reaper can handle them
		try {
			const staleClaimThreshold = new Date(Date.now() - STALE_CLAIM_THRESHOLD_MS);
			const staleClaimed = await db
				.select({ id: table.adsOptimizationTask.id })
				.from(table.adsOptimizationTask)
				.where(
					and(
						eq(table.adsOptimizationTask.tenantId, instance.tenantId),
						eq(table.adsOptimizationTask.status, 'claimed'),
						eq(table.adsOptimizationTask.claimedByInstanceId, instance.instanceId),
						lt(table.adsOptimizationTask.claimedAt, staleClaimThreshold)
					)
				);

			if (staleClaimed.length > 0) {
				logWarning(
					'scheduler',
					`[heartbeat-monitor] ${staleClaimed.length} task(s) claimed by silent instance ${instance.instanceId} — flagging for reaper`,
					{ tenantId: instance.tenantId, metadata: { taskIds: staleClaimed.map((t) => t.id) } }
				);
				await notifyAdmins(
					instance.tenantId,
					`🚨 ${staleClaimed.length} task(s) claimed by silent instance ${instance.instanceId} — reaper will reclaim them`
				);
			}
		} catch (e) {
			logError(
				'scheduler',
				`[heartbeat-monitor] stale claim check failed: ${serializeError(e).message}`
			);
		}
	}

	logInfo('scheduler', 'personalops-heartbeat-monitor: done', {
		metadata: { checked: silentInstances.length + (silentInstances.length === 0 ? 0 : 0), silentFound }
	});

	return { checked: silentInstances.length, silentFound };
}
