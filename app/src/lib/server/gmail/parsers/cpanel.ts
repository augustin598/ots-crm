import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount } from './index';

export const cpanelParser: SupplierParser = {
	id: 'cpanel',
	name: 'cPanel/WHM',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('cpanel.net') || fromLower.includes('cpanel.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'cpanel',
			supplierName: 'cPanel'
		};

		// Extract invoice number from subject: "Invoice #12345"
		const invoiceMatch = email.subject.match(/invoice\s*#?\s*(\d+)/i) ||
			email.body.match(/invoice\s*#?\s*(\d+)/i);
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		// Extract amount from body
		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}

		// Status detection
		const bodyLower = email.body.toLowerCase() + ' ' + email.subject.toLowerCase();
		if (bodyLower.includes('payment received') || bodyLower.includes('paid') || bodyLower.includes('payment confirmation')) {
			result.status = 'paid';
		} else if (bodyLower.includes('payment due') || bodyLower.includes('unpaid') || bodyLower.includes('past due')) {
			result.status = 'unpaid';
		} else {
			result.status = 'pending';
		}

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:cpanel.net OR from:cpanel.com has:attachment';
	}
};
