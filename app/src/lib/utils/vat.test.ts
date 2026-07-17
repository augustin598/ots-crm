import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_VAT_PERCENT,
	resolveVatPercent,
	invoiceVatPercentFromBps,
	vatPercentToBps
} from './vat';

describe('DEFAULT_VAT_PERCENT', () => {
	test('is the Romanian standard 21% (post-2025), not the old 19%', () => {
		expect(DEFAULT_VAT_PERCENT).toBe(21);
	});
});

describe('resolveVatPercent (tenant setting → percent)', () => {
	test('null/undefined → Romanian standard (settings-less tenant), NOT stale 19', () => {
		expect(resolveVatPercent(null)).toBe(21);
		expect(resolveVatPercent(undefined)).toBe(21);
	});

	test('explicit rate is honoured, incl. a historical 19', () => {
		expect(resolveVatPercent(21)).toBe(21);
		expect(resolveVatPercent(19)).toBe(19);
	});

	test('a legitimate stored 0 is preserved, not coerced to the default', () => {
		expect(resolveVatPercent(0)).toBe(0);
	});
});

describe('invoiceVatPercentFromBps (stored taxRate bps → Keez article vatRate)', () => {
	test('0 bps stays 0% — a zero-VAT invoice must NOT become 19% (the keez.remote.ts:455 bug)', () => {
		expect(invoiceVatPercentFromBps(0)).toBe(0);
	});

	test('2100 bps → 21%, 1900 bps → 19%', () => {
		expect(invoiceVatPercentFromBps(2100)).toBe(21);
		expect(invoiceVatPercentFromBps(1900)).toBe(19);
	});

	test('missing rate (null/undefined) → Romanian standard', () => {
		expect(invoiceVatPercentFromBps(null)).toBe(21);
		expect(invoiceVatPercentFromBps(undefined)).toBe(21);
	});

	test('round-trips with vatPercentToBps', () => {
		expect(invoiceVatPercentFromBps(vatPercentToBps(21))).toBe(21);
		expect(invoiceVatPercentFromBps(vatPercentToBps(0))).toBe(0);
	});
});
