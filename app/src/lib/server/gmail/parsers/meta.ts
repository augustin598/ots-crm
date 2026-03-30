import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const metaParser: SupplierParser = {
	id: 'meta',
	name: 'Meta Ads (Facebook)',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			fromLower.includes('facebookmail.com') ||
			fromLower.includes('meta.com') ||
			subjectLower.includes('facebook ads') ||
			subjectLower.includes('meta ads')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'meta',
			supplierName: 'Meta Platforms Ireland Limited'
		};

		// Meta invoice numbers: "FBADS-XXX-XXXXXX"
		const invoiceMatch = email.subject.match(/(FBADS-[\w-]+)/i) ||
			email.body.match(/(?:invoice|receipt)\s*#?\s*([\w-]+)/i);
		
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
		return 'from:facebookmail.com OR subject:"Facebook Ads" has:attachment';
	}
};
