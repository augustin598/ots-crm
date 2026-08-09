/**
 * Extrase Stripe pentru Keez — Reporting API (financial reports).
 *
 * Contabila Keez cere trei CSV-uri pe lună, exportate din Stripe cu fusul orar
 * Europe/Bucharest (vezi https://app.keez.ro/help/client/web_app/contabilitate/
 * documente/extrase_bancare/import_bank_stripe.html):
 *
 *   1. Balance Summary                 → toate coloanele (4)
 *   2. Balance change from activity    → Itemized, Reporting category = All,
 *                                        coloane Default (9) + customer_email
 *                                        + customer_name  (= cele „11 coloane”
 *                                        pe care dashboardul le ține minte ca
 *                                        „Previous download (11)”)
 *   3. Payouts                         → Itemized, coloane Default (11) + payout_type
 *
 * Rapoartele se rulează asincron (ReportRun: pending → succeeded/failed), iar
 * fișierul rezultat se descarcă de pe files.stripe.com cu cheia secretă a
 * tenantului (nu există link public — de aceea descărcarea trece prin serverul
 * nostru, vezi routes/[tenant]/api/stripe-statements).
 *
 * Referințe Stripe:
 *   - Cum funcționează Reports API (rulare, poll, descărcare, limite):
 *     https://docs.stripe.com/reports/api
 *   - Schema rapoartelor Balance (versiuni de report type + coloane, cu marcaj
 *     pe cele default): https://docs.stripe.com/reports/report-types/balance
 *   - API reference ReportRun: https://docs.stripe.com/api/reporting/report_run
 *
 * Din acele pagini vin trei constrângeri respectate mai jos: `interval_start`
 * inclusiv / `interval_end` exclusiv, ambele în intervalul
 * `data_available_start … data_available_end` al report type-ului; `timezone`
 * implicit UTC dacă nu-l trimitem; și throttling pe rulări concurente (de aceea
 * generăm secvențial, în `ensureRuns`).
 *
 * ATENȚIE: Reporting API refuză cheile de test — „A live-mode API key is
 * required”. Verificarea o face `assertLiveMode` din remote, ca eroarea să fie
 * inteligibilă în UI.
 */

import type Stripe from 'stripe';

/** Fusul cerut de Keez — nu-l face configurabil, altfel se pierd tranzacții la graniță de lună. */
export const STATEMENT_TIMEZONE = 'Europe/Bucharest';

export type StatementKind = 'balance_summary' | 'activity' | 'payouts';

export interface StatementSpec {
	kind: StatementKind;
	/** Numele din documentația Keez, afișat în UI. */
	label: string;
	/** Slug folosit în numele fișierului CSV. */
	slug: string;
	/**
	 * Report types acceptate, în ordinea preferinței (cel mai nou primul).
	 * Stripe expune versiuni diferite per cont; alegem prima disponibilă.
	 */
	candidates: readonly string[];
	/**
	 * Coloanele cerute. `null` → lăsăm setul default al Stripe (cazul Balance
	 * Summary, unde default == „All (4)”).
	 */
	columns: readonly string[] | null;
}

/** Default (9) + Customer email + Customer name = cele 11 coloane cerute de Keez. */
const ACTIVITY_COLUMNS = [
	'balance_transaction_id',
	'created',
	'available_on',
	'currency',
	'gross',
	'fee',
	'net',
	'reporting_category',
	'description',
	'customer_email',
	'customer_name'
] as const;

/** Default (11) + Payout type. */
const PAYOUT_COLUMNS = [
	'balance_transaction_id',
	'payout_id',
	'effective_at',
	'payout_expected_arrival_date',
	'payout_status',
	'payout_type',
	'currency',
	'gross',
	'fee',
	'net',
	'reporting_category',
	'description'
] as const;

