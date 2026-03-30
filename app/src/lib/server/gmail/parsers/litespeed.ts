import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const litespeedParser: SupplierParser = {
	id: 'litespeed',
	name: 'LiteSpeed Technologies',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			fromLower.includes('litespeedtech.com') || 
			subjectLower.includes('litespeed') ||
			fromLower.includes('litespeed technologies')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'litespeed',
			supplierName: 'LiteSpeed Technologies'
		};

		// LiteSpeed invoices usually have "Invoice #XXXX"
		const invoiceMatch = email.subject.match(/(?:invoice|factura|factură)\s*#?\s*(\d+)/i) ||
			email.body.match(/(?:invoice|factura|factură)\s*(?:number|nr\.?|#|no\.?)\s*:?\s*(\d+)/i);
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency || 'USD';
		} else {
			result.currency = 'USD';
		}

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:litespeedtech.com has:attachment';
	}
};
