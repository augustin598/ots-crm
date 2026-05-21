/**
 * ANAF address parser — extracted from `hosting-checkout-modal.svelte` so it
 * can be unit-tested without DOM. Pure functions only.
 *
 * ANAF returns Romanian addresses as informal comma-separated strings with
 * prefix tokens (`JUD.`, `MUN.`, `OR.`, `SAT`, `COM.`, `STR.`, `NR.`, `BL.`,
 * `SC.`, `AP.`). The parser pulls out city + county and leaves the rest as
 * a "residual" street address. București is special-cased because ANAF treats
 * it as municipiu without a judet.
 */

export const COUNTIES = [
	'Alba',
	'Arad',
	'Argeș',
	'Bacău',
	'Bihor',
	'Bistrița-Năsăud',
	'Botoșani',
	'Brașov',
	'Brăila',
	'București',
	'Buzău',
	'Caraș-Severin',
	'Călărași',
	'Cluj',
	'Constanța',
	'Covasna',
	'Dâmbovița',
	'Dolj',
	'Galați',
	'Giurgiu',
	'Gorj',
	'Harghita',
	'Hunedoara',
	'Ialomița',
	'Iași',
	'Ilfov',
	'Maramureș',
	'Mehedinți',
	'Mureș',
	'Neamț',
	'Olt',
	'Prahova',
	'Sălaj',
	'Satu Mare',
	'Sibiu',
	'Suceava',
	'Teleorman',
	'Timiș',
	'Tulcea',
	'Vaslui',
	'Vâlcea',
	'Vrancea'
] as const;

export type ParsedAddress = {
	address: string;
	city: string | null;
	county: string | null;
};

function normalizeName(s: string): string {
	return s
		.toLowerCase()
		.split(/[\s-]/)
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(s.includes('-') ? '-' : ' ')
		.replace(/-([a-z])/g, (_, c) => '-' + c.toUpperCase());
}

function stripDiacritics(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function parseAnafAddress(raw: string): ParsedAddress {
	if (!raw) return { address: '', city: null, county: null };
	const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);

	let foundCounty: string | null = null;
	let foundCity: string | null = null;
	let isBucuresti = false;
	const residual: string[] = [];

	const COUNTY_RE = /^jud\.?\s*(.+)$/i;
	const CITY_MUN_RE = /^(?:mun\.?|municipiul)\s*(.+)$/i;
	const CITY_OR_RE = /^(?:or\.?|orasul|oraşul)\s*(.+)$/i;
	const VILLAGE_RE = /^(?:sat)\s*(.+)$/i;
	const COMMUNE_RE = /^com\.?\s*(.+)$/i;
	// Bucharest sectors are not a city — they're a sub-locality. Match separately
	// so we don't accidentally treat "Sector 4" as city="4".
	const SECTOR_RE = /^(?:sector(?:ul)?\s*\d+|sect\.?\s*\d+)$/i;
	const BUCURESTI_RE = /bucure(?:s|ș|ş)ti/i;

	for (const p of parts) {
		let m: RegExpMatchArray | null = null;
		if ((m = p.match(COUNTY_RE))) {
			foundCounty = m[1].trim();
			if (BUCURESTI_RE.test(foundCounty)) isBucuresti = true;
			continue;
		}
		if ((m = p.match(CITY_MUN_RE)) || (m = p.match(CITY_OR_RE))) {
			const matched = m[1].trim();
			if (BUCURESTI_RE.test(matched)) {
				isBucuresti = true;
				foundCity = 'București';
			} else if (!foundCity) {
				foundCity = matched;
			}
			continue;
		}
		if (SECTOR_RE.test(p)) {
			residual.push(p);
			continue;
		}
		if (!foundCity && (m = p.match(VILLAGE_RE) ?? p.match(COMMUNE_RE))) {
			foundCity = m[1].trim();
			continue;
		}
		if (BUCURESTI_RE.test(p)) {
			isBucuresti = true;
			if (!foundCity) foundCity = 'București';
			continue;
		}
		residual.push(p);
	}

	if (isBucuresti) {
		foundCity = 'București';
		foundCounty = 'București';
	}

	const matchedCounty = foundCounty
		? COUNTIES.find(
				(c) => stripDiacritics(c).toLowerCase() === stripDiacritics(foundCounty!).toLowerCase()
			) ?? normalizeName(foundCounty)
		: null;

	return {
		address: residual.join(', '),
		city: foundCity ? normalizeName(foundCity) : null,
		county: matchedCounty
	};
}
