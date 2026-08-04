/**
 * Căutarea cursului BNR PE DATĂ, separat de accesul la baza de date.
 *
 * Modul PUR (fără DB, fără rețea): primește rândurile deja citite și decide care cotație
 * se aplică fiecărei zile. Aici stau cele două reguli care nu au ce căuta nici în
 * `client.ts` (care doar citește), nici în `payment-match.ts` (care trebuie să rămână pur):
 *
 *   1. BNR nu cotează în weekend și de sărbători, deci pentru o plată de sâmbătă se
 *      folosește ULTIMA cotație anterioară — niciodată una ulterioară, care la momentul
 *      plății nu exista.
 *   2. Multiplicatorul: pentru HUF, JPY, KRW… BNR publică prețul a 100 de unități.
 *      Împărțirea se face o singură dată, aici, ca restul codului să lucreze doar cu
 *      lei/unitate.
 */
import type { FxRate, FxRates } from '$lib/server/banking/payment-match';

/** Un rând din `bnr_exchange_rate`, exact cum e stocat. */
export interface BnrRateRow {
	currency: string;
	rate: number;
	/** BNR cotează unele valute la 100 de unități; coloana e nullable în schemă. */
	multiplier: number | null;
	/** ISO YYYY-MM-DD, formatul în care BNR publică data cotației. */
	rateDate: string;
}

/** Datele ISO se compară lexicografic corect, deci nu construim obiecte Date degeaba. */
function normalizeRow(row: BnrRateRow): FxRate | null {
	if (!Number.isFinite(row.rate) || row.rate <= 0) return null;
	const multiplier = row.multiplier && row.multiplier > 0 ? row.multiplier : 1;
	return { ronPerUnit: row.rate / multiplier, rateDate: row.rateDate };
}

/**
 * Cea mai recentă cotație a valutei cu `rateDate <= isoDate`, sau `null` dacă la acea dată
 * nu exista niciuna (valută nesincronizată, dată dinaintea istoricului). `null` înseamnă
 * „nu știu", nu „paritate" — apelantul trebuie să renunțe la comparație.
 */
export function findRateOnOrBefore(
	rows: BnrRateRow[],
	currency: string,
	isoDate: string
): FxRate | null {
	const wanted = currency.toUpperCase();
	let best: FxRate | null = null;
	for (const row of rows) {
		if (row.currency.toUpperCase() !== wanted) continue;
		if (row.rateDate > isoDate) continue;
		if (best && row.rateDate <= best.rateDate) continue;
		// Rândul corupt e sărit ABIA aici, nu mai devreme: altfel ar „ocupa" ziua și ar
		// ascunde o cotație valabilă mai veche.
		const normalized = normalizeRow(row);
		if (normalized) best = normalized;
	}
	return best;
}

/**
 * Cursurile pentru fiecare (dată, valută) cerută, în forma pe care o consumă `matchPayments`.
 * Zilele și valutele fără cotație aplicabilă lipsesc pur și simplu din rezultat.
 */
export function resolveFxRates(rows: BnrRateRow[], isoDates: string[]): FxRates {
	const currencies = [...new Set(rows.map((r) => r.currency.toUpperCase()))];
	const result: FxRates = {};
	for (const isoDate of new Set(isoDates)) {
		const perCurrency: Record<string, FxRate> = {};
		for (const currency of currencies) {
			const rate = findRateOnOrBefore(rows, currency, isoDate);
			if (rate) perCurrency[currency] = rate;
		}
		if (Object.keys(perCurrency).length > 0) result[isoDate] = perCurrency;
	}
	return result;
}
