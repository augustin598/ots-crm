import { describe, test, expect } from 'bun:test';
import { parseInvoiceDate, parseInvoicePeriod } from '../date-parse';

describe('parseInvoiceDate', () => {
	test('ISO format', () => {
		expect(parseInvoiceDate('2025-01-06')).toBe('2025-01-06');
		expect(parseInvoiceDate('2025-01-06T00:00:00Z')).toBe('2025-01-06');
	});

	test('English format', () => {
		expect(parseInvoiceDate('6 Jan 2025')).toBe('2025-01-06');
		expect(parseInvoiceDate('29 October 2024')).toBe('2024-10-29');
		expect(parseInvoiceDate('5 Mar 2025')).toBe('2025-03-05');
	});

	test('Romanian format (the case that used to fall back to 1970)', () => {
		expect(parseInvoiceDate('6 ian. 2025')).toBe('2025-01-06');
		expect(parseInvoiceDate('10 decembrie 2025')).toBe('2025-12-10');
		expect(parseInvoiceDate('15 mai 2026')).toBe('2026-05-15');
		expect(parseInvoiceDate('3 iulie 2025')).toBe('2025-07-03');
		expect(parseInvoiceDate('1 noiembrie 2024')).toBe('2024-11-01');
	});

	test('unparseable → null (never epoch)', () => {
		expect(parseInvoiceDate('')).toBeNull();
		expect(parseInvoiceDate(undefined)).toBeNull();
		expect(parseInvoiceDate(null)).toBeNull();
		expect(parseInvoiceDate('garbage text')).toBeNull();
		expect(parseInvoiceDate('30 zzz 2025')).toBeNull();
	});

	test('never returns a 1970 epoch date for a real-looking but odd string', () => {
		const out = parseInvoiceDate('not a date');
		expect(out).toBeNull();
		expect(out).not.toBe('1970-01-01');
	});
});

describe('parseInvoicePeriod', () => {
	test('returns full-month bounds', () => {
		expect(parseInvoicePeriod('15 mai 2026')).toEqual({ periodStart: '2026-05-01', periodEnd: '2026-05-31' });
		expect(parseInvoicePeriod('6 Jan 2025')).toEqual({ periodStart: '2025-01-01', periodEnd: '2025-01-31' });
	});

	test('February leap vs non-leap', () => {
		expect(parseInvoicePeriod('10 Feb 2024')).toEqual({ periodStart: '2024-02-01', periodEnd: '2024-02-29' });
		expect(parseInvoicePeriod('10 Feb 2025')).toEqual({ periodStart: '2025-02-01', periodEnd: '2025-02-28' });
	});

	test('unparseable → null (caller must skip, not invent a period)', () => {
		expect(parseInvoicePeriod('garbage')).toBeNull();
		expect(parseInvoicePeriod(undefined)).toBeNull();
	});
});
