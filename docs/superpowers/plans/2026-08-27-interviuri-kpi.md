# Interviuri — pagina „KPI Performanță" (cost pe interviu)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pagină secundară `/[tenant]/interviuri/kpi` („KPI Performanță") care răspunde la „cât ne costă un interviu": buget ads (Meta/TikTok/Google, din tabelele `*_ads_spending` deja sincronizate) + cheltuieli fixe de marketing (tabel nou, editor inline), 1:1 cu prototipul Claude Design `Interviuri KPI.html` (`interviuri-kpi.jsx`, `interviuri-kpi-data.jsx`, `interviuri-kpi-styles.css`).

**Architecture:**
- **Formulele** trăiesc într-un singur modul pur `$lib/logic/interviuri-kpi.ts` (fără DB/DOM), folosit și de server, și de UI → cifrele din carduri, grafic, tabele și CSV nu pot diverge. Filtrarea pe lună se face în client (query-ul aduce tot anul + anul precedent pentru delta).
- **Sursa de ads:** nu creăm tabel `ad_spend_monthly`; agregăm la citire din `meta_ads_spending` / `tiktok_ads_spending` / `google_ads_spending` pentru **clienții asociați interviurilor** (`interview.client_id` distinct pe tenant — în prod toate interviurile sunt pe „Lucky Group", care are conturi pe toate trei platformele; Google e în USD → conversie BNR la cursul de la sfârșitul lunii, `loadBnrFxRates`).
- **Cheltuieli fixe:** tabel nou `marketing_fixed_cost` (tenant-scoped, sume în **cenți** ca restul CRM-ului, `valid_from`/`valid_to` ca `YYYY-MM`), seed cu cele 3 rânduri implicite din prototip la prima citire (idempotent, ca `ensureChannelsSeeded`), „Resetează la implicit" le reface.
- **API:** remote functions (standardul CRM), nu rute REST: `getInterviewKpiData`, `getMarketingFixedCosts`, `create/update/delete/resetMarketingFixedCost(s)`, `syncInterviewAdsBudgets`. CSV-ul se generează în browser din rândurile lunare afișate (criteriul 6 „exact rândurile afișate" e garantat structural).
- **Permisiuni:** citire = `requireStaff` (ca pagina Interviuri); scriere pe cheltuieli fixe = `tenantUser.role ∈ {owner, admin}`; UI primește `canEdit` și dezactivează editorul.

**Tech Stack:** SvelteKit 5 (runes, remote functions), Drizzle + libSQL, valibot, svelte-sonner (toast), lucide icons, CSS `interviuri.css` (tokeni `--cl-*`) + `interviuri-kpi.css` (clasele `ivk-*` din prototip).

**Ipoteze/deviații (documentate):**
1. Filtrul `studio` din spec NU are UI în prototip → nu se implementează (conturile de ads sunt per client, nu per studio; nu s-ar putea împărți corect).
2. `valid_from`/`valid_to` sunt în schemă, în logică (testate) și acceptate de comenzi, dar editorul inline din prototip nu are coloane pentru ele → fără UI în această iterație (follow-up).
3. Endpoint-urile REST din spec sunt înlocuite de remote functions; CSV = client-side.
4. „Sincronizează bugetele" rulează cele trei sync-uri existente (`syncMetaAdsInvoicesForTenant`, `syncTiktokAdsSpendingForTenant`, `syncGoogleAdsInvoicesForTenant`) secvențial, fiecare în try/catch; poate dura zeci de secunde (Google descarcă și facturi).

**Teste:** `bun run test interviuri-kpi` (Bun, proces per fișier). Logica pură + agregarea spend + gating-ul de rol/tenant pe comenzi sunt testate unitar; UI-ul se verifică în browser (testermcp) + design-auditor.

---

### Task 1: Modulul pur de formule `$lib/logic/interviuri-kpi.ts` (TDD)

**Files:**
- Create: `app/src/lib/logic/interviuri-kpi.ts`
- Test: `app/src/lib/logic/__tests__/interviuri-kpi.test.ts`

- [ ] **Step 1: Scrie testele** (`app/src/lib/logic/__tests__/interviuri-kpi.test.ts`)

```ts
import { describe, test, expect } from 'bun:test';
import {
	rowMonthly, rowAppliesTo, fixedMonthlyFor, monthsInScope, computeKpi, computeDelta,
	fmtLei, fmtLeiFine, buildKpiCsv, PLATFORM_IDS, type FixedCostRow, type KpiYearData
} from '$lib/logic/interviuri-kpi';

const row = (p: Partial<FixedCostRow> = {}): FixedCostRow => ({
	id: 'f', name: 'x', note: null, qty: 1, unitAmount: 0, unitLabel: null,
	frequency: 'monthly', active: true, validFrom: null, validTo: null, ...p
});
// criteriul de acceptare 1: 4×8000 + 1×940 + 1×2500 = 35.440 lei/lună
const DEFAULT_ROWS: FixedCostRow[] = [
	row({ id: 'f1', qty: 4, unitAmount: 8000 }),
	row({ id: 'f2', qty: 1, unitAmount: 940 }),
	row({ id: 'f3', qty: 1, unitAmount: 2500 })
];
const CHANNELS = ['TikTok', 'Google / SEO', 'Recomandare', 'Instagram', 'Facebook', 'AI (ChatGPT)', 'YouTube', 'Site / Anunț', 'Nespecificat'];

function year2026(): KpiYearData {
	// 7 luni de ads (ian–iul), interviuri în ian–aug (august fără ads)
	const months = [1, 2, 3, 4, 5, 6, 7].map((m) => ({ monthNum: m, spend: { tiktok: 1000 * m, google: 500, meta: 200 } }));
	const iv = (monthNum: number, channel: string, status: 'admisa' | 'respinsa' | 'in_evaluare' = 'in_evaluare') => ({ monthNum, channel, status });
	return {
		year: 2026,
		months,
		interviews: [
			iv(1, 'TikTok', 'admisa'), iv(1, 'TikTok'), iv(1, 'Google / SEO', 'admisa'),
			iv(2, 'Recomandare'), iv(2, 'Instagram', 'admisa'), iv(2, 'Facebook'),
			iv(3, 'Nespecificat'), iv(5, 'TikTok', 'respinsa'), iv(8, 'YouTube')
		]
	};
}
const base = (over: Partial<Parameters<typeof computeKpi>[0]> = {}) =>
	computeKpi({ data: year2026(), fixedRows: DEFAULT_ROWS, month: 'all', mode: 'toate', channelOrder: CHANNELS, ...over });

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
	});
	test('criteriul 1 (cu 7 luni exact): fixe = 248.080', () => {
		const d = year2026();
		d.interviews = d.interviews.filter((i) => i.monthNum <= 7);
		const k = computeKpi({ data: d, fixedRows: DEFAULT_ROWS, month: 'all', mode: 'toate', channelOrder: CHANNELS });
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
		const d: KpiYearData = { year: 2026, months: [{ monthNum: 1, spend: { tiktok: 100, google: 0, meta: 0 } }], interviews: [] };
		const k = computeKpi({ data: d, fixedRows: [], month: 'all', mode: 'toate', channelOrder: CHANNELS });
		expect(k.cpi).toBeNull();
		expect(k.cpiOk).toBeNull();
		expect(k.cpiAds).toBeNull();
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
		expect(k.channelRows.filter((r) => r.paid).reduce((s, r) => s + r.fixed, 0)).toBeCloseTo(k.fixedTotal, 6);
	});
	test('suma ads pe canalele unei platforme = bugetul platformei; sortare desc după interviuri', () => {
		const k = base();
		const tt = k.channelRows.find((r) => r.channel === 'TikTok')!;
		expect(tt.ads).toBeCloseTo(k.adsByPlatform.tiktok, 6);
		const metaSum = k.channelRows.filter((r) => ['Facebook', 'Instagram'].includes(r.channel)).reduce((s, r) => s + r.ads, 0);
		expect(metaSum).toBeCloseTo(k.adsByPlatform.meta, 6);
		expect(k.channelRows[0].channel).toBe('TikTok');
		for (let i = 1; i < k.channelRows.length; i++) expect(k.channelRows[i - 1].n).toBeGreaterThanOrEqual(k.channelRows[i].n);
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
		const prev: KpiYearData = { year: 2025, months: [{ monthNum: 1, spend: { tiktok: 1000, google: 0, meta: 0 } }], interviews: [{ monthNum: 1, channel: 'TikTok', status: 'admisa' }] };
		const d = computeDelta({ current: cur, month: 'all', previous: prev, fixedRows: DEFAULT_ROWS, mode: 'toate', channelOrder: CHANNELS })!;
		expect(d.label).toBe('2025');
		expect(d.prev).toBe(36440);
		expect(d.pct).toBe(Math.round(((cur.cpi! - 36440) / 36440) * 100));
	});
	test('lună selectată → vs luna precedentă din scop; prima lună → null', () => {
		const cur = base({ month: 2 });
		const d = computeDelta({ current: cur, month: 2, previous: null, fixedRows: DEFAULT_ROWS, mode: 'toate', channelOrder: CHANNELS })!;
		expect(d.label).toBe('Ianuarie');
		expect(computeDelta({ current: base({ month: 1 }), month: 1, previous: null, fixedRows: DEFAULT_ROWS, mode: 'toate', channelOrder: CHANNELS })).toBeNull();
	});
	test('fără an precedent sau fără interviuri → null', () => {
		expect(computeDelta({ current: base(), month: 'all', previous: null, fixedRows: [], mode: 'toate', channelOrder: CHANNELS })).toBeNull();
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
```

- [ ] **Step 2: Rulează → FAIL** — `cd app && bun run test interviuri-kpi` → „Cannot find module '$lib/logic/interviuri-kpi'".

- [ ] **Step 3: Implementează** `app/src/lib/logic/interviuri-kpi.ts`

```ts
// KPI performanță interviuri — formulele de cost pe interviu.
// Modul PUR (fără DB, fără DOM): folosit identic de server și de UI, ca cifrele din
// carduri, grafic, tabele și CSV să nu poată diverge.
import { IV_MONTHS } from '$lib/components/interviuri/lib';

export type PlatformId = 'tiktok' | 'google' | 'meta';

export interface PlatformMeta {
	id: PlatformId;
	label: string;
	color: string;
	soft: string;
	/** Canalele de interviu (nume din interview_channel) atribuite platformei. */
	channels: string[];
}

/** Ordinea = ordinea din prototip (TikTok, Google, Meta). */
export const PLATFORMS: PlatformMeta[] = [
	{ id: 'tiktok', label: 'TikTok Ads', color: '#111827', soft: 'rgba(17,24,39,.07)', channels: ['TikTok'] },
	{ id: 'google', label: 'Google Ads', color: '#ea4335', soft: 'rgba(234,67,53,.09)', channels: ['Google / SEO'] },
	{ id: 'meta', label: 'Facebook / Meta', color: '#1877f2', soft: 'rgba(24,119,242,.09)', channels: ['Facebook', 'Instagram'] }
];
export const PLATFORM_IDS: PlatformId[] = PLATFORMS.map((p) => p.id);
export const PAID_CHANNELS: string[] = PLATFORMS.flatMap((p) => p.channels);
export const FIXED_COLOR = '#64748b';

export function platformOfChannel(channel: string): PlatformId | null {
	return PLATFORMS.find((p) => p.channels.includes(channel))?.id ?? null;
}
export function isPaidChannel(channel: string): boolean {
	return platformOfChannel(channel) !== null;
}

export type FixedFrequency = 'monthly' | 'yearly';
export interface FixedCostRow {
	id: string;
	name: string;
	note: string | null;
	qty: number;
	/** lei (nu cenți) — conversia din DB se face în server. */
	unitAmount: number;
	unitLabel: string | null;
	frequency: FixedFrequency;
	active: boolean;
	/** 'YYYY-MM' sau null */
	validFrom: string | null;
	validTo: string | null;
}

export function rowMonthly(r: Pick<FixedCostRow, 'qty' | 'unitAmount' | 'frequency'>): number {
	const v = (Number(r.qty) || 0) * (Number(r.unitAmount) || 0);
	return r.frequency === 'yearly' ? v / 12 : v;
}
export function monthKey(year: number, monthNum: number): string {
	return `${year}-${String(monthNum).padStart(2, '0')}`;
}
export function rowAppliesTo(r: Pick<FixedCostRow, 'active' | 'validFrom' | 'validTo'>, key: string): boolean {
	if (!r.active) return false;
	if (r.validFrom && key < r.validFrom) return false;
	if (r.validTo && key > r.validTo) return false;
	return true;
}
export function fixedMonthlyFor(rows: FixedCostRow[], year: number, monthNum: number): number {
	const key = monthKey(year, monthNum);
	return rows.filter((r) => rowAppliesTo(r, key)).reduce((s, r) => s + rowMonthly(r), 0);
}

export type SpendByPlatform = Record<PlatformId, number>;
export function emptySpend(): SpendByPlatform {
	return { tiktok: 0, google: 0, meta: 0 };
}
export function spendSum(s: SpendByPlatform): number {
	return PLATFORM_IDS.reduce((a, id) => a + (s[id] || 0), 0);
}

export interface KpiMonthSpend {
	monthNum: number;
	/** lei, deja convertit în RON */
	spend: SpendByPlatform;
}
export type KpiStatus = 'admisa' | 'respinsa' | 'in_evaluare';
export interface KpiInterview {
	monthNum: number;
	channel: string;
	status: KpiStatus;
}
export interface KpiYearData {
	year: number;
	months: KpiMonthSpend[];
	interviews: KpiInterview[];
}

/** luni_în_scop = lunile cu cheltuială de ads SAU interviuri. */
export function monthsInScope(d: KpiYearData): number[] {
	const s = new Set<number>();
	for (const m of d.months) if (spendSum(m.spend) > 0) s.add(m.monthNum);
	for (const i of d.interviews) s.add(i.monthNum);
	return [...s].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
}

export type FixedMode = 'toate' | 'platite';
export type MonthFilter = 'all' | number;

export interface KpiInput {
	data: KpiYearData;
	fixedRows: FixedCostRow[];
	month: MonthFilter;
	mode: FixedMode;
	/** ordinea canalelor (din interview_channel.sort_order) */
	channelOrder: string[];
}

export interface KpiMonthRow {
	monthNum: number;
	month: string;
	n: number;
	ok: number;
	ads: SpendByPlatform;
	adsSum: number;
	fixed: number;
	total: number;
	cpi: number | null;
	cpiOk: number | null;
}
export interface KpiChannelRow {
	channel: string;
	n: number;
	ok: number;
	paid: boolean;
	ads: number;
	fixed: number;
	total: number;
	cpi: number | null;
	cpiOk: number | null;
}
export interface KpiResult {
	year: number;
	scopeMonths: number[];
	adsByPlatform: SpendByPlatform;
	adsTotal: number;
	fixedTotal: number;
	/** media lunară a fixelor în scop (lei/lună) */
	fixedMonthly: number;
	activeFixedRows: number;
	total: number;
	n: number;
	nOk: number;
	nPaid: number;
	cpi: number | null;
	cpiOk: number | null;
	cpiAds: number | null;
	monthRows: KpiMonthRow[];
	channelRows: KpiChannelRow[];
}

function ratio(num: number, den: number): number | null {
	return den > 0 ? num / den : null;
}

export function computeKpi(input: KpiInput): KpiResult {
	const { data, fixedRows, month, mode, channelOrder } = input;
	const allMonths = monthsInScope(data);
	const scopeMonths = month === 'all' ? allMonths : [month];
	const spendOf = new Map(data.months.map((m) => [m.monthNum, m.spend]));

	const adsByPlatform = emptySpend();
	for (const mn of scopeMonths) {
		const s = spendOf.get(mn);
		if (!s) continue;
		for (const id of PLATFORM_IDS) adsByPlatform[id] += s[id] || 0;
	}
	const adsTotal = spendSum(adsByPlatform);
	const fixedTotal = scopeMonths.reduce((s, mn) => s + fixedMonthlyFor(fixedRows, data.year, mn), 0);
	const activeRows = fixedRows.filter((r) => r.active);
	const fixedMonthly = scopeMonths.length
		? fixedTotal / scopeMonths.length
		: activeRows.reduce((s, r) => s + rowMonthly(r), 0);
	const total = adsTotal + fixedTotal;

	const scoped = data.interviews.filter((i) => scopeMonths.includes(i.monthNum));
	const n = scoped.length;
	const nOk = scoped.filter((i) => i.status === 'admisa').length;
	const nPaid = scoped.filter((i) => isPaidChannel(i.channel)).length;

	const monthRows: KpiMonthRow[] = allMonths.map((mn) => {
		const recs = data.interviews.filter((i) => i.monthNum === mn);
		const ads = { ...emptySpend(), ...(spendOf.get(mn) ?? {}) };
		const adsSum = spendSum(ads);
		const fixed = fixedMonthlyFor(fixedRows, data.year, mn);
		const tot = adsSum + fixed;
		const k = recs.length;
		const ok = recs.filter((i) => i.status === 'admisa').length;
		return {
			monthNum: mn, month: IV_MONTHS[mn - 1] ?? String(mn), n: k, ok, ads, adsSum, fixed, total: tot,
			cpi: ratio(tot, k), cpiOk: ratio(tot, ok)
		};
	});

	const counts = new Map<string, { n: number; ok: number }>();
	for (const i of scoped) {
		const c = counts.get(i.channel) ?? { n: 0, ok: 0 };
		c.n++;
		if (i.status === 'admisa') c.ok++;
		counts.set(i.channel, c);
	}
	const platformBase = emptySpend();
	for (const [ch, c] of counts) {
		const p = platformOfChannel(ch);
		if (p) platformBase[p] += c.n;
	}
	const order = [...channelOrder, ...[...counts.keys()].filter((ch) => !channelOrder.includes(ch))];
	const channelRows: KpiChannelRow[] = order
		.filter((ch) => counts.has(ch))
		.map((ch) => {
			const c = counts.get(ch)!;
			const p = platformOfChannel(ch);
			const paid = p !== null;
			const ads = p && platformBase[p] > 0 ? adsByPlatform[p] * (c.n / platformBase[p]) : 0;
			const fixed =
				mode === 'toate'
					? n > 0 ? fixedTotal * (c.n / n) : 0
					: paid && nPaid > 0 ? fixedTotal * (c.n / nPaid) : 0;
			const tot = ads + fixed;
			return { channel: ch, n: c.n, ok: c.ok, paid, ads, fixed, total: tot, cpi: ratio(tot, c.n), cpiOk: ratio(tot, c.ok) };
		})
		.sort((a, b) => b.n - a.n);

	return {
		year: data.year, scopeMonths, adsByPlatform, adsTotal, fixedTotal, fixedMonthly,
		activeFixedRows: activeRows.length, total, n, nOk, nPaid,
		cpi: ratio(total, n), cpiOk: ratio(total, nOk), cpiAds: ratio(adsTotal, nPaid),
		monthRows, channelRows
	};
}

export interface KpiDelta {
	pct: number;
	label: string;
	prev: number;
}
/** Delta cost/interviu: luna precedentă (dacă e selectată o lună) sau anul precedent. */
export function computeDelta(args: {
	current: KpiResult;
	month: MonthFilter;
	previous: KpiYearData | null;
	fixedRows: FixedCostRow[];
	mode: FixedMode;
	channelOrder: string[];
}): KpiDelta | null {
	const { current, month, previous, fixedRows, mode, channelOrder } = args;
	if (current.cpi == null) return null;
	let prev: { val: number; label: string } | null = null;
	if (month === 'all') {
		if (!previous) return null;
		const p = computeKpi({ data: previous, fixedRows, month: 'all', mode, channelOrder });
		if (p.cpi == null) return null;
		prev = { val: p.cpi, label: String(previous.year) };
	} else {
		const i = current.monthRows.findIndex((r) => r.monthNum === month);
		if (i <= 0) return null;
		const pr = current.monthRows[i - 1];
		if (pr.cpi == null) return null;
		prev = { val: pr.cpi, label: pr.month };
	}
	if (prev.val <= 0) return null;
	return { pct: Math.round(((current.cpi - prev.val) / prev.val) * 100), label: prev.label, prev: prev.val };
}

// ---- formatare ro-RO ----
const nf0 = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** sume: fără zecimale */
export function fmtLei(n: number | null | undefined): string {
	return `${nf0.format(Math.round(n || 0))} lei`;
}
/** cost/interviu: o zecimală sub 100 lei; null → „—" */
export function fmtLeiFine(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—';
	return `${n < 100 ? nf1.format(n) : nf0.format(Math.round(n))} lei`;
}
export function fmtInt(n: number): string {
	return nf0.format(Math.round(n));
}
export function pct(part: number, total: number): number {
	return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** CSV cu exact rândurile lunare afișate (o coloană per platformă). */
export function buildKpiCsv(rows: KpiMonthRow[]): string {
	const cols = ['Luna', 'Interviuri', 'Admise', ...PLATFORMS.map((p) => p.label), 'Cheltuieli fixe', 'Buget total', 'Cost/interviu', 'Cost/admisa'];
	const esc = (v: unknown) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
	const lines = [cols.map(esc).join(',')].concat(
		rows.map((r) =>
			[r.month, r.n, r.ok, ...PLATFORM_IDS.map((id) => Math.round(r.ads[id])), Math.round(r.fixed), Math.round(r.total),
				r.cpi != null ? Math.round(r.cpi) : '', r.cpiOk != null ? Math.round(r.cpiOk) : '']
				.map(esc).join(',')
		)
	);
	return '﻿' + lines.join('\n');
}
```

- [ ] **Step 4: Rulează → PASS** — `bun run test interviuri-kpi`.
- [ ] **Step 5: Commit** — `git add app/src/lib/logic/interviuri-kpi.ts app/src/lib/logic/__tests__/interviuri-kpi.test.ts && git commit -m "feat(interviuri-kpi): modul pur cu formulele de cost pe interviu + teste"`

---

### Task 2: Schema + migrare `marketing_fixed_cost`

**Files:**
- Modify: `app/src/lib/server/db/schema.ts` (după `export type NewInterview`, ~L6361)
- Create: `app/drizzle/0495_marketing_fixed_cost.sql`, `app/drizzle/0496_marketing_fixed_cost_tenant_idx.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: grep nume** — `grep -rn "marketing_fixed_cost" app/drizzle app/src | head` → gol (memoria: fără dublete).
- [ ] **Step 2: Schema** (după `NewInterview`):

```ts
// Cheltuieli fixe de marketing (pagina Interviuri → KPI Performanță). Editate manual,
// per tenant; sumele în CENȚI ca restul CRM-ului. valid_from/valid_to = 'YYYY-MM'.
export const marketingFixedCost = sqliteTable(
	'marketing_fixed_cost',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		name: text('name').notNull().default(''),
		note: text('note'),
		qty: real('qty').notNull().default(1),
		unitAmountCents: integer('unit_amount_cents').notNull().default(0),
		unitLabel: text('unit_label'),
		frequency: text('frequency').notNull().default('monthly'), // 'monthly' | 'yearly'
		active: boolean('active').notNull().default(true),
		validFrom: text('valid_from'), // 'YYYY-MM' sau null
		validTo: text('valid_to'),
		sortOrder: integer('sort_order').notNull().default(100),
		createdBy: text('created_by').references(() => user.id),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		tenantIdx: index('marketing_fixed_cost_tenant_idx').on(t.tenantId)
	})
);

