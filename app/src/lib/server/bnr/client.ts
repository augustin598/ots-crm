import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, desc, sql, and, gte, lte, inArray } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { resolveFxRates, RATE_LOOKBACK_DAYS, type BnrRateRow } from './rate-lookup';
import type { FxRates } from '$lib/server/banking/payment-match';

/**
 * Feed-ul oficial de cursuri. BNR a mutat fișierele XML pe un server dedicat
 * (anunț 4 aug 2026: /25710-2026-08-04-informare-privind-accesarea-cursurilor-...).
 * Vechiul `https://www.bnr.ro/nbrfxrates.xml` răspunde acum cu 302 către pagina
 * principală — `fetch` urma redirectul, primea HTML cu status 200 și parsarea
 * cădea cu „BNR XML: Could not find Cube date". Nu reveni la host-ul `www`.
 */
const BNR_XML_URL = 'https://curs.bnr.ro/nbrfxrates.xml';

/**
 * Timeout de 15s ca un handshake TLS blocat să nu țină workerul BullMQ peste
 * fereastra lui de 30s de reînnoire a lock-ului.
 */
const BNR_FETCH_TIMEOUT_MS = 15_000;

/**
 * Lanțul certSIGN al BNR a expirat în aprilie 2026 și a oprit sincronizarea până
 * am dezactivat verificarea TLS. Pe `curs.bnr.ro` certificatul e din nou valid
 * (emis ian. 2026, intermediarul e servit corect), deci verificăm normal și
 * cădem pe conexiune neverificată DOAR dacă lanțul se rupe iar: datele sunt
 * publice și fără autentificare, iar alternativa e oprirea cursurilor.
 */
const TLS_CHAIN_ERROR =
	/certificate has expired|unable to verify the first certificate|self[- ]signed certificate|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i;

function bnrFetchInit(insecure: boolean) {
	return {
		headers: { 'User-Agent': 'CRM-App/1.0', Accept: 'application/xml, text/xml' },
		signal: AbortSignal.timeout(BNR_FETCH_TIMEOUT_MS),
		// Un redirect înseamnă că feed-ul s-a mutat, nu ceva de urmat în tăcere.
		redirect: 'manual' as const,
		// Override TLS per cerere (specific Bun) — vezi comentariul de mai sus.
		// NU copia pattern-ul în altă parte; e justificat doar pentru BNR.
		...(insecure ? { tls: { rejectUnauthorized: false } } : {})
	};
}

async function fetchBnrXml(): Promise<Response> {
	try {
		return await fetch(BNR_XML_URL, bnrFetchInit(false));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!TLS_CHAIN_ERROR.test(message)) throw err;
		logWarning('bnr', `Lanț TLS invalid pe curs.bnr.ro, reîncerc fără verificare: ${message}`);
		return await fetch(BNR_XML_URL, bnrFetchInit(true));
	}
}

export interface BnrRate {
	currency: string;
	rate: number;
	multiplier: number;
	date: string;
}

/**
 * Fetch and parse BNR XML exchange rates.
 * Returns raw rates array (not saved to DB).
 */
export async function fetchBnrRates(): Promise<BnrRate[]> {
	const res = await fetchBnrXml();

	// Fără verificările astea două, o mutare a feed-ului sau o pagină de eroare
	// HTML servită cu 200 ajung să fie parsate ca XML și pică abia la regex, cu
	// un mesaj care nu spune nimic despre cauza reală.
	if (res.status >= 300 && res.status < 400) {
		const location = res.headers.get('location') ?? 'necunoscut';
		throw new Error(`BNR XML: redirect ${res.status} către ${location} — feed-ul s-a mutat`);
	}

	if (!res.ok) {
		throw new Error(`BNR XML fetch failed: ${res.status} ${res.statusText}`);
	}

	const contentType = res.headers.get('content-type') ?? '';
	if (!/xml/i.test(contentType)) {
		throw new Error(`BNR XML: răspuns non-XML (content-type: ${contentType || 'absent'})`);
	}

	const xml = await res.text();

	// Extract date from <Cube date="YYYY-MM-DD">
	const dateMatch = xml.match(/<Cube date="([\d-]+)">/);
	if (!dateMatch) {
		throw new Error('BNR XML: Could not find Cube date');
	}
	const date = dateMatch[1];

	// Extract all rates: <Rate currency="EUR">5.0972</Rate>
	// Some have multiplier: <Rate currency="HUF" multiplier="100">1.3459</Rate>
	const rateRegex = /<Rate currency="(\w+)"(?: multiplier="(\d+)")?>([\d.]+)<\/Rate>/g;
	const rates: BnrRate[] = [];

	let match;
	while ((match = rateRegex.exec(xml)) !== null) {
		rates.push({
			currency: match[1],
			rate: parseFloat(match[3]),
			multiplier: match[2] ? parseInt(match[2], 10) : 1,
			date
		});
	}

	if (rates.length === 0) {
		throw new Error('BNR XML: No rates found');
	}

	return rates;
}

