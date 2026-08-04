import { extractTextFromPDF } from '../pdf-client-extractor';
import { parseAmount } from './parsers/index';

export interface PdfExtractedInvoiceData {
	invoiceNumber?: string;
	amount?: number; // in cents
	currency?: string;
	issueDate?: Date;
	dueDate?: Date;
	status?: 'paid';
}

/**
 * Extract invoice data from a PDF buffer.
 * This is used as ENRICHMENT — fills in fields that email text parsing missed.
 * Always wrap calls in try/catch — encrypted or image-only PDFs will fail silently.
 */
export async function extractInvoiceDataFromPdf(buffer: Buffer): Promise<PdfExtractedInvoiceData> {
	const text = await extractTextFromPDF(buffer);
	if (!text || text.trim().length < 10) {
		return {};
	}
	return parseInvoiceText(text);
}

/**
 * Parse a bare number string (no currency symbol) to cents.
 * Handles "241.30", "1,234.56", "241,30" (comma as decimal).
 *
 * Exportat DOAR pentru testul de acord cu celelalte două implementări ale aceleiași
 * reguli (`parseAmount` din parsers/helpers.ts și `parseDecimalToCents` din
 * banking/payment-match.ts): ele stau pe laturi opuse ale comparației de scor —
 * suma facturii față de suma plății — deci o divergență ar fi o regresie tăcută
 * de potrivire. Vezi `__tests__/decimal-separator.test.ts`.
 */
export function parseBareAmount(str: string): number | null {
	let s = str.trim();
	if (!s) return null;
	const hasComma = s.includes(',');
	const hasDot = s.includes('.');
	if (hasComma && hasDot) {
		// Both a thousands and a decimal separator are present. The separator that
		// appears LAST in the string is the decimal one — handles both the European
		// "1.234,56" (dot=thousands, comma=decimal) and the US "1,234.56" (reverse).
		const lastComma = s.lastIndexOf(',');
		const lastDot = s.lastIndexOf('.');
		if (lastComma > lastDot) {
			s = s.replace(/\./g, '').replace(',', '.');
		} else {
			s = s.replace(/,/g, '');
		}
	} else if (hasComma) {
		s = s.replace(',', '.');
	}
	const amount = Math.round(parseFloat(s) * 100);
	return !isNaN(amount) && amount > 0 ? amount : null;
}

function normalizeCurrency(c: string): string {
	const upper = c.toUpperCase();
	return upper === 'LEI' ? 'RON' : upper;
}

function normalizeSymbolCurrency(c: string): string {
	const map: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };
	return map[c] || normalizeCurrency(c);
}

