import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice'];

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
		result.invoiceNumber =
			extractInvoiceNumber(email.subject, INVOICE_KEYWORDS) ??
			extractInvoiceNumber(email.body, INVOICE_KEYWORDS);

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
