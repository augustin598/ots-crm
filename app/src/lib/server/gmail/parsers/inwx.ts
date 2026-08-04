import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice', 'rechnung'];

export const inwxParser: SupplierParser = {
	id: 'inwx',
	name: 'INWX',

	matchEmail(from: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('inwx.de') || fromLower.includes('inwx.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'inwx',
			supplierName: 'INWX GmbH'
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
		return '(from:inwx.de OR from:inwx.com) has:attachment filename:pdf';
	}
};
