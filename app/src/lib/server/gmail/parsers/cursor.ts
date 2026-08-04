import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice', 'receipt'];

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

		result.invoiceNumber =
			extractInvoiceNumber(email.subject, INVOICE_KEYWORDS) ??
			extractInvoiceNumber(email.body, INVOICE_KEYWORDS);

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
		return '(from:cursor.com OR from:anysphere.com) has:attachment filename:pdf';
	}
};
