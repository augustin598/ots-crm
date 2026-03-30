import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const tiktokParser: SupplierParser = {
	id: 'tiktok',
	name: 'TikTok Ads',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			fromLower.includes('tiktok.com') ||
			subjectLower.includes('tiktok')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'tiktok',
			supplierName: 'TikTok Information Technologies UK Limited'
		};

		// TikTok invoice numbers: "BDUKXXXXXXXXXXX"
		const invoiceMatch = email.subject.match(/(BDUK\d+)/i) ||
			email.body.match(/(BDUK\d+)/i) ||
			email.body.match(/invoice\s*#?\s*([\w-]+)/i);
		
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		// Amount detection
		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		} else {
			// Fallback for TikTok specific format "Total 88.95"
			const totalMatch = email.body.match(/Total\s+([\d.,]+)/i);
			if (totalMatch) {
				const val = totalMatch[1].replace(',', '');
				result.amount = Math.round(parseFloat(val) * 100);
				
				if (email.body.includes('RON') || email.body.includes('lei')) {
					result.currency = 'RON';
				} else if (email.body.includes('USD') || email.body.includes('$')) {
					result.currency = 'USD';
				} else if (email.body.includes('EUR') || email.body.includes('€')) {
					result.currency = 'EUR';
				}
			}
		}

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:tiktok.com has:attachment';
	}
};
