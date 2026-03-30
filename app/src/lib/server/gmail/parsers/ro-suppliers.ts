import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

export const roSuppliersParser: SupplierParser = {
	id: 'ro-suppliers',
	name: 'Furnizori România (eMAG, SmartBill, Digi, etc.)',

	matchEmail(from: string, subject: string): boolean {
		const fromLower = from.toLowerCase();
		const subjectLower = subject.toLowerCase();
		return (
			fromLower.includes('emag.ro') ||
			fromLower.includes('smartbill.ro') ||
			fromLower.includes('digi.ro') ||
			fromLower.includes('rcs-rds.ro') ||
			fromLower.includes('orange.ro') ||
			fromLower.includes('vodafone.ro') ||
			subjectLower.includes('factura') ||
			subjectLower.includes('factura fiscala')
		);
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		// Extract sender name from email
		let supplierName = 'Furnizor RO';
		const fromLower = email.from.toLowerCase();
		
		if (fromLower.includes('emag')) supplierName = 'eMAG';
		else if (fromLower.includes('smartbill')) supplierName = 'SmartBill';
		else if (fromLower.includes('digi') || fromLower.includes('rcs-rds')) supplierName = 'Digi (RCS & RDS)';
		else if (fromLower.includes('orange')) supplierName = 'Orange';
		else if (fromLower.includes('vodafone')) supplierName = 'Vodafone';

		const result: ParsedInvoice = {
			supplierType: 'ro-supplier',
			supplierName
		};

		// RO invoice numbers: often "Seria XXX Nr. YYY" or numeric after "Factura"
		const invoiceMatch = email.body.match(/(?:seria|serie)\s+([\w-]+)\s+(?:nr|numar)\s+([\w-]+)/i) ||
			email.subject.match(/(?:factura|invoice)\s*#?\s*([\w-]+)/i) ||
			email.body.match(/factura\s*#?\s*([\w-]+)/i);
		
		if (invoiceMatch) {
			result.invoiceNumber = invoiceMatch[2] ? `${invoiceMatch[1]}-${invoiceMatch[2]}` : invoiceMatch[1];
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
		return '(from:emag.ro OR from:smartbill.ro OR from:digi.ro OR from:orange.ro) has:attachment filename:pdf';
	}
};
