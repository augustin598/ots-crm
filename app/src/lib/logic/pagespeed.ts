// Logica pură PageSpeed Insights — praguri Google, nivele, formatare ro,
// chei de săptămână ISO, verdict Core Web Vitals, programare raport.
// Modul PUR (fără DB, fără DOM): folosit identic de server (scan, email) și de UI,
// ca scorurile și culorile să nu poată diverge între tabel, drawer și raport.

export type PsiLevel = 'good' | 'ni' | 'poor' | 'none';
export type PsiStrategy = 'mobile' | 'desktop';
export type PsiMetricKey = 'lcp' | 'inp' | 'cls' | 'fcp' | 'tbt' | 'si';

/** Praguri Google (Core Web Vitals + Lighthouse). Valorile în ms, CLS adimensional. */
export const PSI_THRESHOLDS: Record<
	PsiMetricKey,
	{ good: number; ni: number; unit: 's' | 'ms' | ''; label: string; name: string }
> = {
	lcp: { good: 2500, ni: 4000, unit: 's', label: 'LCP', name: 'Largest Contentful Paint' },
	inp: { good: 200, ni: 500, unit: 'ms', label: 'INP', name: 'Interaction to Next Paint' },
	cls: { good: 0.1, ni: 0.25, unit: '', label: 'CLS', name: 'Cumulative Layout Shift' },
	fcp: { good: 1800, ni: 3000, unit: 's', label: 'FCP', name: 'First Contentful Paint' },
	tbt: { good: 200, ni: 600, unit: 'ms', label: 'TBT', name: 'Total Blocking Time' },
	si: { good: 3400, ni: 5800, unit: 's', label: 'SI', name: 'Speed Index' }
};

/** Colorarea scorurilor 0–100: verde ≥ 90, portocaliu 50–89, roșu < 50. */
export function psiScoreLevel(v: number | null | undefined): PsiLevel {
	if (v == null) return 'none';
	return v >= 90 ? 'good' : v >= 50 ? 'ni' : 'poor';
}

export function psiMetricLevel(key: PsiMetricKey, v: number | null | undefined): PsiLevel {
	if (v == null) return 'none';
	const t = PSI_THRESHOLDS[key];
	return v <= t.good ? 'good' : v <= t.ni ? 'ni' : 'poor';
}

