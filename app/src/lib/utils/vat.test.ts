import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_VAT_PERCENT,
	resolveVatPercent,
	invoiceVatPercentFromBps,
	resolveVatBps,
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

describe('resolveVatBps (stored taxRate bps, stays in bps)', () => {
	test('0 bps stays 0 — editing/importing a zero-VAT invoice must NOT stamp it 19/21%', () => {
		// The `existing.taxRate || 1900` bug: any unrelated edit to a 0% invoice
		// (reverse charge / export) silently flipped its stored rate to 19%.
		expect(resolveVatBps(0)).toBe(0);
	});

	test('an explicit rate is preserved, incl. a historical 1900', () => {
		expect(resolveVatBps(2100)).toBe(2100);
		expect(resolveVatBps(1900)).toBe(1900);
	});

	test('missing rate (null/undefined) → RO standard in bps (2100), not stale 1900', () => {
		expect(resolveVatBps(null)).toBe(2100);
		expect(resolveVatBps(undefined)).toBe(2100);
	});

	test('agrees with invoiceVatPercentFromBps', () => {
		expect(resolveVatBps(null) / 100).toBe(invoiceVatPercentFromBps(null));
		expect(resolveVatBps(0) / 100).toBe(invoiceVatPercentFromBps(0));
	});
});
