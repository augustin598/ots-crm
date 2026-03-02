import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount } from './index';

export const whmcsParser: SupplierParser = {
	id: 'whmcs',
	name: 'WHMCS',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return fromLower.includes('whmcs.com') || subjectLower.includes('whmcs');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'whmcs',
			supplierName: 'WHMCS'
		};

		// WHMCS invoices often have "Invoice #XXXX" in subject
		const invoiceMatch = email.subject.match(/invoice\s*#?\s*(\w+)/i) ||
			email.body.match(/invoice\s*(?:number|#|no\.?)\s*:?\s*(\w+)/i);
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}

		const bodyLower = email.body.toLowerCase() + ' ' + email.subject.toLowerCase();
		if (bodyLower.includes('payment received') || bodyLower.includes('paid') || bodyLower.includes('payment confirmation') || bodyLower.includes('receipt')) {
			result.status = 'paid';
		} else if (bodyLower.includes('payment due') || bodyLower.includes('unpaid') || bodyLower.includes('overdue')) {
			result.status = 'unpaid';
		} else {
			result.status = 'pending';
		}

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:whmcs.com has:attachment';
	}
};
