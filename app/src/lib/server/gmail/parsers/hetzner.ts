import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount } from './index';

export const hetznerParser: SupplierParser = {
	id: 'hetzner',
	name: 'Hetzner',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('hetzner.com') || fromLower.includes('hetzner.de');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'hetzner',
			supplierName: 'Hetzner Online GmbH'
		};

		// Hetzner invoice numbers: "R1234567890" or "Invoice R1234567890"
		const invoiceMatch = email.subject.match(/(?:invoice|rechnung)\s*#?\s*(R?\d+)/i) ||
			email.body.match(/(?:invoice|rechnung)\s*(?:number|nr\.?|#)\s*:?\s*(R?\d+)/i);
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency || 'EUR';
		} else {
			result.currency = 'EUR';
		}

		const bodyLower = email.body.toLowerCase() + ' ' + email.subject.toLowerCase();
		if (bodyLower.includes('payment received') || bodyLower.includes('paid') || bodyLower.includes('bezahlt')) {
			result.status = 'paid';
		} else if (bodyLower.includes('payment due') || bodyLower.includes('fällig') || bodyLower.includes('unpaid')) {
			result.status = 'unpaid';
		} else {
			result.status = 'pending';
		}

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:hetzner.com OR from:hetzner.de has:attachment';
	}
};
