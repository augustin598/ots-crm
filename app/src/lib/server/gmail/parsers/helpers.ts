/**
 * Leaf module: shared parsing helpers with NO imports of any parser module.
 * Keeping this dependency-free is what breaks the parsers/index.ts <-> parsers/*.ts
 * import cycle (see parsers/index.ts for the re-export and the cycle history).
 */

/**
 * Helper: parse amount string like "$12.34" or "12,34 EUR" to cents
 */
export function parseAmount(text: string): { amount: number; currency: string } | null {
	// Match patterns like: $12.34, 12.34 USD, €12,34, 12,34 EUR
	const patterns = [
		/\$\s*([\d,]+\.?\d*)/,
		/€\s*([\d.,]+)/,
		/([\d,]+\.?\d*)\s*(USD|EUR|RON|GBP)/i,
		/(USD|EUR|RON|GBP)\s*([\d,]+\.?\d*)/i
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

			// Normalize number: "1,234.56" or "1.234,56"
			const hasCommaAsDecimal = amountStr.includes(',') && !amountStr.includes('.');
			if (hasCommaAsDecimal) {
				amountStr = amountStr.replace(',', '.');
			} else {
				amountStr = amountStr.replace(/,/g, '');
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
 */
export function isValidInvoiceNumber(candidate: string, hasExplicitMarker: boolean): boolean {
	if (!/\d/.test(candidate)) return false;
	if (!hasExplicitMarker && /^(19|20)\d{2}$/.test(candidate)) return false;
	return true;
}
