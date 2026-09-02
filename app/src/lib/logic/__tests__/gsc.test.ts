// Teste pentru logica pură GSC: fereastra de tragere, parsarea rândurilor
// searchanalytics și semnalul de divergență față de poziția scrapată. ZERO mockuri.
import { describe, test, expect } from 'bun:test';
import { gscPullWindow, parseGscRows, gscTrust } from '../gsc';

describe('gscPullWindow — retragem 7 zile la fiecare rulare', () => {
	test('fereastra se termină azi și acoperă 7 zile', () => {
		const w = gscPullWindow(new Date('2026-09-02T10:00:00Z'));
		expect(w.endDate).toBe('2026-09-02');
		expect(w.startDate).toBe('2026-08-27');
	});

	test('numărul de zile e configurabil', () => {
		const w = gscPullWindow(new Date('2026-09-02T10:00:00Z'), 3);
		expect(w).toEqual({ startDate: '2026-08-31', endDate: '2026-09-02' });
	});

	test('traversează granița de lună', () => {
		expect(gscPullWindow(new Date('2026-03-02T00:00:00Z'), 4).startDate).toBe('2026-02-27');
	});
});

describe('parseGscRows — dimensiunile sunt [query, device, date]', () => {
	const row = (keys: string[], over: Record<string, number> = {}) => ({
		keys,
		clicks: 5,
		impressions: 100,
		ctr: 0.05,
		position: 7.4,
		...over
	});

	test('mapează un rând complet, cu CTR convertit în procente', () => {
		expect(parseGscRows([row(['videochat iasi', 'DESKTOP', '2026-09-01'])])).toEqual([
			{
				keyword: 'videochat iasi',
				device: 'desktop',
				date: '2026-09-01',
				clicks: 5,
				impressions: 100,
				ctr: 5,
				position: 7.4
			}
		]);
	});

	test('normalizează interogarea (spații multiple, majuscule)', () => {
		const [r] = parseGscRows([row(['  Studio   Videochat ', 'MOBILE', '2026-09-01'])]);
		expect(r.keyword).toBe('studio videochat');
		expect(r.device).toBe('mobile');
	});

	test('TABLET se ignoră — nu urmărim tablete nicăieri în modul', () => {
		expect(parseGscRows([row(['x', 'TABLET', '2026-09-01'])])).toEqual([]);
	});

	test('rânduri fără interogare, fără dată validă sau fără keys → ignorate', () => {
		expect(
			parseGscRows([
				row(['', 'DESKTOP', '2026-09-01']),
				row(['x', 'DESKTOP', 'ieri']),
				{ clicks: 1, impressions: 2, ctr: 0.5, position: 1 }
			])
		).toEqual([]);
	});

	test('intrare non-array → listă goală, fără excepție', () => {
		expect(parseGscRows(undefined)).toEqual([]);
		expect(parseGscRows(null)).toEqual([]);
	});

	test('valorile lipsă devin 0, nu undefined', () => {
		const [r] = parseGscRows([{ keys: ['a', 'DESKTOP', '2026-09-01'] }]);
		expect(r).toEqual({
			keyword: 'a',
			device: 'desktop',
			date: '2026-09-01',
			clicks: 0,
			impressions: 0,
			ctr: 0,
			position: 0
		});
	});
});

describe('gscTrust — semnalul care ar fi prins cazul heylux', () => {
	test('noi n-am găsit nimic, dar Google raportează afișări → scrape-missing', () => {
		expect(gscTrust(null, 8.2, 340)).toBe('scrape-missing');
	});

	test('noi n-am găsit nimic și nici Google nu are afișări → ok', () => {
		expect(gscTrust(null, null, 0)).toBe('ok');
	});

	test('pozițiile sunt apropiate → ok', () => {
		expect(gscTrust(7, 8.2, 340)).toBe('ok');
		expect(gscTrust(7, 16.9, 340)).toBe('ok');
	});

	test('diferență de cel puțin 10 poziții → divergent', () => {
		expect(gscTrust(3, 13, 340)).toBe('divergent');
		expect(gscTrust(40, 5.5, 340)).toBe('divergent');
	});

	test('fără date GSC (0 afișări) nu declarăm niciodată divergență', () => {
		expect(gscTrust(3, 90, 0)).toBe('ok');
		expect(gscTrust(3, null, 120)).toBe('ok');
	});
});
