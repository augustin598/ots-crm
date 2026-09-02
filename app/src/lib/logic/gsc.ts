// Logica pură pentru Google Search Console: fereastra de zile trasă la fiecare
// rulare, conversia rândurilor `searchanalytics.query` în forma noastră și semnalul
// de încredere în poziția scrapată. Modul PUR (fără rețea, fără DB) — folosit identic
// de jobul de tragere și de read model.
import { normalizeKeyword } from './rank-tracker';

/** Dispozitivele pe care le urmărim. GSC mai întoarce și „TABLET", pe care îl ignorăm. */
export type GscDevice = 'desktop' | 'mobile';

/** Un rând brut din `searchanalytics.query`, cu dimensiunile [query, device, date]. */
export interface GscRow {
	keys?: string[] | null;
	clicks?: number | null;
	impressions?: number | null;
	ctr?: number | null;
	position?: number | null;
}

export interface GscDailyRecord {
	keyword: string;
	device: GscDevice;
	/** Ziua raportată de GSC, „YYYY-MM-DD" (ora Pacificului). */
	date: string;
	clicks: number;
	impressions: number;
	/** 0–100 cu o zecimală. */
	ctr: number;
	/** Poziția medie, o zecimală. */
	position: number;
}

/** Câte zile retragem la fiecare rulare. */
export const GSC_WINDOW_DAYS = 7;
/** De la ce diferență între poziția scrapată și cea din GSC ridicăm semnalul. */
export const GSC_DIVERGENCE_THRESHOLD = 10;

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Fereastra trasă la fiecare rulare. Retragem mai multe zile pentru că datele
 * proaspete (`dataState: 'all'`) sunt PARȚIALE și Google le rescrie zile la rând;
 * scrierea e upsert, deci fiecare rulare le corectează pe cele anterioare.
 */
export function gscPullWindow(
	today: Date,
	days: number = GSC_WINDOW_DAYS
): { startDate: string; endDate: string } {
	const start = new Date(today.getTime() - (days - 1) * 86400000);
	return { startDate: isoDate(start), endDate: isoDate(today) };
}

function toDevice(raw: unknown): GscDevice | null {
	if (typeof raw !== 'string') return null;
	const v = raw.toLowerCase();
	return v === 'desktop' || v === 'mobile' ? v : null;
}

/** Rândurile GSC → forma noastră. Ce nu se potrivește se aruncă, fără excepție. */
export function parseGscRows(rows: GscRow[] | null | undefined): GscDailyRecord[] {
	if (!Array.isArray(rows)) return [];
	const out: GscDailyRecord[] = [];
	for (const row of rows) {
		const [rawQuery, rawDevice, rawDate] = row?.keys ?? [];
		const keyword = typeof rawQuery === 'string' ? normalizeKeyword(rawQuery) : '';
		const device = toDevice(rawDevice);
		if (!keyword || !device) continue;
		if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
		out.push({
			keyword,
			device,
			date: rawDate,
			clicks: Math.round(row.clicks ?? 0),
			impressions: Math.round(row.impressions ?? 0),
			// GSC dă CTR în 0–1; îl ținem în procente, ca restul modulului
			ctr: Math.round((row.ctr ?? 0) * 1000) / 10,
			position: Math.round((row.position ?? 0) * 10) / 10
		});
	}
	return out;
}

/** Cât de mult ne putem baza pe poziția scrapată, dat fiind ce spune Google. */
export type GscTrust = 'ok' | 'divergent' | 'scrape-missing';

/**
 * MĂSURAT 2 sep. 2026: heylux.ro apărea „negăsit în primele 30" la toate cuvintele,
 * fiindcă toate rulările fuseseră blocate de Google — dar site-ul era pe poziția 8.
 * `scrape-missing` există exact pentru cazul ăsta: noi n-am găsit nimic, Google
 * raportează afișări, deci datele NOASTRE sunt greșite, nu pozițiile clientului.
 *
 * `depth` = câte poziții căutăm efectiv (`SERP_DEPTH`, implicit 30). Dacă Google
 * raportează o poziție DINCOLO de ea, „negăsit în primele 30" e răspunsul corect,
 * nu o măsurătoare ratată — MĂSURAT 3 sep. 2026, când badge-ul se aprindea degeaba
 * la cuvinte aflate pe pozițiile 40 și 58. Un semnal care dă alarme false e mai rău
 * decât niciun semnal: se învață ignorarea lui, inclusiv când e real.
 */
export function gscTrust(
	scraped: number | null,
	gscPosition: number | null,
	impressions: number,
	depth?: number
): GscTrust {
	if (impressions <= 0) return 'ok'; // fără date GSC nu avem cu ce compara
	if (scraped == null) {
		// dincolo de adâncimea căutată, „negăsit" e adevărul, nu un eșec de măsurare
		if (depth != null && gscPosition != null && gscPosition > depth) return 'ok';
		return 'scrape-missing';
	}
	if (gscPosition == null) return 'ok';
	return Math.abs(scraped - gscPosition) >= GSC_DIVERGENCE_THRESHOLD ? 'divergent' : 'ok';
}
