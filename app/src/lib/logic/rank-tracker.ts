// Logica pură Rank Tracker — tabelul CTR pe poziții, vizibilitate, share of voice,
// delte de poziție, ferestre de lookback, pagini Google, buckete, canibalizare,
// cheia zilei în Europe/Bucharest, parsarea localizării.
// Modul PUR (fără DB, fără DOM, fără importuri SvelteKit): folosit identic de server
// (scan, email, PDF) și de UI, ca pozițiile, delta și culorile să nu poată diverge
// între tabel, drawer, raport și portalul clientului. Doar importuri relative.

// Re-exportăm helperii de săptămână ISO și programarea din modulul PageSpeed,
// ca să nu existe două implementări care se pot desincroniza.
export { isoWeekKey, isoWeekInterval, isoWeekLabel, nextRunDate, PSI_HOURS } from './pagespeed';

/** CTR-ul organic estimat (procent) pe pozițiile 1–10, exact din spec. */
const CTR_TOP_10 = [31.7, 24.7, 18.7, 13.6, 9.5, 6.3, 4.3, 3.1, 2.6, 2.4];

/**
 * CTR-ul estimat pentru o poziție: tabel fix pe 1–10, apoi plat pe intervale
 * (11–20 → 1.1, 21–50 → 0.35, 51–100 → 0.1). null sau peste 100 → 0.
 */
export function ctrForPosition(pos: number | null): number {
	if (pos == null || pos < 1 || pos > 100) return 0;
	if (pos <= 10) return CTR_TOP_10[pos - 1];
	if (pos <= 20) return 1.1;
	if (pos <= 50) return 0.35;
	return 0.1;
}

/**
 * Scor de vizibilitate 0–100: Σ ctr(poz) / (n × ctr(1)) × 100, rotunjit la o zecimală.
 * Array gol → 0 (fără împărțire la zero). [1] → 100. [null, null] → 0.
 */
export function visibility(positions: (number | null)[]): number {
	const n = positions.length;
	if (n === 0) return 0;
	const sum = positions.reduce((acc: number, p) => acc + ctrForPosition(p), 0);
	const max = n * ctrForPosition(1);
	return Math.round((sum / max) * 100 * 10) / 10;
}

/** Share of voice: aceeași formulă de vizibilitate, pe array-ul fiecărui domeniu. */
export function shareOfVoice(
	competitorPositions: Record<string, (number | null)[]>
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [domain, positions] of Object.entries(competitorPositions)) {
		out[domain] = visibility(positions);
	}
	return out;
}

export type PositionDeltaKind = 'up' | 'down' | 'flat' | 'entered' | 'lost' | 'none';

/**
 * Delta de poziție între „atunci" și „acum": delta = then − now (pozitiv = urcare,
 * fiindcă o poziție mai mică e mai bună). Intrare/ieșire din top → delta null.
 */
export function positionDelta(
	then: number | null,
	now: number | null
): { delta: number | null; kind: PositionDeltaKind } {
	if (then == null && now == null) return { delta: null, kind: 'none' };
	if (then == null) return { delta: null, kind: 'entered' };
	if (now == null) return { delta: null, kind: 'lost' };
	const delta = then - now;
	const kind: PositionDeltaKind = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
	return { delta, kind };
}

/** 'YYYY-MM-DD' → instantul UTC de la miezul nopții, ca număr de milisecunde. */
function dayKeyToUtc(dayKey: string): number {
	const [y, m, d] = dayKey.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

/**
 * Din seria (sortată sau nu) alege instantaneul a cărui zi e cea mai apropiată de
 * (todayKey − daysAgo), în fereastra inclusivă [daysAgo − tolerance, daysAgo + tolerance]
 * zile înainte de todayKey. Diferențele se calculează pe date calendaristice (UTC).
 * Fereastră goală → null. La egalitate câștigă cel mai recent (diff mai mic).
 */
export function snapshotAtLookback(
	series: { dayKey: string; position: number | null }[],
	todayKey: string,
	daysAgo: number,
	tolerance: number
): { dayKey: string; position: number | null } | null {
	const todayMs = dayKeyToUtc(todayKey);
	// `lo` nu are voie să coboare sub 1: cu `daysAgo=1, tolerance=2` fereastra ajungea la
	// [-1, 3] și includea instantaneul de AZI. La egalitate de scor câștigă `diff` mai mic,
	// deci ziua curentă se alegea drept referință și `delta1` ieșea 0 — o prăbușire de 25 de
	// poziții apărea ca „fără schimbare" ori de câte ori lipsea ziua de ieri.
	const lo = Math.max(1, daysAgo - tolerance);
	const hi = daysAgo + tolerance;
	let best: { dayKey: string; position: number | null } | null = null;
	let bestScore = Infinity; // |diff − daysAgo|
	let bestDiff = Infinity; // departajare: mai recent = diff mai mic
	for (const snap of series) {
		const diff = Math.round((todayMs - dayKeyToUtc(snap.dayKey)) / 86400000);
		if (diff < lo || diff > hi) continue;
		const score = Math.abs(diff - daysAgo);
		if (score < bestScore || (score === bestScore && diff < bestDiff)) {
			best = snap;
			bestScore = score;
			bestDiff = diff;
		}
	}
	return best;
}

/** Pagina Google (10 rezultate/pagină) în care apare poziția; null → null. */
export function pageForPosition(pos: number | null): number | null {
	if (pos == null) return null;
	return Math.ceil(pos / 10);
}

/** Poziția ca text pentru UI/raport: null → „100+", altfel numărul. */
export function fmtPosition(pos: number | null): string {
	return pos == null ? '100+' : String(pos);
}

export type RankBucket = '1-3' | '4-10' | '11-20' | '21-50' | '51-100' | '100+';

/** Bucketul de rang al unei poziții; null sau peste 100 → „100+". */
export function bucketForPosition(pos: number | null): RankBucket {
	if (pos == null || pos > 100) return '100+';
	if (pos <= 3) return '1-3';
	if (pos <= 10) return '4-10';
	if (pos <= 20) return '11-20';
	if (pos <= 50) return '21-50';
	return '51-100';
}

/** Distribuția pe cele 6 buckete; toate cheile prezente (0 când lipsesc). */
export function distribution(positions: (number | null)[]): Record<RankBucket, number> {
	const dist: Record<RankBucket, number> = {
		'1-3': 0,
		'4-10': 0,
		'11-20': 0,
		'21-50': 0,
		'51-100': 0,
		'100+': 0
	};
	for (const p of positions) dist[bucketForPosition(p)]++;
	return dist;
}

/** Cea mai bună poziție (minimul valorilor non-null) sau null dacă nu există. */
export function bestPosition(positions: (number | null)[]): number | null {
	let best: number | null = null;
	for (const p of positions) {
		if (p == null) continue;
		if (best == null || p < best) best = p;
	}
	return best;
}

/**
 * Canibalizare: flagged când apar ≥2 URL-uri de ranking distincte non-null în
 * instantaneele date (apelantul prefiltrează la fereastra de 30 de zile).
 * urls = URL-urile distincte non-null, în ordinea primei apariții.
 */
export function detectCannibalization(
	snapshots: { dayKey: string; rankingUrl: string | null }[]
): { flagged: boolean; urls: string[] } {
	const urls: string[] = [];
	for (const s of snapshots) {
		if (s.rankingUrl != null && !urls.includes(s.rankingUrl)) urls.push(s.rankingUrl);
	}
	return { flagged: urls.length >= 2, urls };
}

/**
 * Cheia zilei 'YYYY-MM-DD' pentru ora de perete din Europe/Bucharest (implicit).
 * en-CA produce direct formatul YYYY-MM-DD. Vara (EEST, UTC+3) 21:30Z → ziua următoare.
 */
export function rankDayKey(date: Date, tz: string = 'Europe/Bucharest'): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
}

