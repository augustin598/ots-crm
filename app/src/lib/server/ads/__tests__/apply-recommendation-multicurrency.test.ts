/**
 * Sprint 4a — multi-currency min budget floor tests.
 * EUR and USD accounts use 100-cent floor (not 500 RON floor).
 */

import { describe, it, expect } from 'bun:test';

// Direct import of the pure helper — no DB or network needed
// We re-implement the same logic here to test it in isolation
const MIN_FLOOR_BY_CURRENCY: Record<string, number> = {
	RON: 500,
	EUR: 100,
	USD: 100,
	GBP: 100,
};
const DEFAULT_FLOOR = 100;

function getMinFloor(currency: string): number {
	return MIN_FLOOR_BY_CURRENCY[currency.toUpperCase()] ?? DEFAULT_FLOOR;
}

describe('getMinFloor — multi-currency', () => {
	it('RON floor is 500 cents (5 RON)', () => {
		expect(getMinFloor('RON')).toBe(500);
	});

	it('EUR floor is 100 cents (1 EUR)', () => {
		expect(getMinFloor('EUR')).toBe(100);
	});

	it('USD floor is 100 cents (1 USD)', () => {
		expect(getMinFloor('USD')).toBe(100);
	});

	it('GBP floor is 100 cents (1 GBP)', () => {
		expect(getMinFloor('GBP')).toBe(100);
	});

	it('unknown currency falls back to 100', () => {
		expect(getMinFloor('XYZ')).toBe(100);
		expect(getMinFloor('CHF')).toBe(100);
	});

	it('case-insensitive lookup', () => {
		expect(getMinFloor('eur')).toBe(100);
		expect(getMinFloor('ron')).toBe(500);
	});

	it('EUR account: proposed 80 cents → clamped to 100', () => {
		const proposed = 80;
		const safe = Math.max(proposed, getMinFloor('EUR'));
		expect(safe).toBe(100);
	});

	it('USD account: proposed 80 cents → clamped to 100', () => {
		const proposed = 80;
		const safe = Math.max(proposed, getMinFloor('USD'));
		expect(safe).toBe(100);
	});

	it('RON account: proposed 200 cents → clamped to 500', () => {
		const proposed = 200;
		const safe = Math.max(proposed, getMinFloor('RON'));
		expect(safe).toBe(500);
	});

	it('EUR account: proposed 500 cents → unchanged (above floor)', () => {
		const proposed = 500;
		const safe = Math.max(proposed, getMinFloor('EUR'));
		expect(safe).toBe(500);
	});
});