export type MarketingFixedCost = typeof marketingFixedCost.$inferSelect;
export type NewMarketingFixedCost = typeof marketingFixedCost.$inferInsert;
```

- [ ] **Step 3: Migrări** (FĂRĂ `IF NOT EXISTS`; un statement per fișier)

`app/drizzle/0495_marketing_fixed_cost.sql`:
```sql
CREATE TABLE `marketing_fixed_cost` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`note` text,
	`qty` real DEFAULT 1 NOT NULL,
	`unit_amount_cents` integer DEFAULT 0 NOT NULL,
	`unit_label` text,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`active` number DEFAULT true NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`created_by` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
```
`app/drizzle/0496_marketing_fixed_cost_tenant_idx.sql`:
```sql
CREATE INDEX `marketing_fixed_cost_tenant_idx` ON `marketing_fixed_cost` (`tenant_id`);
```
Journal: două intrări noi, `idx` 495/496, `when` 1785398836928469/…470, `version: "6"`, `breakpoints: true`.

- [ ] **Step 4: Aplică** — înainte: verifică pe remote `select max(created_at) from __drizzle_migrations` ≥ `when` al lui 0494 (memoria „jurnal when sub remote"); apoi `cd app && bun run db:migrate`; verifică `PRAGMA table_info(marketing_fixed_cost)`.
- [ ] **Step 5: Commit** — `git add app/src/lib/server/db/schema.ts app/drizzle/0495_marketing_fixed_cost.sql app/drizzle/0496_marketing_fixed_cost_tenant_idx.sql app/drizzle/meta/_journal.json && git commit -m "feat(interviuri-kpi): tabel marketing_fixed_cost + migrări"`

---

### Task 3: Agregarea spend-ului (server) — `kpi-data.ts` (TDD pe partea pură)

**Files:**
- Create: `app/src/lib/server/interviuri/kpi-data.ts`
- Test: `app/src/lib/server/interviuri/__tests__/kpi-spend.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
await import('$lib/server/db/schema');
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/bnr/client', () => ({ loadBnrFxRates: async () => ({}) }));

