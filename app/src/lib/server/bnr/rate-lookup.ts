/**
 * Căutarea cursului BNR PE DATĂ, separat de accesul la baza de date.
 *
 * Modul PUR (fără DB, fără rețea): primește rândurile deja citite și decide care cotație
 * se aplică fiecărei zile. Aici stau cele două reguli care nu au ce căuta nici în
 * `client.ts` (care doar citește), nici în `payment-match.ts` (care trebuie să rămână pur):
 *
 *   1. BNR nu cotează în weekend și de sărbători, deci pentru o plată de sâmbătă se
 *      folosește ULTIMA cotație anterioară — niciodată una ulterioară, care la momentul
 *      plății nu exista. Cu un PLAFON de vechime: vezi `RATE_LOOKBACK_DAYS`.
 *   2. Multiplicatorul: pentru HUF, JPY, KRW… BNR publică prețul a 100 de unități.
 *      Împărțirea se face o singură dată, aici, ca restul codului să lucreze doar cu
 *      lei/unitate.
 */
import type { FxRate, FxRates } from '$lib/server/banking/payment-match';

/**
 * Cât de veche are voie să fie cotația aplicată unei zile fără cotație proprie.
 *
 * BNR nu cotează în weekend și de sărbători; cea mai lungă pauză din calendarul românesc
 * (Paște, Rusalii, 1 Decembrie lipit de weekend) ajunge la 4-5 zile lucrătoare pierdute.
 * 15 zile lasă marjă confortabilă.
 *
 * Plafonul se aplică AICI, per zi cerută, nu doar ca margine a interogării din `client.ts`:
 * interogarea are o singură margine stângă (cea mai veche zi de plată − 15), deci pentru
 * zilele de la coada unui export lung o cotație rămasă în fereastră putea fi veche de cât e
 * exportul — măsurat, 143 de zile pe un export de la martie la iulie. Un sync BNR oprit nu e
 * ipotetic (istoricul din prod are deja o întrerupere înainte de 02.03.2026), iar un curs
 * învechit lărgește tăcut zona în care două facturi diferite se potrivesc la fel de bine.
 *
 * `client.ts` importă exact această constantă pentru marginea interogării, ca să nu existe
 * două numere care se pot despărți.
 */
export const RATE_LOOKBACK_DAYS = 15;

/** Milisecundele UTC ale unei zile ISO, sau NaN dacă șirul nu e o dată calendaristică. */
function isoToUtcMs(iso: string): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return NaN;
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

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
 * Cea mai recentă cotație a valutei cu `rateDate <= isoDate` și cel mult `lookbackDays`
 * zile mai veche, sau `null` dacă la acea dată nu exista niciuna aplicabilă (valută
 * nesincronizată, dată dinaintea istoricului, sync oprit). `null` înseamnă „nu știu", nu
 * „paritate" — apelantul trebuie să renunțe la comparație.
 *
 * O dată nevalidă (în rând sau în cerere) e tratată tot ca „nu știu": mai bine fără scor pe
 * sumă decât cu un curs ales la întâmplare.
 */
export function findRateOnOrBefore(
	rows: BnrRateRow[],
	currency: string,
	isoDate: string,
	lookbackDays: number = RATE_LOOKBACK_DAYS
): FxRate | null {
	const wanted = currency.toUpperCase();
	const wantedMs = isoToUtcMs(isoDate);
	if (!Number.isFinite(wantedMs)) return null;
	let best: FxRate | null = null;
	for (const row of rows) {
		if (row.currency.toUpperCase() !== wanted) continue;
		if (row.rateDate > isoDate) continue;
		if (best && row.rateDate <= best.rateDate) continue;
		const age = (wantedMs - isoToUtcMs(row.rateDate)) / 86_400_000;
		if (!Number.isFinite(age) || age > lookbackDays) continue;
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
export function resolveFxRates(
	rows: BnrRateRow[],
	isoDates: string[],
	lookbackDays: number = RATE_LOOKBACK_DAYS
): FxRates {
	const currencies = [...new Set(rows.map((r) => r.currency.toUpperCase()))];
	const result: FxRates = {};
	for (const isoDate of new Set(isoDates)) {
		const perCurrency: Record<string, FxRate> = {};
		for (const currency of currencies) {
			const rate = findRateOnOrBefore(rows, currency, isoDate, lookbackDays);
			if (rate) perCurrency[currency] = rate;
		}
		if (Object.keys(perCurrency).length > 0) result[isoDate] = perCurrency;
	}
	return result;
}
