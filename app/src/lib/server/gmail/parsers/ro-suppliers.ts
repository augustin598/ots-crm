import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmount, detectStatus } from './index';

function isValidInvoiceNumber(candidate: string, hasExplicitMarker: boolean): boolean {
	if (!/\d/.test(candidate)) return false; // rejects "available", "ready"
	// A bare 4-digit year next to the trigger word is prose, not a number —
	// but an explicit "#"/"nr" marker means it really is the invoice number.
	if (!hasExplicitMarker && /^(19|20)\d{2}$/.test(candidate)) return false;
	return true;
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
		// Subject captures its own marker (group 1) so a bare year is only trusted
		// when an explicit "#"/"nr"/"no"/"number" marker precedes it.
		const subjectMatch = email.subject.match(
			/(?:factura|invoice)\s*(#|nr\.?|no\.?|number)?\s*[:.]?\s*([\w-]+)/i
		);
		const bodyMatch = email.body.match(
			/factura\s*(#|nr\.?|no\.?|number)?\s*[:.]?\s*([\w-]+)/i
		);

		const seriaCandidate = seriaMatch ? `${seriaMatch[1]}-${seriaMatch[2]}` : undefined;
		// "Seria X nr Y" always has an explicit marker (nr/numar) by construction.
		if (seriaCandidate && isValidInvoiceNumber(seriaCandidate, true)) {
			result.invoiceNumber = seriaCandidate;
		} else if (subjectMatch && isValidInvoiceNumber(subjectMatch[2], !!subjectMatch[1])) {
			result.invoiceNumber = subjectMatch[2];
		} else if (bodyMatch && isValidInvoiceNumber(bodyMatch[2], !!bodyMatch[1])) {
			result.invoiceNumber = bodyMatch[2];
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