const { aggregateSpend, fxRateDateFor } = await import('$lib/server/interviuri/kpi-data');

const TODAY = '2026-08-27';
const fx = { '2026-03-31': { USD: { ronPerUnit: 4.5, rateDate: '2026-03-31' } }, [TODAY]: { USD: { ronPerUnit: 4.6, rateDate: TODAY } } };

describe('aggregateSpend', () => {
	test('RON direct din cenți, pe lună și platformă; conturi multiple se adună', () => {
		const { months } = aggregateSpend(
			[
				{ platform: 'tiktok', periodStart: '2026-03-01', periodEnd: '2026-03-31', spendCents: 100050, currencyCode: 'RON' },
				{ platform: 'tiktok', periodStart: '2026-03-01', periodEnd: '2026-03-31', spendCents: 50, currencyCode: 'RON' },
				{ platform: 'meta', periodStart: '2026-04-01', periodEnd: '2026-04-30', spendCents: 200, currencyCode: 'RON' }
			], 2026, fx, TODAY
		);
		expect(months).toEqual([
			{ monthNum: 3, spend: { tiktok: 1001, google: 0, meta: 0 } },
			{ monthNum: 4, spend: { tiktok: 0, google: 0, meta: 2 } }
		]);
	});
	test('USD → RON la cursul de la sfârșitul lunii; luna curentă folosește azi', () => {
		const { months, warnings } = aggregateSpend(
			[
				{ platform: 'google', periodStart: '2026-03-01', periodEnd: '2026-03-31', spendCents: 10000, currencyCode: 'USD' },
				{ platform: 'google', periodStart: '2026-08-01', periodEnd: '2026-08-31', spendCents: 10000, currencyCode: 'USD' }
			], 2026, fx, TODAY
		);
		expect(months[0].spend.google).toBeCloseTo(450, 6);
		expect(months[1].spend.google).toBeCloseTo(460, 6);
		expect(warnings).toEqual([]);
	});
	test('curs lipsă → suma e exclusă și raportată', () => {
		const { months, warnings } = aggregateSpend(
			[{ platform: 'google', periodStart: '2026-01-01', periodEnd: '2026-01-31', spendCents: 10000, currencyCode: 'EUR' }], 2026, fx, TODAY
		);
		expect(months).toEqual([]);
		expect(warnings).toEqual([{ platform: 'google', month: '2026-01', currency: 'EUR' }]);
	});
	test('rândurile din alt an sunt ignorate', () => {
		const { months } = aggregateSpend(
			[{ platform: 'meta', periodStart: '2025-12-01', periodEnd: '2025-12-31', spendCents: 100, currencyCode: 'RON' }], 2026, fx, TODAY
		);
		expect(months).toEqual([]);
	});
	test('fxRateDateFor plafonează la azi', () => {
		expect(fxRateDateFor('2026-08-31', TODAY)).toBe(TODAY);
		expect(fxRateDateFor('2026-03-31', TODAY)).toBe('2026-03-31');
	});
});
```

- [ ] **Step 2: Rulează → FAIL.**
- [ ] **Step 3: Implementează** `app/src/lib/server/interviuri/kpi-data.ts`

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { loadBnrFxRates } from '$lib/server/bnr/client';
import type { FxRates } from '$lib/server/banking/payment-match';
import {
	emptySpend, PLATFORMS, type KpiInterview, type KpiMonthSpend, type KpiStatus, type KpiYearData,
	type PlatformId, type SpendByPlatform
} from '$lib/logic/interviuri-kpi';

/** Rând brut din oricare din tabelele *_ads_spending (deja etichetat cu platforma). */
export interface SpendRowInput {
	platform: PlatformId;
	periodStart: string; // 'YYYY-MM-DD'
	periodEnd: string;
	spendCents: number;
	currencyCode: string;
}
export interface FxWarning {
	platform: PlatformId;
	month: string; // 'YYYY-MM'
	currency: string;
}

/** Cursul „zilei de facturare" pentru spend lunar = sfârșitul lunii, plafonat la azi. */
export function fxRateDateFor(periodEnd: string, today: string): string {
	return periodEnd > today ? today : periodEnd;
}

/** Agregă în lei pe (lună, platformă) rândurile unui an. Pur — testabil fără DB. */
export function aggregateSpend(
	rows: SpendRowInput[], year: number, fx: FxRates, today: string
): { months: KpiMonthSpend[]; warnings: FxWarning[] } {
	const byMonth = new Map<number, SpendByPlatform>();
	const warnings: FxWarning[] = [];
	for (const r of rows) {
		if (!r.periodStart.startsWith(`${year}-`)) continue;
		const monthNum = Number(r.periodStart.slice(5, 7));
		if (!(monthNum >= 1 && monthNum <= 12)) continue;
		const cur = (r.currencyCode || 'RON').toUpperCase();
		let ron: number;
		if (cur === 'RON') {
			ron = r.spendCents / 100;
		} else {
			const rate = fx[fxRateDateFor(r.periodEnd, today)]?.[cur];
			if (!rate) {
				warnings.push({ platform: r.platform, month: r.periodStart.slice(0, 7), currency: cur });
				continue;
			}
			ron = (r.spendCents / 100) * rate.ronPerUnit;
		}
		const s = byMonth.get(monthNum) ?? emptySpend();
		s[r.platform] += ron;
		byMonth.set(monthNum, s);
	}
	return {
		months: [...byMonth].sort((a, b) => a[0] - b[0]).map(([monthNum, spend]) => ({ monthNum, spend })),
		warnings
	};
}

export interface KpiPlatformInfo {
	id: PlatformId;
	label: string;
	/** „Nume cont · id" sau null când clienții interviurilor n-au cont pe platformă */
	account: string | null;
	syncedAt: string | null;
}
export interface InterviewKpiData {
	years: number[];
	platforms: KpiPlatformInfo[];
	current: KpiYearData;
	previous: KpiYearData | null;
	/** câți clienți distincți au interviuri (0 ⇒ nu putem citi bugete) */
	linkedClients: number;
	hasAdsData: boolean;
	fxWarnings: FxWarning[];
	lastSyncedAt: string | null;
}

type SpendRowWithSync = SpendRowInput & { syncedAt: Date | null };

async function loadSpendRows(tenantId: string, clientIds: string[]): Promise<SpendRowWithSync[]> {
	const [meta, tiktok, google] = await Promise.all([
		db.select({ periodStart: table.metaAdsSpending.periodStart, periodEnd: table.metaAdsSpending.periodEnd, spendCents: table.metaAdsSpending.spendCents, currencyCode: table.metaAdsSpending.currencyCode, syncedAt: table.metaAdsSpending.syncedAt })
			.from(table.metaAdsSpending)
			.where(and(eq(table.metaAdsSpending.tenantId, tenantId), inArray(table.metaAdsSpending.clientId, clientIds))),
		db.select({ periodStart: table.tiktokAdsSpending.periodStart, periodEnd: table.tiktokAdsSpending.periodEnd, spendCents: table.tiktokAdsSpending.spendCents, currencyCode: table.tiktokAdsSpending.currencyCode, syncedAt: table.tiktokAdsSpending.syncedAt })
			.from(table.tiktokAdsSpending)
			.where(and(eq(table.tiktokAdsSpending.tenantId, tenantId), inArray(table.tiktokAdsSpending.clientId, clientIds))),
		db.select({ periodStart: table.googleAdsSpending.periodStart, periodEnd: table.googleAdsSpending.periodEnd, spendCents: table.googleAdsSpending.spendCents, currencyCode: table.googleAdsSpending.currencyCode, syncedAt: table.googleAdsSpending.syncedAt })
			.from(table.googleAdsSpending)
			.where(and(eq(table.googleAdsSpending.tenantId, tenantId), inArray(table.googleAdsSpending.clientId, clientIds)))
	]);
	return [
		...meta.map((r) => ({ ...r, platform: 'meta' as const })),
		...tiktok.map((r) => ({ ...r, platform: 'tiktok' as const })),
		...google.map((r) => ({ ...r, platform: 'google' as const }))
	];
}

function accountLabel(rows: Array<{ name: string; ext: string }>): string | null {
	if (rows.length === 0) return null;
	const first = `${rows[0].name || 'Cont'} · ${rows[0].ext}`;
	return rows.length > 1 ? `${first} +${rows.length - 1}` : first;
}

async function loadAccountLabels(tenantId: string, clientIds: string[]): Promise<Record<PlatformId, string | null>> {
	if (clientIds.length === 0) return { tiktok: null, google: null, meta: null };
	const [meta, tiktok, google] = await Promise.all([
		db.select({ name: table.metaAdsAccount.accountName, ext: table.metaAdsAccount.metaAdAccountId })
			.from(table.metaAdsAccount)
			.where(and(eq(table.metaAdsAccount.tenantId, tenantId), inArray(table.metaAdsAccount.clientId, clientIds), eq(table.metaAdsAccount.isActive, true))),
		db.select({ name: table.tiktokAdsAccount.accountName, ext: table.tiktokAdsAccount.tiktokAdvertiserId })
			.from(table.tiktokAdsAccount)
			.where(and(eq(table.tiktokAdsAccount.tenantId, tenantId), inArray(table.tiktokAdsAccount.clientId, clientIds), eq(table.tiktokAdsAccount.isActive, true))),
		db.select({ name: table.googleAdsAccount.accountName, ext: table.googleAdsAccount.googleAdsCustomerId })
			.from(table.googleAdsAccount)
			.where(and(eq(table.googleAdsAccount.tenantId, tenantId), inArray(table.googleAdsAccount.clientId, clientIds), eq(table.googleAdsAccount.isActive, true)))
	]);
	return { meta: accountLabel(meta), tiktok: accountLabel(tiktok), google: accountLabel(google) };
}

async function loadInterviews(tenantId: string, year: number): Promise<KpiInterview[]> {
	const rows = await db
		.select({ dataInterviu: table.interview.dataInterviu, status: table.interview.status, channelName: table.interviewChannel.name })
		.from(table.interview)
		.leftJoin(
			table.interviewChannel,
			and(eq(table.interview.channelId, table.interviewChannel.id), eq(table.interviewChannel.tenantId, tenantId))
		)
		.where(and(eq(table.interview.tenantId, tenantId), gte(table.interview.dataInterviu, `${year}-01-01`), lte(table.interview.dataInterviu, `${year}-12-31`)));
	return rows.map((r) => ({
		monthNum: Number(r.dataInterviu.slice(5, 7)) || 1,
		channel: r.channelName ?? 'Nespecificat',
		status: (['admisa', 'respinsa', 'in_evaluare'].includes(r.status) ? r.status : 'in_evaluare') as KpiStatus
	}));
}

/** Toate datele de care are nevoie pagina pentru un an (+ anul precedent, pentru delta). */
export async function loadInterviewKpiData(tenantId: string, requestedYear?: number): Promise<InterviewKpiData> {
	const today = new Date().toISOString().slice(0, 10);

	const clientRows = await db
		.selectDistinct({ clientId: table.interview.clientId })
		.from(table.interview)
		.where(and(eq(table.interview.tenantId, tenantId), isNotNull(table.interview.clientId)));
	const clientIds = clientRows.map((r) => r.clientId).filter((x): x is string => !!x);

	const yearRows = await db
		.select({ y: sql<string>`substr(${table.interview.dataInterviu}, 1, 4)` })
		.from(table.interview)
		.where(eq(table.interview.tenantId, tenantId))
		.groupBy(sql`substr(${table.interview.dataInterviu}, 1, 4)`);
	const years = new Set<number>(yearRows.map((r) => Number(r.y)).filter((y) => y > 2000));

	const spendRows = clientIds.length ? await loadSpendRows(tenantId, clientIds) : [];
	for (const r of spendRows) {
		const y = Number(r.periodStart.slice(0, 4));
		if (y > 2000) years.add(y);
	}
	const yearList = [...years].sort((a, b) => a - b);
	const year = requestedYear && yearList.includes(requestedYear) ? requestedYear : (yearList[yearList.length - 1] ?? new Date().getFullYear());

	const foreign = spendRows.filter((r) => (r.currencyCode || 'RON').toUpperCase() !== 'RON');
	const fx: FxRates = foreign.length
		? await loadBnrFxRates(foreign.map((r) => r.currencyCode), foreign.map((r) => fxRateDateFor(r.periodEnd, today)))
		: {};

	const cur = aggregateSpend(spendRows, year, fx, today);
	const prev = aggregateSpend(spendRows, year - 1, fx, today);
	const [curIv, prevIv, accounts] = await Promise.all([
		loadInterviews(tenantId, year), loadInterviews(tenantId, year - 1), loadAccountLabels(tenantId, clientIds)
	]);

	const syncedBy: Record<PlatformId, Date | null> = { tiktok: null, google: null, meta: null };
	for (const r of spendRows) {
		if (r.syncedAt && (!syncedBy[r.platform] || r.syncedAt > syncedBy[r.platform]!)) syncedBy[r.platform] = r.syncedAt;
	}
	const lastSynced = Object.values(syncedBy).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

	const previous: KpiYearData | null = prev.months.length || prevIv.length ? { year: year - 1, months: prev.months, interviews: prevIv } : null;
	return {
		years: yearList,
		platforms: PLATFORMS.map((p) => ({ id: p.id, label: p.label, account: accounts[p.id], syncedAt: syncedBy[p.id]?.toISOString() ?? null })),
		current: { year, months: cur.months, interviews: curIv },
		previous,
		linkedClients: clientIds.length,
		hasAdsData: cur.months.length > 0,
		fxWarnings: cur.warnings,
		lastSyncedAt: lastSynced?.toISOString() ?? null
	};
}
```

