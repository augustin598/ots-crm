import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

function isValidInvoiceNumber(candidate: string, hasExplicitMarker: boolean): boolean {
	if (!/\d/.test(candidate)) return false; // rejects "available", "ready"
	// A bare 4-digit year next to the trigger word is prose, not a number —
	// but an explicit "#"/"nr" marker means it really is the invoice number.
	if (!hasExplicitMarker && /^(19|20)\d{2}$/.test(candidate)) return false;
	return true;
}

export const genericParser: SupplierParser = {
	id: 'generic',
	name: 'Generic (any supplier)',

	matchEmail(from: string, subject: string): boolean {
		const subjectLower = subject.toLowerCase();
		return (
			subjectLower.includes('invoice') ||
			subjectLower.includes('factura') ||
			subjectLower.includes('factură') ||
			subjectLower.includes('receipt') ||
			subjectLower.includes('payment')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		// Extract sender name from "Name <email>" format
		const nameMatch = email.from.match(/^"?([^"<]+)"?\s*</);
		const supplierName = nameMatch ? nameMatch[1].trim() : email.from;

		const result: ParsedInvoice = {
			supplierType: 'unknown',
			supplierName
		};

		// Subject captures its own marker (group 1) so a bare year is only trusted
		// when an explicit "#"/"nr"/"no"/"number" marker precedes it.
		const subjectMatch = email.subject.match(
			/(?:invoice|factura|factură)\s*(#|nr\.?|no\.?|number)?\s*[:.]?\s*([\w-]+)/i
		);
		// Body match always requires one of these keywords, so it always has an explicit marker.
		const bodyMatch = email.body.match(
			/(?:invoice|factura|factură)\s*(?:number|nr\.?|#|no\.?)\s*:?\s*([\w-]+)/i
		);

		if (subjectMatch && isValidInvoiceNumber(subjectMatch[2], !!subjectMatch[1])) {
			result.invoiceNumber = subjectMatch[2];
		} else if (bodyMatch && isValidInvoiceNumber(bodyMatch[1], true)) {
			result.invoiceNumber = bodyMatch[1];
		}

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return '(subject:invoice OR subject:factura OR subject:receipt) has:attachment filename:pdf';
	}
};
