// Teste pentru logica pură Rank Tracker: tabelul CTR, vizibilitate, share of voice,
// delte de poziție, ferestre de lookback, pagini Google, buckete, canibalizare,
// cheia zilei în Europe/Bucharest, parsarea localizării. ZERO mockuri — modul pur.
import { describe, test, expect } from 'bun:test';
import {
	ctrForPosition,
	visibility,
	shareOfVoice,
	positionDelta,
	snapshotAtLookback,
	pageForPosition,
	fmtPosition,
	bucketForPosition,
	distribution,
	bestPosition,
	detectCannibalization,
	rankDayKey,
	parseLocale,
	RANK_HOURS,
	// re-exporturi din ../pagespeed (nu reimplementate)
	isoWeekKey,
	isoWeekInterval,
	isoWeekLabel,
	nextRunDate,
	PSI_HOURS
} from '../rank-tracker';

describe('ctrForPosition — tabelul CTR din spec (1→31.7 … 100→0.1, restul 0)', () => {
	test('pozițiile 1–10 sunt exact din tabel', () => {
		expect(ctrForPosition(1)).toBe(31.7);
		expect(ctrForPosition(2)).toBe(24.7);
		expect(ctrForPosition(3)).toBe(18.7);
		expect(ctrForPosition(4)).toBe(13.6);
		expect(ctrForPosition(5)).toBe(9.5);
		expect(ctrForPosition(6)).toBe(6.3);
		expect(ctrForPosition(7)).toBe(4.3);
		expect(ctrForPosition(8)).toBe(3.1);
		expect(ctrForPosition(9)).toBe(2.6);
		expect(ctrForPosition(10)).toBe(2.4);
	});
	test('intervalele 11–20, 21–50, 51–100 sunt plate', () => {
		expect(ctrForPosition(11)).toBe(1.1);
		expect(ctrForPosition(20)).toBe(1.1);
		expect(ctrForPosition(21)).toBe(0.35);
		expect(ctrForPosition(50)).toBe(0.35);
		expect(ctrForPosition(51)).toBe(0.1);
		expect(ctrForPosition(100)).toBe(0.1);
	});
	test('peste 100 sau null → 0', () => {
		expect(ctrForPosition(101)).toBe(0);
		expect(ctrForPosition(null)).toBe(0);
	});
});

describe('visibility — Σ ctr / (n × ctr(1)) × 100, o zecimală', () => {
	test('cazuri de bază: [] → 0, [1] → 100, [null,null] → 0', () => {
		expect(visibility([])).toBe(0);
		expect(visibility([1])).toBe(100);
		expect(visibility([null, null])).toBe(0);
	});
	test('un singur null trage media în jos: [1, null] → 50', () => {
		expect(visibility([1, null])).toBe(50);
	});
	test('valori intermediare, rotunjite la o zecimală', () => {
		expect(visibility([2])).toBe(77.9); // 24.7/31.7*100
		expect(visibility([1, 10])).toBe(53.8); // (31.7+2.4)/(2*31.7)*100
	});
});

describe('shareOfVoice — visibility pe fiecare domeniu', () => {
	test('per cheie, pe array-ul propriu', () => {
		const sov = shareOfVoice({ noi: [1, 1], ei: [null, 10] });
		expect(sov.noi).toBe(100);
		expect(sov.ei).toBe(3.8); // (0+2.4)/(2*31.7)*100
	});
});

describe('positionDelta — delta = then − now (pozitiv = urcare)', () => {
	test('ambele numere: urcare, coborâre, egal', () => {
		expect(positionDelta(10, 5)).toEqual({ delta: 5, kind: 'up' });
		expect(positionDelta(5, 10)).toEqual({ delta: -5, kind: 'down' });
		expect(positionDelta(7, 7)).toEqual({ delta: 0, kind: 'flat' });
	});
	test('intrare / ieșire din top / niciunul', () => {
		expect(positionDelta(null, 3)).toEqual({ delta: null, kind: 'entered' });
		expect(positionDelta(3, null)).toEqual({ delta: null, kind: 'lost' });
		expect(positionDelta(null, null)).toEqual({ delta: null, kind: 'none' });
	});
});

