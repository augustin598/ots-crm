import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice', 'factura', 'factură'];

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

		// Google invoice numbers in subject or body. "Numărul facturii: X" is a
		// distinct RO idiom (marker word precedes the keyword, not the candidate) so
		// it can't fold into extractInvoiceNumber — and it's checked FIRST, because
		// if it were checked after the generic scan, an unrelated "invoice"/"factura"
		// mention elsewhere in the body could win first and shadow the real number.
		result.invoiceNumber =
			email.body.match(/num[aă]rul facturii:\s*(\d+)/i)?.[1] ??
			extractInvoiceNumber(email.subject, INVOICE_KEYWORDS) ??
			extractInvoiceNumber(email.body, INVOICE_KEYWORDS);

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
