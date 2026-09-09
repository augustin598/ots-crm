import * as v from 'valibot';

/**
 * Pure parsing/validation helpers for Google Ads invoice ingestion. Shared by
 * the browser scraper, the server-side downloader and the userscript ingest API.
 * No I/O here so the module is trivially testable.
 */

const RO_MONTHS: Record<string, string> = {
	ian: '01', ianuarie: '01', feb: '02', februarie: '02',
	mar: '03', martie: '03', apr: '04', aprilie: '04',
	mai: '05', iun: '06', iunie: '06', iul: '07', iulie: '07',
	aug: '08', august: '08', sep: '09', septembrie: '09',
	oct: '10', octombrie: '10', noi: '11', noiembrie: '11', noiembre: '11',
	dec: '12', decembrie: '12'
};

const EN_MONTHS: Record<string, string> = {
	jan: '01', january: '01', feb: '02', february: '02',
	mar: '03', march: '03', apr: '04', april: '04',
	may: '05', jun: '06', june: '06', jul: '07', july: '07',
	aug: '08', august: '08', sep: '09', september: '09',
	oct: '10', october: '10', nov: '11', november: '11',
	dec: '12', december: '12'
};

/** Parse "7.536,54 RON", "7,536.54 USD", "1.234,56 lei" into a number. */
export function parseAmountString(amountStr?: string | null): number | null {
	if (!amountStr) return null;
	const cleaned = amountStr
		.replace(/ /g, ' ')
		.replace(/[A-Za-z]{2,}/g, '') // currency codes / "lei"
		.replace(/[^\d.,-]/g, '')
		.trim();
	if (!cleaned || !/\d/.test(cleaned)) return null;
	let value: number;
	if (cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
		// European: "7.536,54" → 7536.54
		value = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
	} else {
		// US: "7,536.54" → 7536.54
		value = parseFloat(cleaned.replace(/,/g, ''));
	}
	return Number.isFinite(value) ? value : null;
}

/** Find a Romanian or English date inside free text and return "YYYY-MM-DD". */
export function parseInvoiceDateText(text?: string | null): string | undefined {
	if (!text) return undefined;

	// Romanian / day-first: "30 noiembrie 2025", "10 dec. 2025", "9 Apr 2025"
	const dayFirst = text.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
	if (dayFirst) {
		const key = dayFirst[2].toLowerCase();
		const mm = RO_MONTHS[key] || RO_MONTHS[key.slice(0, 3)] || EN_MONTHS[key] || EN_MONTHS[key.slice(0, 3)];
		if (mm) return `${dayFirst[3]}-${mm}-${dayFirst[1].padStart(2, '0')}`;
	}

	// English month-first: "November 30, 2025", "Dec 10, 2025"
	const monthFirst = text.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
	if (monthFirst) {
		const key = monthFirst[1].toLowerCase();
		const mm = EN_MONTHS[key] || EN_MONTHS[key.slice(0, 3)];
		if (mm) return `${monthFirst[3]}-${mm}-${monthFirst[2].padStart(2, '0')}`;
	}

	return undefined;
}

/** "2026-08-31" or a RO/EN text date → Date at UTC midnight; null when unparseable. */
export function parseIssueDate(input?: string | null): Date | null {
	if (!input) return null;
	const trimmed = input.trim();
	const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
	const ymd = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : parseInvoiceDateText(trimmed);
	if (!ymd) return null;
	const d = new Date(`${ymd}T00:00:00.000Z`);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function isPdfBuffer(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

export type DecodePdfResult =
	| { ok: true; buffer: Buffer }
	| { ok: false; reason: 'too_large' | 'not_pdf' | 'invalid_base64' };

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decode a base64 PDF with a size cap applied BEFORE allocating the buffer. */
export function decodePdfBase64(b64: string, maxBytes: number): DecodePdfResult {
	const clean = b64.replace(/\s+/g, '');
	// base64 expands 3 bytes → 4 chars; reject early on the encoded length
	if (Math.floor((clean.length * 3) / 4) > maxBytes) return { ok: false, reason: 'too_large' };
	if (!clean || !BASE64_RE.test(clean)) return { ok: false, reason: 'invalid_base64' };
	const buffer = Buffer.from(clean, 'base64');
	if (buffer.length > maxBytes) return { ok: false, reason: 'too_large' };
	if (!isPdfBuffer(buffer)) return { ok: false, reason: 'not_pdf' };
	return { ok: true, buffer };
}

// ---- valibot schemas for the userscript ingest API ----

const customerIdField = v.pipe(v.string(), v.trim(), v.regex(/^\d{3}-?\d{3}-?\d{4}$/, 'customerId trebuie să fie un ID Google Ads (xxx-xxx-xxxx)'));
const invoiceIdField = v.pipe(v.string(), v.trim(), v.regex(/^\d{6,20}$/, 'invoiceId trebuie să fie numeric'));

export const checkInvoicesSchema = v.object({
	customerId: customerIdField,
	invoiceIds: v.pipe(v.array(invoiceIdField), v.minLength(1), v.maxLength(500))
});

export const ingestInvoiceSchema = v.object({
	customerId: customerIdField,
	invoiceId: invoiceIdField,
	date: v.optional(v.pipe(v.string(), v.maxLength(64))),
	amountText: v.optional(v.pipe(v.string(), v.maxLength(64))),
	accountName: v.optional(v.pipe(v.string(), v.maxLength(200))),
	pdfBase64: v.pipe(v.string(), v.minLength(100))
});

export type CheckInvoicesPayload = v.InferOutput<typeof checkInvoicesSchema>;
export type IngestInvoicePayload = v.InferOutput<typeof ingestInvoiceSchema>;
