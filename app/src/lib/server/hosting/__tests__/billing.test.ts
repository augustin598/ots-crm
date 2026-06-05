import { describe, test, expect } from 'bun:test';
import { advanceNextDueDate, isInvoiceEffectivelyPaid } from '../billing';

describe('advanceNextDueDate', () => {
	test('advances annually by one year, preserving anniversary day', () => {
		expect(advanceNextDueDate('2026-05-26', 'annually')).toBe('2027-05-26');
		expect(advanceNextDueDate('2026-05-31', 'annually')).toBe('2027-05-31');
	});

	test('advances monthly and clamps to month end (Jan 31 -> Feb 28)', () => {
		expect(advanceNextDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
		expect(advanceNextDueDate('2026-03-15', 'monthly')).toBe('2026-04-15');
	});

	test('handles quarterly / semiannually / biennially', () => {
		expect(advanceNextDueDate('2026-01-15', 'quarterly')).toBe('2026-04-15');
		expect(advanceNextDueDate('2026-01-15', 'semiannually')).toBe('2026-07-15');
		expect(advanceNextDueDate('2026-01-15', 'biennially')).toBe('2028-01-15');
	});

	test('handles daily and weekly', () => {
		expect(advanceNextDueDate('2026-12-31', 'daily')).toBe('2027-01-01');
		expect(advanceNextDueDate('2026-01-01', 'weekly')).toBe('2026-01-08');
	});

	test('leap-year anniversary clamps (Feb 29 -> Feb 28)', () => {
		expect(advanceNextDueDate('2024-02-29', 'annually')).toBe('2025-02-28');
	});

	test('returns null for non-renewing or invalid inputs (never throws)', () => {
		expect(advanceNextDueDate('2026-05-26', 'one_time')).toBeNull();
		expect(advanceNextDueDate('2026-05-26', 'weird-cycle')).toBeNull();
		expect(advanceNextDueDate(null, 'annually')).toBeNull();
		expect(advanceNextDueDate('not-a-date', 'annually')).toBeNull();
	});

	test('defaults to monthly when billingCycle is null', () => {
		expect(advanceNextDueDate('2026-03-15', null)).toBe('2026-04-15');
	});
});

describe('isInvoiceEffectivelyPaid', () => {
	test('CRM status paid / partially_paid → paid', () => {
		expect(isInvoiceEffectivelyPaid({ status: 'paid' })).toBe(true);
		expect(isInvoiceEffectivelyPaid({ status: 'partially_paid' })).toBe(true);
	});

	test('manual paidDate counts as paid even when status is still sent (OTSH 5 case)', () => {
		expect(
			isInvoiceEffectivelyPaid({ status: 'sent', paidDate: new Date(), remainingAmount: 90629 })
		).toBe(true);
	});

	test('Keez remainingAmount=0 counts as paid', () => {
		expect(isInvoiceEffectivelyPaid({ status: 'sent', remainingAmount: 0 })).toBe(true);
	});

	test('unpaid: sent, no paidDate, remaining>0 or unknown', () => {
		expect(
			isInvoiceEffectivelyPaid({ status: 'sent', paidDate: null, remainingAmount: 90629 })
		).toBe(false);
		expect(
			isInvoiceEffectivelyPaid({ status: 'sent', paidDate: null, remainingAmount: null })
		).toBe(false);
	});
});
