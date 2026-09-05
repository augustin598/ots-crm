// Teste pentru logica pură PageSpeed: praguri Google, nivele, formatare ro,
// chei de săptămână ISO, verdict Core Web Vitals, următoarea rulare programată.
import { describe, test, expect } from 'bun:test';
import {
	PSI_THRESHOLDS,
	psiScoreLevel,
	psiMetricLevel,
	psiFmt,
	isoWeekKey,
	isoWeekLabel,
	isoWeekInterval,
	cwvPass,
	nextRunDate,
	scheduledRunForWeek,
	PSI_DAYS,
	PSI_HOURS
} from '../pagespeed';

describe('psiScoreLevel — praguri Lighthouse (verde ≥90, portocaliu 50–89, roșu <50)', () => {
	test('90 → good, 89 → ni, 50 → ni, 49 → poor', () => {
		expect(psiScoreLevel(90)).toBe('good');
		expect(psiScoreLevel(100)).toBe('good');
		expect(psiScoreLevel(89)).toBe('ni');
		expect(psiScoreLevel(50)).toBe('ni');
		expect(psiScoreLevel(49)).toBe('poor');
		expect(psiScoreLevel(0)).toBe('poor');
	});
	test('null/undefined → none', () => {
		expect(psiScoreLevel(null)).toBe('none');
		expect(psiScoreLevel(undefined)).toBe('none');
	});
});

describe('psiMetricLevel — praguri Google per metrică (valori în ms, cls adimensional)', () => {
	test('LCP: ≤2500 ms good, ≤4000 ni, peste → poor', () => {
		expect(psiMetricLevel('lcp', 2500)).toBe('good');
		expect(psiMetricLevel('lcp', 2501)).toBe('ni');
		expect(psiMetricLevel('lcp', 4000)).toBe('ni');
		expect(psiMetricLevel('lcp', 4001)).toBe('poor');
	});
	test('INP: ≤200 good, ≤500 ni', () => {
		expect(psiMetricLevel('inp', 200)).toBe('good');
		expect(psiMetricLevel('inp', 500)).toBe('ni');
		expect(psiMetricLevel('inp', 501)).toBe('poor');
	});
	test('CLS: ≤0.1 good, ≤0.25 ni', () => {
		expect(psiMetricLevel('cls', 0.1)).toBe('good');
		expect(psiMetricLevel('cls', 0.25)).toBe('ni');
		expect(psiMetricLevel('cls', 0.26)).toBe('poor');
	});
	test('TBT: ≤200 good, ≤600 ni; FCP: ≤1800 good; SI: ≤3400 good', () => {
		expect(psiMetricLevel('tbt', 200)).toBe('good');
		expect(psiMetricLevel('tbt', 601)).toBe('poor');
		expect(psiMetricLevel('fcp', 1800)).toBe('good');
		expect(psiMetricLevel('si', 3400)).toBe('good');
	});
	test('valoare lipsă → none', () => {
		expect(psiMetricLevel('lcp', null)).toBe('none');
		expect(psiMetricLevel('inp', undefined)).toBe('none');
	});
});

describe('psiFmt — formatare românească (virgulă zecimală)', () => {
	test('metrici în secunde (lcp/fcp/si) primesc ms și afișează s cu virgulă', () => {
		expect(psiFmt('lcp', 2500)).toBe('2,5 s');
		expect(psiFmt('fcp', 1834)).toBe('1,8 s');
		expect(psiFmt('si', 5800)).toBe('5,8 s');
	});
	test('metrici în ms (tbt/inp) rămân în ms, rotunjite', () => {
		expect(psiFmt('tbt', 204.6)).toBe('205 ms');
		expect(psiFmt('inp', 85)).toBe('85 ms');
	});
	test('cls: adimensional, virgulă, fără zerouri finale', () => {
		expect(psiFmt('cls', 0.1)).toBe('0,1');
		expect(psiFmt('cls', 0.008)).toBe('0,008');
		expect(psiFmt('cls', 0)).toBe('0');
	});
	test('null → em-dash', () => {
		expect(psiFmt('lcp', null)).toBe('—');
	});
});

