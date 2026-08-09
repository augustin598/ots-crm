/**
 * Leaf module: shared parsing helpers with NO imports of any parser module.
 * Keeping this dependency-free is what breaks the parsers/index.ts <-> parsers/*.ts
 * import cycle (see parsers/index.ts for the re-export and the cycle history).
 */

/**
 * Helper: parse amount string like "$12.34" or "12,34 EUR" to cents
 */
export function parseAmount(text: string): { amount: number; currency: string } | null {
	// Match patterns like: $12.34, 12.34 USD, €12,34, 12,34 EUR. The number
	// itself allows BOTH separators ("[\d]+(?:[.,]\d+)*") so a full mixed
	// thousands+decimal number ("1.234,56", "1,234.56") is captured as ONE
	// token instead of being cut at the first separator — see normalization
	// below for how the two separators are told apart.
	const patterns = [
		/\$\s*(\d+(?:[.,]\d+)*)/,
		/€\s*(\d+(?:[.,]\d+)*)/,
		/(\d+(?:[.,]\d+)*)\s*(USD|EUR|RON|GBP)/i,
		/(USD|EUR|RON|GBP)\s*(\d+(?:[.,]\d+)*)/i
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			let amountStr: string;
			let currency: string;

			if (pattern === patterns[0]) {
				amountStr = match[1];
				currency = 'USD';
			} else if (pattern === patterns[1]) {
				amountStr = match[1];
				currency = 'EUR';
			} else if (pattern === patterns[3]) {
				currency = match[1].toUpperCase();
				amountStr = match[2];
			} else {
				amountStr = match[1];
				currency = match[2].toUpperCase();
			}

			// Normalize number. When BOTH '.' and ',' are present, the LAST one
			// in the string is the decimal separator — this is the same rule
			// used by pdf-parser.ts's parseBareAmount and banking/payment-match.ts's
			// parseDecimalToCents, and it handles both the European "1.234,56"
			// (dot=thousands, comma=decimal) and the US "1,234.56" (reverse).
			// A bare single separator ("12,34") is still assumed decimal, same
			// as before.
			const hasComma = amountStr.includes(',');
			const hasDot = amountStr.includes('.');
			if (hasComma && hasDot) {
				const lastComma = amountStr.lastIndexOf(',');
				const lastDot = amountStr.lastIndexOf('.');
				if (lastComma > lastDot) {
					amountStr = amountStr.replace(/\./g, '').replace(',', '.');
				} else {
					amountStr = amountStr.replace(/,/g, '');
				}
			} else if (hasComma) {
				amountStr = amountStr.replace(',', '.');
			}

			const amount = Math.round(parseFloat(amountStr) * 100);
			if (!isNaN(amount)) {
				return { amount, currency };
			}
		}
	}
	return null;
}

/**
 * Câte caractere după cuvântul-cheie mai poate sta suma ca să fie ÎNCĂ a lui. Suficient
 * pentru „Rechnungsbetrag: 9,89 EUR" sau „Total amount due: EUR 9.89" (etichetă, separator,
 * eventual o valută înaintea cifrelor), prea puțin pentru o frază întreagă.
 */
const AMOUNT_KEYWORD_WINDOW = 40;

/**
 * Suma DOAR când e declarată ca atare — adică apare imediat după un cuvânt care spune că
 * numărul e un total de plată („total", „amount", „Rechnungsbetrag").
 *
 * De ce există, pe lângă `parseAmount`: primul tipar din `parseAmount` e `/\$\s*(\d+…)/`,
 * deci un „$1" oarecare din corpul unui email devine o factură de 1,00 USD. Pe notificările
 * care NU conțin suma (INWX trimite doar „New Invoice available", suma stă în PDF) asta nu
 * e o parsare mai slabă, ci una INVENTATĂ: acoperă poarta de îmbogățire din PDF, unde stă
 * suma reală, și strică apoi comparația de sumă din potrivirea plăților (1,00 USD față de
 * 51,81 lei plătiți → nicio dovadă pe sumă, potrivirea rămâne „probabilă").
 *
 * `null` înseamnă „emailul nu spune suma" — exact starea care lasă documentul să decidă.
 */
export function parseAmountNearKeyword(
	text: string,
	keywords: string[]
): { amount: number; currency: string } | null {
	if (!text) return null;
	const keywordRe = new RegExp(`(?:${keywords.join('|')})`, 'gi');
	for (const km of text.matchAll(keywordRe)) {
		const start = (km.index ?? 0) + km[0].length;
		const found = parseAmount(text.slice(start, start + AMOUNT_KEYWORD_WINDOW));
		if (found) return found;
	}
	return null;
}

