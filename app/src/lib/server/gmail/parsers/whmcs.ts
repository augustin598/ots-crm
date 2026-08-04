import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice'];

export const whmcsParser: SupplierParser = {
	id: 'whmcs',
	name: 'WHMCS',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return fromLower.includes('whmcs.com') || subjectLower.includes('whmcs');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'whmcs',
			supplierName: 'WHMCS'
		};

		// WHMCS invoices often have "Invoice #XXXX" in subject
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
		return 'from:whmcs.com has:attachment';
	}
};
