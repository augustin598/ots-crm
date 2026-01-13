/**
 * Format invoice number with series for Keez invoices
 * Based on WHMCS Keez integration: all invoices should use keezSeries when configured
 * @param invoice - Invoice object with invoiceNumber, keezInvoiceId, keezExternalId, smartbillSeries, smartbillNumber
 * @param invoiceSettings - Invoice settings with keezSeries
 * @returns Formatted invoice number (e.g., "OTS 520" for Keez, or just "520.0" for others)
 */
export function formatInvoiceNumberDisplay(
	invoice: { 
		invoiceNumber: string; 
		keezInvoiceId?: string | null; 
		keezExternalId?: string | null;
		smartbillSeries?: string | null;
		smartbillNumber?: string | null;
	} | null | undefined,
	invoiceSettings: { keezSeries?: string | null } | null | undefined
): string {
	if (!invoice) return '';

	// Check if invoice is from SmartBill (has priority - SmartBill has its own format)
	const isSmartBillInvoice = !!(invoice.smartbillSeries || invoice.smartbillNumber);
	if (isSmartBillInvoice && invoice.smartbillSeries && invoice.smartbillNumber) {
		// SmartBill invoices already have their own series format: "SERIA-NUMĂR"
		return `${invoice.smartbillSeries}-${invoice.smartbillNumber}`;
	}

	// For Keez invoices (or all invoices when keezSeries is configured):
	// If keezSeries is set, use it for all invoices (like WHMCS implementation)
	// This matches the behavior where all invoices use the same series
	if (invoiceSettings?.keezSeries) {
		const series = invoiceSettings.keezSeries.trim();
		if (series) {
			let number = invoice.invoiceNumber;
			
			// Remove trailing ".0" if present (e.g., "520.0" -> "520")
			if (number.endsWith('.0')) {
				number = number.slice(0, -2);
			}
			
			// Extract only numeric part if invoiceNumber contains series already
			// Example: "OTS520" -> "520", "INV-123" -> "123"
			const numericMatch = number.match(/(\d+)$/);
			if (numericMatch) {
				number = numericMatch[1];
			}
			
			return `${series} ${number}`;
		}
	}

	// Fallback: return invoice number as is
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
