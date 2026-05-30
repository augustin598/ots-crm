import { describe, test, expect } from 'bun:test';
import { buildRecurringLineItem } from '../recurring-line-item';

describe('buildRecurringLineItem — cents→decimal contract', () => {
	test('stores rate in DECIMAL currency units (not cents) so the generator does not bill ×100', () => {
		const item = buildRecurringLineItem({
			description: 'Wordpress Pro',
			netCents: 114900, // 1149.00 RON
			taxRatePercent: 21,
			currency: 'RON'
		});
		expect(item.rate).toBe(1149); // decimal, NOT 114900
		expect(item.taxRate).toBe(21); // percent, NOT 2100 bps
		expect(item.quantity).toBe(1);
		expect(item.currency).toBe('RON');
		expect(item.unitOfMeasure).toBe('Buc');
		// invoice-utils.generateInvoiceFromRecurringTemplate does Math.round(rate * 100)
		// to recover cents — must yield the ORIGINAL cents, not 100× that.
		expect(Math.round(item.rate * 100)).toBe(114900);
		// and Math.round(taxRate * 100) → the BPS the invoice stores (2100 = 21%).
		expect(Math.round(item.taxRate * 100)).toBe(2100);
	});

	test('round-trips fractional-RON amounts without precision loss', () => {
		const item = buildRecurringLineItem({
			description: 'x',
			netCents: 8660, // 86.60 RON
			taxRatePercent: 21,
			currency: 'RON'
		});
		expect(item.rate).toBe(86.6);
		expect(Math.round(item.rate * 100)).toBe(8660);
	});
});