describe('isoWeekKey / isoWeekLabel', () => {
	test('31 aug 2026 (marți) → 2026-W36', () => {
		expect(isoWeekKey(new Date('2026-08-31T12:00:00Z'))).toBe('2026-W36');
	});
	test('24 aug 2026 → 2026-W35; granița de an: 1 ian 2027 (vineri) → 2026-W53', () => {
		expect(isoWeekKey(new Date('2026-08-24T12:00:00Z'))).toBe('2026-W35');
		expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
	});
	test('label scurt S<nn>', () => {
		expect(isoWeekLabel('2026-W35')).toBe('S35');
	});

	test('isoWeekInterval — luni–duminică, format românesc', () => {
		expect(isoWeekInterval('2026-W36')).toBe('31 aug. – 6 sept. 2026');
		expect(isoWeekInterval('2026-W35')).toBe('24 – 30 aug. 2026');
	});
});

describe('cwvPass — verdict Core Web Vitals pe date CrUX', () => {
	test('toate sub prag → true', () => {
		expect(cwvPass({ lcpMs: 2400, inpMs: 180, cls: 0.09 })).toBe(true);
	});
	test('o metrică peste prag → false', () => {
		expect(cwvPass({ lcpMs: 2600, inpMs: 180, cls: 0.09 })).toBe(false);
		expect(cwvPass({ lcpMs: 2400, inpMs: 250, cls: 0.09 })).toBe(false);
		expect(cwvPass({ lcpMs: 2400, inpMs: 180, cls: 0.2 })).toBe(false);
	});
	test('fără date → null', () => {
		expect(cwvPass(null)).toBeNull();
		expect(cwvPass({ lcpMs: null, inpMs: 180, cls: 0.05 })).toBeNull();
	});
});

describe('nextRunDate — următoarea rulare în Europe/Bucharest', () => {
	// 2026-08-31 este luni. Ora Bucureștiului în august = UTC+3.
	test('luni 07:00 cerut luni la 05:00 → aceeași zi 07:00', () => {
		const now = new Date('2026-08-31T02:00:00Z'); // 05:00 la București
		const next = nextRunDate(1, '07:00', now);
		expect(next.toISOString()).toBe('2026-08-31T04:00:00.000Z'); // 07:00 EEST
	});
	test('luni 07:00 cerut luni la 08:00 → lunea următoare', () => {
		const now = new Date('2026-08-31T05:00:00Z'); // 08:00 la București
		const next = nextRunDate(1, '07:00', now);
		expect(next.toISOString()).toBe('2026-09-07T04:00:00.000Z');
	});
	test('duminică (7) 21:00 cerut luni → duminica aceleiași săptămâni ISO', () => {
		const now = new Date('2026-08-31T05:00:00Z');
		const next = nextRunDate(7, '21:00', now);
		expect(next.toISOString()).toBe('2026-09-06T18:00:00.000Z'); // 21:00 EEST
	});
});

describe('constante UI', () => {
	test('zilele și orele din design există', () => {
		expect(PSI_DAYS).toEqual(['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică']);
		expect(PSI_HOURS).toContain('07:00');
	});
	test('pragurile expuse pentru UI (în ms) sunt cele Google', () => {
		expect(PSI_THRESHOLDS.lcp.good).toBe(2500);
		expect(PSI_THRESHOLDS.inp.good).toBe(200);
		expect(PSI_THRESHOLDS.cls.ni).toBe(0.25);
	});
});

describe('scheduledRunForWeek — momentul programat al săptămânii (pentru catch-up)', () => {
	test('luni 07:00 în 2026-W36 = 31 aug. 2026, 04:00 UTC (EEST = UTC+3)', () => {
		expect(scheduledRunForWeek('2026-W36', 1, '07:00').toISOString()).toBe(
			'2026-08-31T04:00:00.000Z'
		);
	});

	test('vineri 18:00 în aceeași săptămână = 4 sept. 2026', () => {
		expect(scheduledRunForWeek('2026-W36', 5, '18:00').toISOString()).toBe(
			'2026-09-04T15:00:00.000Z'
		);
	});

	test('iarna (EET = UTC+2): luni 07:00 în 2026-W03', () => {
		expect(scheduledRunForWeek('2026-W03', 1, '07:00').toISOString()).toBe(
			'2026-01-12T05:00:00.000Z'
		);
	});
});
