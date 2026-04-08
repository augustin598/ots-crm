import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { EMAIL_SEND_REGISTRY, clearTenantTransporterCache } from '$lib/server/email';

/**
 * Scheduled task: drain failed email_log rows and replay them via the original send
 * function. Runs every 15 minutes.
 *
 * Eligibility filter:
 *   - status = 'failed'
 *   - attempts < maxAttempts
 *   - payload IS NOT NULL  (no payload = not retriable)
 *   - createdAt > now - 72h (don't try forever — old failures are abandoned)
 *   - past the in-memory exponential backoff window (15min * 2^attempts, cap 4h)
 *
 * Recovery strategy: delete the old failed row first, then call the original send
 * function. The send function (via `sendWithPersistence`) will create a new email_log
 * row tracking the new attempt — failure or success. This matches the existing manual
 * retry pattern in `email-logs.remote.ts` and avoids duplicate-row state management.
 *
 * Per-tenant: clear the cached transporter once per tenant before retrying. This
 * ensures that if the admin just re-saved the SMTP password, we pick up the fresh
 * decryption.
 */
export async function processEmailRetry(): Promise<{
	success: boolean;
	processed: number;
	recovered: number;
}> {
	logInfo('scheduler', 'email_retry starting');

	const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

	let candidates: Array<typeof table.emailLog.$inferSelect>;
	try {
		candidates = await db
			.select()
			.from(table.emailLog)
			.where(
				and(
					eq(table.emailLog.status, 'failed'),
					sql`${table.emailLog.attempts} < ${table.emailLog.maxAttempts}`,
					isNotNull(table.emailLog.payload),
					isNotNull(table.emailLog.tenantId),
					gt(table.emailLog.createdAt, cutoff)
				)
			)
			.limit(50);
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `email_retry select failed: ${message}`, { stackTrace: stack });
		throw error;
	}

	// In-memory backoff filter: nextEligible = updatedAt + 15min * 2^attempts (cap 4h).
	const nowMs = Date.now();
	const eligible = candidates.filter((r) => {
		const backoffMs = Math.min(
			15 * 60 * 1000 * Math.pow(2, r.attempts),
			4 * 60 * 60 * 1000
		);
		return nowMs - new Date(r.updatedAt).getTime() >= backoffMs;
	});

	if (eligible.length === 0) {
		logInfo('scheduler', 'email_retry: no eligible rows', {
			metadata: { totalFailed: candidates.length }
		});
		return { success: true, processed: 0, recovered: 0 };
	}

	// Group by tenantId so we only clear the transporter cache once per tenant.
	const byTenant = new Map<string, typeof eligible>();
	for (const r of eligible) {
		if (!r.tenantId) continue;
		if (!byTenant.has(r.tenantId)) byTenant.set(r.tenantId, []);
		byTenant.get(r.tenantId)!.push(r);
	}

	let processed = 0;
	let recovered = 0;

	for (const [tenantId, rows] of byTenant) {
		// Force fresh decryption — the admin may have just re-saved SMTP password.
		clearTenantTransporterCache(tenantId);

		for (const row of rows) {
			processed++;
			try {
				const parsed = JSON.parse(row.payload!) as { sendFn: string; args: unknown[] };
				const handler = EMAIL_SEND_REGISTRY[parsed.sendFn];
				if (!handler) {
					logWarning('scheduler', `email_retry: unknown sendFn ${parsed.sendFn}`, {
						tenantId,
						metadata: { logId: row.id }
					});
					continue;
				}

				// Delete the old failed row first — sendWithPersistence will create a new one.
				await db.delete(table.emailLog).where(eq(table.emailLog.id, row.id));

				try {
					await handler(...parsed.args);
					recovered++;
				} catch {
					// The new log row (created by sendWithPersistence) already records the failure.
					// Next scheduler pass will see it (with attempts incremented).
				}
			} catch (parseErr) {
				logError('scheduler', `email_retry: malformed payload for ${row.id}`, {
					tenantId,
					stackTrace: serializeError(parseErr).stack
				});
			}
		}
	}

	// Also: garbage-collect rows past the retry budget but older than the cutoff,
	// so they don't accumulate indefinitely as visible failures.
	try {
		await db
			.delete(table.emailLog)
			.where(
				and(
					eq(table.emailLog.status, 'failed'),
					sql`${table.emailLog.attempts} >= ${table.emailLog.maxAttempts}`,
					lt(table.emailLog.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
				)
			);
	} catch {
		// Non-critical
	}

	logInfo('scheduler', `email_retry completed`, {
		metadata: { processed, recovered, tenantsTouched: byTenant.size }
	});

	return { success: true, processed, recovered };
}
