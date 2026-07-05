/**
 * Parse a Meta invoice date string into an ISO "YYYY-MM-DD" date.
 *
 * Handles the formats the Facebook billing extractors produce:
 *  - ISO: "2025-01-06"
 *  - English: "6 Jan 2025", "29 October 2024"
 *  - Romanian: "6 ian. 2025", "10 decembrie 2025"
 *
 * Returns null when the string cannot be parsed — callers MUST handle null
 * rather than silently falling back to an epoch date (1970), which would file
 * the invoice under the wrong period.
 */

const EN_MONTHS: Record<string, string> = {
	jan: '01', january: '01', feb: '02', february: '02',
	mar: '03', march: '03', apr: '04', april: '04',
	may: '05', jun: '06', june: '06', jul: '07', july: '07',
	aug: '08', august: '08', sep: '09', sept: '09', september: '09',
	oct: '10', october: '10', nov: '11', november: '11',
	dec: '12', december: '12'
};

const RO_MONTHS: Record<string, string> = {
	ian: '01', ianuarie: '01', feb: '02', februarie: '02',
	mar: '03', martie: '03', apr: '04', aprilie: '04',
	mai: '05', iun: '06', iunie: '06', iul: '07', iulie: '07',
	aug: '08', august: '08', sep: '09', septembrie: '09',
	oct: '10', octombrie: '10', noi: '11', noiembrie: '11',
	dec: '12', decembrie: '12'
};

export function parseInvoiceDate(text: string | undefined | null): string | null {
	if (!text) return null;
	const t = text.trim();

	// ISO "2025-01-06"
	const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

	// "6 Jan 2025" / "29 October 2024" (English)
	const en = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
	if (en) {
		const mm = EN_MONTHS[en[2].toLowerCase()];
		if (mm) return `${en[3]}-${mm}-${en[1].padStart(2, '0')}`;
	}

	// "6 ian. 2025" / "10 decembrie 2025" (Romanian, diacritics-safe)
	const ro = t.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
	if (ro) {
		const key = ro[2].toLowerCase();
		const mm = RO_MONTHS[key] || RO_MONTHS[key.substring(0, 3)];
		if (mm) return `${ro[3]}-${mm}-${ro[1].padStart(2, '0')}`;
	}

	// Last resort: native Date (handles a few extra locale forms), but reject
	// the epoch (which is what Invalid Date coerces toward) and anything absurd.
	const d = new Date(t);
	if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	return null;
}

/**
 * Given an invoice date string, return the {periodStart, periodEnd} covering the
 * whole month, or null if the date can't be parsed.
 */
export function parseInvoicePeriod(
	text: string | undefined | null
): { periodStart: string; periodEnd: string } | null {
	const iso = parseInvoiceDate(text);
	if (!iso) return null;
	const [y, m] = iso.split('-');
	const lastDay = new Date(Number(y), Number(m), 0).getDate();
	return {
		periodStart: `${y}-${m}-01`,
		periodEnd: `${y}-${m}-${String(lastDay).padStart(2, '0')}`
	};
}
