import { describe, test, expect } from 'bun:test';
import { dueCutoffIso, nextScheduledRunDate } from '../recurring-schedule';

describe('dueCutoffIso — tot ce e programat azi (ora României) e scadent', () => {
	// Incident 2026-09-17 (Lucky Group, Digital Marketing): jobul a pornit la
	// 06:00:00.112Z, șablonul avea next_run_date 06:00:04.016Z (ora generării din
	// august) → `<= now` fals, factura a sărit o zi.
	test('șablon cu ora 06:00:04Z e prins de jobul pornit la 06:00:00Z', () => {
		const cutoff = dueCutoffIso(new Date('2026-09-17T06:00:00.112Z'));
		expect('2026-09-17T06:00:04.016Z' <= cutoff).toBe(true);
		expect('2026-09-17T10:47:53.594Z' <= cutoff).toBe(true);
		expect('2026-09-18T00:00:00.000Z' <= cutoff).toBe(false);
	});

	test('ziua e cea din București, nu din UTC (22:30Z = ziua următoare)', () => {
		expect(dueCutoffIso(new Date('2026-09-17T22:30:00.000Z'))).toBe('2026-09-18T23:59:59.999Z');
	});

	test('dată fără oră (rând vechi „2026-12-30") se compară corect', () => {
		expect('2026-12-30' <= dueCutoffIso(new Date('2026-12-30T07:00:00Z'))).toBe(true);
		expect('2026-12-30' <= dueCutoffIso(new Date('2026-12-29T07:00:00Z'))).toBe(false);
	});
});

describe('nextScheduledRunDate — ancorat pe data programată, la miezul nopții', () => {
	const now = new Date('2026-09-17T06:00:04.000Z');

	test('lunar: ora rămasă de la generare dispare, ziua se păstrează', () => {
		expect(
			nextScheduledRunDate(new Date('2026-09-17T06:00:04.016Z'), 'monthly', 1, now).toISOString()
		).toBe('2026-10-17T00:00:00.000Z');
	});

	test('rulare întârziată cu o zi NU mută ziua de facturare', () => {
		const late = new Date('2026-09-18T06:00:00.000Z');
		expect(
			nextScheduledRunDate(new Date('2026-09-17T06:00:04.016Z'), 'monthly', 1, late).toISOString()
		).toBe('2026-10-17T00:00:00.000Z');
	});

	test('generare manuală înainte de termen → ciclul următor celui programat', () => {
		const early = new Date('2026-09-10T08:00:00.000Z');
		expect(
			nextScheduledRunDate(new Date('2026-09-17T00:00:00.000Z'), 'monthly', 1, early).toISOString()
		).toBe('2026-10-17T00:00:00.000Z');
	});

	test('restanță de luni: sare ciclurile trecute, fără avalanșă de facturi zilnice', () => {
		// SOLX: programat 3 sep, blocat (fără CUI). Deblocat pe 17 sep → următoarea în viitor.
		expect(
			nextScheduledRunDate(new Date('2026-06-03T00:00:00.000Z'), 'monthly', 1, now).toISOString()
		).toBe('2026-10-03T00:00:00.000Z');
		expect(
			nextScheduledRunDate(new Date('2026-09-03T00:00:00.000Z'), 'yearly', 1, now).toISOString()
		).toBe('2027-09-03T00:00:00.000Z');
	});

	test('rezultatul e mereu după ziua curentă, chiar dacă următorul ciclu cade azi', () => {
		expect(
			nextScheduledRunDate(new Date('2026-09-16T00:00:00.000Z'), 'daily', 1, now).toISOString()
		).toBe('2026-09-18T00:00:00.000Z');
	});

	test('sfârșit de lună: 31 ian → 28 feb; an bisect 29 feb → 28 feb', () => {
		const jan = new Date('2027-01-31T10:00:00.000Z');
		expect(nextScheduledRunDate(jan, 'monthly', 1, jan).toISOString()).toBe(
			'2027-02-28T00:00:00.000Z'
		);
		const leap = new Date('2028-02-29T00:00:00.000Z');
		expect(nextScheduledRunDate(leap, 'yearly', 1, leap).toISOString()).toBe(
			'2029-02-28T00:00:00.000Z'
		);
	});

	test('săptămânal și interval > 1', () => {
		expect(
			nextScheduledRunDate(new Date('2026-09-17T00:00:00.000Z'), 'weekly', 2, now).toISOString()
		).toBe('2026-10-01T00:00:00.000Z');
		expect(
			nextScheduledRunDate(new Date('2026-09-17T00:00:00.000Z'), 'monthly', 3, now).toISOString()
		).toBe('2026-12-17T00:00:00.000Z');
	});

	test('ziua programată se ia din București (21:30Z = ziua următoare)', () => {
		expect(
			nextScheduledRunDate(new Date('2026-09-16T21:30:00.000Z'), 'monthly', 1, now).toISOString()
		).toBe('2026-10-17T00:00:00.000Z');
	});

	test('tip necunoscut aruncă', () => {
		expect(() => nextScheduledRunDate(now, 'hourly', 1, now)).toThrow();
	});
});