/**
 * Fetch BNR rates and upsert into database.
 * Returns count of synced rates and the date.
 */
export async function syncBnrRates(): Promise<{ synced: number; date: string }> {
	const rates = await fetchBnrRates();
	const date = rates[0].date;

	// Upsert all rates
	for (const rate of rates) {
		await db
			.insert(table.bnrExchangeRate)
			.values({
				currency: rate.currency,
				rate: rate.rate,
				multiplier: rate.multiplier,
				rateDate: rate.date,
				fetchedAt: new Date()
			})
			.onConflictDoUpdate({
				target: [table.bnrExchangeRate.currency, table.bnrExchangeRate.rateDate],
				set: {
					rate: sql`excluded.rate`,
					multiplier: sql`excluded.multiplier`,
					fetchedAt: new Date()
				}
			});
	}

	logInfo('bnr', `Synced ${rates.length} rates for ${date}`);
	return { synced: rates.length, date };
}

/**
 * Get the latest BNR rate for a specific currency.
 * Returns the effective rate (adjusted for multiplier).
 * E.g., for EUR returns 5.0972, for HUF returns 0.013459 (1.3459/100).
 */
export async function getLatestBnrRate(currency: string): Promise<number | null> {
	const result = await db
		.select({
			rate: table.bnrExchangeRate.rate,
			multiplier: table.bnrExchangeRate.multiplier
		})
		.from(table.bnrExchangeRate)
		.where(eq(table.bnrExchangeRate.currency, currency.toUpperCase()))
		.orderBy(desc(table.bnrExchangeRate.rateDate))
		.limit(1);

	if (result.length === 0) return null;

	const { rate, multiplier } = result[0];
	// For currencies with multiplier (e.g., HUF × 100 = 1.3459 → per unit = 0.013459)
	// But for invoice exchange rate, we return the rate AS-IS (per multiplier units)
	// because that's how BNR publishes it and how Keez/invoices expect it
	return rate;
}

/**
 * Same as getLatestBnrRate but also returns the rate's effective date so
 * callers can implement freshness gates (e.g. WHMCS strict mode rejecting
 * non-RON pushes when the rate is stale > N hours). The rateDate column
 * stores the date BNR published the rate for, which is typically T-1
 * working day from `now`.
 */