- [ ] **Step 4: Rulează → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(interviuri-kpi): agregare spend pe lună/platformă cu conversie BNR + loader"`

---

### Task 4: Cheltuieli fixe (server) + remote functions (TDD pe gating rol/tenant)

**Files:**
- Create: `app/src/lib/server/interviuri/fixed-costs.ts`
- Create: `app/src/lib/remotes/interviuri-kpi.remote.ts`
- Test: `app/src/lib/remotes/__tests__/interviuri-kpi-fixed-costs.test.ts`

- [ ] **Step 1: Test** (pattern din `interviuri-client-assoc.test.ts`)

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
await import('$lib/server/db/schema');

let currentEvent: any = null;
mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));
mock.module('$lib/server/get-actor', () => ({
	requireStaff: async () => {
		if (currentEvent?.locals?.isClientUser) throw new Error('Unauthorized');
		return { type: 'staff' };
	}
}));
mock.module('$lib/server/interviuri/kpi-data', () => ({ loadInterviewKpiData: async () => ({ years: [] }) }));
mock.module('$lib/server/meta-ads/sync', () => ({ syncMetaAdsInvoicesForTenant: async () => ({}) }));
mock.module('$lib/server/tiktok-ads/sync', () => ({ syncTiktokAdsSpendingForTenant: async () => ({}) }));
mock.module('$lib/server/google-ads/sync', () => ({ syncGoogleAdsInvoicesForTenant: async () => ({}) }));

