import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const anthropicParser: SupplierParser = {
	id: 'anthropic',
	name: 'Anthropic, PBC',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			fromLower.includes('anthropic') ||
			subjectLower.includes('anthropic')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'anthropic',
			supplierName: 'Anthropic, PBC'
		};

		// Anthropic receipts: "Your receipt from Anthropic, PBC #2831-6585-6541"
		const invoiceMatch = email.subject.match(/#([\w-]+)/) ||
			email.body.match(/(?:receipt|invoice)\s*#?\s*([\w-]+)/i);
		
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
		return 'from:anthropic.com OR subject:anthropic has:attachment';
	}
};