export function parseInvoiceText(text: string): PdfExtractedInvoiceData {
	const result: PdfExtractedInvoiceData = {};

	// --- Invoice Number ---
	// Patterns: "Invoice #123", "Invoice Number: 123", "Factura nr. 123", "Rechnung Nr. 123"
	// Order matters: text.match() returns the first match found, so the more specific,
	// keyword-anchored patterns MUST come before the generic "nr." pattern — otherwise
	// a street number ("Str. Aviatorilor nr. 128") or a law citation ("Ordinului nr.
	// 2634/2015") gets picked up before the real invoice number.
	const invoicePatterns = [
		// 1. Explicit invoice/factura/rechnung keyword patterns
		/(?:invoice|factur[aă]|rechnung)\s*(?:number|num[aă]rul|nr\.?|no\.?|#|num[aă]r)\s*[:\-–]?\s*([\w\-/.]+)/i,
		/(?:invoice|factur[aă]|rechnung)\s*#\s*([\w\-/.]+)/i,
		/(?:invoice|factur[aă])\s*:\s*([\w\-/.]+)/i,
		/\bnum[aă]rul facturii:\s*(\d+)/i,
		// 2. "Document number" (INWX and similar)
		/document\s+number\s*[:\-–]?\s*([\w\-/.]+)/i,
		// 3. Generic "nr." pattern, anchored to line start to avoid matching mid-sentence
		// occurrences like street numbers or legal citations
		/(?:^|\n)\s*nr\.?\s+(\d{3,})\b/i,
		// Specific vendor patterns
		/\b([A-Z]{2}-\d{6,})\b/, // OVH: FR-1234567
		/\bINV-[\w-]+\b/i, // AWS: INV-xxxxx
		/\b(R\d{8,})\b/ // Hetzner: R1234567890
	];

	for (const pattern of invoicePatterns) {
		const match = text.match(pattern);
		if (match) {
			const num = match[1] || match[0];
			// Sanity check: 3-30 chars and contains at least one digit (rejects "available" etc.)
			if (num.length >= 3 && num.length <= 30 && /\d/.test(num)) {
				result.invoiceNumber = num.replace(/^[:\-–\s]+/, '').trim();
				break;
			}
		}
	}

	// --- Amount ---
	// Strategy: try multiple approaches from most specific to least specific

	// 0. Gross totals — highest priority: "Total de plata (TVA inclus) 76,12",
	// "Total with VAT: 9,50 €", "Grand total", "Gesamtbetrag"
	const grossPatterns: Array<{ re: RegExp; amountIdx: number; currencyIdx?: number }> = [
		{ re: /total\s+de\s+plat[aă][^\d\n]*?([\d.,]+)/i, amountIdx: 1 },
		{
			re: /total\s+with\s+vat\s*[:\-–]?\s*([\d.,]+)\s*(€|\$|£|RON|EUR|USD|GBP|LEI)?/i,
			amountIdx: 1,
			currencyIdx: 2
		},
		{
			re: /(?:grand\s+total|gesamtbetrag)\s*[:\-–]?\s*([\d.,]+)\s*(€|\$|£|RON|EUR|USD|GBP|LEI)?/i,
			amountIdx: 1,
			currencyIdx: 2
		}
	];
	for (const { re, amountIdx, currencyIdx } of grossPatterns) {
		const m = text.match(re);
		if (!m) continue;
		const parsed = parseBareAmount(m[amountIdx]);
		if (!parsed) continue;
		result.amount = parsed;
		if (currencyIdx && m[currencyIdx]) result.currency = normalizeSymbolCurrency(m[currencyIdx]);
		break;
	}

	// 1. "Total in RON 241.30" or "Total in EUR 50.00" (exact currency + number)
	if (!result.amount) {
		const totalInCurrencyMatch = text.match(
			/(?:total)\s+(?:in|în)\s+(RON|EUR|USD|GBP|LEI)\s+([\d.,]+)/i
		);
		if (totalInCurrencyMatch) {
			const parsed = parseBareAmount(totalInCurrencyMatch[2]);
			if (parsed) {
				result.amount = parsed;
				result.currency = normalizeCurrency(totalInCurrencyMatch[1]);
			}
		}
	}

	// 1b. Romanian specific format "Total în EUR 16,20" (explicit fallback)
	if (!result.amount) {
		const totalInCurrencyMatchRo = text.match(/Total\s+în\s+(EUR|RON|USD|GBP|LEI)\s+([\d,.]+)/i);
		if (totalInCurrencyMatchRo) {
			const parsed = parseBareAmount(totalInCurrencyMatchRo[2]);
			if (parsed) {
				result.amount = parsed;
				result.currency = normalizeCurrency(totalInCurrencyMatchRo[1]);
			}
		}
	}

	// 2. Standard patterns: "Total: $12.34", "Amount due: 50.00 EUR", etc.
	if (!result.amount) {
		const amountPatterns = [
			/(?:total|amount\s*due|suma\s*total[aă]?|de\s*plat[aă]|gesamtbetrag)\s*[:\-–]?\s*(.{3,30})/i,
			/(?:balance\s*due|amount\s*payable)\s*[:\-–]?\s*(.{3,30})/i
		];
		for (const pattern of amountPatterns) {
			const match = text.match(pattern);
			if (match) {
				const amountResult = parseAmount(match[1]);
				if (amountResult) {
					result.amount = amountResult.amount;
					result.currency = amountResult.currency;
					break;
				}
			}
		}
	}

	// 3. "Amount in RON/EUR" header followed by number (column-style layout)
	if (!result.amount) {
		const headerMatch = text.match(/(?:amount|suma|sumă)\s+(?:in|în)\s+(RON|EUR|USD|GBP|LEI)\s*\n?\s*([\d.,]+)/i);
		if (headerMatch) {
			const parsed = parseBareAmount(headerMatch[2]);
			if (parsed) {
				result.amount = parsed;
				result.currency = normalizeCurrency(headerMatch[1]);
			}
		}
	}

	// 4. "Total" followed by bare number (no currency symbol — detect currency from context)
	if (!result.amount) {
		const totalBareMatch = text.match(/\btotal\b\s*[:\-–]?\s*([\d.,]+)/i);
		if (totalBareMatch) {
			const parsed = parseBareAmount(totalBareMatch[1]);
			if (parsed) {
				result.amount = parsed;
				const currencyHint = text.match(/(?:amount|suma|sumă|total|consumption)\s+(?:in|în)\s+(RON|EUR|USD|GBP|LEI)/i);
				if (currencyHint) {
					result.currency = normalizeCurrency(currencyHint[1]);
				}
			}
		}
	}

	// 5. Fallback: try parseAmount on the full text (picks first amount with currency found)
	if (!result.amount) {
		const amountResult = parseAmount(text);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}
	}

	// Currency from document context when amount was found without one:
	// column headers like "- RON -", or RON invoices with Romanian VAT wording
	if (result.amount && !result.currency) {
		const columnHint = text.match(/-\s*(RON|EUR|USD|GBP|LEI)\s*-/i);
		if (columnHint) {
			result.currency = normalizeCurrency(columnHint[1]);
		} else if (/\bTVA\b/i.test(text) && /\b(RON|LEI)\b/i.test(text)) {
			result.currency = 'RON';
		}
	}

	// Never return an amount without a currency — a wrong guess (old USD default)
	// is worse than an empty field.
	if (result.amount && !result.currency) {
		delete result.amount;
	}

	// --- Dates ---
	const datePatterns = [
		// DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
		/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/g,
		// YYYY-MM-DD
		/(\d{4})-(\d{2})-(\d{2})/g
	];

	// Collect all dates found in text with their context
	const foundDates: Array<{ date: Date; context: string }> = [];
	const lines = text.split('\n');

	for (const line of lines) {
		// DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
		const ddmmPattern = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/g;
		let match;
		while ((match = ddmmPattern.exec(line)) !== null) {
			const day = parseInt(match[1]);
			const month = parseInt(match[2]);
			const year = parseInt(match[3]);
			if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
				foundDates.push({
					date: new Date(year, month - 1, day),
					context: line.toLowerCase()
				});
			}
		}

		// YYYY-MM-DD
		const isoPattern = /(\d{4})-(\d{2})-(\d{2})/g;
		while ((match = isoPattern.exec(line)) !== null) {
			const year = parseInt(match[1]);
			const month = parseInt(match[2]);
			const day = parseInt(match[3]);
			if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
				foundDates.push({
					date: new Date(year, month - 1, day),
					context: line.toLowerCase()
				});
			}
		}
	}

	// Classify dates by context
	const dueDateKeywords = [
		'due date', 'payment due', 'data scaden', 'scaden', 'échéance',
		'fällig', 'fälligkeit', 'zahlungsziel', 'pay by', 'payment deadline'
	];
	const issueDateKeywords = [
		'issue date', 'invoice date', 'data factur', 'data emiterii',
		'rechnungsdatum', 'date de facturation', 'billing date', 'date'
	];

	for (const { date, context } of foundDates) {
		if (!result.dueDate && dueDateKeywords.some((kw) => context.includes(kw))) {
			result.dueDate = date;
		}
		if (!result.issueDate && issueDateKeywords.some((kw) => context.includes(kw))) {
			result.issueDate = date;
		}
	}

	// If no contextual match for issueDate but we found dates, use the earliest
	if (!result.issueDate && foundDates.length > 0) {
		const sorted = [...foundDates].sort((a, b) => a.date.getTime() - b.date.getTime());
		result.issueDate = sorted[0].date;
	}

	// Paid detection from PDF text (only positive signal; absence means unknown).
	// Guard against opposite-meaning phrases: "neachitat", "de achitat" (= amount due).
	if (
		!/neachitat|de\s+achitat/i.test(text) &&
		/achitat[ăa]?\s*(?:cu|integral|prin|la\s+data)|amount\s+received|paid\s+in\s+full|payment\s+received/i.test(
			text
		)
	) {
		result.status = 'paid';
	}

	return result;
}
