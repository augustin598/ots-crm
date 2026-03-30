import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const openaiParser: SupplierParser = {
	id: 'openai',
	name: 'OpenAI (ChatGPT)',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('openai.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'openai',
			supplierName: 'OpenAI Ireland Ltd'
		};

		// OpenAI invoice numbers usually start with "INV" or numeric
		const invoiceMatch = email.subject.match(/(?:invoice)\s*#?\s*([\w-]+)/i) ||
			email.body.match(/(?:invoice)\s*(?:number|#|no\.?)\s*:?\s*([\w-]+)/i);
		
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
		return 'from:openai.com subject:invoice has:attachment';
	}
};