export const STATEMENT_SPECS: readonly StatementSpec[] = [
	{
		kind: 'balance_summary',
		label: 'Balance Summary',
		slug: 'balance-summary',
		candidates: ['balance.summary.1'],
		columns: null
	},
	{
		kind: 'activity',
		label: 'Balance change from activity',
		slug: 'balance-change-from-activity',
		candidates: [
			'balance_change_from_activity.itemized.7',
			'balance_change_from_activity.itemized.3'
		],
		columns: ACTIVITY_COLUMNS
	},
	{
		kind: 'payouts',
		label: 'Payouts',
		slug: 'payouts',
		candidates: ['payouts.itemized.5', 'payouts.itemized.3'],
		columns: PAYOUT_COLUMNS
	}
];

export function specFor(kind: StatementKind): StatementSpec {
	const spec = STATEMENT_SPECS.find((s) => s.kind === kind);
	if (!spec) throw new Error(`Tip de extras necunoscut: ${kind}`);
	return spec;
}

// ---------------------------------------------------------------------------
// Intervale în fusul Europe/Bucharest
// ---------------------------------------------------------------------------

/**
 * Offsetul (în secunde, est de UTC) al unui moment dat, în fusul cerut.
 * Îl calculăm din Intl ca să prindem corect trecerea EET ↔ EEST fără să
 * adăugăm o dependență de dată în proiect.
 */
function tzOffsetSeconds(instantMs: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts: Record<string, string> = {};
	for (const p of dtf.formatToParts(new Date(instantMs))) {
		if (p.type !== 'literal') parts[p.type] = p.value;
	}
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	return (asUtc - instantMs) / 1000;
}

/** Unix seconds pentru miezul nopții local (fus dat) al zilei cerute. */
export function zonedMidnightUnix(
	year: number,
	month: number,
	day: number,
	timeZone: string = STATEMENT_TIMEZONE
): number {
	const wallClockUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
	let ms = wallClockUtc;
	// Două iterații sunt suficiente pentru orice fus real (a doua doar confirmă).
	for (let i = 0; i < 3; i++) {
		const next = wallClockUtc - tzOffsetSeconds(ms, timeZone) * 1000;
		if (next === ms) break;
		ms = next;
	}
	return Math.floor(ms / 1000);
}

export interface MonthInterval {
	/** inclusiv */
	start: number;
	/** exclusiv */
	end: number;
}

/** Interval [1 ale lunii 00:00, 1 ale lunii următoare 00:00) în Europe/Bucharest. */
export function monthInterval(year: number, month: number): MonthInterval {
	if (month < 1 || month > 12) throw new Error(`Lună invalidă: ${month}`);
	const nextYear = month === 12 ? year + 1 : year;
	const nextMonth = month === 12 ? 1 : month + 1;
	return {
		start: zonedMidnightUnix(year, month, 1),
		end: zonedMidnightUnix(nextYear, nextMonth, 1)
	};
}

/** `2026-07` — cheia de lună folosită în UI, nume de fișiere și chei de map. */
export function monthKey(year: number, month: number): string {
	return `${year}-${String(month).padStart(2, '0')}`;
}

/** Prima lună pentru care are sens să cerem extrase (Stripe live a pornit în 2026). */
export const STATEMENTS_MIN_YEAR = 2026;

/** Lunile pentru care afișăm rânduri: ianuarie → luna curentă (sau tot anul, dacă e trecut). */
export function monthsForYear(year: number, now: Date): number[] {
	const currentYear = now.getFullYear();
	const last = year < currentYear ? 12 : year === currentYear ? now.getMonth() + 1 : 0;
	return Array.from({ length: last }, (_, i) => i + 1);
}

// ---------------------------------------------------------------------------
// Report types disponibile pe cont
// ---------------------------------------------------------------------------

export interface ResolvedReportType {
	kind: StatementKind;
	reportType: string;
	/** Unix seconds; null dacă Stripe nu raportează disponibilitatea. */
	dataAvailableStart: number | null;
	dataAvailableEnd: number | null;
}

/**
 * Alege, pentru fiecare dintre cele 3 extrase, versiunea de report type
 * disponibilă pe contul curent (cea mai nouă pe care o știm mapa la coloane).
 */
