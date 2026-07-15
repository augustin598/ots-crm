/**
 * Billing-period coverage analysis for hosting renewals.
 *
 * An invoice states the period it bills inside the line item text — either in the
 * description (CRM-generated: "Wordpress_Gold - domain.ro (22/04/2026 - 21/04/2027)")
 * or in the note carried over from Keez ("Wordpress Standard - https://yards.ro -
 * (09/03/2025 - 09/03/2027)"). That declared period is the ONLY sound evidence of
 * what a customer paid for: issue dates lie. A 2-year prepay issued in July 2025
 * covers March 2025 → March 2027, and no proximity heuristic on the issue date can
 * see that — which is exactly how a customer with a valid 2-year prepay got billed
 * again for a year they had already paid.
 *
 * So: match periods against periods. When an invoice declares no period at all we
 * cannot prove coverage either way — the caller must treat the gap as UNCERTAIN and
 * put it in front of a human instead of billing it.
 */

export interface Period {
	/** inclusive, YYYY-MM-DD */
	start: string;
	/** exclusive, YYYY-MM-DD */
	end: string;
}

export interface InvoiceEvidence {
	invoiceNumber: string | null;
	/** YYYY-MM-DD, null when the invoice has no issue date */
	issueDate: string | null;
	status: string;
	/** true when invoice.hostingAccountId points at the account under analysis */
	linkedToAccount: boolean;
	/**
	 * true when this invoice provably concerns THIS account — linked by FK, or its
	 * text names the account's domain. Client-level matches (a hosting invoice on
	 * the same client, for one of its other domains) must set this false: clients
	 * routinely hold several domains, and one domain's renewal says nothing about
	 * another's.
	 */
	identifiesAccount: boolean;
	/** concatenated description + note of every line item */
	text: string;
}

export type CoverageVerdict =
	| { covered: true; reason: 'declared_period'; by: InvoiceEvidence; declared: Period }
	| { covered: false; certainty: 'certain'; reason: 'no_overlapping_declared_period' }
	| {
			covered: false;
			certainty: 'uncertain';
			reason: 'no_period_evidence' | 'partial_period_evidence';
			near: InvoiceEvidence[];
	  };

/**
 * A declared period counts as covering a gap only when it accounts for most of it.
 * Renewals drift a few days off the anniversary (a 29/01 invoice against a 25/01
 * cycle), and CRM descriptions write the end date inclusive (one day short) — so
 * exact containment is too strict. But a 30-day add-on that merely starts on the
 * anniversary must never pass for a year: require the bulk of the gap.
 */
const MIN_COVERAGE_FRACTION = 0.8;

function daysBetween(a: string, b: string): number {
	return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

export function coverageFraction(declared: Period, gap: Period): number {
	const start = declared.start > gap.start ? declared.start : gap.start;
	const end = declared.end < gap.end ? declared.end : gap.end;
	const overlap = daysBetween(start, end);
	if (overlap <= 0) return 0;
	const gapLength = daysBetween(gap.start, gap.end);
	if (gapLength <= 0) return 0;
	return overlap / gapLength;
}

const DMY = String.raw`(\d{2})[./](\d{2})[./](\d{4})`;
/** "(09/03/2025 - 09/03/2027)", "30.12.2025 - 29.12.2026", "(22/04/2026-21/04/2027)" */
const PERIOD_RE = new RegExp(`${DMY}\\s*[-–]\\s*${DMY}`, 'g');

function toISO(d: string, m: string, y: string): string {
	return `${y}-${m}-${d}`;
}

/** Extract every "dd/MM/yyyy - dd/MM/yyyy" (or dot-separated) period declared in a text. */
export function parseDeclaredPeriods(text: string | null | undefined): Period[] {
	if (!text) return [];
	const out: Period[] = [];
	for (const m of text.matchAll(PERIOD_RE)) {
		const start = toISO(m[1], m[2], m[3]);
		const end = toISO(m[4], m[5], m[6]);
		// Guard against reversed/degenerate ranges (e.g. "19.12.2023 - 19.12.2023"
		// on an ad-hoc invoice — a same-day "period" declares nothing about a year).
		if (end > start) out.push({ start, end });
	}
	return out;
}

/** Half-open overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅ */
export function periodsOverlap(a: Period, b: Period): boolean {
	return a.start < b.end && b.start < a.end;
}

/**
 * Decide whether `gap` is already billed by any of `invoices`.
 *
 * Only invoices that identify THIS account (FK link or the domain in their text)
 * can prove anything; everything else is noise from sibling domains.
 *
 * Precedence:
 *  1. An identifying invoice declares a period covering most of the gap → covered.
 *  2. An identifying invoice declares a period that only partly overlaps, or
 *     declares no period at all while being issued near the gap → uncertain: a
 *     human must open it (it may be a multi-year prepay whose period was never
 *     written down — the failure that re-billed a paid year).
 *  3. Nothing identifying is anywhere near → certainly not covered.
 */
export function assessCoverage(
	gap: Period,
	invoices: InvoiceEvidence[],
	options?: { nearSlackDays?: number }
): CoverageVerdict {
	const slack = options?.nearSlackDays ?? 45;
	const relevant = invoices.filter((inv) => inv.identifiesAccount || inv.linkedToAccount);

	const partial: InvoiceEvidence[] = [];
	for (const inv of relevant) {
		for (const declared of parseDeclaredPeriods(inv.text)) {
			const fraction = coverageFraction(declared, gap);
			if (fraction >= MIN_COVERAGE_FRACTION) {
				return { covered: true, reason: 'declared_period', by: inv, declared };
			}
			if (fraction > 0) partial.push(inv);
		}
	}
	if (partial.length > 0) {
		return {
			covered: false,
			certainty: 'uncertain',
			reason: 'partial_period_evidence',
			near: [...new Set(partial)]
		};
	}

	// Invoices for this account that declare no period at all but land near the gap.
	const windowStart = shiftISO(gap.start, -slack);
	const near = relevant.filter(
		(inv) =>
			parseDeclaredPeriods(inv.text).length === 0 &&
			inv.issueDate !== null &&
			inv.issueDate >= windowStart &&
			inv.issueDate < gap.end
	);
	if (near.length > 0) {
		return { covered: false, certainty: 'uncertain', reason: 'no_period_evidence', near };
	}

	return { covered: false, certainty: 'certain', reason: 'no_overlapping_declared_period' };
}

export function shiftISO(iso: string, days: number): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
