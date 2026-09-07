/**
 * Prețul orelor de extra work de pe /servicii — modul PUR, client-safe.
 *
 * Fără import din `ots-catalog` (tarifele ajung în browser doar prin `load`,
 * după parolă); limitele stau AICI ca server-ul (`createHoursOrder`) și
 * modalul public să valideze identic, fără drift.
 */

export const HOURS_MIN = 1;
export const HOURS_MAX = 100;

/**
 * Regimurile de lucru — doar identitatea, aici. Etichetele, multiplicatorii și
 * plafoanele stau în `RATE_MODES` din `ots-catalog` (server-only) și ajung în
 * browser prin `load`, ca restul prețurilor.
 */
export const RATE_MODE_SLUGS = ['standard', 'urgent', 'weekend', 'night'] as const;
export type RateModeSlug = (typeof RATE_MODE_SLUGS)[number];
export const DEFAULT_RATE_MODE: RateModeSlug = 'standard';

export function isRateModeSlug(value: string): value is RateModeSlug {
	return (RATE_MODE_SLUGS as readonly string[]).includes(value);
}

/**
 * Tariful efectiv al unui regim: bază × multiplicator, rotunjit la euro întreg.
 *
 * Rotunjirea e obligatorie, nu cosmetică: `service_hours_order.rate_eur` e
 * INTEGER, iar `hoursNetCents` refuză tarifele fracționare. Aceeași funcție
 * rulează pe server (la calculul sumei încasate) și în pagină (la prețul
 * afișat) — fără ea, cele două ar putea diverge cu un cent.
 */
export function effectiveRateEur(baseRateEur: number, multiplierPct: number): number {
	if (!Number.isInteger(baseRateEur) || baseRateEur <= 0) {
		throw new Error(`Tarif de bază invalid: ${baseRateEur}`);
	}
	if (!Number.isInteger(multiplierPct) || multiplierPct < 100) {
		throw new Error(`Multiplicator invalid: ${multiplierPct}`);
	}
	return Math.round((baseRateEur * multiplierPct) / 100);
}

export function isValidHours(hours: number): boolean {
	return Number.isInteger(hours) && hours >= HOURS_MIN && hours <= HOURS_MAX;
}

/** Net în cenți EUR: ore × tarif (EUR întregi) × 100. Aruncă pe input invalid. */
export function hoursNetCents(rateEur: number, hours: number): number {
	if (!isValidHours(hours)) throw new Error(`Număr de ore invalid: ${hours}`);
	if (!Number.isInteger(rateEur) || rateEur <= 0) throw new Error(`Tarif invalid: ${rateEur}`);
	return rateEur * hours * 100;
}

/**
 * Cenți EUR → bani RON la cursul BNR dat, rotunjit la ban. Factura fiscală
 * pentru clienți RO are antetul în RON (cerință Keez), deși Stripe încasează EUR.
 */
export function eurCentsToRonCents(eurCents: number, rate: number): number {
	if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Curs invalid: ${rate}`);
	return Math.round(eurCents * rate);
}

/** Cursul ca text cu 4 zecimale și punct — forma din `invoice.exchange_rate` (mapper-ul Keez acceptă și virgula). */
export function formatExchangeRate(rate: number): string {
	return rate.toFixed(4);
}
