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
			fromLower.includes('claude') ||
			subjectLower.includes('anthropic') ||
			subjectLower.includes('claude')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'anthropic',
			supplierName: 'Anthropic, PBC'
		};

		// Anthropic receipts: "Your receipt from Anthropic, PBC #2831-6585-6541"
		// or Stripe-style IDs like 7XNUXHOY-0004
		const invoiceMatch = email.body.match(/\b([A-Z0-9]{8}-\d{4})\b/) ||
			email.subject.match(/#([\w-]+)/) ||
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
