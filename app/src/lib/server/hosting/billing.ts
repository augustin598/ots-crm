/**
 * Hosting billing helpers.
 *
 * - `advanceNextDueDate`: move a hosting account's `next_due_date` forward by ONE
 *   billing cycle when a renewal is paid. Never throws (a bad cycle just returns
 *   null so the caller leaves the date untouched — must not break payment processing).
 * - `isInvoiceEffectivelyPaid`: robust "paid" check spanning BOTH the CRM signal
 *   (status='paid' or a manually-set paidDate) AND the Keez signal (remainingAmount
 *   synced to 0). Keez can lag behind a manual CRM mark and vice-versa, so EITHER
 *   source being "paid" must suppress auto-suspension.
 */

// Number of months each renewing billing cycle advances. Cycles not listed here
// (e.g. 'one_time') do not renew → next_due_date is left untouched.
const CYCLE_MONTHS: Record<string, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36
};

function isoDateUTC(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Advance a 'YYYY-MM-DD' date string by one billing cycle, preserving the
 * anniversary day (clamped to month end). Returns the new 'YYYY-MM-DD' string,
 * or null when there is nothing to advance:
 *   - `current` is null/unparseable
 *   - cycle is 'one_time' or unknown (no renewal)
 *   - cycle is 'daily'/'weekly' (handled explicitly)
 */
export function advanceNextDueDate(
	current: string | null | undefined,
	billingCycle: string | null | undefined
): string | null {
	if (!current) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(current);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]) - 1;
	const d = Number(m[3]);
	const cycle = (billingCycle ?? 'monthly').toLowerCase();

	if (cycle === 'daily') return isoDateUTC(new Date(Date.UTC(y, mo, d + 1)));
	if (cycle === 'weekly') return isoDateUTC(new Date(Date.UTC(y, mo, d + 7)));

	const months = CYCLE_MONTHS[cycle];
	if (!months) return null; // one_time / unknown → no renewal

	// Move N months forward; clamp the day to the target month's last day
	// (e.g. Jan 31 + 1mo → Feb 28/29).
	const target = new Date(Date.UTC(y, mo + months, 1));
	const lastDay = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(d, lastDay));
	return isoDateUTC(target);
}

/**
 * True if the invoice should be considered paid for suspension purposes.
 * ANY of: CRM status paid/partially_paid, a manually-set paidDate, or Keez
 * having synced remainingAmount to 0. Used as a hard guard so a paying customer
 * is never auto-suspended even when one of the two systems lags.
 */
export function isInvoiceEffectivelyPaid(inv: {
	status?: string | null;
	paidDate?: Date | string | null;
	remainingAmount?: number | null;
}): boolean {
	if (inv.status === 'paid' || inv.status === 'partially_paid') return true;
	if (inv.paidDate != null) return true;
	if (inv.remainingAmount === 0) return true;
	return false;
}
