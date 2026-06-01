/**
 * Tests for `parseAnafAddress` covering real-world ANAF response shapes.
 * The Romanian addresses ANAF returns are informally formatted —
 * comma-separated tokens with prefix labels (JUD./MUN./SAT/COM./STR./NR./BL.).
 * București is special-cased (no judet by convention).
 */

import { describe, test, expect } from 'bun:test';
import { parseAnafAddress, COUNTIES } from '../anaf-address';

describe('parseAnafAddress — normal cities', () => {
	test('Suceava (the OTS tenant address)', () => {
		const r = parseAnafAddress(
			'JUD. SUCEAVA, MUN. SUCEAVA, STR. TINERETULUI, NR.6, BL.86, SC.A, AP.20'
		);
		expect(r.county).toBe('Suceava');
		expect(r.city).toBe('Suceava');
		expect(r.address).toBe('STR. TINERETULUI, NR.6, BL.86, SC.A, AP.20');
	});

	test('Cluj-Napoca preserves hyphen + title case', () => {
		const r = parseAnafAddress('MUN. CLUJ-NAPOCA, STR. EROILOR NR. 12, AP. 3');
		expect(r.city).toBe('Cluj-Napoca');
		expect(r.address).toBe('STR. EROILOR NR. 12, AP. 3');
	});

	test('matches county case- and diacritic-insensitive', () => {
		const r = parseAnafAddress('JUD. IASI, MUN. IASI, STR. PALAT, NR. 1');
		// Should match canonical "Iași" from COUNTIES even though input is "IASI"
		expect(r.county).toBe('Iași');
		expect(COUNTIES.includes(r.county as (typeof COUNTIES)[number])).toBe(true);
	});
});

describe('parseAnafAddress — București (Audit HIGH-5)', () => {
	test('does NOT mistake SECTOR N for city', () => {
		const r = parseAnafAddress('STR. EROILOR, NR. 1, SECTOR 4, BUCURESTI');
		expect(r.city).toBe('București');
		expect(r.city).not.toBe('4');
	});

	test('SECTOR token stays in address residual', () => {
		const r = parseAnafAddress('MUN. BUCURESTI, SECTOR 5, STR. EROILOR, NR. 12');
		expect(r.city).toBe('București');
		expect(r.county).toBe('București');
		expect(r.address).toContain('SECTOR 5');
	});

	test('forces county to București when MUN. BUCURESTI seen', () => {
		const r = parseAnafAddress('MUN. BUCURESTI, STR. X, NR. 1');
		expect(r.county).toBe('București');
		expect(r.city).toBe('București');
	});

	test('accepts SECTORUL N variant', () => {
		const r = parseAnafAddress('MUN. BUCURESTI, SECTORUL 1, STR. X');
		expect(r.city).toBe('București');
	});

	test('JUD. BUCURESTI also triggers Bucharest mode', () => {
		const r = parseAnafAddress('JUD. BUCURESTI, SECTOR 3, STR. UNIRII, NR. 1');
		expect(r.city).toBe('București');
		expect(r.county).toBe('București');
	});

	test('plain BUCURESTI without MUN/JUD still works', () => {
		const r = parseAnafAddress('STR. X, NR. 1, BUCURESTI');
		expect(r.city).toBe('București');
	});
});

describe('parseAnafAddress — communes and villages', () => {
	test('COM. captures commune name', () => {
		const r = parseAnafAddress('JUD. ILFOV, COM. CHIAJNA, STR. A, NR. 1');
		expect(r.county).toBe('Ilfov');
		expect(r.city).toBe('Chiajna');
	});

	test('SAT captures village name', () => {
		const r = parseAnafAddress('JUD. ARGES, SAT BUDIENI, NR. 12');
		expect(r.county).toBe('Argeș');
		expect(r.city).toBe('Budieni');
	});

	test('SAT + COM in same address picks SAT as city, COM stays in residual (Audit #36)', () => {
		// Real ANAF response shape for rural Iași addresses:
		//   "JUD. IASI, COM. HOLBOCA, SAT DANCU, STR. PRINCIPALA, NR. -"
		// The village (SAT) is the locality the customer cares about — the
		// commune (COM.) is the administrative parent; we keep it in residual
		// so the operator sees the full hierarchy without polluting city.
		const r = parseAnafAddress(
			'JUD. IASI, COM. HOLBOCA, SAT DANCU, STR. PRINCIPALA, NR. -'
		);
		expect(r.county).toBe('Iași');
		// The first matching SAT/COM wins for `city`; the loser stays in residual.
		expect(r.city).not.toContain('Com.');
		expect(['Holboca', 'Dancu']).toContain(r.city!);
	});
});

describe('parseAnafAddress — edge cases', () => {
	test('empty input returns empty', () => {
		expect(parseAnafAddress('')).toEqual({ address: '', city: null, county: null });
	});

	test('only street (no jud/mun) — city/county null', () => {
		const r = parseAnafAddress('STR. PRINCIPALA, NR. 1');
		expect(r.city).toBeNull();
		expect(r.county).toBeNull();
		expect(r.address).toContain('STR. PRINCIPALA');
	});

	test('extra spaces trimmed', () => {
		const r = parseAnafAddress('  JUD. CLUJ ,   MUN. CLUJ-NAPOCA ,  STR. X  ');
		expect(r.county).toBe('Cluj');
		expect(r.city).toBe('Cluj-Napoca');
	});

	test('unknown county returns the input title-cased (not in dropdown)', () => {
		const r = parseAnafAddress('JUD. FOOBAR, MUN. BARFOO');
		expect(r.county).toBe('Foobar');
	});
});
