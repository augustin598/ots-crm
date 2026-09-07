import { describe, test, expect } from 'bun:test';
import {
	KEEZ_MEASURE_UNIT_IDS,
	KEEZ_DEFAULT_MEASURE_UNIT_ID,
	KEEZ_UNIT,
	keezMeasureUnitId,
	keezMeasureUnitName
} from '../keez-measure-units';

/**
 * Nomenclatorul oficial Keez, copiat din
 * https://app.keez.ro/help/api/data_measure_unit.html (verificat 7 sep 2026).
 * Nu există endpoint API care să-l listeze, deci lista trăiește în cod — dar
 * într-un singur loc, cu testul ăsta ca dovadă că e cea publicată.
 *
 * Testul există fiindcă tabelul fusese copiat greșit în `hooks.ts` (`Hours: 2`,
 * adică „Luna om", și `Days: 3`, adică „An"): orele de extra work plecau spre
 * Keez cu unitate de lună-om.
 */
const OFICIAL: Array<[number, string]> = [
	[1, 'Buc'],
	[2, 'Luna om'],
	[3, 'An'],
	[4, 'Zi'],
	[5, 'Ora'],
	[6, 'Kg'],
	[7, 'Km'],
	[8, 'KWh'],
	[9, 'KW'],
	[10, 'M'],
	[11, 'L'],
	[12, 'Min'],
	[13, 'Luna'],
	[14, 'Mp'],
	[15, 'Oz'],
	[16, 'Per'],
	[17, 'Trim'],
	[18, 'T'],
	[19, 'Sapt'],
	[20, 'Mc'],
	[22, 'Cutie'],
	[23, 'Pag'],
	[24, 'Rola'],
	[25, 'Coala'],
	[26, 'Tambur'],
	[27, 'Set']
];

describe('nomenclatorul de unități de măsură Keez', () => {
	test('fiecare denumire scurtă are id-ul din documentație', () => {
		for (const [id, shortName] of OFICIAL) {
			expect(KEEZ_MEASURE_UNIT_IDS[shortName]).toBe(id);
			expect(keezMeasureUnitId(shortName)).toBe(id);
		}
	});

	test('inversul întoarce denumirea canonică, nu un alias', () => {
		for (const [id, shortName] of OFICIAL) {
			expect(keezMeasureUnitName(id)).toBe(shortName);
		}
		expect(keezMeasureUnitName(21)).toBeNull(); // 21 lipsește din nomenclator
		expect(keezMeasureUnitName(999)).toBeNull();
	});

	test('aliasurile EN duc la aceleași id-uri (linii vechi/importate)', () => {
		expect(keezMeasureUnitId('Pcs')).toBe(1);
		expect(keezMeasureUnitId('Hours')).toBe(5);
		expect(keezMeasureUnitId('Hour')).toBe(5);
		expect(keezMeasureUnitId('Days')).toBe(4);
		expect(keezMeasureUnitId('Months')).toBe(13);
	});

	test('ora NU e „Luna om" — regresia care trimitea extra work-ul greșit', () => {
		expect(keezMeasureUnitId(KEEZ_UNIT.HOUR)).toBe(5);
		expect(keezMeasureUnitId(KEEZ_UNIT.HOUR)).not.toBe(2);
		expect(keezMeasureUnitId('Days')).not.toBe(3);
	});

	test('lipsa unității cade pe Buc, nu aruncă', () => {
		expect(keezMeasureUnitId(null)).toBe(KEEZ_DEFAULT_MEASURE_UNIT_ID);
		expect(keezMeasureUnitId(undefined)).toBe(1);
		expect(keezMeasureUnitId('')).toBe(1);
		expect(keezMeasureUnitId('  Ora  ')).toBe(5);
		expect(keezMeasureUnitId('unitate inexistentă')).toBe(1);
	});

	test('constantele CRM sunt denumiri reale din nomenclator', () => {
		for (const name of Object.values(KEEZ_UNIT)) {
			expect(OFICIAL.some(([, shortName]) => shortName === name)).toBe(true);
		}
	});
});
