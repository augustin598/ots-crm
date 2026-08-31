import { describe, test, expect } from 'bun:test';
import {
	rowMonthly,
	rowAppliesTo,
	fixedMonthlyFor,
	monthsInScope,
	computeKpi,
	computeDelta,
	fmtLei,
	fmtLeiFine,
	buildKpiCsv,
	PLATFORM_IDS,
	type FixedCostRow,
	type KpiYearData
} from '$lib/logic/interviuri-kpi';

/**
 * Formulele paginii „KPI Performanță" (cost pe interviu). Modulul e pur și e
 * folosit identic de server și de UI — testele de aici sunt contractul pe care
 * îl garantează ambele.
 */

const row = (p: Partial<FixedCostRow> = {}): FixedCostRow => ({
	id: 'f',
	name: 'x',
	note: null,
	qty: 1,
	unitAmount: 0,
	unitLabel: null,
	frequency: 'monthly',
	active: true,
	validFrom: null,
	validTo: null,
	...p
});

// criteriul de acceptare 1: 4×8000 + 1×940 + 1×2500 = 35.440 lei/lună
const DEFAULT_ROWS: FixedCostRow[] = [
	row({ id: 'f1', qty: 4, unitAmount: 8000 }),
	row({ id: 'f2', qty: 1, unitAmount: 940 }),
	row({ id: 'f3', qty: 1, unitAmount: 2500 })
];
const CHANNELS = [
	'TikTok',
	'Google / SEO',
	'Recomandare',
	'Instagram',
	'Facebook',
	'AI (ChatGPT)',
	'YouTube',
	'Site / Anunț',
	'Nespecificat'
];

function year2026(): KpiYearData {
	// 7 luni de ads (ian–iul), interviuri în ian–aug (august fără ads)
	const months = [1, 2, 3, 4, 5, 6, 7].map((m) => ({
		monthNum: m,
		spend: { tiktok: 1000 * m, google: 500, meta: 200 }
	}));
	const iv = (
		monthNum: number,
		channel: string,
		status: 'admisa' | 'respinsa' | 'in_evaluare' = 'in_evaluare'
	) => ({ monthNum, channel, status });
	return {
		year: 2026,
		months,
		interviews: [
			iv(1, 'TikTok', 'admisa'),
			iv(1, 'TikTok'),
			iv(1, 'Google / SEO', 'admisa'),
			iv(2, 'Recomandare'),
			iv(2, 'Instagram', 'admisa'),
			iv(2, 'Facebook'),
			iv(3, 'Nespecificat'),
			iv(5, 'TikTok', 'respinsa'),
			iv(8, 'YouTube')
		]
	};
}
const base = (over: Partial<Parameters<typeof computeKpi>[0]> = {}) =>
	computeKpi({
		data: year2026(),
		fixedRows: DEFAULT_ROWS,
		month: 'all',
		mode: 'toate',
		channelOrder: CHANNELS,
		...over
	});

describe('rânduri fixe', () => {
	test('rowMonthly: lunar = qty×unit, anual ÷12', () => {
		expect(rowMonthly(row({ qty: 4, unitAmount: 8000 }))).toBe(32000);
		expect(rowMonthly(row({ qty: 1, unitAmount: 1200, frequency: 'yearly' }))).toBe(100);
	});
	test('rowAppliesTo respectă active + valid_from/valid_to (YYYY-MM inclusiv)', () => {
		expect(rowAppliesTo(row({ active: false }), '2026-03')).toBe(false);
		const r = row({ validFrom: '2026-03', validTo: '2026-05' });
		expect(rowAppliesTo(r, '2026-02')).toBe(false);
		expect(rowAppliesTo(r, '2026-03')).toBe(true);
		expect(rowAppliesTo(r, '2026-05')).toBe(true);
		expect(rowAppliesTo(r, '2026-06')).toBe(false);
	});
	test('fixedMonthlyFor: implicitele dau 35.440/lună', () => {
		expect(fixedMonthlyFor(DEFAULT_ROWS, 2026, 1)).toBe(35440);
	});
});

