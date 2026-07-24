import { describe, test, expect } from 'bun:test';
import { buildMonthGrid } from '../calendar';

describe('buildMonthGrid', () => {
	test('iulie 2026 începe luni și acoperă 5 săptămâni pline', () => {
		const grid = buildMonthGrid(2026, 6); // month 0-based: 6 = iulie
		expect(grid.length).toBeGreaterThanOrEqual(5);
		// fiecare săptămână are 7 zile
		for (const week of grid) expect(week.length).toBe(7);
		// prima zi a grilei e luni (getDay()===1) — săptămâna începe luni
		expect(new Date(grid[0][0].iso + 'T00:00:00').getDay()).toBe(1);
	});

	test('marchează corect zilele din afara lunii', () => {
		const grid = buildMonthGrid(2026, 6);
		const flat = grid.flat();
		const inMonth = flat.filter((d) => d.inMonth);
		expect(inMonth.length).toBe(31); // iulie are 31 zile
		expect(inMonth[0].iso).toBe('2026-07-01');
		expect(inMonth[inMonth.length - 1].iso).toBe('2026-07-31');
	});

	test('iso e stabil (YYYY-MM-DD, zero-padded)', () => {
		const grid = buildMonthGrid(2026, 0); // ianuarie
		expect(grid.flat().find((d) => d.inMonth)?.iso).toBe('2026-01-01');
	});
});
