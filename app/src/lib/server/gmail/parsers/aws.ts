import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const awsParser: SupplierParser = {
	id: 'aws',
	name: 'Amazon Web Services',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		return (
			fromLower.includes('amazonaws.com') ||
			fromLower.includes('aws.amazon.com') ||
			(fromLower.includes('amazon.com') &&
				/\b(invoice|billing|payment|aws)\b/i.test(subject))
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'aws',
			supplierName: 'Amazon Web Services'
		};

		// AWS invoice numbers: numeric or "INV-XXXXXXX"
		const invoiceMatch =
			email.subject.match(/(?:invoice)\s*#?\s*(INV-?[\w-]+|\d+)/i) ||
			email.body.match(/(?:invoice)\s*(?:number|#|id)\s*:?\s*(INV-?[\w-]+|\d+)/i);
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[1];
		}

		const amountResult = parseAmount(email.body) || parseAmount(email.subject);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency || 'USD';
		} else {
			result.currency = 'USD';
		}

		result.status = detectStatus(email.body + ' ' + email.subject);

		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return '(from:amazonaws.com OR from:aws.amazon.com OR (from:amazon.com (invoice OR billing))) has:attachment';
	}
};