export async function getLatestBnrRateWithDate(
	currency: string
): Promise<{ rate: number; rateDate: Date } | null> {
	const result = await db
		.select({
			rate: table.bnrExchangeRate.rate,
			rateDate: table.bnrExchangeRate.rateDate
		})
		.from(table.bnrExchangeRate)
		.where(eq(table.bnrExchangeRate.currency, currency.toUpperCase()))
		.orderBy(desc(table.bnrExchangeRate.rateDate))
		.limit(1);

	if (result.length === 0) return null;
	// bnr_exchange_rate.rate_date is `text` (YYYY-MM-DD per BNR convention).
	// Parse as UTC midnight so age comparisons against Date.now() are stable
	// across timezones.
	const parsed = new Date(`${result[0].rateDate}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	return { rate: result[0].rate, rateDate: parsed };
}

/**
 * Get the latest BNR rates for display (Settings page).
 * Returns all rates from the most recent date.
 */
export async function getLatestBnrRates(): Promise<
	Array<{ currency: string; rate: number; multiplier: number; date: string }>
> {
	// Get the most recent date
	const latestDate = await db
		.select({ rateDate: table.bnrExchangeRate.rateDate })
		.from(table.bnrExchangeRate)
		.orderBy(desc(table.bnrExchangeRate.rateDate))
		.limit(1);

	if (latestDate.length === 0) return [];

	const date = latestDate[0].rateDate;

	const rates = await db
		.select({
			currency: table.bnrExchangeRate.currency,
			rate: table.bnrExchangeRate.rate,
			multiplier: table.bnrExchangeRate.multiplier,
			rateDate: table.bnrExchangeRate.rateDate
		})
		.from(table.bnrExchangeRate)
		.where(eq(table.bnrExchangeRate.rateDate, date))
		.orderBy(table.bnrExchangeRate.currency);

	return rates.map((r) => ({
		currency: r.currency,
		rate: r.rate,
		multiplier: r.multiplier ?? 1,
		date: r.rateDate
	}));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function shiftIsoDate(isoDate: string, days: number): string {
	const shifted = new Date(`${isoDate}T00:00:00.000Z`);
	shifted.setUTCDate(shifted.getUTCDate() + days);
	return shifted.toISOString().slice(0, 10);
}

/**
 * Cursurile aplicabile fiecărei zile de plată, pentru potrivirea între valute diferite
 * (`matchPayments`). Pentru fiecare (zi, valută) se ia cotația de la ACEA dată sau, dacă
 * lipsește (weekend, sărbătoare), ultima anterioară — niciodată cursul de azi, care pe un
 * export de acum șase luni ar da o conversie complet greșită.
 *
 * Leul nu se cere niciodată: e baza conversiei, tratată ca identitate în `payment-match`.
 * Absența cotațiilor (tabel gol, valută nesincronizată) întoarce pur și simplu mai puține
 * intrări — potrivirea funcționează atunci exact ca înainte de conversie.
 *
 * `RATE_LOOKBACK_DAYS` apare aici DOAR ca margine stângă a interogării, ca să nu citim tot
 * istoricul; plafonul care contează se aplică per zi cerută, în `findRateOnOrBefore`.
 */
export async function loadBnrFxRates(
	currencies: string[],
	isoDates: string[]
): Promise<FxRates> {
	const wanted = [...new Set(currencies.map((c) => c.trim().toUpperCase()))].filter(
		(c) => c.length > 0 && c !== 'RON'
	);
	const dates = [...new Set(isoDates)].filter((d) => ISO_DATE.test(d)).sort();
	if (wanted.length === 0 || dates.length === 0) return {};

	const rows = await db
		.select({
			currency: table.bnrExchangeRate.currency,
			rate: table.bnrExchangeRate.rate,
			multiplier: table.bnrExchangeRate.multiplier,
			rateDate: table.bnrExchangeRate.rateDate
		})
		.from(table.bnrExchangeRate)
		.where(
			and(
				inArray(table.bnrExchangeRate.currency, wanted),
				gte(table.bnrExchangeRate.rateDate, shiftIsoDate(dates[0], -RATE_LOOKBACK_DAYS)),
				lte(table.bnrExchangeRate.rateDate, dates[dates.length - 1])
			)
		);

	const typed: BnrRateRow[] = rows;
	return resolveFxRates(typed, dates);
}

/**
 * Get the last fetch timestamp to enforce rate limiting.
 */
export async function getLastFetchTime(): Promise<Date | null> {
	const result = await db
		.select({ fetchedAt: table.bnrExchangeRate.fetchedAt })
		.from(table.bnrExchangeRate)
		.orderBy(desc(table.bnrExchangeRate.fetchedAt))
		.limit(1);

	return result.length > 0 ? result[0].fetchedAt : null;
}

/**
 * Sync BNR rates if not already synced today.
 * Safe to call at startup — will skip if rates are fresh.
 */
export async function ensureBnrRatesSynced(): Promise<void> {
	const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

	const existing = await db
		.select({ id: table.bnrExchangeRate.id })
		.from(table.bnrExchangeRate)
		.where(eq(table.bnrExchangeRate.rateDate, today))
		.limit(1);

	if (existing.length === 0) {
		try {
			await syncBnrRates();
		} catch (err) {
			const { message, stack } = serializeError(err);
			logError('bnr', `Failed to sync rates at startup: ${message}`, { stackTrace: stack });
		}
	}
}
