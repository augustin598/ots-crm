import { describe, expect, test } from 'bun:test';
import { parseBareAmount } from '../pdf-parser';
import { parseAmount } from '../parsers/helpers';
import { parseDecimalToCents } from '../../banking/payment-match';

/**
 * Trei implementări ale ACELEIAȘI reguli de separator zecimal („când apar ambii,
 * ultimul e cel zecimal”), fiecare cu testele ei, niciuna verificată față de
 * celelalte. Problema e că `parseAmount`/`parseBareAmount` produc suma FACTURII, iar
 * `parseDecimalToCents` produce suma PLĂȚII — cele două laturi ale comparației din
 * `scoreMatch`. O corectură într-una singură nu pică niciun test, dar oprește
 * potrivirea pe sumă exactă, adică exact semnalul principal al fluxului.
 *
 * Testul de mai jos e singurul lucru care le ține de acord.
 */
const CASES: Array<{ input: string; cents: number; ce: string }> = [
	{ input: '1.234,56', cents: 123_456, ce: 'european, cu separator de mii' },
	{ input: '1,234.56', cents: 123_456, ce: 'american, cu separator de mii' },
	{ input: '968,77', cents: 96_877, ce: 'virgulă zecimală' },
	{ input: '12,34', cents: 1_234, ce: 'virgulă zecimală, sumă mică' },
	{ input: '12.34', cents: 1_234, ce: 'punct zecimal, sumă mică' },
	{ input: '1.099,00', cents: 109_900, ce: 'european, zecimale nule' }
];

describe('regula separatorului zecimal e aceeași în toate cele trei parsere', () => {
	for (const { input, cents, ce } of CASES) {
		test(`„${input}” (${ce}) → ${cents} bani în toate trei`, () => {
			// Factura, din corpul emailului (are nevoie de valută ca să recunoască suma)
			expect(parseAmount(`Total ${input} EUR`)).toEqual({ amount: cents, currency: 'EUR' });
			// Factura, din PDF-ul atașat (număr gol, fără valută lângă el)
			expect(parseBareAmount(input)).toBe(cents);
			// Plata, din exportul Keez („valoare tranzactie: X CUR” și coloana Valoare)
			expect(parseDecimalToCents(input)).toBe(cents);
		});
	}

	test('suma facturii și suma plății coincid pe aceeași valoare scrisă diferit', () => {
		// Cazul real: PDF-ul scrie „1.099,00 EUR”, extrasul bancar „1099.00 EUR”.
		expect(parseBareAmount('1.099,00')).toBe(parseDecimalToCents('1099.00')!);
		expect(parseAmount('1.099,00 EUR')?.amount).toBe(parseDecimalToCents('1099.00')!);
	});
});
