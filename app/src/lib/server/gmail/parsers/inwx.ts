import type { GmailMessage } from '../client';
import type { SupplierParser, ParsedInvoice } from './index';
import { parseAmountNearKeyword, detectStatus, extractInvoiceNumber } from './helpers';

const INVOICE_KEYWORDS = ['invoice', 'rechnung'];

/**
 * INWX anunță factura prin email („New Invoice available") și trimite suma DOAR în PDF-ul
 * atașat. Fără o etichetă care să declare numărul drept total, `parseAmount` pe corpul
 * emailului nu extrage suma, ci o inventează: primul ei tipar prinde orice „$1" din text și
 * scrie 1,00 USD în CRM. Suma falsă e mai rea decât lipsa ei — închide îmbogățirea din PDF
 * (care rulează doar când suma lipsește) și, în potrivirea plăților, arată drept factură de
 * altă valoare decât plata, deci nu confirmă nimic pe sumă.
 */
const AMOUNT_KEYWORDS = ['total', 'amount', 'betrag', 'summe', 'gesamt'];

export const inwxParser: SupplierParser = {
	id: 'inwx',
	name: 'INWX',

	matchEmail(from: string): boolean {
		const fromLower = from.toLowerCase();
		return fromLower.includes('inwx.de') || fromLower.includes('inwx.com');
	},

	parseInvoice(email: GmailMessage): ParsedInvoice {
		const result: ParsedInvoice = {
			supplierType: 'inwx',
			supplierName: 'INWX GmbH'
		};

		result.invoiceNumber =
			extractInvoiceNumber(email.subject, INVOICE_KEYWORDS) ??
			extractInvoiceNumber(email.body, INVOICE_KEYWORDS);

		const amountResult =
			parseAmountNearKeyword(email.body, AMOUNT_KEYWORDS) ||
			parseAmountNearKeyword(email.subject, AMOUNT_KEYWORDS);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}

		result.status = detectStatus(email.body + ' ' + email.subject);
		result.issueDate = email.date;

		return result;
	},

	getSearchQuery(): string {
		return '(from:inwx.de OR from:inwx.com) has:attachment filename:pdf';
	}
};
