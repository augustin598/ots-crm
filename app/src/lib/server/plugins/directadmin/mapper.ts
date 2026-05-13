// WHMCS → DA hosting product/service/domain mapping helpers.

/**
 * Map WHMCS `tblhosting.domainstatus` ENUM to internal hostingAccount.status.
 * Real ENUM values (per WHMCS 8.x schema): Pending | Active | Suspended | Terminated | Cancelled | Fraud | Completed.
 * `Completed` is a WHMCS state used when a one-off service finished its lifecycle (no recurring) — treat as terminated.
 * `Fraud` means the order was flagged — treat as cancelled (the user shouldn't have an active hosting account).
 */
export function mapWHMCSStatus(
	whmcsStatus: string
): 'pending' | 'active' | 'suspended' | 'terminated' | 'cancelled' {
	const s = (whmcsStatus ?? '').toLowerCase().trim();
	switch (s) {
		case 'active':
			return 'active';
		case 'suspended':
			return 'suspended';
		case 'terminated':
		case 'completed':
			return 'terminated';
		case 'cancelled':
		case 'canceled':
		case 'fraud':
			return 'cancelled';
		case 'pending':
			return 'pending';
		default:
			return 'pending';
	}
}

/**
 * Map WHMCS `tblhosting.billingcycle` / `tblpricing.*` to internal billing cycle.
 * Distinct values for `semiannually` (6 months) and `biennially` (2 years) — previously
 * conflated as `biannually` which corrupted MRR math.
 *
 * WHMCS uses these literal strings (PascalCase): Monthly, Quarterly, Semiannually, Annually,
 * Biennially, Triennially. Plus 'Free Account' and 'One Time' for non-recurring.
 */
export type BillingCycle =
	| 'monthly'
	| 'quarterly'
	| 'semiannually'
	| 'annually'
	| 'biennially'
	| 'triennially'
	| 'one_time';

export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36,
	one_time: 0 // not recurring — excluded from MRR/ARR math
};

export function mapWHMCSBillingCycle(whmcsCycle: string): BillingCycle {
	const c = (whmcsCycle ?? '').toLowerCase().trim();
	if (c.startsWith('month')) return 'monthly';
	if (c.startsWith('quarter')) return 'quarterly';
	if (c.startsWith('semi')) return 'semiannually';
	// Order matters: 'bienn' must be checked before 'annu' since 'biennially' contains neither
	// but generally checking the more specific prefix first is safer.
	if (c.startsWith('bienn')) return 'biennially';
	if (c.startsWith('trienn') || c.startsWith('threey')) return 'triennially';
	if (c.startsWith('annu') || c.startsWith('year')) return 'annually';
	// WHMCS uses 'Free Account', 'Free', 'One Time', 'OneTime' for non-recurring services
	if (
		c.includes('onetime') ||
		c.includes('one time') ||
		c.startsWith('one_time') ||
		c.startsWith('free')
	)
		return 'one_time';
	return 'monthly';
}

/**
 * Map WHMCS `tbldomains.status` ENUM to internal registeredDomain.status.
 * Real ENUM values (per WHMCS 8.x schema):
 *   Pending | Pending Registration | Pending Transfer | Active | Grace | Redemption | Expired | Cancelled | Fraud | Transferred Away
 * Grace/Redemption mean the domain expired but is still recoverable — surface as `expired` so the user sees urgency.
 * Fraud / Transferred Away → cancelled (we no longer manage the domain).
 */
export function mapWHMCSDomainStatus(
	whmcsStatus: string
): 'active' | 'expired' | 'cancelled' | 'pending-transfer' {
	const s = (whmcsStatus ?? '').toLowerCase().trim();
	switch (s) {
		case 'active':
			return 'active';
		case 'expired':
		case 'grace':
		case 'redemption':
			return 'expired';
		case 'cancelled':
		case 'canceled':
		case 'fraud':
		case 'transferred away':
			return 'cancelled';
		case 'pending':
		case 'pending registration':
		case 'pending transfer':
			return 'pending-transfer';
		default:
			return 'active';
	}
}

/**
 * Convert a price expressed as a decimal string ("12.50") to cents (1250).
 * WHMCS uses `-1.00` in `tblpricing` columns to mean "billing cycle not enabled" — returns 0
 * so callers can filter out via `> 0` check (don't store -100 cents as a real price).
 */
export function priceToCents(price: string | number | null | undefined): number {
	if (price === null || price === undefined) return 0;
	const n = typeof price === 'string' ? parseFloat(price) : price;
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.round(n * 100);
}

/**
 * Normalize WHMCS date values. WHMCS uses `'0000-00-00'` as a NOT-NULL sentinel for missing dates.
 * Returns null for sentinels; otherwise returns a YYYY-MM-DD string.
 *
 * Defensive against type variance: even with `dateStrings: true` on the mysql2 connection,
 * some columns may still arrive as Date objects (e.g. when fetched via a JOIN of mixed
 * column types). Handle string, Date, number (epoch ms), Buffer.
 */
export function normalizeWHMCSDate(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	let s: string;
	if (typeof value === 'string') {
		s = value;
	} else if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		// Slice the ISO date portion: 2026-05-12T00:00:00.000Z → 2026-05-12
		s = value.toISOString().slice(0, 10);
	} else if (typeof value === 'number') {
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return null;
		s = d.toISOString().slice(0, 10);
	} else if (Buffer.isBuffer(value)) {
		s = value.toString('utf8');
	} else {
		// Last-ditch: stringify whatever it is. Returns "[object Object]" for unknowns → caught below.
		s = String(value);
	}
	const v = s.trim();
	if (!v || v === '0000-00-00' || v.startsWith('0000-00-00') || v === '[object Object]') return null;
	return v;
}

/**
 * Normalize empty string to null. WHMCS stores text columns as NOT NULL DEFAULT '' so missing
 * values come through as empty strings, which would clutter the CRM (empty registrar, empty
 * notes) instead of showing the intended "absent" semantics.
 *
 * Defensive: mysql2 with the `utf8mb3` charset (older WHMCS installs) sometimes returns Buffer
 * for text columns when decoding fails; coerce to string via `.toString()` before trimming.
 * Also coerce numbers, in case a column was misread.
 */
export function nullIfEmpty(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	let s: string;
	if (typeof value === 'string') s = value;
	else if (typeof value === 'number' || typeof value === 'bigint') s = String(value);
	else if (Buffer.isBuffer(value)) s = value.toString('utf8');
	else if (typeof (value as { toString?: () => string }).toString === 'function') s = String(value);
	else return null;
	const v = s.trim();
	return v === '' ? null : v;
}
