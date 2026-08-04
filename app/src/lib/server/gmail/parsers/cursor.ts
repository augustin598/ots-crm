import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, isValidInvoiceNumber } from './helpers';

// Keyword and marker are both optional so the regex, combined with the "g" flag,
// walks every token in the text instead of anchoring on a single "invoice"/"receipt"
// occurrence. The marker (group 1) is captured so isValidInvoiceNumber knows whether
// a candidate (group 2) was explicitly flagged as the number.
const INVOICE_NUMBER_RE = /(?:invoice|receipt)?\s*(#|nr\.?|no\.?|number)?\s*[:.]?\s*([\w-]+)/gi;

// Scans every candidate token in order and returns the first one that survives
// isValidInvoiceNumber — a rejected candidate no longer blocks a real number
// appearing later in the same subject/body.
function extractInvoiceNumber(text: string): string | undefined {
	for (const match of text.matchAll(INVOICE_NUMBER_RE)) {
		if (isValidInvoiceNumber(match[2], !!match[1])) return match[2];
	}
	return undefined;
}

export const cursorParser: SupplierParser = {
	id: 'cursor',
	name: 'Cursor (Anysphere)',

	matchEmail(from: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('cursor.com') || fromLower.includes('anysphere');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'cursor',
			supplierName: 'Anysphere Inc (cursor.com)'
		};

		result.invoiceNumber = extractInvoiceNumber(email.subject) ?? extractInvoiceNumber(email.body);

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
		return 'from:cursor.com has:attachment filename:pdf';
	}
};
