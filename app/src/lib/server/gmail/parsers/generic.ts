import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice', 'factura', 'factură'];

export const genericParser: SupplierParser = {
	id: 'generic',
	name: 'Generic (any supplier)',

	matchEmail(from: string, subject: string): boolean {
		const subjectLower = subject.toLowerCase();
		return (
			subjectLower.includes('invoice') ||
			subjectLower.includes('factura') ||
			subjectLower.includes('factură') ||
			subjectLower.includes('receipt') ||
			subjectLower.includes('payment')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		// Extract sender name from "Name <email>" format
		const nameMatch = email.from.match(/^"?([^"<]+)"?\s*</);
		const supplierName = nameMatch ? nameMatch[1].trim() : email.from;

		const result: ParsedInvoice = {
			supplierType: 'unknown',
			supplierName
		};

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
		return '(subject:invoice OR subject:factura OR subject:receipt) has:attachment filename:pdf';
	}
};
