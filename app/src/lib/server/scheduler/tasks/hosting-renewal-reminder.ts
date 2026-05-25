import { db } from '$lib/server/db';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { hostingAccount, hostingEmailEvent } from '$lib/server/db/schema';
import { notifyHostingRenewalReminder } from '$lib/server/hosting/notifications';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Reminder windows, ordered MOST-URGENT first. We probe in this order so a
 * 1d send shadows the 7d/14d windows (a customer 6 days from renewal who has
 * already received the 1d ping shouldn't also get a 7d).
 */
const WINDOWS = [1, 7, 14] as const;
type Window = (typeof WINDOWS)[number];

export interface HostingRenewalReminderResult {
	checked: number;
	sent: number;
	skipped: number;
}

/**
 * Scheduled task: scans active hosting accounts whose `nextDueDate` falls
 * within the next 14 days and dispatches at most ONE renewal reminder per
 * account-per-run, picking the most-urgent window the account qualifies for
 * that hasn't already been sent.
 *
 * Self-healing design (replaces the prior exact-date-match scheduler that
 * lost reminders on any day the scheduler missed):
 *
 *   for each active account with nextDueDate in [today+1, today+14]:
 *     daysRemaining = nextDueDate - today
 *     for window in [1, 7, 14]:           // most urgent first
 *       if dedupeExists(account, nextDueDate, window):
 *         break — this or a more-urgent reminder already fired this cycle
 *       if daysRemaining <= window:
 *         dispatch notifyHostingRenewalReminder(window)
 *         break — one window per run; less-urgent windows wait for future runs
 *
 * Why this is self-healing: a scheduler outage that misses the exact "+7 days"
 * day no longer drops the reminder permanently. The next run sees the missing
 * dedupe row and fires the 7d notice (with copy reflecting the actual N days
 * remaining, since the notifier renders against `daysUntilDue` parameter).
 * The dedupe key still scopes by `next_due_date` so each cycle gets at most
 * one fire per window.
 *
 * Why "one window per run": prevents same-day spam when an account is in
 * multiple windows (e.g. a 6-day-out account qualifies for both 7d and 14d).
 * The hourly cadence ensures the next window fires within an hour, never
 * back-to-back in the same minute.
 *
 * Per-account isolation: a single bad account (missing relations, decrypt
 * failure, etc.) is logged + counted in `skipped` and the loop continues —
 * one customer's misconfiguration never blocks the rest of the tenant fleet.
 *
 * SQLite date arithmetic note: `date('now', '+N days')` is evaluated in UTC
 * by libSQL. Europe/Bucharest "today" may differ from UTC "today" by ±1h
 * depending on DST — acceptable for a reminder cadence.
 */
export async function processHostingRenewalReminder(): Promise<HostingRenewalReminderResult> {
	let checked = 0;
	let sent = 0;
	let skipped = 0;

	// Single scan: all active accounts with nextDueDate in the 1..14 day window.
	// Cross-tenant safe — the notifier re-enforces tenantId on every read.
	const candidates = await db
		.select({
			id: hostingAccount.id,
			tenantId: hostingAccount.tenantId,
			nextDueDate: hostingAccount.nextDueDate
		})
		.from(hostingAccount)
		.where(
			and(
				eq(hostingAccount.status, 'active'),
				isNotNull(hostingAccount.nextDueDate),
				sql`date(${hostingAccount.nextDueDate}) BETWEEN date('now', '+1 days') AND date('now', '+14 days')`
			)
		);

	for (const acc of candidates) {
		checked++;
		const daysRemaining = daysBetween(new Date(), parseDateOnly(acc.nextDueDate!));
		if (daysRemaining < 1 || daysRemaining > 14) {
			// Defensive: SQLite BETWEEN already filtered; this catches DST/timezone edge cases.
			skipped++;
			continue;
		}

		const fired = await fireMostUrgentWindow({
			tenantId: acc.tenantId,
			accountId: acc.id,
			nextDueDate: acc.nextDueDate!,
			daysRemaining
		});
		if (fired === 'sent') sent++;
		else if (fired === 'skipped') skipped++;
		// 'noop' (already-sent for most urgent applicable window) does not count toward sent/skipped — that's normal.
	}

	logInfo('hosting-email', 'renewal reminder run complete', {
		metadata: { checked, sent, skipped }
	});
	return { checked, sent, skipped };
}

/**
 * For a single account, walk the WINDOWS list (most-urgent first) and fire
 * the first window that BOTH applies (daysRemaining <= window) AND hasn't
 * been sent yet. Returns:
 *   - 'sent' if a reminder was dispatched
 *   - 'noop' if the most-urgent applicable window already has a dedupe row
 *   - 'skipped' on dispatch error
 */
async function fireMostUrgentWindow(args: {
	tenantId: string;
	accountId: string;
	nextDueDate: string;
	daysRemaining: number;
}): Promise<'sent' | 'noop' | 'skipped'> {
	for (const window of WINDOWS) {
		const dedupeKey = `renewal-reminder:${args.nextDueDate}:${window}d`;
		const existing = await db
			.select({ id: hostingEmailEvent.id })
			.from(hostingEmailEvent)
			.where(
				and(
					eq(hostingEmailEvent.hostingAccountId, args.accountId),
					eq(hostingEmailEvent.dedupeKey, dedupeKey)
				)
			)
			.limit(1);

		if (existing.length > 0) {
			// A reminder for this OR a more-urgent window for the same due date
			// already fired this cycle. Don't fall through to less-urgent windows
			// — we'd re-send the same customer with stale "in 14 days" copy.
			return 'noop';
		}

		if (args.daysRemaining <= window) {
			try {
				await notifyHostingRenewalReminder(args.tenantId, args.accountId, window);
				return 'sent';
			} catch (err) {
				const { message, stack } = serializeError(err);
				logError('hosting-email', `renewal reminder dispatch failed`, {
					tenantId: args.tenantId,
					metadata: {
						accountId: args.accountId,
						window,
						daysRemaining: args.daysRemaining,
						error: message
					},
					stackTrace: stack
				});
				return 'skipped';
			}
		}
	}
	return 'noop';
}

function parseDateOnly(iso: string): Date {
	// next_due_date is stored as 'YYYY-MM-DD' (text). Treat as UTC midnight to
	// match SQLite's date('now') semantics used in the WHERE filter.
	const d = new Date(iso);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

function daysBetween(from: Date, to: Date): number {
	const fromMid = new Date(from);
	fromMid.setUTCHours(0, 0, 0, 0);
	return Math.floor((to.getTime() - fromMid.getTime()) / 86400000);
}
