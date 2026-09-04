// Helper-e UI pentru Rank Tracker — portate 1:1 din designul Claude Design
// (rank-data.jsx + rank-bits.jsx). Logica de calcul (CTR, vizibilitate, buckete)
// stă în $lib/logic/rank-tracker.ts; aici rămân doar etichetele și culorile.
import { parseLocale, type RankBucket } from '$lib/logic/rank-tracker';

export const RT_MONTHS = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sep.', 'oct.', 'nov.', 'dec.'];
export const RT_WDAYS = ['dum.', 'lun.', 'mar.', 'mie.', 'joi', 'vin.', 'sâm.'];

/** Chips-urile de SERP features: aceleași etichete, prescurtări și culori ca în design. */
export const RT_FEATURES: Record<string, { label: string; short: string; color: string }> = {
	ai: { label: 'AI Overview', short: 'AI', color: '#8b5cf6' },
	snippet: { label: 'Featured snippet', short: 'FS', color: '#0ea5e9' },
	local: { label: 'Local pack', short: 'LP', color: '#10b981' },
	paa: { label: 'People also ask', short: 'PA', color: '#64748b' },
	images: { label: 'Pachet imagini', short: 'IM', color: '#f59e0b' },
	video: { label: 'Video / YouTube', short: 'VD', color: '#ef4444' },
	shopping: { label: 'Google Shopping', short: 'SH', color: '#0f766e' },
	ads: { label: 'Anunțuri top', short: 'AD', color: '#a16207' }
};

/** Ordinea bucketelor în bara de distribuție (de la cel mai bun la „peste 100"). */
export const RT_BUCKETS: RankBucket[] = ['1-3', '4-10', '11-20', '21-50', '51-100', '100+'];

export const RT_BUCKET_COLORS: Record<RankBucket, string> = {
	'1-3': '#10b981',
	'4-10': '#1877F2',
	'11-20': '#f59e0b',
	'21-50': '#94a3b8',
	'51-100': '#cbd5e1',
	'100+': '#e2e8f0'
};

export const RT_BUCKET_LABELS: Record<RankBucket, string> = {
	'1-3': '1–3',
	'4-10': '4–10',
	'11-20': '11–20',
	'21-50': '21–50',
	'51-100': '51–100',
	'100+': 'peste 100'
};

/** Nivelul de culoare al pastilei de poziție. */
export function rtPosLevel(pos: number | null): 'top3' | 'top10' | 'top20' | 'low' | 'out' {
	if (pos == null) return 'out';
	if (pos <= 3) return 'top3';
	if (pos <= 10) return 'top10';
	if (pos <= 20) return 'top20';
	return 'low';
}

/** Link către SERP-ul Google al cuvântului, pe domeniul din localizarea proiectului. */
export function rtSerpLink(keyword: string, locale: string): string {
	const { googleDomain } = parseLocale(locale);
	const domain = googleDomain || 'google.ro';
	return `https://www.${domain}/search?q=${encodeURIComponent(keyword)}`;
}

/** „google.ro|ro" → „google.ro · ro" (formatul afișat în design). */
export function rtLocaleLabel(locale: string): string {
	return (locale || '').replace('|', ' · ');
}

export function rtNum(n: number): string {
	return n.toLocaleString('ro-RO');
}

export function rtDevicesLabel(devices: readonly string[]): string {
	if (devices.length >= 2) return 'desktop + mobil';
	return devices[0] === 'mobile' ? 'doar mobil' : 'doar desktop';
}

export interface RtDay {
	id: string;
	label: string;
	short: string;
	full: string;
}

/** 'YYYY-MM-DD' → etichetele de zi folosite pe axe și în tooltip-uri. */
export function rtDay(dayKey: string): RtDay {
	const [y, m, d] = dayKey.split('-').map(Number);
	const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
	return {
		id: dayKey,
		label: String(d),
		short: `${d} ${RT_MONTHS[(m || 1) - 1]}`,
		full: `${RT_WDAYS[date.getUTCDay()]} ${d} ${RT_MONTHS[(m || 1) - 1]} ${y}`
	};
}

export function rtDays(dayKeys: string[]): RtDay[] {
	return dayKeys.map(rtDay);
}

/** Ora „HH:MM" de azi a trecut? → următoarea rulare e mâine. */
export function rtNextRunLabel(hour: string, now: Date = new Date()): string {
	const [h, m] = hour.split(':').map(Number);
	const today = new Date(now);
	today.setHours(h || 0, m || 0, 0, 0);
	return `${now.getTime() < today.getTime() ? 'azi' : 'mâine'}, ${hour}`;
}

/**
 * Bidul top-of-page din Keyword Planner, în moneda contului Google Ads.
 * Google NU dă un CPC mediu — doar intervalul low–high; în tabel arătăm capătul de
 * sus (cât costă efectiv să prinzi topul), iar intervalul complet stă în tooltip.
 * Micro-unități → unități: 1.000.000 micro = 1 RON.
 */
function fmtMicros(micros: number): string {
	return (micros / 1_000_000).toLocaleString('ro-RO', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

/** Maximul bidului top-of-page, rotunjit la leu (fallback pe low, dacă high lipsește). */
export function rtCpc(lowMicros: number | null, highMicros: number | null): string | null {
	const max = highMicros ?? lowMicros;
	return max == null ? null : rtNum(Math.round(max / 1_000_000));
}

/** Intervalul complet, pentru tooltip. Null când n-avem ambele capete. */
export function rtCpcRange(lowMicros: number | null, highMicros: number | null): string | null {
	if (lowMicros == null || highMicros == null) return null;
	return `Interval bid top-of-page: ${fmtMicros(lowMicros)}–${fmtMicros(highMicros)} RON`;
}

/** Mijlocul intervalului de bid, în micro-unități. Null dacă lipsesc ambele capete. */
export function rtCpcMidMicros(lowMicros: number | null, highMicros: number | null): number | null {
	if (lowMicros != null && highMicros != null) return (lowMicros + highMicros) / 2;
	return highMicros ?? lowMicros;
}