const updateCalls: Array<{ set: any; where: any }> = [];
const deleteCalls: Array<{ where: any }> = [];
const inserted: any[] = [];
let updateReturns: unknown[] = [{ id: 'fc1' }];

function paramValues(node: unknown, out: unknown[] = []): unknown[] {
	if (!node || typeof node !== 'object') return out;
	const n = node as Record<string, unknown>;
	if (Array.isArray(n.queryChunks)) n.queryChunks.forEach((c) => paramValues(c, out));
	else if ('value' in n && !Array.isArray(n.value)) out.push(n.value);
	return out;
}
function chain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, { from: () => chain(rows), where: () => chain(rows), orderBy: () => chain(rows), limit: () => chain(rows), returning: () => chain(rows) });
}
mock.module('$lib/server/db', () => ({
	db: {
		select: () => chain([{ id: 'fc1' }]),
		insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
		update: () => ({ set: (set: unknown) => ({ where: (where: unknown) => { updateCalls.push({ set, where }); return chain(updateReturns); } }) }),
		delete: () => ({ where: (where: unknown) => { deleteCalls.push({ where }); return chain([{ id: 'fc1' }]); } })
	}
}));

const remote = await import('$lib/remotes/interviuri-kpi.remote');

function ev(role: string, extra: Record<string, unknown> = {}) {
	return { locals: { user: { id: 'u1', email: 'a@b.c' }, tenant: { id: 't1' }, tenantUser: { role }, ...extra } };
}
beforeEach(() => { updateCalls.length = 0; deleteCalls.length = 0; inserted.length = 0; updateReturns = [{ id: 'fc1' }]; });

