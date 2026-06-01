import { describe, it, expect } from 'bun:test';

/**
 * Unit tests for the helper logic in getHostingAccountsGrouped.
 * The remote function itself requires SvelteKit context, so we replicate
 * the pure helpers here and test them directly.
 */

const CYCLE_MONTHS: Record<string, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	biannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36,
	one_time: 0
};

function toMonthlyCents(amount: number | null, cycle: string | null): number {
	const months = CYCLE_MONTHS[cycle ?? 'monthly'] ?? 1;
	if (months === 0 || !amount) return 0;
	return Math.round(amount / months);
}

function daysDiff(fromISO: string | null | undefined, toISO: string): number | null {
	if (!fromISO) return null;
	const a = new Date(fromISO);
	const b = new Date(toISO);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
	return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

describe('toMonthlyCents', () => {
	it('normalizes annual to monthly', () => {
		expect(toMonthlyCents(12000, 'annually')).toBe(1000);
	});
	it('normalizes quarterly to monthly', () => {
		expect(toMonthlyCents(3000, 'quarterly')).toBe(1000);
	});
	it('keeps monthly as-is', () => {
		expect(toMonthlyCents(1000, 'monthly')).toBe(1000);
	});
	it('returns 0 for one_time', () => {
		expect(toMonthlyCents(5000, 'one_time')).toBe(0);
	});
	it('returns 0 for null amount', () => {
		expect(toMonthlyCents(null, 'annually')).toBe(0);
	});
	it('defaults to monthly for unknown cycle', () => {
		expect(toMonthlyCents(1500, 'weird-cycle')).toBe(1500);
	});
});

describe('daysDiff', () => {
	it('returns positive for future date', () => {
		expect(daysDiff('2026-05-01', '2026-05-11')).toBe(10);
	});
	it('returns negative for past date', () => {
		expect(daysDiff('2026-05-20', '2026-05-10')).toBe(-10);
	});
	it('returns 0 for same date', () => {
		expect(daysDiff('2026-05-15', '2026-05-15')).toBe(0);
	});
	it('returns null for null from', () => {
		expect(daysDiff(null, '2026-05-15')).toBeNull();
	});
	it('returns null for invalid from', () => {
		expect(daysDiff('not-a-date', '2026-05-15')).toBeNull();
	});
});