/**
 * Helper: Detect invoice status from text (body or subject)
 */
export function detectStatus(text: string): 'paid' | 'unpaid' | 'pending' {
	const bodyLower = text.toLowerCase();

	// Check UNPAID first to avoid false positives with "paid" word appearing in "unpaid"
	if (
		bodyLower.includes('unpaid') ||
		bodyLower.includes('neplatit') ||
		bodyLower.includes('neplătit') ||
		bodyLower.includes('neachitat') ||
		bodyLower.includes('de achitat') ||
		bodyLower.includes('overdue') ||
		bodyLower.includes('restant') ||
		bodyLower.includes('scadenta') ||
		bodyLower.includes('scadență') ||
		bodyLower.includes('past due') ||
		bodyLower.includes('in asteptare') ||
		bodyLower.includes('în așteptare') ||
		bodyLower.includes('pending') ||
		bodyLower.includes('impayée') ||
		bodyLower.includes('échéance') ||
		bodyLower.includes('fällig') ||
		bodyLower.includes('offen') ||
		bodyLower.includes('payment due') ||
		bodyLower.includes('payment is due') ||
		bodyLower.includes('payment required')
	) {
		return 'unpaid';
	}

	if (
		bodyLower.includes('payment received') ||
		bodyLower.includes('payment is received') ||
		bodyLower.includes('payment confirmed') ||
		bodyLower.includes('payment confirmation') ||
		bodyLower.includes('paid') ||
		bodyLower.includes('achitat') ||
		bodyLower.includes('amount received') ||
		bodyLower.includes('received by prepayment') ||
		bodyLower.includes('plata confirmata') ||
		bodyLower.includes('plată confirmată') ||
		bodyLower.includes('incasat') ||
		bodyLower.includes('încasat') ||
		bodyLower.includes('receipt') ||
		bodyLower.includes('chitanta') ||
		bodyLower.includes('chitanță') ||
		bodyLower.includes('payé') ||
		bodyLower.includes('réglée') ||
		bodyLower.includes('bezahlt') ||
		bodyLower.includes('quittung') ||
		bodyLower.includes('autopay') ||
		bodyLower.includes('vei fi taxat(ă) automat') ||
		bodyLower.includes('taxat automat') ||
		bodyLower.includes('automatically charged')
	) {
		return 'paid';
	}

	return 'pending';
}

/**
 * Helper: decide whether a regex-captured token is really an invoice number.
 * - Words like "available"/"ready" never contain a digit -> rejected.
 * - A bare 4-digit year (1900-2099) next to the trigger word is prose, not a
 *   number -- unless an explicit "#"/"nr"/"no"/"number" marker precedes it,
 *   in which case it really is the invoice number (e.g. "Invoice #2026").
 * - A few SHAPES are never an invoice number regardless of marker: an ISO
 *   date, a d/m/y date, or a decimal amount ("2026-07-21", "21/07/2026",
 *   "129.99") — these are dates/amounts mentioned near the keyword, not the
 *   number itself (e.g. "Invoice ready, total 129.99 EUR" must not turn
 *   "129.99" into the invoice number).
 */
export function isValidInvoiceNumber(candidate: string, hasExplicitMarker: boolean): boolean {
	if (!/\d/.test(candidate)) return false;
	if (!hasExplicitMarker && /^(19|20)\d{2}$/.test(candidate)) return false;
	if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false; // ISO date
	if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(candidate)) return false; // d/m/y
	if (/^\d+[.,]\d{1,2}$/.test(candidate)) return false; // amount
	return true;
}

/**
 * Markers that mean the following token IS the invoice number. Word markers
 * ("nr", "no", "number", "num[ăa]rul") are wrapped in `\b` so they can't match
 * as a substring inside a longer word ("no" must not match inside
 * "notification"/"now"/"not"/"November"). "#" is left unanchored — it's
 * already a non-word character so it can't blend into a word either way.
 */
const INVOICE_MARKERS = '#|\\bnr\\.?\\b|\\bno\\.?\\b|\\bnumber\\b|\\bnum[ăa]rul\\b';

/**
 * How many whitespace-delimited tokens after the keyword are scanned for a
 * MARKED candidate ("New Invoice available - #INV-2026-0042" needs the marker
 * 3 tokens out; "...subscription no. 1234567890" needs 6). Wider than this
 * risks picking up an unrelated marker-like word deep in unrelated prose.
 */
const MARKER_WINDOW_TOKENS = 6;

