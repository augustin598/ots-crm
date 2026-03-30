import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

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

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:ovh.com OR from:ovhcloud.com has:attachment';
	}
};
