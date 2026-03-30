import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const googleParser: SupplierParser = {
	id: 'google',
	name: 'Google',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			(fromLower.includes('google.com') || fromLower.includes('google-cloud')) &&
			(subjectLower.includes('invoice') || subjectLower.includes('payment') ||
			 subjectLower.includes('billing') || subjectLower.includes('receipt'))
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'google',
			supplierName: 'Google'
		};

		// Google invoice numbers in subject or body
		const invoiceMatch = email.subject.match(/invoice\s*#?\s*([\w-]+)/i) ||
			email.body.match(/(?:invoice|factur[aă])\s*(?:number|num[aă]rul|#|no\.?)\s*:?\s*([\w-]+)/i) ||
			email.body.match(/num[aă]rul facturii:\s*(\d+)/i);
		
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		} else {
			// Fallback for Romanian specific format "Total în EUR 16,20"
			const totalMatch = email.body.match(/Total\s+în\s+(EUR|RON|USD|GBP|LEI)\s+([\d,.]+)/i);
			if (totalMatch) {
				result.currency = totalMatch[1] === 'LEI' ? 'RON' : totalMatch[1].toUpperCase();
				const val = totalMatch[2].replace(',', '.');
				result.amount = Math.round(parseFloat(val) * 100);
			}
		}

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return 'from:google.com (subject:invoice OR subject:billing OR subject:receipt) has:attachment';
	}
};
