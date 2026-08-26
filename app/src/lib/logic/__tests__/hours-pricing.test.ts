import { describe, test, expect } from 'bun:test';
import { HOURS_MIN, HOURS_MAX, isValidHours, hoursNetCents } from '../hours-pricing';

describe('isValidHours', () => {
	test('acceptă limitele și întregii din interval', () => {
		expect(isValidHours(HOURS_MIN)).toBe(true);
		expect(isValidHours(50)).toBe(true);
		expect(isValidHours(HOURS_MAX)).toBe(true);
	});

	test('respinge 0, negative, peste max, fracții și non-numere', () => {
		expect(isValidHours(0)).toBe(false);
		expect(isValidHours(-3)).toBe(false);
		expect(isValidHours(HOURS_MAX + 1)).toBe(false);
		expect(isValidHours(2.5)).toBe(false);
		expect(isValidHours(NaN)).toBe(false);
		expect(isValidHours(Infinity)).toBe(false);
	});
});

describe('hoursNetCents', () => {
	test('net = ore × tarif × 100 (EUR → cenți)', () => {
		expect(hoursNetCents(65, 1)).toBe(6500);
		expect(hoursNetCents(65, 10)).toBe(65000);
		expect(hoursNetCents(80, 7)).toBe(56000);
		expect(hoursNetCents(55, HOURS_MAX)).toBe(550000);
	});

	test('aruncă pe ore invalide sau tarif nepozitiv/fracționar', () => {
		expect(() => hoursNetCents(65, 0)).toThrow();
		expect(() => hoursNetCents(65, HOURS_MAX + 1)).toThrow();
		expect(() => hoursNetCents(65, 2.5)).toThrow();
		expect(() => hoursNetCents(0, 5)).toThrow();
		expect(() => hoursNetCents(-65, 5)).toThrow();
		expect(() => hoursNetCents(65.5, 5)).toThrow();
	});
});
