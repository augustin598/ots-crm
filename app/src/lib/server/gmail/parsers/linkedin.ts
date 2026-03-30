import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const linkedinParser: SupplierParser = {
	id: 'linkedin',
	name: 'LinkedIn Ads',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('linkedin.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'linkedin',
			supplierName: 'LinkedIn Ireland Unlimited Company'
		};

		// LinkedIn invoice numbers: "L-XXXXXXX"
		const invoiceMatch = email.subject.match(/(L-\d+)/i) ||
			email.body.match(/invoice\s*#?\s*(L-\d+)/i);
		
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

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
		return 'from:linkedin.com subject:invoice has:attachment';
	}
};
