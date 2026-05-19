/**
 * Format invoice number with series for display.
 *
 * Source-of-truth precedence:
 *   1. SmartBill fields if populated → format "SERIA-NUMĂR".
 *   2. `invoice.invoiceSeries` (per-row series tag, e.g. "OTSH" for hosting,
 *      "OTS" for default) → strip the series from `invoiceNumber` to get the
 *      numeric part, then render "<invoice.invoiceSeries> <NUMBER>".
 *   3. `invoiceSettings.keezSeries` (tenant default) as fallback only when the
 *      invoice row has no own series tag — handles legacy rows that pre-date
 *      the per-invoice `invoiceSeries` column being populated.
 *   4. Raw `invoice.invoiceNumber` if neither path applies.
 *
 * History: this used to blindly rewrite every invoice as
 *   `settings.keezSeries + numericTail(invoiceNumber)`
 * which mangled OTSH → OTS once a separate hosting series existed.
 */
export function formatInvoiceNumberDisplay(
	invoice: {
		invoiceNumber: string;
		invoiceSeries?: string | null;
		keezInvoiceId?: string | null;
		keezExternalId?: string | null;
		smartbillSeries?: string | null;
		smartbillNumber?: string | null;
	} | null | undefined,
	invoiceSettings: { keezSeries?: string | null } | null | undefined
): string {
	if (!invoice) return '';

	// SmartBill takes priority — it has its own "SERIA-NUMĂR" format.
	const isSmartBillInvoice = !!(invoice.smartbillSeries || invoice.smartbillNumber);
	if (isSmartBillInvoice && invoice.smartbillSeries && invoice.smartbillNumber) {
		return `${invoice.smartbillSeries}-${invoice.smartbillNumber}`;
	}

	// Pick the series to render. Per-row wins; tenant default is fallback.
	const effectiveSeries =
		invoice.invoiceSeries?.trim() || invoiceSettings?.keezSeries?.trim() || null;

	if (effectiveSeries) {
		let number = invoice.invoiceNumber;
		if (number.endsWith('.0')) number = number.slice(0, -2);

		// Strip any leading series prefix that's already on the number, then
		// take whatever trailing digits remain. Avoids "OTSH OTSH 1" or
		// "OTSH OTS 1" mismatches when the stored number already includes a
		// prefix.
		const seriesEscaped = effectiveSeries.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const prefixed = number.match(new RegExp(`^${seriesEscaped}\\s*(\\d+)$`, 'i'));
		if (prefixed) {
			number = prefixed[1];
		} else {
			const trailingDigits = number.match(/(\d+)$/);
			if (trailingDigits) number = trailingDigits[1];
		}

		return `${effectiveSeries} ${number}`;
	}

	// No series anywhere → return raw number (synthetic "INV-..." fallback).
	return invoice.invoiceNumber;
}

/**
 * Generate invoice number with Keez series format
 * @param series - Keez series (e.g., "OTS")
 * @param number - Invoice number (numeric part)
 * @returns Formatted invoice number (e.g., "OTS520" or "OTS 520" based on preference)
 */
export function generateKeezInvoiceNumber(series: string, number: number | string): string {
	const seriesTrimmed = series.trim();
	const numStr = typeof number === 'number' ? number.toString() : number;
	
	// Format as "SERIES NUMBER" (with space) to match display format
	return `${seriesTrimmed} ${numStr}`;
}

/**
 * Extract numeric part from invoice number
 * @param invoiceNumber - Invoice number (e.g., "OTS 520", "520", "INV-123")
 * @returns Numeric part as string (e.g., "520", "123")
 */
export function extractInvoiceNumber(invoiceNumber: string): string {
	// Remove trailing ".0" if present
	let number = invoiceNumber.endsWith('.0') ? invoiceNumber.slice(0, -2) : invoiceNumber;
	
	// Extract numeric part
	const numericMatch = number.match(/(\d+)$/);
	if (numericMatch) {
		return numericMatch[1];
	}
	
	// Fallback: return as is if no numeric part found
	return number;
}
