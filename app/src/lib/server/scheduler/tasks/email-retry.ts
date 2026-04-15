import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { EMAIL_SEND_REGISTRY, clearTenantTransporterCache } from '$lib/server/email';

/**
 * Scheduled task: drain failed email_log rows and replay them via the original send
 * function. Runs every 15 minutes.
 *
 * Eligibility filter:
 *   - status = 'failed' (not 'retrying' — those are in-flight)
 *   - attempts < maxAttempts
 *   - payload IS NOT NULL  (no payload = not retriable)
 *   - createdAt > now - 72h (don't try forever — old failures are abandoned)
 *   - past the in-memory exponential backoff window (15min * 2^attempts, cap 4h)
 *
 * Recovery strategy (crash-safe):
 *   1. Mark row as status='retrying' + increment attempts (persisted BEFORE handler call)
 *   2. Call the original send function via EMAIL_SEND_REGISTRY
 *   3. On success: delete old row (sendWithPersistence created a new success row)
 *   4. On failure: mark row back to status='failed' (new attempt count persisted)
 *
 * On startup: any rows left with status='retrying' (from a crash) are reset to 'failed'
 * so they re-enter the retry pool. See recoverInterruptedRetries().
 */

const PER_TENANT_RETRY_LIMIT = 10;

/** SMTP permanent rejection — do NOT retry these */
function isPermanentError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return /\b(550|551|552|553|554)\b/.test(msg)
		|| /mailbox.*not found/i.test(msg)
		|| /user.*unknown/i.test(msg)
		|| /address.*rejected/i.test(msg)
		|| /hard.?bounce/i.test(msg)
		|| /account.*disabled/i.test(msg);
}

/**
 * Called on startup to recover rows stuck in 'retrying' state from a crash.
 */
export async function recoverInterruptedRetries(): Promise<void> {
	try {
		const stuck = await db
			.select({ id: table.emailLog.id })
			.from(table.emailLog)
			.where(eq(table.emailLog.status, 'retrying'));

		if (stuck.length > 0) {
			await db
				.update(table.emailLog)
				.set({ status: 'failed', updatedAt: new Date() })
				.where(eq(table.emailLog.status, 'retrying'));
			logWarning('scheduler', `Recovered ${stuck.length} email(s) stuck in 'retrying' state after restart`);
		}
	} catch (e) {
		const { message } = serializeError(e);
		logWarning('scheduler', `Failed to recover interrupted email retries: ${message}`);
	}
}

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

		// Per-tenant cap to prevent one tenant from monopolizing retry budget
		const capped = rows.slice(0, PER_TENANT_RETRY_LIMIT);

		for (const row of capped) {
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

				// STEP 1: Mark as 'retrying' + increment attempts BEFORE calling handler (crash-safe)
				await db
					.update(table.emailLog)
					.set({
						status: 'retrying',
						attempts: row.attempts + 1,
						updatedAt: new Date()
					})
					.where(eq(table.emailLog.id, row.id));

				try {
					// STEP 2: Call the original send function
					await handler(...parsed.args);
					// STEP 3: Success — delete old row (sendWithPersistence created a new success row)
					await db.delete(table.emailLog).where(eq(table.emailLog.id, row.id));
					recovered++;
				} catch (sendErr) {
					// STEP 4: Classify error and decide retry strategy
					if (isPermanentError(sendErr)) {
						// Permanent SMTP rejection — stop retrying immediately
						await db
							.update(table.emailLog)
							.set({
								status: 'failed',
								attempts: row.maxAttempts, // exhaust attempts
								errorMessage: sendErr instanceof Error ? sendErr.message : String(sendErr),
								updatedAt: new Date()
							})
							.where(eq(table.emailLog.id, row.id));
						logWarning('scheduler', `email_retry: permanent error for ${row.toEmail}, stopping retries`, {
							tenantId,
							metadata: { logId: row.id, error: sendErr instanceof Error ? sendErr.message : String(sendErr) }
						});
					} else {
						// Transient error — mark back as 'failed' for next retry pass
						await db
							.update(table.emailLog)
							.set({ status: 'failed', updatedAt: new Date() })
							.where(eq(table.emailLog.id, row.id));
					}
				}
			} catch (parseErr) {
				logError('scheduler', `email_retry: malformed payload for ${row.id}`, {
					tenantId,
					stackTrace: serializeError(parseErr).stack
				});
			}
		}
	}

	// Garbage-collect exhausted failures older than 30 days (with LIMIT to avoid blocking Turso)
	try {
		const idsToDelete = await db
			.select({ id: table.emailLog.id })
			.from(table.emailLog)
			.where(
				and(
					eq(table.emailLog.status, 'failed'),
					sql`${table.emailLog.attempts} >= ${table.emailLog.maxAttempts}`,
					lt(table.emailLog.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
				)
			)
			.limit(100);

		if (idsToDelete.length > 0) {
			await db
				.delete(table.emailLog)
				.where(inArray(table.emailLog.id, idsToDelete.map((r) => r.id)));
		}
	} catch {
		// Non-critical
	}

	logInfo('scheduler', `email_retry completed`, {
		metadata: { processed, recovered, tenantsTouched: byTenant.size }
	});

	return { success: true, processed, recovered };
}
