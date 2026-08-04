import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus, isValidInvoiceNumber } from './helpers';

// Keyword and marker are both optional so the regex, combined with the "g" flag,
// walks every token in the text instead of anchoring on a single "factura"/"invoice"
// occurrence. The marker (group 1) is captured so isValidInvoiceNumber knows whether
// a candidate (group 2) was explicitly flagged as the number.
const INVOICE_NUMBER_RE = /(?:factura|invoice)?\s*(#|nr\.?|no\.?|number)?\s*[:.]?\s*([\w-]+)/gi;

// Scans every candidate token in order and returns the first one that survives
// isValidInvoiceNumber — a rejected candidate (e.g. "disponibila") no longer blocks
// a real number appearing later in the same subject/body.
function extractInvoiceNumber(text: string): string | undefined {
	for (const match of text.matchAll(INVOICE_NUMBER_RE)) {
		if (isValidInvoiceNumber(match[2], !!match[1])) return match[2];
	}
	return undefined;
}

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
		const seriaMatch = email.body.match(/(?:seria|serie)\s+([\w-]+)\s+(?:nr|numar)\s+([\w-]+)/i);
		const seriaCandidate = seriaMatch ? `${seriaMatch[1]}-${seriaMatch[2]}` : undefined;

		// "Seria X nr Y" always has an explicit marker (nr/numar) by construction.
		if (seriaCandidate && isValidInvoiceNumber(seriaCandidate, true)) {
			result.invoiceNumber = seriaCandidate;
		} else {
			result.invoiceNumber = extractInvoiceNumber(email.subject) ?? extractInvoiceNumber(email.body);
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
