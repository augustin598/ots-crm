import { describe, expect, it } from 'bun:test';
import { needsDe, numarSi } from '../ro-numerale';

describe('acordul numeralului cu „de"', () => {
	it('sub 20 nu cere „de"', () => {
		for (const n of [0, 1, 2, 7, 19]) expect(needsDe(n)).toBe(false);
	});

	it('de la 20 în sus cere „de"', () => {
		for (const n of [20, 21, 40, 99, 100, 1267]) expect(needsDe(n)).toBe(true);
	});

	it('compusele terminate în 1–19 nu cer „de"', () => {
		// „202 persoane", „1203 membri" — regula se uită la ultimele două cifre.
		for (const n of [101, 202, 1203, 1019]) expect(needsDe(n)).toBe(false);
	});

	it('sutele rotunde cer „de"', () => {
		expect(needsDe(100)).toBe(true);
		expect(needsDe(1200)).toBe(true);
	});
});

describe('numarSi', () => {
	it('formele din inboxul de grupuri', () => {
		expect(numarSi(1, 'membru', 'membri')).toBe('1 membru');
		expect(numarSi(7, 'membru', 'membri')).toBe('7 membri');
		expect(numarSi(8, 'membru', 'membri')).toBe('8 membri');
		expect(numarSi(1267, 'membru', 'membri')).toBe('1267 de membri');
		expect(numarSi(1203, 'membru', 'membri')).toBe('1203 membri');
		expect(numarSi(0, 'membru', 'membri')).toBe('0 membri');
	});

	it('merge și pe alte substantive', () => {
		expect(numarSi(21, 'număr', 'numere')).toBe('21 de numere');
		expect(numarSi(3, 'număr', 'numere')).toBe('3 numere');
	});
});
