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
	{
		id: 'tiktok',
		label: 'TikTok Ads',
		color: '#111827',
		soft: 'rgba(17,24,39,.07)',
		channels: ['TikTok']
	},
	{
		id: 'google',
		label: 'Google Ads',
		color: '#ea4335',
		soft: 'rgba(234,67,53,.09)',
		channels: ['Google / SEO']
	},
	{
		id: 'meta',
		label: 'Facebook / Meta',
		color: '#1877f2',
		soft: 'rgba(24,119,242,.09)',
		channels: ['Facebook', 'Instagram']
	}
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

/** Cost lunar al unui rând: qty × unit_amount (÷12 dacă anual). */
export function rowMonthly(r: Pick<FixedCostRow, 'qty' | 'unitAmount' | 'frequency'>): number {
	const v = (Number(r.qty) || 0) * (Number(r.unitAmount) || 0);
	return r.frequency === 'yearly' ? v / 12 : v;
}
export function monthKey(year: number, monthNum: number): string {
	return `${year}-${String(monthNum).padStart(2, '0')}`;
}
/** Rândul intră în calcul pentru luna `key` ('YYYY-MM')? Interval inclusiv. */
export function rowAppliesTo(
	r: Pick<FixedCostRow, 'active' | 'validFrom' | 'validTo'>,
	key: string
): boolean {
	if (!r.active) return false;
	if (r.validFrom && key < r.validFrom) return false;
	if (r.validTo && key > r.validTo) return false;
	return true;
}
/** fix_lunar = Σ rowMonthly pentru rândurile active valabile în luna respectivă. */
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
	/** media lunară a fixelor în scop (lei/lună); fără luni în scop = tariful rândurilor active */
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

/** Împărțirile la zero dau null — se afișează „—", niciodată 0 sau ∞. */
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
	const fixedTotal = scopeMonths.reduce(
		(s, mn) => s + fixedMonthlyFor(fixedRows, data.year, mn),
		0
	);
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
			monthNum: mn,
			month: IV_MONTHS[mn - 1] ?? String(mn),
			n: k,
			ok,
			ads,
			adsSum,
			fixed,
			total: tot,
			cpi: ratio(tot, k),
			cpiOk: ratio(tot, ok)
		};
	});

	const counts = new Map<string, { n: number; ok: number }>();
	for (const i of scoped) {
		const c = counts.get(i.channel) ?? { n: 0, ok: 0 };
		c.n++;
		if (i.status === 'admisa') c.ok++;
		counts.set(i.channel, c);
	}
	// interviurile fiecărei platforme (numitorul cotei pe canal)
	const platformBase = emptySpend();
	for (const [ch, c] of counts) {
		const p = platformOfChannel(ch);
		if (p) platformBase[p] += c.n;
	}
	const order = [
		...channelOrder,
		...[...counts.keys()].filter((ch) => !channelOrder.includes(ch))
	];
	const channelRows: KpiChannelRow[] = order
		.filter((ch) => counts.has(ch))
		.map((ch) => {
			const c = counts.get(ch)!;
			const p = platformOfChannel(ch);
			const paid = p !== null;
			const ads = p && platformBase[p] > 0 ? adsByPlatform[p] * (c.n / platformBase[p]) : 0;
			const fixed =
				mode === 'toate'
					? n > 0
						? fixedTotal * (c.n / n)
						: 0
					: paid && nPaid > 0
						? fixedTotal * (c.n / nPaid)
						: 0;
			const tot = ads + fixed;
			return {
				channel: ch,
				n: c.n,
				ok: c.ok,
				paid,
				ads,
				fixed,
				total: tot,
				cpi: ratio(tot, c.n),
				cpiOk: ratio(tot, c.ok)
			};
		})
		.sort((a, b) => b.n - a.n);

	return {
		year: data.year,
		scopeMonths,
		adsByPlatform,
		adsTotal,
		fixedTotal,
		fixedMonthly,
		activeFixedRows: activeRows.length,
		total,
		n,
		nOk,
		nPaid,
		cpi: ratio(total, n),
		cpiOk: ratio(total, nOk),
		cpiAds: ratio(adsTotal, nPaid),
		monthRows,
		channelRows
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
	return {
		pct: Math.round(((current.cpi - prev.val) / prev.val) * 100),
		label: prev.label,
		prev: prev.val
	};
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
	const cols = [
		'Luna',
		'Interviuri',
		'Admise',
		...PLATFORMS.map((p) => p.label),
		'Cheltuieli fixe',
		'Buget total',
		'Cost/interviu',
		'Cost/admisa'
	];
	const esc = (v: unknown) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
	const lines = [cols.map(esc).join(',')].concat(
		rows.map((r) =>
			[
				r.month,
				r.n,
				r.ok,
				...PLATFORM_IDS.map((id) => Math.round(r.ads[id])),
				Math.round(r.fixed),
				Math.round(r.total),
				r.cpi != null ? Math.round(r.cpi) : '',
				r.cpiOk != null ? Math.round(r.cpiOk) : ''
			]
				.map(esc)
				.join(',')
		)
	);
	return '﻿' + lines.join('\n');
}
