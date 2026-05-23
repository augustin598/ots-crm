import { db } from '$lib/server/db';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { hostingAccount } from '$lib/server/db/schema';
import { notifyHostingRenewalReminder } from '$lib/server/hosting/notifications';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Three reminder windows fired per renewal cycle. Each (account, dueDate, window)
 * pair is dedupe-guarded inside the notifier, so this task is safe to run hourly.
 */
const WINDOWS = [14, 7, 1] as const;

export interface HostingRenewalReminderResult {
	checked: number;
	sent: number;
	skipped: number;
}

/**
 * Scheduled task: scans active hosting accounts whose `nextDueDate` falls on
 * today + N days for each of the three reminder windows (14 / 7 / 1) and
 * dispatches the customer renewal reminder for each match.
 *
 * Self-healing per-account: a single bad account (missing relations, decrypt
 * failure, etc.) is logged + counted in `skipped` and the loop continues —
 * one customer's misconfiguration never blocks the rest of the tenant fleet.
 *
 * Dedupe / replay safety: notifyHostingRenewalReminder enforces the unique
 * (tenantId, hostingAccountId, dedupeKey) index, so this task can fire hourly
 * (08-20 RO) without duplicating sends. The hourly cadence is intentional —
 * it tolerates Redis hiccups, daylight savings rollovers, and brief worker
 * outages while still landing in the customer's inbox during business hours.
 *
 * SQLite date arithmetic note: `date('now', '+N days')` is evaluated in UTC
 * by libSQL. Europe/Bucharest "today" may differ from UTC "today" by ±1h
 * depending on DST — acceptable for a reminder cadence (a customer might see
 * the 14d reminder land at 22:00 RO on day-15 instead of 08:00 on day-14, but
 * the dedupe key still scopes by `next_due_date` so they only see one fire
 * per window per cycle).
 */
export async function processHostingRenewalReminder(): Promise<HostingRenewalReminderResult> {
	let checked = 0;
	let sent = 0;
	let skipped = 0;

	for (const days of WINDOWS) {
		// Tenant-scoped DB read is enforced by the notifier itself. Here we scan
		// across ALL active tenants — the notifier's WHERE-clause (eq(hostingAccount.tenantId, tenantId))
		// keeps each dispatch tenant-bounded. We DO pull tenantId from each row
		// so the notifier never has to infer it.
		const candidates = await db
			.select({
				id: hostingAccount.id,
				tenantId: hostingAccount.tenantId
			})
			.from(hostingAccount)
			.where(
				and(
					eq(hostingAccount.status, 'active'),
					isNotNull(hostingAccount.nextDueDate),
					sql`date(${hostingAccount.nextDueDate}) = date('now', ${`+${days} days`})`
				)
			);

		for (const acc of candidates) {
			checked++;
			try {
				await notifyHostingRenewalReminder(acc.tenantId, acc.id, days as 1 | 7 | 14);
				sent++;
			} catch (err) {
				const { message, stack } = serializeError(err);
				logError('hosting-email', `renewal reminder dispatch failed`, {
					tenantId: acc.tenantId,
					metadata: { accountId: acc.id, days, error: message },
					stackTrace: stack
				});
				skipped++;
			}
		}
	}

	logInfo('hosting-email', 'renewal reminder run complete', {
		metadata: { checked, sent, skipped }
	});
	return { checked, sent, skipped };
}
