import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const digitaloceanParser: SupplierParser = {
	id: 'digitalocean',
	name: 'DigitalOcean',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('digitalocean.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'digitalocean',
			supplierName: 'DigitalOcean'
		};

		const invoiceMatch =
			email.subject.match(/invoice\s*#?\s*(\w+)/i) ||
			email.body.match(/invoice\s*(?:number|#|no\.?)\s*:?\s*(\w+)/i);
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
		return 'from:digitalocean.com (invoice OR receipt OR billing) has:attachment';
	}
};
