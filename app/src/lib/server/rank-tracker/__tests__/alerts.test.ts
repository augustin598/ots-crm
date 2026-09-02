// Teste pentru logica pură de alertare a pozițiilor.
import { describe, test, expect } from 'bun:test';
import { computeAlert, alertLabelRo } from '../alerts';

describe('computeAlert — praguri și tipuri', () => {
	test('scădere ≥ prag → drop', () => {
		expect(computeAlert(3, 9, 5)).toMatchObject({ type: 'drop', delta: -6, fromPosition: 3, toPosition: 9 });
	});

	test('scădere sub prag → nicio alertă', () => {
		expect(computeAlert(3, 6, 5)).toBeNull();
	});

	test('ieșit din top 10 → out_of_top10 (chiar dacă scăderea e mică)', () => {
		expect(computeAlert(10, 11, 5)).toMatchObject({ type: 'out_of_top10', fromPosition: 10, toPosition: 11 });
	});

	test('din top 10 în afara top 100 → lost (prioritar față de out_of_top10)', () => {
		expect(computeAlert(8, null, 5)).toMatchObject({ type: 'lost', toPosition: null });
	});

	test('urcare → nicio alertă', () => {
		expect(computeAlert(9, 3, 5)).toBeNull();
	});

	test('keyword nou (fără poziție precedentă) → nicio alertă', () => {
		expect(computeAlert(null, 5, 5)).toBeNull();
		expect(computeAlert(null, null, 5)).toBeNull();
	});

	test('scădere mare în interiorul top 10 nu declanșează out_of_top10, ci drop', () => {
		expect(computeAlert(1, 8, 5)).toMatchObject({ type: 'drop', delta: -7 });
	});
});

describe('alertLabelRo', () => {
	test('etichete în română', () => {
		expect(alertLabelRo('drop')).toBe('scădere');
		expect(alertLabelRo('out_of_top10')).toBe('ieșit din top 10');
		expect(alertLabelRo('lost')).toBe('dispărut din top 100');
	});
});