describe('snapshotAtLookback — cel mai apropiat instantaneu în fereastra ±toleranță', () => {
	const series = [
		{ dayKey: '2026-08-31', position: 5 }, // 30 zile înainte de 2026-09-30
		{ dayKey: '2026-09-23', position: 3 }, // 7 zile înainte
		{ dayKey: '2026-09-29', position: 1 } // 1 zi înainte
	];
	test('7 zile ±2 → instantaneul de la 7 zile', () => {
		expect(snapshotAtLookback(series, '2026-09-30', 7, 2)).toEqual({
			dayKey: '2026-09-23',
			position: 3
		});
	});
	test('30 zile ±0 → fix instantaneul de la 30 zile', () => {
		expect(snapshotAtLookback(series, '2026-09-30', 30, 0)).toEqual({
			dayKey: '2026-08-31',
			position: 5
		});
	});
	test('fereastra goală → null', () => {
		expect(snapshotAtLookback(series, '2026-09-30', 14, 1)).toBeNull();
	});
	test('la egalitate câștigă cel mai recent (diff mai mic)', () => {
		const tie = [
			{ dayKey: '2026-09-22', position: 8 }, // diff 8, |8−7|=1
			{ dayKey: '2026-09-24', position: 6 } // diff 6, |6−7|=1
		];
		expect(snapshotAtLookback(tie, '2026-09-30', 7, 3)).toEqual({
			dayKey: '2026-09-24',
			position: 6
		});
		// și nesortat, același rezultat
		expect(snapshotAtLookback([...tie].reverse(), '2026-09-30', 7, 3)).toEqual({
			dayKey: '2026-09-24',
			position: 6
		});
	});
});

describe('pageForPosition — Math.ceil(pos/10)', () => {
	test('pagina Google din poziție', () => {
		expect(pageForPosition(1)).toBe(1);
		expect(pageForPosition(10)).toBe(1);
		expect(pageForPosition(11)).toBe(2);
		expect(pageForPosition(100)).toBe(10);
		expect(pageForPosition(null)).toBeNull();
	});
});

describe('fmtPosition — null → „100+", altfel numărul', () => {
	test('formatare', () => {
		expect(fmtPosition(null)).toBe('100+');
		expect(fmtPosition(5)).toBe('5');
		expect(fmtPosition(100)).toBe('100');
	});
});

describe('bucketForPosition / distribution — cele 6 buckete', () => {
	test('granițele fiecărui bucket', () => {
		expect(bucketForPosition(1)).toBe('1-3');
		expect(bucketForPosition(3)).toBe('1-3');
		expect(bucketForPosition(4)).toBe('4-10');
		expect(bucketForPosition(10)).toBe('4-10');
		expect(bucketForPosition(11)).toBe('11-20');
		expect(bucketForPosition(20)).toBe('11-20');
		expect(bucketForPosition(21)).toBe('21-50');
		expect(bucketForPosition(50)).toBe('21-50');
		expect(bucketForPosition(51)).toBe('51-100');
		expect(bucketForPosition(100)).toBe('51-100');
		expect(bucketForPosition(101)).toBe('100+');
		expect(bucketForPosition(null)).toBe('100+');
	});
	test('distribution numără pe buckete, toate cele 6 chei prezente', () => {
		expect(distribution([1, 2, 5, 15, 30, 80, 101, null])).toEqual({
			'1-3': 2,
			'4-10': 1,
			'11-20': 1,
			'21-50': 1,
			'51-100': 1,
			'100+': 2
		});
	});
	test('array gol → toate zero, dar toate cheile prezente', () => {
		expect(distribution([])).toEqual({
			'1-3': 0,
			'4-10': 0,
			'11-20': 0,
			'21-50': 0,
			'51-100': 0,
			'100+': 0
		});
	});
});

describe('bestPosition — minimul valorilor non-null', () => {
	test('minim / doar null / gol', () => {
		expect(bestPosition([5, 3, null, 8])).toBe(3);
		expect(bestPosition([null, null])).toBeNull();
		expect(bestPosition([])).toBeNull();
	});
});

describe('detectCannibalization — ≥2 URL-uri distincte non-null', () => {
	test('2 URL-uri distincte → flagged, ordine de primă apariție', () => {
		const snaps = [
			{ dayKey: '2026-09-01', rankingUrl: '/a' },
			{ dayKey: '2026-09-02', rankingUrl: '/b' },
			{ dayKey: '2026-09-03', rankingUrl: '/a' },
			{ dayKey: '2026-09-04', rankingUrl: null }
		];
		expect(detectCannibalization(snaps)).toEqual({ flagged: true, urls: ['/a', '/b'] });
	});
	test('un singur URL (repetat) → nu e flagged', () => {
		const snaps = [
			{ dayKey: '2026-09-01', rankingUrl: '/a' },
			{ dayKey: '2026-09-02', rankingUrl: '/a' },
			{ dayKey: '2026-09-03', rankingUrl: null }
		];
		expect(detectCannibalization(snaps)).toEqual({ flagged: false, urls: ['/a'] });
	});
	test('toate null → gol, nu e flagged', () => {
		expect(
			detectCannibalization([
				{ dayKey: '2026-09-01', rankingUrl: null },
				{ dayKey: '2026-09-02', rankingUrl: null }
			])
		).toEqual({ flagged: false, urls: [] });
	});
});

