/**
 * Prețul orelor de extra work de pe /servicii — modul PUR, client-safe.
 *
 * Fără import din `ots-catalog` (tarifele ajung în browser doar prin `load`,
 * după parolă); limitele stau AICI ca server-ul (`createHoursOrder`) și
 * modalul public să valideze identic, fără drift.
 */

export const HOURS_MIN = 1;
export const HOURS_MAX = 100;

export function isValidHours(hours: number): boolean {
	return Number.isInteger(hours) && hours >= HOURS_MIN && hours <= HOURS_MAX;
}

/** Net în cenți EUR: ore × tarif (EUR întregi) × 100. Aruncă pe input invalid. */
export function hoursNetCents(rateEur: number, hours: number): number {
	if (!isValidHours(hours)) throw new Error(`Număr de ore invalid: ${hours}`);
	if (!Number.isInteger(rateEur) || rateEur <= 0) throw new Error(`Tarif invalid: ${rateEur}`);
	return rateEur * hours * 100;
}