/**
 * How many of those tokens are tried as a BARE (unmarked) candidate. Kept
 * narrower than the marker window — prose further along starts looking like
 * a plausible number — but needs to reach at least the 3rd token for cases
 * like "...invoice is available INV-0042". Deliberately NOT wider than 3: a
 * bare 3-digit quantity ("...for 150 domains renewed") has no shape that
 * distinguishes it from a real 3-digit invoice number, so every extra token
 * scanned is pure exposure to that ambiguity with no corresponding benefit.
 */
const BARE_WINDOW_TOKENS = 3;

/**
 * Extract an invoice number anchored on a keyword. Only text AFTER a keyword
 * occurrence is scanned, and only a bounded number of TOKENS (never raw
 * characters) — a character slice can truncate a long candidate mid-digit-run
 * (e.g. cut "987654321098" down to "987654321"), while a token-based window
 * always keeps a candidate whole no matter how long it is. This replaced an
 * earlier version where the keyword was optional in a global regex, which
 * degraded to "first digit-bearing token anywhere in the text" and silently
 * wrote order numbers/dates/amounts into the CRM as invoice numbers.
 *
 * A candidate is accepted either:
 * 1. Right after an EXPLICIT marker ("#", "nr.", "no.", "number", "numărul")
 *    — any length is fine, digit/year rules still apply (isValidInvoiceNumber).
 *    Every marker occurrence in the window is tried, in order, and the first
 *    one whose candidate validates wins — a marker-like match that turns out
 *    to have no valid number after it must not block a real one further along.
 * 2. As a BARE token with no marker ("Invoice 12345") — same digit/year rules,
 *    PLUS a >= 3 char floor: a short bare token ("Invoice 42") is too weak a
 *    signal without a marker, whereas an explicit marker is enough signal on
 *    its own for a short candidate ("Invoice #42" IS accepted).
 *
 * The candidate character class is deliberately narrow (`[\w-]+`, no "/" or
 * "."): a wider class swallows date/path separators and trailing punctuation
 * -- e.g. "Factura #453940/2026-07-21" must stop at "453940", and
 * "...invoice #5566." must not include the trailing sentence period. The
 * bare path normalizes its RETURNED candidate with this same `[\w-]+` rule
 * (only after validating the fuller, punctuation-preserved token — see
 * below) so "Invoice 123/2026" and "Invoice #123/2026" both resolve to
 * "123" instead of the bare path alone keeping the "/2026" suffix.
 */
export function extractInvoiceNumber(text: string, keywords: string[]): string | undefined {
	if (!text) return undefined;
	const keywordRe = new RegExp(`(?:${keywords.join('|')})`, 'gi');
	for (const km of text.matchAll(keywordRe)) {
		const start = (km.index ?? 0) + km[0].length;
		// Bound the slice BEFORE splitting. This is a performance guard, not a
		// semantic limit: `.split(/\s+/)` on the entire remaining text would be
		// O(n) allocations per keyword occurrence, and an invoice email body can
		// be tens of KB with "invoice"/"factura" appearing many times. 200 chars
		// must stay comfortably larger than the token windows below (6 tokens for
		// MARKER_WINDOW_TOKENS) — ordinary words/markers/numbers never need
		// anywhere near 200 characters to span 6 whitespace-delimited tokens, so
		// this bound can't truncate the token window in practice.
		const restTokens = text.slice(start, start + 200).split(/\s+/).filter(Boolean);

		// 1. Explicit marker anywhere in the (token) window.
		const markerWindow = restTokens.slice(0, MARKER_WINDOW_TOKENS).join(' ');
		const markerRe = new RegExp(`(?:${INVOICE_MARKERS})\\s*[:.]?\\s*([\\w-]+)`, 'gi');
		for (const mm of markerWindow.matchAll(markerRe)) {
			if (isValidInvoiceNumber(mm[1], true)) return mm[1];
		}

		// 2. No marker: bare token in the first few tokens after the keyword.
		// Strip only leading/trailing punctuation for VALIDATION — keeping internal
		// "." and "/" intact is what lets isValidInvoiceNumber's amount/date shape
		// guards actually see "129.99" or "21/07/2026" and reject them; truncating
		// with [\w-]+ first would hide the decimal/slash and let e.g. "129" (from
		// "129.99") through as a false invoice number. Only the RETURNED value is
		// then normalized with [\w-]+, to match the marker path's own truncation.
		for (const raw of restTokens.slice(0, BARE_WINDOW_TOKENS)) {
			const stripped = raw.replace(/^[^\w]+|[^\w]+$/g, '');
			if (stripped.length >= 3 && isValidInvoiceNumber(stripped, false)) {
				return stripped.match(/[\w-]+/)?.[0] ?? stripped;
			}
		}
	}
	return undefined;
}