describe('gating rol pe cheltuieli fixe', () => {
	test('member nu poate scrie (create/update/delete/reset)', async () => {
		currentEvent = ev('member');
		await expect(remote.createMarketingFixedCost({})).rejects.toThrow(/Owner\/Admin/);
		await expect(remote.updateMarketingFixedCost({ id: 'fc1', name: 'x' })).rejects.toThrow(/Owner\/Admin/);
		await expect(remote.deleteMarketingFixedCost('fc1')).rejects.toThrow(/Owner\/Admin/);
		await expect(remote.resetMarketingFixedCosts()).rejects.toThrow(/Owner\/Admin/);
		expect(updateCalls.length + deleteCalls.length + inserted.length).toBe(0);
	});
	test('userul de portal e respins și la citire', async () => {
		currentEvent = ev('owner', { isClientUser: true, client: { id: 'c1' } });
		await expect(remote.getMarketingFixedCosts()).rejects.toThrow(/Unauthorized/);
		await expect(remote.getInterviewKpiData(undefined)).rejects.toThrow(/Unauthorized/);
	});
	test('owner: update-ul filtrează pe id ȘI tenant; sumele ajung în cenți', async () => {
		currentEvent = ev('owner');
		const res = await remote.updateMarketingFixedCost({ id: 'fc1', unitAmount: 8000.5, qty: 4 });
		expect(res).toEqual({ success: true });
		expect(updateCalls.length).toBe(1);
		expect(paramValues(updateCalls[0].where)).toEqual(expect.arrayContaining(['fc1', 't1']));
		expect(updateCalls[0].set.unitAmountCents).toBe(800050);
		expect(updateCalls[0].set.qty).toBe(4);
	});
	test('update pe rând inexistent/al altui tenant → eroare', async () => {
		currentEvent = ev('admin');
		updateReturns = [];
		await expect(remote.updateMarketingFixedCost({ id: 'zzz', name: 'x' })).rejects.toThrow(/nu a fost găsit/);
	});
	test('delete filtrează pe tenant', async () => {
		currentEvent = ev('admin');
		await remote.deleteMarketingFixedCost('fc1');
		expect(paramValues(deleteCalls[0].where)).toEqual(expect.arrayContaining(['fc1', 't1']));
	});
	test('canEdit reflectă rolul', async () => {
		currentEvent = ev('member');
		const r = await remote.getMarketingFixedCosts();
		expect(r.canEdit).toBe(false);
	});
});
```

- [ ] **Step 2: Rulează → FAIL.**
- [ ] **Step 3: Server module** `app/src/lib/server/interviuri/fixed-costs.ts`

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { FixedCostRow, FixedFrequency } from '$lib/logic/interviuri-kpi';

export function generateFixedCostId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Rândurile implicite din prototip (seed la prima folosire + „Resetează la implicit"). */
export const DEFAULT_FIXED_COSTS: Array<Pick<table.NewMarketingFixedCost, 'name' | 'note' | 'qty' | 'unitAmountCents' | 'unitLabel' | 'frequency' | 'sortOrder'>> = [
	{ name: 'Echipă marketing', note: 'salarii brute', qty: 4, unitAmountCents: 800000, unitLabel: 'persoane', frequency: 'monthly', sortOrder: 10 },
	{ name: 'Abonamente & tooling', note: 'Canva, Metricool, ChatGPT, Ahrefs', qty: 1, unitAmountCents: 94000, unitLabel: 'pachet', frequency: 'monthly', sortOrder: 20 },
	{ name: 'Producție content', note: 'filmări + editare clipuri', qty: 1, unitAmountCents: 250000, unitLabel: 'pachet', frequency: 'monthly', sortOrder: 30 }
];

export function toFixedCostRow(r: table.MarketingFixedCost): FixedCostRow {
	return {
		id: r.id, name: r.name, note: r.note, qty: r.qty, unitAmount: r.unitAmountCents / 100, unitLabel: r.unitLabel,
		frequency: (r.frequency === 'yearly' ? 'yearly' : 'monthly') as FixedFrequency, active: r.active,
		validFrom: r.validFrom, validTo: r.validTo
	};
}

export async function insertDefaultFixedCosts(tenantId: string, userId: string | null): Promise<void> {
	const now = new Date();
	await db.insert(table.marketingFixedCost).values(
		DEFAULT_FIXED_COSTS.map((d) => ({ id: generateFixedCostId(), tenantId, ...d, active: true, createdBy: userId, createdAt: now, updatedAt: now }))
	);
}

/** Seed idempotent la prima citire (ca ensureChannelsSeeded). */
export async function ensureFixedCostsSeeded(tenantId: string, userId: string | null): Promise<void> {
	const existing = await db.select({ id: table.marketingFixedCost.id }).from(table.marketingFixedCost)
		.where(eq(table.marketingFixedCost.tenantId, tenantId)).limit(1);
	if (existing.length > 0) return;
	await insertDefaultFixedCosts(tenantId, userId);
}

export async function listFixedCosts(tenantId: string): Promise<FixedCostRow[]> {
	const rows = await db.select().from(table.marketingFixedCost)
		.where(eq(table.marketingFixedCost.tenantId, tenantId))
		.orderBy(asc(table.marketingFixedCost.sortOrder), asc(table.marketingFixedCost.createdAt));
	return rows.map(toFixedCostRow);
}

export async function resetFixedCosts(tenantId: string, userId: string | null): Promise<void> {
	await db.delete(table.marketingFixedCost).where(eq(table.marketingFixedCost.tenantId, tenantId));
	await insertDefaultFixedCosts(tenantId, userId);
}

export function fixedCostWhere(tenantId: string, id: string) {
	return and(eq(table.marketingFixedCost.id, id), eq(table.marketingFixedCost.tenantId, tenantId));
}
```

- [ ] **Step 4: Remote** `app/src/lib/remotes/interviuri-kpi.remote.ts`

