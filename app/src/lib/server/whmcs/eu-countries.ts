/**
 * EU member states (27, post-Brexit). ISO 3166-1 alpha-2.
 *
 * Used to distinguish intracommunity supply (EU B2B with valid VAT ID,
 * 0% VAT under reverse charge) from export (non-EU, 0% VAT under
 * "operațiune neimpozabilă"). Keep manually in sync with EU enlargement.
 *
 * Last reviewed 2026-04-25 — current state still 27 members.
 */
const EU_COUNTRY_CODES = new Set<string>([
	'AT', // Austria
	'BE', // Belgium
	'BG', // Bulgaria
	'HR', // Croatia
	'CY', // Cyprus
	'CZ', // Czechia
	'DK', // Denmark
	'EE', // Estonia
	'FI', // Finland
	'FR', // France
	'DE', // Germany
	'GR', // Greece
	'HU', // Hungary
	'IE', // Ireland
	'IT', // Italy
	'LV', // Latvia
	'LT', // Lithuania
	'LU', // Luxembourg
	'MT', // Malta
	'NL', // Netherlands
	'PL', // Poland
	'PT', // Portugal
	'RO', // Romania
	'SK', // Slovakia
	'SI', // Slovenia
	'ES', // Spain
	'SE'  // Sweden
]);

/**
 * Returns true for the 27 EU member states. Case-insensitive on input;
 * trims whitespace. Falsy/unknown input → false (caller decides what to do).
 */
export function isEuCountry(code: string | null | undefined): boolean {
	if (!code) return false;
	return EU_COUNTRY_CODES.has(code.trim().toUpperCase());
}

/**
 * Returns true only for non-RO EU countries — i.e. cross-border within EU.
 * Used to gate intracommunity reverse-charge logic which doesn't apply to
 * RO-RO transactions (those use domestic rules / local reverse charge).
 */
export function isOtherEuCountry(code: string | null | undefined): boolean {
	if (!code) return false;
	const upper = code.trim().toUpperCase();
	return upper !== 'RO' && EU_COUNTRY_CODES.has(upper);
}
