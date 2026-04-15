import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { redis } from 'bun';

const MAX_FAILURES_BEFORE_ALERT = 3;
const REDIS_KEY = 'db-health-check:consecutive-failures';

async function getConsecutiveFailures(): Promise<number> {
	try {
		const val = await redis.get(REDIS_KEY);
		return val ? parseInt(String(val), 10) : 0;
	} catch {
		return 0;
	}
}

async function setConsecutiveFailures(count: number): Promise<void> {
	try {
		await redis.set(REDIS_KEY, String(count));
	} catch {
		// Redis down — fall through, not critical
	}
}

/**
 * Scheduled task: verify Turso DB accepts writes.
 *
 * Inserts a test row into debug_log, then deletes it.
 * If writes fail 3+ times in a row, logs a critical warning.
 * Failure count persists in Redis (survives server restarts).
 */
export async function processDbWriteHealthCheck(): Promise<{
	success: boolean;
	latencyMs: number;
}> {
	const testId = `_health_${encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(10)))}`;
	const start = Date.now();

	try {
		// Test write
		await db.insert(table.debugLog).values({
			id: testId,
			level: 'info',
			source: 'scheduler',
			message: 'DB write health check',
			createdAt: new Date()
		});

		// Clean up
		await db.delete(table.debugLog).where(eq(table.debugLog.id, testId));

		const latencyMs = Date.now() - start;
		const previousFailures = await getConsecutiveFailures();

		if (previousFailures > 0) {
			logInfo('scheduler', `DB write health check recovered after ${previousFailures} failures (${latencyMs}ms)`, { metadata: { previousFailures, latencyMs } });
		}
		await setConsecutiveFailures(0);

		return { success: true, latencyMs };
	} catch (error) {
		const previousFailures = await getConsecutiveFailures();
		const consecutiveFailures = previousFailures + 1;
		await setConsecutiveFailures(consecutiveFailures);

		const latencyMs = Date.now() - start;
		const { message, stack } = serializeError(error);

		if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
			logError('scheduler', `CRITICAL: DB writes failing for ${consecutiveFailures} consecutive checks (${latencyMs}ms). Turso may need a pod restart. Error: ${message}`, {
				stackTrace: stack,
				metadata: { consecutiveFailures, latencyMs }
			});
		} else {
			logWarning('scheduler', `DB write health check failed (${consecutiveFailures}/${MAX_FAILURES_BEFORE_ALERT}): ${message}`, {
				metadata: { consecutiveFailures, latencyMs }
			});
		}

		throw error;
	}
}