```ts
import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { requireStaff } from '$lib/server/get-actor';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { loadInterviewKpiData } from '$lib/server/interviuri/kpi-data';
import {
	ensureFixedCostsSeeded, fixedCostWhere, generateFixedCostId, listFixedCosts, resetFixedCosts
} from '$lib/server/interviuri/fixed-costs';
import { syncMetaAdsInvoicesForTenant } from '$lib/server/meta-ads/sync';
import { syncTiktokAdsSpendingForTenant } from '$lib/server/tiktok-ads/sync';
import { syncGoogleAdsInvoicesForTenant } from '$lib/server/google-ads/sync';
import { logError } from '$lib/server/logger';
import { PLATFORMS, type PlatformId } from '$lib/logic/interviuri-kpi';

function requireCtx() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return event;
}
/** Citire: orice user staff (aceleași reguli ca pagina Interviuri). */
async function requireStaffCtx() {
	const event = requireCtx();
	await requireStaff(event);
	return event;
}
function isMarketingAdmin(event: ReturnType<typeof requireCtx>): boolean {
	const role = event.locals.tenantUser?.role;
	return role === 'owner' || role === 'admin';
}
/** Scriere pe cheltuieli fixe: doar Owner/Admin. */
async function requireMarketingAdminCtx() {
	const event = await requireStaffCtx();
	if (!isMarketingAdmin(event)) throw new Error('Doar Owner/Admin pot modifica cheltuielile fixe');
	return event;
}

// ===================== Queries =====================

export const getInterviewKpiData = query(
	v.optional(v.object({ year: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100))) })),
	async (args) => {
		const event = await requireStaffCtx();
		return loadInterviewKpiData(event.locals.tenant!.id, args?.year);
	}
);

export const getMarketingFixedCosts = query(async () => {
	const event = await requireStaffCtx();
	const tenantId = event.locals.tenant!.id;
	await ensureFixedCostsSeeded(tenantId, event.locals.user!.id);
	return { rows: await listFixedCosts(tenantId), canEdit: isMarketingAdmin(event) };
});

// ===================== Commands =====================

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const fixedCostFields = {
	name: v.optional(v.pipe(v.string(), v.maxLength(120))),
	note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(300)))),
	qty: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1_000_000))),
	unitAmount: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1_000_000_000))),
	unitLabel: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(40)))),
	frequency: v.optional(v.picklist(['monthly', 'yearly'])),
	active: v.optional(v.boolean()),
	validFrom: v.optional(v.nullable(v.pipe(v.string(), v.regex(monthRe, 'Lună invalidă (YYYY-MM)')))),
	validTo: v.optional(v.nullable(v.pipe(v.string(), v.regex(monthRe, 'Lună invalidă (YYYY-MM)'))))
};
type FixedCostPatch = v.InferOutput<v.ObjectSchema<typeof fixedCostFields, undefined>>;

function toDbPatch(data: FixedCostPatch) {
	const set: Partial<table.NewMarketingFixedCost> = {};
	if (data.name !== undefined) set.name = data.name.trim();
	if (data.note !== undefined) set.note = data.note?.trim() || null;
	if (data.qty !== undefined) set.qty = data.qty;
	if (data.unitAmount !== undefined) set.unitAmountCents = Math.round(data.unitAmount * 100);
	if (data.unitLabel !== undefined) set.unitLabel = data.unitLabel?.trim() || null;
	if (data.frequency !== undefined) set.frequency = data.frequency;
	if (data.active !== undefined) set.active = data.active;
	if (data.validFrom !== undefined) set.validFrom = data.validFrom || null;
	if (data.validTo !== undefined) set.validTo = data.validTo || null;
	if (set.validFrom && set.validTo && set.validFrom > set.validTo) throw new Error('„Valabil de la" nu poate fi după „până la"');
	return set;
}

export const createMarketingFixedCost = command(v.optional(v.object(fixedCostFields)), async (data) => {
	const event = await requireMarketingAdminCtx();
	const tenantId = event.locals.tenant!.id;
	const id = generateFixedCostId();
	const now = new Date();
	await db.insert(table.marketingFixedCost).values({
		id, tenantId, name: '', qty: 1, unitAmountCents: 0, frequency: 'monthly', active: true, sortOrder: 100 + now.getTime() % 100000,
		...toDbPatch(data ?? {}), createdBy: event.locals.user!.id, createdAt: now, updatedAt: now
	});
	return { success: true, id };
});

export const updateMarketingFixedCost = command(
	v.object({ id: v.pipe(v.string(), v.minLength(1)), ...fixedCostFields }),
	async ({ id, ...data }) => {
		const event = await requireMarketingAdminCtx();
		const updated = await db.update(table.marketingFixedCost)
			.set({ ...toDbPatch(data), updatedAt: new Date() })
			.where(fixedCostWhere(event.locals.tenant!.id, id))
			.returning({ id: table.marketingFixedCost.id });
		if (updated.length === 0) throw new Error('Rândul nu a fost găsit');
		return { success: true };
	}
);

export const deleteMarketingFixedCost = command(v.pipe(v.string(), v.minLength(1)), async (id) => {
	const event = await requireMarketingAdminCtx();
	const deleted = await db.delete(table.marketingFixedCost)
		.where(fixedCostWhere(event.locals.tenant!.id, id))
		.returning({ id: table.marketingFixedCost.id });
	if (deleted.length === 0) throw new Error('Rândul nu a fost găsit');
	return { success: true };
});

export const resetMarketingFixedCosts = command(async () => {
	const event = await requireMarketingAdminCtx();
	await resetFixedCosts(event.locals.tenant!.id, event.locals.user!.id);
	return { success: true };
});

export interface SyncPlatformResult {
	id: PlatformId;
	label: string;
	ok: boolean;
	error?: string;
}
/** Re-sincronizează cele trei conturi; o platformă picată nu blochează restul. */
export const syncInterviewAdsBudgets = command(async () => {
	const event = await requireStaffCtx();
	const tenantId = event.locals.tenant!.id;
	const runners: Record<PlatformId, () => Promise<unknown>> = {
		meta: () => syncMetaAdsInvoicesForTenant(tenantId),
		tiktok: () => syncTiktokAdsSpendingForTenant(tenantId),
		google: () => syncGoogleAdsInvoicesForTenant(tenantId)
	};
	const results: SyncPlatformResult[] = [];
	for (const p of PLATFORMS) {
		try {
			await runners[p.id]();
			results.push({ id: p.id, label: p.label, ok: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError('interviuri-kpi', `Sync ${p.id} failed: ${message}`, { tenantId, userId: event.locals.user!.id });
			results.push({ id: p.id, label: p.label, ok: false, error: message.slice(0, 200) });
		}
	}
	return { results, syncedAt: new Date().toISOString() };
});
```

- [ ] **Step 5: Rulează → PASS** (`bun run test interviuri-kpi`).
- [ ] **Step 6: Commit** — `git commit -m "feat(interviuri-kpi): cheltuieli fixe (seed/reset) + remote functions cu gating owner/admin"`

---

### Task 5: Sidebar — `Interviuri` devine părinte cu copilul „KPI Performanță"

**Files:**
- Modify: `app/src/lib/config/sidebar-nav.ts:245`

- [ ] **Step 1:** înlocuiește linia:
```ts
			{
				id: 'interviuri',
				label: 'Interviuri',
				icon: 'interviuri',
				href: '/interviuri',
				children: [
					{ id: 'iv-kpi', label: 'KPI Performanță', icon: 'reports', href: '/interviuri/kpi' }
				]
			},
```
(Părintele rămâne navigabil — `OtsSidebar` face `goto(itemHref)` + toggle pe click; caretul apare automat pentru `children`.)
- [ ] **Step 2:** `bun run test sidebar` (regresii pe testele existente ale nav-ului) → PASS; commit `feat(interviuri-kpi): sub-item „KPI Performanță" în sidebar`.

---

### Task 6: UI — CSS + componente + pagină (1:1 cu prototipul)

