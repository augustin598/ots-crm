import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

const BNR_XML_URL = 'https://www.bnr.ro/nbrfxrates.xml';

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
	const res = await fetch(BNR_XML_URL, {
		headers: { 'User-Agent': 'CRM-App/1.0' }
	});

	if (!res.ok) {
		throw new Error(`BNR XML fetch failed: ${res.status} ${res.statusText}`);
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

	console.log(`[BNR] Synced ${rates.length} rates for ${date}`);
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
			console.error('[BNR] Failed to sync rates at startup:', err);
		}
	}
}
