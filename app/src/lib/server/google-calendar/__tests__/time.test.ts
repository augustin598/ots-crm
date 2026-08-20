import { describe, it, expect } from 'bun:test';
import { toNaiveDateTime, addMinutes, naiveDatePart } from '../time';

const TZ = 'Europe/Bucharest';

describe('toNaiveDateTime', () => {
	it('keeps a wall-clock value exactly as the user typed it', () => {
		expect(toNaiveDateTime('2026-08-21T10:00', TZ)).toBe('2026-08-21T10:00:00');
	});

	it('accepts seconds and space-separated forms', () => {
		expect(toNaiveDateTime('2026-08-21T10:00:45', TZ)).toBe('2026-08-21T10:00:45');
		expect(toNaiveDateTime('2026-08-21 10:00', TZ)).toBe('2026-08-21T10:00:00');
	});

	/**
	 * The whole point of the fix: the result must not depend on the machine's
	 * timezone. Production (UTC container) and dev (Europe/Bucharest) previously
	 * produced instants three hours apart from this exact input.
	 */
	it('is independent of the process timezone', () => {
		const original = process.env.TZ;
		try {
			process.env.TZ = 'UTC';
			const asUtc = toNaiveDateTime('2026-08-21T10:00', TZ);
			process.env.TZ = 'America/Los_Angeles';
			const asLa = toNaiveDateTime('2026-08-21T10:00', TZ);
			expect(asUtc).toBe('2026-08-21T10:00:00');
			expect(asLa).toBe(asUtc);
		} finally {
			process.env.TZ = original;
		}
	});

	it('converts a legacy absolute value into Romanian wall-clock time', () => {
		// 07:00Z in August is 10:00 in Bucharest (EEST, UTC+3).
		expect(toNaiveDateTime('2026-08-21T07:00:00.000Z', TZ)).toBe('2026-08-21T10:00:00');
		// In January Bucharest is UTC+2, so 08:00Z is 10:00 local.
		expect(toNaiveDateTime('2026-01-21T08:00:00.000Z', TZ)).toBe('2026-01-21T10:00:00');
	});

	it('renders midnight as 00, never 24', () => {
		expect(toNaiveDateTime('2026-08-20T21:00:00.000Z', TZ)).toBe('2026-08-21T00:00:00');
	});

	// Regression: a bare "10:00" reached the Calendar call and surfaced as an
	// opaque `RangeError: Invalid Date` (seen in production on 2026-06-01).
	it('rejects a bare time', () => {
		expect(() => toNaiveDateTime('10:00', TZ)).toThrow();
	});

	it('rejects empty and impossible values', () => {
		expect(() => toNaiveDateTime('', TZ)).toThrow();
		expect(() => toNaiveDateTime('   ', TZ)).toThrow();
		expect(() => toNaiveDateTime('not a date', TZ)).toThrow();
		expect(() => toNaiveDateTime('2026-13-01T10:00', TZ)).toThrow();
		expect(() => toNaiveDateTime('2026-08-21T25:00', TZ)).toThrow();
	});
});

describe('addMinutes', () => {
	it('adds duration on the wall clock', () => {
		expect(addMinutes('2026-08-21T10:00:00', 30)).toBe('2026-08-21T10:30:00');
		expect(addMinutes('2026-08-21T10:00:00', 90)).toBe('2026-08-21T11:30:00');
	});

	it('rolls over midnight and month boundaries', () => {
		expect(addMinutes('2026-08-31T23:45:00', 30)).toBe('2026-09-01T00:15:00');
	});

	/**
	 * Wall-clock arithmetic deliberately ignores DST: a 30-minute meeting starting
	 * at 03:45 on a spring-forward night still ends at 04:15 on the clock. Google
	 * resolves both endpoints against the zone, so the duration stays sane.
	 */
	it('does not shift across a DST boundary', () => {
		expect(addMinutes('2026-03-29T03:45:00', 30)).toBe('2026-03-29T04:15:00');
	});

	it('rejects values that are not wall-clock strings', () => {
		expect(() => addMinutes('2026-08-21T10:00:00Z', 30)).toThrow();
	});
});

describe('naiveDatePart', () => {
	it('extracts the calendar date', () => {
		expect(naiveDatePart('2026-08-21T10:00:00')).toBe('2026-08-21');
	});
});