/** Orele selectabile pentru verificarea zilnică: toate cele 24, „HH:00". */
export const RANK_HOURS: string[] = Array.from(
	{ length: 24 },
	(_, i) => `${String(i).padStart(2, '0')}:00`
);

/** Un rezultat organic din prima pagină, așa cum e stocat în `rank_snapshot.top_results`. */
export interface RankSerpResult {
	position: number;
	domain: string;
	url: string;
	title: string;
	snippet: string;
}

/** Câte rezultate organice are o pagină de căutare Google. */
export const RANK_PAGE_SIZE = 10;

/**
 * Hostul arată a domeniu real? `new URL()` e prea permisiv pentru ce scoatem din
 * `<cite>`: „https://6" NU aruncă, ci întoarce hostname „0.0.0.6" (Node citește „6"
 * ca întreg IPv4), iar „https://ro" dă hostul „ro". Ambele ajungeau în SERP ca
 * rezultate false — MĂSURAT 2 sep. 2026 pe „videochat iasi", unde un rezultat local
 * avea cite-ul „6 Strada Sărăriei, Iași".
 */
export function isPlausibleHost(host: string): boolean {
	if (!host.includes('.')) return false;
	const tld = host.slice(host.lastIndexOf('.') + 1);
	return /^[a-z]{2,}$/.test(tld) || /^xn--[a-z0-9-]+$/.test(tld);
}

/**
 * Curăță `rank_snapshot.top_results`: coloana e jsonb, deci la citire nu avem nicio
 * garanție de formă (snapshoturi vechi fără coloană, rânduri parțiale de la un provider
 * care schimbă contractul). Păstrează doar intrările cu poziție și domeniu utilizabile,
 * normalizează „www.", sortează după poziție și taie la prima pagină.
 */
export function normalizeTopResults(raw: unknown): RankSerpResult[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item) => {
			const r = (item ?? {}) as Record<string, unknown>;
			const position = Number(r.position);
			const domain =
				typeof r.domain === 'string' ? r.domain.replace(/^www\./i, '').toLowerCase() : '';
			// filtrul se aplică ȘI la citire, nu doar la scriere: snapshoturile luate
			// înainte de fixul din parser au deja rânduri cu host-uri de tip „0.0.0.6"
			if (!Number.isInteger(position) || position < 1 || !isPlausibleHost(domain)) return null;
			return {
				position,
				domain,
				url: typeof r.url === 'string' ? r.url : '',
				title: typeof r.title === 'string' ? r.title : '',
				snippet: typeof r.snippet === 'string' ? r.snippet : ''
			};
		})
		.filter((r): r is RankSerpResult => r !== null)
		.sort((a, b) => a.position - b.position)
		.slice(0, RANK_PAGE_SIZE);
}

/**
 * Parsează localizarea „google.ro|ro" → { googleDomain, hl, gl }.
 * gl = TLD-ul de după „google." dacă are exact 2 litere (ro, de), altfel „us" (com).
 */
export function parseLocale(locale: string): { googleDomain: string; hl: string; gl: string } {
	const [googleDomain = '', hl = ''] = locale.split('|');
	const m = /^google\.([a-z]{2})$/.exec(googleDomain);
	const gl = m ? m[1] : 'us';
	return { googleDomain, hl, gl };
}