export async function resolveReportTypes(
	stripe: Stripe
): Promise<Record<StatementKind, ResolvedReportType>> {
	// `reportTypes.list` nu e paginat — întoarce toate tipurile eligibile pe cont.
	const available = await stripe.reporting.reportTypes.list();
	const byId = new Map(available.data.map((t) => [t.id, t]));

	const resolved = {} as Record<StatementKind, ResolvedReportType>;
	for (const spec of STATEMENT_SPECS) {
		const match = spec.candidates.map((id) => byId.get(id)).find((t) => !!t);
		if (!match) {
			throw new Error(
				`Contul Stripe nu expune raportul „${spec.label}” (${spec.candidates.join(' / ')}). ` +
					'Verifică dacă folosești o cheie live — Reporting API nu rulează pe chei de test.'
			);
		}
		resolved[spec.kind] = {
			kind: spec.kind,
			reportType: match.id,
			dataAvailableStart: match.data_available_start ?? null,
			dataAvailableEnd: match.data_available_end ?? null
		};
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// Report runs
// ---------------------------------------------------------------------------

export type StatementStatus =
	/** Nu există rulare pentru luna asta. */
	| 'missing'
	/** Rulare în curs la Stripe. */
	| 'pending'
	| 'succeeded'
	| 'failed'
	/** Stripe n-are încă date pentru intervalul cerut. */
	| 'unavailable';

export interface StatementRunView {
	kind: StatementKind;
	label: string;
	reportType: string;
	status: StatementStatus;
	/** Numele fișierului livrat — calculat aici ca să nu se dubleze logica în UI. */
	fileName: string;
	runId: string | null;
	fileId: string | null;
	fileSize: number | null;
	createdAt: number | null;
	/** Intervalul acoperit efectiv de rulare (poate fi mai scurt pentru luna curentă). */
	intervalStart: number | null;
	intervalEnd: number | null;
	error: string | null;
}

export interface MonthStatementsView {
	year: number;
	month: number;
	key: string;
	interval: MonthInterval;
	/** Luna e încheiată ȘI Stripe are date până la finalul ei. */
	complete: boolean;
	reports: StatementRunView[];
}

type ReportRun = Stripe.Reporting.ReportRun;

/**
 * Toate rulările recente ale contului (max `limit`), din care compunem
 * starea per lună fără să ținem un tabel propriu în DB.
 */
export async function listRecentRuns(stripe: Stripe, limit = 300): Promise<ReportRun[]> {
	return stripe.reporting.reportRuns.list({ limit: 100 }).autoPagingToArray({ limit });
}

function runInterval(run: ReportRun): MonthInterval | null {
	const start = run.parameters?.interval_start;
	const end = run.parameters?.interval_end;
	if (typeof start !== 'number' || typeof end !== 'number') return null;
	return { start, end };
}

/**
 * Cea mai relevantă rulare pentru (report type, lună):
 *  - lună încheiată → potrivire exactă pe interval;
 *  - lună în curs → orice rulare care începe la 1 ale lunii (Stripe are date
 *    doar până la `data_available_end`, deci capătul diferă de la zi la zi).
 *
 * În ambele cazuri preferăm `succeeded`, apoi cea mai recentă.
 */
export function pickRunForMonth(
	runs: ReportRun[],
	reportType: string,
	interval: MonthInterval,
	exactEnd: boolean
): ReportRun | null {
	const candidates = runs.filter((run) => {
		if (run.report_type !== reportType) return false;
		const ri = runInterval(run);
		if (!ri || ri.start !== interval.start) return false;
		if (exactEnd) return ri.end === interval.end;
		return ri.end <= interval.end;
	});
	if (candidates.length === 0) return null;

	const rank = (run: ReportRun) => (run.status === 'succeeded' ? 2 : run.status === 'failed' ? 0 : 1);
	return candidates.sort((a, b) => rank(b) - rank(a) || b.created - a.created)[0];
}

function statusFromRun(run: ReportRun | null): StatementStatus {
	if (!run) return 'missing';
	if (run.status === 'succeeded') return 'succeeded';
	if (run.status === 'failed') return 'failed';
	return 'pending';
}

/** Compune starea celor 3 extrase pentru o lună, din rulările deja existente. */
export function buildMonthView(
	year: number,
	month: number,
	runs: ReportRun[],
	types: Record<StatementKind, ResolvedReportType>,
	nowSeconds: number
): MonthStatementsView {
	const interval = monthInterval(year, month);
	const monthOver = interval.end <= nowSeconds;

	const reports: StatementRunView[] = STATEMENT_SPECS.map((spec) => {
		const type = types[spec.kind];
		const availableEnd = type.dataAvailableEnd;
		const hasFullData = availableEnd != null && availableEnd >= interval.end;
		const exactEnd = monthOver && hasFullData;
		const run = pickRunForMonth(runs, type.reportType, interval, exactEnd);
		const ri = run ? runInterval(run) : null;

		let status = statusFromRun(run);
		if (status === 'missing' && availableEnd != null && availableEnd <= interval.start) {
			status = 'unavailable';
		}

		return {
			kind: spec.kind,
			label: spec.label,
			reportType: type.reportType,
			status,
			fileName: csvFileName(spec.kind, year, month),
			runId: run?.id ?? null,
			fileId: run?.result?.id ?? null,
			fileSize: run?.result?.size ?? null,
			createdAt: run?.created ?? null,
			intervalStart: ri?.start ?? null,
			intervalEnd: ri?.end ?? null,
			error: run?.error ?? null
		};
	});

	const complete = reports.every((r) => {
		const type = types[r.kind];
		return (
			monthOver && type.dataAvailableEnd != null && type.dataAvailableEnd >= interval.end
		);
	});

	return { year, month, key: monthKey(year, month), interval, complete, reports };
}

/**
 * Intervalul cu care chemăm Stripe: pentru luna în curs tăiem capătul la
 * `data_available_end`, altfel Stripe răspunde 400 (interval în afara datelor
 * disponibile).
 */
export function effectiveInterval(
	interval: MonthInterval,
	type: ResolvedReportType
): MonthInterval | null {
	const start = interval.start;
	const end =
		type.dataAvailableEnd != null ? Math.min(interval.end, type.dataAvailableEnd) : interval.end;
	if (type.dataAvailableStart != null && start < type.dataAvailableStart) {
		// Contul n-are date atât de vechi — Stripe ar da 400.
		if (type.dataAvailableStart >= end) return null;
		return { start: type.dataAvailableStart, end };
	}
	if (end <= start) return null;
	return { start, end };
}

/** Creează o rulare pentru (spec, lună). Aruncă eroarea Stripe brută dacă e cazul. */
export async function createRun(
	stripe: Stripe,
	spec: StatementSpec,
	type: ResolvedReportType,
	interval: MonthInterval
): Promise<ReportRun> {
	// Obiectul e inline ca să primească tipul contextual al SDK-ului: `timezone`
	// e o uniune de fusuri IANA, iar un literal extras într-o variabilă s-ar lăți
	// la `string` și ar fi respins de TypeScript.
	return stripe.reporting.reportRuns.create({
		report_type: type.reportType,
		parameters: {
			interval_start: interval.start,
			interval_end: interval.end,
			timezone: STATEMENT_TIMEZONE,
			...(spec.columns ? { columns: [...spec.columns] } : {})
		}
	});
}

// ---------------------------------------------------------------------------
// Descărcare fișier
// ---------------------------------------------------------------------------

/** Numele fișierului livrat contabilei. */
export function csvFileName(kind: StatementKind, year: number, month: number): string {
	return `${monthKey(year, month)}_${specFor(kind).slug}.csv`;
}

/**
 * Descarcă CSV-ul unei rulări. `result.url` (files.stripe.com) cere autentificare
 * cu cheia secretă — nu e un link public și nu poate fi dat clientului.
 */
export async function fetchReportCsv(secretKey: string, fileUrl: string): Promise<Buffer> {
	const res = await fetch(fileUrl, {
		headers: { Authorization: `Bearer ${secretKey}` },
		// Fără timeout, un Stripe lent blochează requestul (și workerul) la nesfârșit.
		signal: AbortSignal.timeout(60_000)
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(
			`Descărcarea raportului Stripe a eșuat (HTTP ${res.status}). ${body.slice(0, 200)}`
		);
	}
	return Buffer.from(await res.arrayBuffer());
}
