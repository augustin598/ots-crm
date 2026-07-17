import { describe, expect, test } from 'bun:test';
import { classifyClientVat, shouldZeroVatForClient, getZeroVatLegalNote } from './classify-client';

/**
 * The business rule this locks: VAT is charged ONLY to Romanian clients.
 * Anything outside RO (EU or not) is invoiced at 0% and must carry a legal mention.
 *
 * Cases use real client identifiers from the 2026-07-17 intracom audit, so a
 * regression here maps directly onto invoices that actually exist.
 */
describe('classifyClientVat — VAT applies only to RO', () => {
	test('RO company (numeric CUI, country România) → ro_domestic (VAT applies)', () => {
		expect(classifyClientVat({ country: 'Romania', cui: '44621379' })).toBe('ro_domestic');
		expect(classifyClientVat({ country: 'România', cui: '35380816' })).toBe('ro_domestic');
		expect(shouldZeroVatForClient({ country: 'Romania', cui: '44621379' })).toBe(false);
	});

	test('EU company → intracom (0% VAT) — real audit clients', () => {
		// Wow Agency, MEITNERIUM, CDVA (Cyprus) and PUBBLILA (Italy)
		expect(classifyClientVat({ country: 'Cipru', cui: 'CY10399119V' })).toBe('intracom');
		expect(classifyClientVat({ country: null, cui: 'CY60124923R' })).toBe('intracom');
		expect(classifyClientVat({ country: null, cui: 'IT03446240925' })).toBe('intracom');
		expect(shouldZeroVatForClient({ country: null, cui: 'IT03446240925' })).toBe(true);
	});

	test('CUI prefix wins over a stale/wrong country field', () => {
		// A Cyprus client whose free-text country still says România must NOT be charged VAT.
		expect(classifyClientVat({ country: 'România', cui: 'CY10399119V' })).toBe('intracom');
		expect(shouldZeroVatForClient({ country: 'România', cui: 'CY10399119V' })).toBe(true);
	});

	test('non-EU company → export (0% VAT)', () => {
		expect(classifyClientVat({ country: 'Elvetia', cui: 'CH123456789' })).toBe('export');
		expect(shouldZeroVatForClient({ country: 'Elvetia', cui: 'CH123456789' })).toBe(true);
	});

	test('no country and no usable CUI → unknown', () => {
		expect(classifyClientVat({ country: null, cui: null })).toBe('unknown');
		expect(classifyClientVat({ country: '   ', cui: null })).toBe('unknown');
	});

	test('unrecognised country text → export (never silently bill VAT abroad)', () => {
		expect(classifyClientVat({ country: 'Wakanda', cui: null })).toBe('export');
	});

	test('a pure-numeric CUI does not get mistaken for a country prefix', () => {
		// "39988493" — first two chars are digits, so the CUI branch must fall through
		// to the country field rather than inventing a country code.
		expect(classifyClientVat({ country: 'România', cui: '39988493' })).toBe('ro_domestic');
	});
});

describe('getZeroVatLegalNote — the mention that was missing on 65 invoices', () => {
	test('intracom gets the reverse-charge mention', () => {
		const note = getZeroVatLegalNote('intracom');
		expect(note).toBeTruthy();
		expect(note).toContain('Taxare inversă');
	});

	test('export gets the non-taxable mention', () => {
		const note = getZeroVatLegalNote('export');
		expect(note).toBeTruthy();
		expect(note).toContain('neimpozabilă');
	});

	test('ro_domestic gets no zero-VAT note', () => {
		expect(getZeroVatLegalNote('ro_domestic')).toBeNull();
	});
});