describe('rankDayKey — ziua de perete Europe/Bucharest (YYYY-MM-DD)', () => {
	test('vara EEST (UTC+3): 21:30Z → ziua următoare', () => {
		expect(rankDayKey(new Date('2026-09-01T21:30:00Z'))).toBe('2026-09-02');
	});
	test('iarna EET (UTC+2): 23:30Z → ziua următoare; 10:00Z → aceeași zi', () => {
		expect(rankDayKey(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
		expect(rankDayKey(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15');
	});
	test('tz explicit UTC nu deplasează ziua', () => {
		expect(rankDayKey(new Date('2026-09-01T21:30:00Z'), 'UTC')).toBe('2026-09-01');
	});
});

describe('parseLocale — „google.ro|ro" → {googleDomain, hl, gl}', () => {
	test('TLD de 2 litere devine gl', () => {
		expect(parseLocale('google.ro|ro')).toEqual({ googleDomain: 'google.ro', hl: 'ro', gl: 'ro' });
		expect(parseLocale('google.de|de')).toEqual({ googleDomain: 'google.de', hl: 'de', gl: 'de' });
	});
	test('TLD non-2-litere (com) → gl „us"', () => {
		expect(parseLocale('google.com|en')).toEqual({
			googleDomain: 'google.com',
			hl: 'en',
			gl: 'us'
		});
	});
});

describe('RANK_HOURS — 24 de ore HH:00 pentru verificarea zilnică', () => {
	test('lungime 24, prima și ultima corecte', () => {
		expect(RANK_HOURS).toHaveLength(24);
		expect(RANK_HOURS[0]).toBe('00:00');
		expect(RANK_HOURS[23]).toBe('23:00');
		expect(RANK_HOURS).toContain('13:00');
	});
});

describe('re-exporturi din ../pagespeed (byte-for-byte)', () => {
	test('funcțiile ISO și programarea sunt disponibile din rank-tracker', () => {
		expect(isoWeekKey(new Date('2026-08-31T12:00:00Z'))).toBe('2026-W36');
		expect(isoWeekLabel('2026-W35')).toBe('S35');
		expect(isoWeekInterval('2026-W36')).toBe('31 aug. – 6 sept. 2026');
		expect(typeof nextRunDate).toBe('function');
		expect(PSI_HOURS).toContain('07:00');
	});
});

/* Audit 2 sep. 2026: fereastra `daysAgo=1, tolerance=2` ajungea la [-1, 3] și includea
 * instantaneul de AZI. La egalitate de scor câștiga `diff` mai mic, deci ziua curentă
 * devenea propria referință și `delta1` ieșea 0. */
describe('snapshotAtLookback — nu se compară ziua cu ea însăși', () => {
	test('cu ziua de ieri lipsă, delta1 NU alege ziua curentă ca referință', () => {
		const series = [
			{ dayKey: '2026-09-02', position: 30 }, // azi
			{ dayKey: '2026-08-31', position: 5 } // acum 2 zile
		];
		const base = snapshotAtLookback(series, '2026-09-02', 1, 2);
		expect(base?.dayKey).toBe('2026-08-31');
		expect(positionDelta(base?.position ?? null, 30).delta).toBe(-25);
	});

	test('cu ziua de ieri prezentă, o alege pe ea', () => {
		const series = [
			{ dayKey: '2026-09-02', position: 12 },
			{ dayKey: '2026-09-01', position: 10 },
			{ dayKey: '2026-08-31', position: 5 }
		];
		expect(snapshotAtLookback(series, '2026-09-02', 1, 2)?.dayKey).toBe('2026-09-01');
	});

	test('ferestrele de 7 și 30 de zile rămân neschimbate', () => {
		const series = [
			{ dayKey: '2026-09-02', position: 9 },
			{ dayKey: '2026-08-26', position: 4 },
			{ dayKey: '2026-08-03', position: 20 }
		];
		expect(snapshotAtLookback(series, '2026-09-02', 7, 3)?.dayKey).toBe('2026-08-26');
		expect(snapshotAtLookback(series, '2026-09-02', 30, 5)?.dayKey).toBe('2026-08-03');
	});
});
