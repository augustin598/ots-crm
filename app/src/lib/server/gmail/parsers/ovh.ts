import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount } from './index';

export const ovhParser: SupplierParser = {
	id: 'ovh',
	name: 'OVH / OVHcloud',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('ovh.com') || fromLower.includes('ovhcloud.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'ovh',
			supplierName: 'OVHcloud'
		};

		// OVH invoice numbers: "FR-XXXXXXX", "XX-XXXXXXX", or just numeric
		const invoiceMatch =
			email.subject.match(/(?:invoice|facture?)\s*#?\s*([A-Z]{2}-?\d+)/i) ||
			email.body.match(/(?:invoice|facture?)\s*(?:number|n[°o]\.?|#)\s*:?\s*([A-Z]{2}-?\d+)/i) ||
			email.body.match(/(?:invoice|facture?)\s*(?:number|n[°o]\.?|#)\s*:?\s*(\d+)/i);
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
		if (bodyLower.includes('payment received') || bodyLower.includes('paid') || bodyLower.includes('payé') || bodyLower.includes('réglée')) {
			result.status = 'paid';
		} else if (bodyLower.includes('payment due') || bodyLower.includes('unpaid') || bodyLower.includes('impayée') || bodyLower.includes('échéance')) {
			result.status = 'unpaid';
		} else {
			result.status = 'pending';
		}

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:ovh.com OR from:ovhcloud.com has:attachment';
	}
};
