import { isOtherEuCountry } from '$lib/server/whmcs/eu-countries';
import {
	DEFAULT_INTRACOM_NOTE,
	DEFAULT_EXPORT_NOTE
} from '$lib/server/whmcs/zero-vat-detection';

export type ClientVatScenario = 'ro_domestic' | 'intracom' | 'export' | 'unknown';

// Country names that appear in `client.country` (free-text field, default 'România').
// CUI prefix (e.g. CY60124923R) is the more authoritative source — checked first.
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
	romania: 'RO',
	'românia': 'RO',
	cipru: 'CY',
	cyprus: 'CY',
	germania: 'DE',
	germany: 'DE',
	austria: 'AT',
	belgia: 'BE',
	belgium: 'BE',
	bulgaria: 'BG',
	croatia: 'HR',
	'croația': 'HR',
	cehia: 'CZ',
	czechia: 'CZ',
	danemarca: 'DK',
	denmark: 'DK',
	estonia: 'EE',
	finlanda: 'FI',
	finland: 'FI',
	'franța': 'FR',
	franta: 'FR',
	france: 'FR',
	grecia: 'GR',
	greece: 'GR',
	ungaria: 'HU',
	hungary: 'HU',
	irlanda: 'IE',
	ireland: 'IE',
	italia: 'IT',
	italy: 'IT',
	letonia: 'LV',
	latvia: 'LV',
	lituania: 'LT',
	lithuania: 'LT',
	luxemburg: 'LU',
	luxembourg: 'LU',
	malta: 'MT',
	olanda: 'NL',
	netherlands: 'NL',
	polonia: 'PL',
	poland: 'PL',
	portugalia: 'PT',
	portugal: 'PT',
	slovacia: 'SK',
	slovakia: 'SK',
	slovenia: 'SI',
	spania: 'ES',
	spain: 'ES',
	suedia: 'SE',
	sweden: 'SE'
};

function deriveCountryCode(country?: string | null, cui?: string | null): string | null {
	// 1) CUI prefix wins — the official VAT ID encodes the country (CY60124923R → CY).
	//    Pure-numeric Romanian CUIs (e.g. "39988493") have no letter prefix, so they
	//    fall through to the country field below.
	if (cui) {
		const trimmed = cui.trim().toUpperCase();
		const prefix = trimmed.slice(0, 2);
		if (/^[A-Z]{2}$/.test(prefix) && /\d/.test(trimmed.slice(2))) {
			return prefix;
		}
	}
	if (country) {
		const c = country.trim();
		if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
		const mapped = COUNTRY_NAME_TO_CODE[c.toLowerCase()];
		if (mapped) return mapped;
	}
	return null;
}

export function classifyClientVat(input: {
	country?: string | null;
	cui?: string | null;
}): ClientVatScenario {
	const code = deriveCountryCode(input.country, input.cui);

	if (code) {
		if (code === 'RO') return 'ro_domestic';
		if (isOtherEuCountry(code)) return 'intracom';
		return 'export';
	}

	// No code derivable. If the country field is empty, we can't tell — return 'unknown'
	// (caller decides; for zero-VAT decisions we treat 'unknown' as no-VAT, conservative).
	const raw = input.country?.trim();
	if (!raw) return 'unknown';

	// Country text exists but didn't match any known name. Treat as export (0% VAT) —
	// safer than billing VAT to a foreign client we can't classify.
	return 'export';
}

export function shouldZeroVatForClient(input: {
	country?: string | null;
	cui?: string | null;
}): boolean {
	const s = classifyClientVat(input);
	return s !== 'ro_domestic';
}

export function getZeroVatLegalNote(scenario: ClientVatScenario): string | null {
	if (scenario === 'intracom') return DEFAULT_INTRACOM_NOTE;
	if (scenario === 'export') return DEFAULT_EXPORT_NOTE;
	return null;
}
