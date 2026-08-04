import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, isValidInvoiceNumber } from './helpers';

// Keyword and marker are both optional so the regex, combined with the "g" flag,
// walks every token in the text instead of anchoring on a single "invoice"/"factur[aă]"
// occurrence. The marker (group 1) is captured so isValidInvoiceNumber knows whether
// a candidate (group 2) was explicitly flagged as the number.
const INVOICE_NUMBER_RE = /(?:invoice|factur[aă])?\s*(#|nr\.?|no\.?|number)?\s*[:.]?\s*([\w-]+)/gi;

// Scans every candidate token in order and returns the first one that survives
// isValidInvoiceNumber — a rejected candidate (e.g. "is" from "...invoice is available")
// no longer blocks a real number appearing later in the same subject/body.
function extractInvoiceNumber(text: string): string | undefined {
	for (const match of text.matchAll(INVOICE_NUMBER_RE)) {
		if (isValidInvoiceNumber(match[2], !!match[1])) return match[2];
	}
	return undefined;
}

export const googleParser: SupplierParser = {
	id: 'google',
	name: 'Google',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			(fromLower.includes('google.com') || fromLower.includes('google-cloud')) &&
			(subjectLower.includes('invoice') || subjectLower.includes('payment') ||
			 subjectLower.includes('billing') || subjectLower.includes('receipt'))
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'google',
			supplierName: 'Google'
		};

		// Google invoice numbers in subject or body. "Numărul facturii: X" is a
		// distinct RO idiom (marker word precedes the keyword, not the candidate),
		// so it stays a dedicated fallback instead of folding into extractInvoiceNumber.
		result.invoiceNumber =
			extractInvoiceNumber(email.subject) ??
			extractInvoiceNumber(email.body) ??
			email.body.match(/num[aă]rul facturii:\s*(\d+)/i)?.[1];

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		} else {
			// Fallback for Romanian specific format "Total în EUR 16,20"
			const totalMatch = email.body.match(/Total\s+în\s+(EUR|RON|USD|GBP|LEI)\s+([\d,.]+)/i);
			if (totalMatch) {
				result.currency = totalMatch[1] === 'LEI' ? 'RON' : totalMatch[1].toUpperCase();
				const val = totalMatch[2].replace(',', '.');
				result.amount = Math.round(parseFloat(val) * 100);
			}
		}

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:google.com (subject:invoice OR subject:billing OR subject:receipt) has:attachment';
	}
};