describe('luni în scop', () => {
	test('include lunile cu ads SAU interviuri, exclude restul', () => {
		expect(monthsInScope(year2026())).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe('computeKpi', () => {
	test('criteriul 1: 7 luni ads + august doar interviuri → fixe = 8 × 35.440, total = ads + fixe', () => {
		const k = base();
		const ads = [1, 2, 3, 4, 5, 6, 7].reduce((s, m) => s + 1000 * m + 700, 0);
		expect(k.scopeMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(k.adsTotal).toBe(ads);
		expect(k.fixedTotal).toBe(8 * 35440);
		expect(k.total).toBe(ads + 8 * 35440);
		expect(k.n).toBe(9);
		expect(k.nOk).toBe(3);
		expect(k.nPaid).toBe(6); // TikTok×3, Google, Instagram, Facebook
		expect(k.cpi).toBeCloseTo(k.total / 9, 6);
		expect(k.cpiOk).toBeCloseTo(k.total / 3, 6);
		expect(k.cpiAds).toBeCloseTo(ads / 6, 6);
		expect(k.activeFixedRows).toBe(3);
		expect(k.fixedMonthly).toBe(35440);
	});
	test('criteriul 1 (cu 7 luni exact): fixe = 248.080', () => {
		const d = year2026();
		d.interviews = d.interviews.filter((i) => i.monthNum <= 7);
		const k = computeKpi({
			data: d,
			fixedRows: DEFAULT_ROWS,
			month: 'all',
			mode: 'toate',
			channelOrder: CHANNELS
		});
		expect(k.fixedTotal).toBe(248080);
	});
	test('criteriul 5: suma coloanelor pe platformă din rândurile lunare = bugetul ads', () => {
		for (const month of ['all', 3] as const) {
			const k = base({ month });
			const rows = month === 'all' ? k.monthRows : k.monthRows.filter((r) => r.monthNum === month);
			const sum = rows.reduce((s, r) => s + PLATFORM_IDS.reduce((a, id) => a + r.ads[id], 0), 0);
			expect(sum).toBeCloseTo(k.adsTotal, 6);
		}
	});
	test('suma bugetelor lunare = bugetul total al anului', () => {
		const k = base();
		expect(k.monthRows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(k.total, 6);
	});
	test('lună cu cheltuială dar fără interviuri → cpi null, buget inclus', () => {
		const k = base();
		const apr = k.monthRows.find((r) => r.monthNum === 4)!;
		expect(apr.n).toBe(0);
		expect(apr.cpi).toBeNull();
		expect(apr.total).toBe(4000 + 700 + 35440);
	});
	test('criteriul 2: dezactivarea unui rând schimbă toate agregatele', () => {
		const rows = DEFAULT_ROWS.map((r) => (r.id === 'f1' ? { ...r, active: false } : r));
		const k = base({ fixedRows: rows });
		expect(k.fixedTotal).toBe(8 * 3440);
		expect(k.monthRows[0].fixed).toBe(3440);
		expect(k.channelRows.reduce((s, r) => s + r.fixed, 0)).toBeCloseTo(8 * 3440, 6);
		expect(k.activeFixedRows).toBe(2);
	});
	test('valid_from/valid_to: rândul intră doar în lunile din interval', () => {
		const rows = [row({ id: 'a', qty: 1, unitAmount: 100, validFrom: '2026-03', validTo: '2026-04' })];
		const k = base({ fixedRows: rows });
		expect(k.fixedTotal).toBe(200);
		expect(k.monthRows.find((r) => r.monthNum === 2)!.fixed).toBe(0);
		expect(k.monthRows.find((r) => r.monthNum === 3)!.fixed).toBe(100);
	});
	test('selectarea unei luni restrânge scopul la acea lună', () => {
		const k = base({ month: 1 });
		expect(k.scopeMonths).toEqual([1]);
		expect(k.adsTotal).toBe(1700);
		expect(k.fixedTotal).toBe(35440);
		expect(k.n).toBe(3);
		expect(k.monthRows.length).toBe(8); // graficul rămâne pe tot anul
	});
	test('împărțire la zero → null (niciodată 0/∞)', () => {
		const d: KpiYearData = {
			year: 2026,
			months: [{ monthNum: 1, spend: { tiktok: 100, google: 0, meta: 0 } }],
			interviews: []
		};
		const k = computeKpi({ data: d, fixedRows: [], month: 'all', mode: 'toate', channelOrder: CHANNELS });
		expect(k.cpi).toBeNull();
		expect(k.cpiOk).toBeNull();
		expect(k.cpiAds).toBeNull();
	});
	test('an gol: fixedMonthly arată tariful rândurilor active', () => {
		const d: KpiYearData = { year: 2024, months: [], interviews: [] };
		const k = computeKpi({ data: d, fixedRows: DEFAULT_ROWS, month: 'all', mode: 'toate', channelOrder: CHANNELS });
		expect(k.scopeMonths).toEqual([]);
		expect(k.fixedTotal).toBe(0);
		expect(k.fixedMonthly).toBe(35440);
	});
});

describe('cost pe canal', () => {
	test('ads_canal = spend platformă × cota canalului din interviurile platformei; organicele n-au ads', () => {
		const k = base({ month: 2 }); // feb: Recomandare, Instagram(admisă), Facebook; meta=200
		const ig = k.channelRows.find((r) => r.channel === 'Instagram')!;
		const fb = k.channelRows.find((r) => r.channel === 'Facebook')!;
		const rec = k.channelRows.find((r) => r.channel === 'Recomandare')!;
		expect(ig.ads).toBeCloseTo(100, 6);
		expect(fb.ads).toBeCloseTo(100, 6);
		expect(rec.ads).toBe(0);
		expect(rec.paid).toBe(false);
		expect(ig.paid).toBe(true);
	});
	test('mod „toate": fixele se împart pe toate interviurile (inclusiv Nespecificat)', () => {
		const k = base();
		const nes = k.channelRows.find((r) => r.channel === 'Nespecificat')!;
		expect(nes.ads).toBe(0);
		expect(nes.fixed).toBeCloseTo(k.fixedTotal / 9, 6);
		expect(k.channelRows.reduce((s, r) => s + r.fixed, 0)).toBeCloseTo(k.fixedTotal, 6);
	});
	test('mod „plătite": organicele primesc 0 fixe, suma pe plătite = fix_total', () => {
		const k = base({ mode: 'platite' });
		const nes = k.channelRows.find((r) => r.channel === 'Nespecificat')!;
		const tt = k.channelRows.find((r) => r.channel === 'TikTok')!;
		expect(nes.fixed).toBe(0);
		expect(tt.fixed).toBeCloseTo(k.fixedTotal * (3 / 6), 6);
		expect(k.channelRows.filter((r) => r.paid).reduce((s, r) => s + r.fixed, 0)).toBeCloseTo(
			k.fixedTotal,
			6
		);
	});
	test('suma ads pe canalele unei platforme = bugetul platformei; sortare desc după interviuri', () => {
		const k = base();
		const tt = k.channelRows.find((r) => r.channel === 'TikTok')!;
		expect(tt.ads).toBeCloseTo(k.adsByPlatform.tiktok, 6);
		const metaSum = k.channelRows
			.filter((r) => ['Facebook', 'Instagram'].includes(r.channel))
			.reduce((s, r) => s + r.ads, 0);
		expect(metaSum).toBeCloseTo(k.adsByPlatform.meta, 6);
		expect(k.channelRows[0].channel).toBe('TikTok');
		for (let i = 1; i < k.channelRows.length; i++) {
			expect(k.channelRows[i - 1].n).toBeGreaterThanOrEqual(k.channelRows[i].n);
		}
	});
	test('platformă cu spend dar fără interviuri din canalele ei → buget nealocat, raportat', () => {
		const k = base({ month: 3 }); // martie: doar „Nespecificat"; spend tiktok 3000 + google 500 + meta 200
		expect(k.channelRows.map((r) => r.channel)).toEqual(['Nespecificat']);
		expect(k.unallocatedAds).toBeCloseTo(3700, 6);
		expect(k.unallocatedFixed).toBe(0); // „toate": Nespecificat ia toate fixele
		const kp = base({ month: 3, mode: 'platite' });
		expect(kp.unallocatedFixed).toBeCloseTo(35440, 6); // niciun interviu plătit → fixele nealocate
		expect(base().unallocatedAds).toBeCloseTo(0, 6);
	});
	test('canal necunoscut (neinclus în channelOrder) apare totuși', () => {
		const d = year2026();
		d.interviews.push({ monthNum: 1, channel: 'Canal nou', status: 'in_evaluare' });
		const k = computeKpi({ data: d, fixedRows: [], month: 'all', mode: 'toate', channelOrder: CHANNELS });
		expect(k.channelRows.some((r) => r.channel === 'Canal nou')).toBe(true);
	});
});

describe('delta față de perioada anterioară', () => {
	test('tot anul → vs anul precedent', () => {
		const cur = base();
		const prev: KpiYearData = {
			year: 2025,
			months: [{ monthNum: 1, spend: { tiktok: 1000, google: 0, meta: 0 } }],
			interviews: [{ monthNum: 1, channel: 'TikTok', status: 'admisa' }]
		};
		const d = computeDelta({
			current: cur,
			month: 'all',
			previous: prev,
			fixedRows: DEFAULT_ROWS,
			mode: 'toate',
			channelOrder: CHANNELS
		})!;
		expect(d.label).toBe('2025');
		expect(d.prev).toBe(36440);
		expect(d.pct).toBe(Math.round(((cur.cpi! - 36440) / 36440) * 100));
	});
	test('lună selectată → vs luna precedentă din scop; prima lună → null', () => {
		const cur = base({ month: 2 });
		const d = computeDelta({
			current: cur,
			month: 2,
			previous: null,
			fixedRows: DEFAULT_ROWS,
			mode: 'toate',
			channelOrder: CHANNELS
		})!;
		expect(d.label).toBe('Ianuarie');
		expect(
			computeDelta({
				current: base({ month: 1 }),
				month: 1,
				previous: null,
				fixedRows: DEFAULT_ROWS,
				mode: 'toate',
				channelOrder: CHANNELS
			})
		).toBeNull();
	});
	test('luna precedentă din scop fără interviuri (cpi null) → null, nu sare peste ea', () => {
		// aprilie n-are interviuri → pentru mai, „luna precedentă" e aprilie cu cpi null
		expect(
			computeDelta({
				current: base({ month: 5 }),
				month: 5,
				previous: null,
				fixedRows: DEFAULT_ROWS,
				mode: 'toate',
				channelOrder: CHANNELS
			})
		).toBeNull();
	});
	test('fără an precedent sau fără interviuri → null', () => {
		expect(
			computeDelta({
				current: base(),
				month: 'all',
				previous: null,
				fixedRows: [],
				mode: 'toate',
				channelOrder: CHANNELS
			})
		).toBeNull();
	});
});

describe('formatare ro-RO', () => {
	test('fmtLei fără zecimale; fmtLeiFine cu o zecimală sub 100; null → —', () => {
		expect(fmtLei(248080)).toBe('248.080 lei');
		expect(fmtLeiFine(42.345)).toBe('42,3 lei');
		expect(fmtLeiFine(1234.6)).toBe('1.235 lei');
		expect(fmtLeiFine(null)).toBe('—');
	});
	test('CSV: antet + un rând pe lună + BOM', () => {
		const csv = buildKpiCsv(base().monthRows);
		const lines = csv.split('\n');
		expect(lines[0].startsWith('﻿"Luna"')).toBe(true);
		expect(lines.length).toBe(1 + 8);
		expect(lines[1]).toContain('"Ianuarie"');
	});
});
