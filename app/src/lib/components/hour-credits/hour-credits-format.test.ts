import { describe, expect, test } from 'bun:test';
import {
	avatarColor,
	creditToEur,
	fmtHoursShort,
	fmtMinutes,
	fmtRelative,
	initialsOf
} from './hour-credits-format';

describe('fmtMinutes', () => {
	test('ore + minute, doar ore, doar minute', () => {
		expect(fmtMinutes(200)).toBe('3 h 20 min');
		expect(fmtMinutes(60)).toBe('1 h');
		expect(fmtMinutes(45)).toBe('45 min');
		expect(fmtMinutes(0)).toBe('0 min');
	});

	test('negativul folosește minusul tipografic din design, nu cratima', () => {
		expect(fmtMinutes(-90)).toBe('−1 h 30 min');
		expect(fmtMinutes(-90).startsWith('−')).toBe(true);
	});

	test('valoare invalidă → em dash', () => {
		expect(fmtMinutes(Number.NaN)).toBe('—');
	});
});

describe('fmtHoursShort', () => {
	test('întreg fără zecimale, fracționar cu virgulă', () => {
		expect(fmtHoursShort(120)).toBe('2 h');
		expect(fmtHoursShort(210)).toBe('3,5 h');
		expect(fmtHoursShort(-210)).toBe('−3,5 h');
	});
});

describe('creditToEur', () => {
	test('conversie la tariful de referință', () => {
		expect(creditToEur(600, 55)).toBe('550 €');
	});

	test('fără tarif de referință → null (nu 0 €)', () => {
		expect(creditToEur(600, null)).toBeNull();
		expect(creditToEur(600, 0)).toBeNull();
	});
});

describe('initialsOf', () => {
	test('două cuvinte → două inițiale', () => {
		expect(initialsOf('Beauty One Medical')).toBe('BO');
	});

	test('un cuvânt → primele două litere', () => {
		expect(initialsOf('Kaufland')).toBe('KA');
	});

	test('gol → semn de întrebare, nu crapă', () => {
		expect(initialsOf('   ')).toBe('?');
	});
});

describe('avatarColor', () => {
	test('deterministă: același id → aceeași culoare', () => {
		expect(avatarColor('u44x')).toBe(avatarColor('u44x'));
	});

	test('întoarce mereu o culoare din paletă', () => {
		for (const id of ['a', 'bb', 'client-123', 'x'.repeat(40)]) {
			expect(avatarColor(id)).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});
});

describe('fmtRelative', () => {
	const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

	test('azi / ieri / zile', () => {
		expect(fmtRelative(daysAgo(0))).toBe('azi');
		expect(fmtRelative(daysAgo(1))).toBe('ieri');
		expect(fmtRelative(daysAgo(3))).toBe('acum 3 zile');
	});

	test('fără dată → „niciodată"', () => {
		expect(fmtRelative(null)).toBe('niciodată');
	});
});