/** Formatare românească: virgulă zecimală; lcp/fcp/si primesc ms și afișează secunde. */
export function psiFmt(key: PsiMetricKey, v: number | null | undefined): string {
	if (v == null) return '—';
	if (key === 'cls') {
		return v
			.toFixed(3)
			.replace(/0+$/, '')
			.replace(/\.$/, '')
			.replace('.', ',');
	}
	const t = PSI_THRESHOLDS[key];
	if (t.unit === 'ms') return `${Math.round(v)} ms`;
	return `${(v / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Cheia săptămânii ISO 8601 (pe componentele UTC ale datei), ex. „2026-W36". */
export function isoWeekKey(date: Date): string {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	// joia din aceeași săptămână ISO decide anul săptămânii
	const dow = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dow);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** „2026-W35" → „S35" (eticheta scurtă din design). */
export function isoWeekLabel(weekKey: string): string {
	return `S${Number(weekKey.slice(-2))}`;
}

/** Ziua de luni (UTC) a săptămânii ISO date. */
export function isoWeekMonday(weekKey: string): Date {
	const [yearStr, weekStr] = weekKey.split('-W');
	const year = Number(yearStr);
	const week = Number(weekStr);
	// 4 ianuarie e mereu în W1; luni W1 = 4 ian − (ziua săptămânii − 1)
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const dow = jan4.getUTCDay() || 7;
	const mondayW1 = new Date(Date.UTC(year, 0, 4 - (dow - 1)));
	return new Date(mondayW1.getTime() + (week - 1) * 7 * 86400000);
}

const RO_MONTHS_SHORT = [
	'ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.',
	'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'
];

/** Data de luni a săptămânii ISO, scurt: „31 aug." — pentru axele graficelor. */
export function isoWeekShortDate(weekKey: string): string {
	const monday = isoWeekMonday(weekKey);
	return `${monday.getUTCDate()} ${RO_MONTHS_SHORT[monday.getUTCMonth()]}`;
}

/** Intervalul luni–duminică al săptămânii ISO, format românesc: „24 – 30 aug. 2026". */
export function isoWeekInterval(weekKey: string): string {
	const monday = isoWeekMonday(weekKey);
	const sunday = new Date(monday.getTime() + 6 * 86400000);
	const m1 = RO_MONTHS_SHORT[monday.getUTCMonth()];
	const m2 = RO_MONTHS_SHORT[sunday.getUTCMonth()];
	if (m1 === m2) {
		return `${monday.getUTCDate()} – ${sunday.getUTCDate()} ${m2} ${sunday.getUTCFullYear()}`;
	}
	return `${monday.getUTCDate()} ${m1} – ${sunday.getUTCDate()} ${m2} ${sunday.getUTCFullYear()}`;
}

/** Verdict Core Web Vitals pe datele reale CrUX (p75): LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1. */
export function cwvPass(
	field: { lcpMs: number | null; inpMs: number | null; cls: number | null } | null | undefined
): boolean | null {
	if (!field || field.lcpMs == null || field.inpMs == null || field.cls == null) return null;
	return field.lcpMs <= 2500 && field.inpMs <= 200 && field.cls <= 0.1;
}

/** Zilele săptămânii din UI (1 = Luni … 7 = Duminică). */
export const PSI_DAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
/** Orele selectabile pentru raport (aliniate cu jobul orar al schedulerului). */
export const PSI_HOURS = ['06:00', '07:00', '08:00', '09:00', '12:00', '18:00', '21:00'];

const BUCHAREST_TZ = 'Europe/Bucharest';

function bucharestParts(date: Date): { y: number; m: number; d: number; dow: number } {
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: BUCHAREST_TZ,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		weekday: 'short'
	});
	const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
	const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
	return {
		y: Number(parts.year),
		m: Number(parts.month),
		d: Number(parts.day),
		dow: dowMap[parts.weekday]
	};
}

/** Instantul UTC pentru ora de perete dată în Europe/Bucharest (corect și la DST). */
function bucharestWallToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
	// două treceri: estimăm cu offsetul instantului-ghici, apoi corectăm
	let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
	for (let i = 0; i < 2; i++) {
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: BUCHAREST_TZ,
			hour: 'numeric',
			minute: 'numeric',
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric'
		});
		const p = Object.fromEntries(fmt.formatToParts(guess).map((x) => [x.type, x.value]));
		const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
		const target = Date.UTC(y, m - 1, d, hh, mm);
		const diff = target - wall;
		if (diff === 0) break;
		guess = new Date(guess.getTime() + diff);
	}
	return guess;
}

/**
 * Următoarea rulare programată (instant UTC) pentru ziua săptămânii (1=Luni…7=Duminică)
 * și ora „HH:MM", interpretate în Europe/Bucharest. Dacă momentul de azi a trecut,
 * întoarce săptămâna următoare.
 */
export function nextRunDate(dayOfWeek: number, hour: string, now: Date = new Date()): Date {
	const [hh, mm] = hour.split(':').map(Number);
	const today = bucharestParts(now);
	const ahead = (dayOfWeek - today.dow + 7) % 7;
	const base = new Date(Date.UTC(today.y, today.m - 1, today.d + ahead, 12, 0));
	let candidate = bucharestWallToUtc(
		base.getUTCFullYear(),
		base.getUTCMonth() + 1,
		base.getUTCDate(),
		hh,
		mm
	);
	if (candidate.getTime() <= now.getTime()) {
		const next = new Date(Date.UTC(today.y, today.m - 1, today.d + ahead + 7, 12, 0));
		candidate = bucharestWallToUtc(
			next.getUTCFullYear(),
			next.getUTCMonth() + 1,
			next.getUTCDate(),
			hh,
			mm
		);
	}
	return candidate;
}
