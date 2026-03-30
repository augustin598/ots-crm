import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const cloudflareParser: SupplierParser = {
	id: 'cloudflare',
	name: 'Cloudflare',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('cloudflare.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'cloudflare',
			supplierName: 'Cloudflare, Inc.'
		};

		const invoiceMatch = email.subject.match(/#([\w-]+)/) ||
			email.body.match(/invoice\s*(?:number|#|no\.?)\s*:?\s*([\w-]+)/i);
		
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
		return 'from:cloudflare.com subject:invoice has:attachment';
	}
};