**Files:**
- Create: `app/src/lib/components/interviuri/kpi/interviuri-kpi.css` (clasele `ivk-*` din `interviuri-kpi-styles.css`, plus `.ivk-trend-col` ca `<button>` și `.ivk-row-sel`)
- Create: `app/src/lib/components/interviuri/kpi/PlatformIcon.svelte`
- Create: `app/src/lib/components/interviuri/kpi/SourcesPanel.svelte`
- Create: `app/src/lib/components/interviuri/kpi/FixedCostsPanel.svelte`
- Create: `app/src/lib/components/interviuri/kpi/CostTrend.svelte`
- Create: `app/src/lib/components/interviuri/kpi/ChannelCostTable.svelte`
- Create: `app/src/lib/components/interviuri/kpi/MonthlyDetailTable.svelte`
- Create: `app/src/lib/components/interviuri/kpi/InterviewsKpiView.svelte`
- Create: `app/src/routes/[tenant]/interviuri/kpi/+page.svelte`

Stări definite înainte de markup (design flow):
- **Loading**: hero cu titlul + „Se încarcă…" în paragraf; cardurile KPI arată „—"; secțiunile de sub hero nu se randează până nu există `data`.
- **Error**: `.ivk-note` roșu cu mesajul + buton „Reîncearcă" (`kpiQuery.refresh()`).
- **Empty**: an fără nimic → grafic „Fără date pentru {year}.", tabele cu rând „Niciun interviu în perioada selectată.".
- **Banner** (`.ivk-note`): (a) `linkedClients === 0` → „Interviurile nu sunt asociate niciunui client, deci bugetele de ads nu pot fi citite. Asociază-le din pagina Interviuri."; (b) `!hasAdsData` → „Pentru {year} nu există cheltuieli de ads sincronizate — se afișează doar cheltuielile fixe."; (c) `fxWarnings.length` → „Sume în {valută} excluse (fără curs BNR): …".

- [ ] **Step 1: CSS** — copiază `interviuri-kpi-styles.css` din prototip în `interviuri-kpi.css` și adaugă la final:
```css
/* coloanele din grafic sunt butoane (click = filtrare pe lună) */
button.ivk-trend-col { border: 0; background: transparent; padding: 0; font: inherit; color: inherit; cursor: pointer; border-radius: 8px; }
button.ivk-trend-col:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 2px; }
.ivk-row-sel { background: var(--cl-accent-50); }
.ivk-total-row { background: var(--cl-surface-2); cursor: default; }
.ivk-note.warn { background: var(--cl-warn-50); border-color: var(--cl-warn); }
.ivk-note.danger { background: var(--cl-danger-50); border-color: var(--cl-danger); }
.ivk-check:focus-visible, .ivk-mode button:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 2px; }
.ivk-fx-row .cl-input:disabled, .ivk-fx-row .cl-select:disabled { opacity: .7; cursor: not-allowed; }
@media (max-width: 900px) { .ivk-fx-head { display: none; } .ivk-fx-row { grid-template-columns: 30px minmax(0,1fr) 60px 12px 90px 90px 90px 30px; } }
```

- [ ] **Step 2: PlatformIcon.svelte**
```svelte
<script lang="ts">
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import type { PlatformId } from '$lib/logic/interviuri-kpi';
	let { id, class: className = 'size-4' }: { id: PlatformId; class?: string } = $props();
</script>
{#if id === 'tiktok'}<IconTiktok class={className} />{:else if id === 'google'}<IconGoogleAds class={className} />{:else}<IconFacebook class={className} />{/if}
```

- [ ] **Step 3: SourcesPanel.svelte** — props `platforms: Array<KpiPlatformInfo & { amount: number }>`, `adsTotal`, `fixedTotal`, `months`, `syncing`, `onSync`, `lastSync: string`; markup identic cu `SourcesPanel` din JSX (bară stivuită → rânduri platformă cu badge „live" + cont → rând fixe „manual" `{months} luni × lei/lună` → rând total cu „ultima sincronizare"); buton „Sincronizează bugetele" `disabled={syncing}` cu text „Se sincronizează…".

- [ ] **Step 4: FixedCostsPanel.svelte** — props `rows`, `canEdit`, `months`, `fixedTotal`, `fixedMonthly`, `mode`, `onChange(id, patch)`, `onDelete(id)`, `onAdd()`, `onReset()`, `onModeChange(mode)`; grid `ivk-fx-head/ivk-fx-row` identic; checkbox = `<button role="checkbox" aria-checked>`; inputuri `oninput` → `onChange` (parent debounce 400 ms); frecvență `<select>`; „Adaugă cheltuială"/„Resetează" (confirm nativ la reset); footer cu comutatorul de mod + „Total fix în perioadă"; când `!canEdit` toate controalele sunt `disabled` și sub titlu apare „doar Owner/Admin pot edita".

- [ ] **Step 5: CostTrend.svelte** — props `rows: KpiMonthRow[]`, `year`, `selMonth`, `onPick(m)`, `platforms` (cu `amount`); coloane `<button class="ivk-trend-col" aria-pressed>` cu cifra cost/interviu sus, stiva (segmente pe platformă + fixe la opacitate .55), luna (3 litere), „N intv."; legendă `iv-legend` cu sumele pe platformă + „Cheltuieli fixe".

- [ ] **Step 6: ChannelCostTable.svelte** — props `rows: KpiChannelRow[]`, `channelMeta`, `mode`; tabel `cl-list-table` cu coloanele din spec, tag „organic", `ivk-bar-mini` sub nume (lățime = total/maxTotal), „—" pentru 0/null.

- [ ] **Step 7: MonthlyDetailTable.svelte** — props `rows`, `year`, `selMonth`, `onPick`, `platforms`; rânduri clicabile (`onclick` + `onkeydown` Enter/Space, `tabindex=0`, `aria-selected`), rând total `ivk-total-row`.

- [ ] **Step 8: InterviewsKpiView.svelte** — orchestrarea: query-uri (`getInterviewKpiData` derived pe `selectedYear`, `getMarketingFixedCosts`, `getInterviewChannels`), stare (`selectedYear`/`mode` persistate în `localStorage` `ots_iv_kpi_v1`, `month`), overlay optimist `edits` + debounce 400 ms + `toast.error` la eșec, `computeKpi`/`computeDelta`, sync cu `.updates(kpiQuery)`, export CSV (`buildKpiCsv` → Blob), crumbs `Marketing & Ads › Interviuri › KPI Performanță`, hero, 6 carduri KPI, card rezumat, grid Sources+Fixed, trend, tabel canal, tabel lunar, bannere.

- [ ] **Step 9: Pagina** `app/src/routes/[tenant]/interviuri/kpi/+page.svelte`
```svelte
<script lang="ts">
	import { page } from '$app/state';
	import InterviewsKpiView from '$lib/components/interviuri/kpi/InterviewsKpiView.svelte';
	const tenant = $derived(page.params.tenant as string);
</script>

<svelte:head><title>KPI Performanță Interviuri</title></svelte:head>
<InterviewsKpiView homeHref={`/${tenant}`} interviewsHref={`/${tenant}/interviuri`} />
```

- [ ] **Step 10:** `svelte-autofixer` pe fiecare componentă; `/build-check`; commit `feat(interviuri-kpi): pagina KPI Performanță 1:1 cu prototipul`.

---

### Task 7: Verificare în browser + audit design + docs

- [ ] testermcp: `/ots/interviuri/kpi` — golden path: pagina se încarcă cu date reale; pills an; select lună filtrează hero/KPI/compunere/tabel canal + evidențiază luna în grafic (criteriul 4); click pe coloană/rând lunar = același filtru; dezactivare rând fix → KPI-urile, graficul și ambele tabele se schimbă instant (criteriul 2); adăugare rând → persistă după refresh (criteriul 3); editare 4×8000 → total/lună 32.000; export CSV descarcă; „Sincronizează bugetele" → loading → `synced_at` nou fără reload (criteriul 7); sidebar: caret pe Interviuri, copil activ; dark mode.
- [ ] Criteriul 5 pe date reale: suma coloanelor TikTok+Google+Meta din „Detaliu lunar" = cardul „Buget ads" (tot anul și o lună).
- [ ] design-auditor + web-design-guidelines pe componentele noi; repară Critical/High.
- [ ] Doc scurt `app/docs/interviuri-kpi.md`: surse de date, formule, mapare canale, ipoteze (client-linked spend, curs BNR sfârșit de lună, valid_from/to fără UI).
- [ ] `bun run test` complet → 0 fail; commit; propune deploy (întreabă production/staging, așteaptă „go").
