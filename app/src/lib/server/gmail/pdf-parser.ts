import { extractTextFromPDF } from '../pdf-client-extractor';
import { parseAmount } from './parsers/index';

export interface PdfExtractedInvoiceData {
	invoiceNumber?: string;
	amount?: number; // in cents
	currency?: string;
	issueDate?: Date;
	dueDate?: Date;
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

function parseInvoiceText(text: string): PdfExtractedInvoiceData {
	const result: PdfExtractedInvoiceData = {};

	// --- Invoice Number ---
	// Patterns: "Invoice #123", "Invoice Number: 123", "Factura nr. 123", "Rechnung Nr. 123"
	const invoicePatterns = [
		/(?:invoice|factur[aă]|rechnung)\s*(?:number|nr\.?|no\.?|#|num[aă]r)\s*[:\-–]?\s*([\w\-/.]+)/i,
		/(?:invoice|factur[aă]|rechnung)\s*#\s*([\w\-/.]+)/i,
		/(?:invoice|factur[aă])\s*:\s*([\w\-/.]+)/i,
		// Specific vendor patterns
		/\b([A-Z]{2}-\d{6,})\b/, // OVH: FR-1234567
		/\bINV-[\w-]+\b/i, // AWS: INV-xxxxx
		/\b(R\d{8,})\b/ // Hetzner: R1234567890
	];

	for (const pattern of invoicePatterns) {
		const match = text.match(pattern);
		if (match) {
			const num = match[1] || match[0];
			// Sanity check: invoice numbers are typically 3-30 chars
			if (num.length >= 3 && num.length <= 30) {
				result.invoiceNumber = num.replace(/^[:\-–\s]+/, '').trim();
				break;
			}
		}
	}

	// --- Amount ---
	// Use the existing parseAmount from parsers (handles $, €, USD, EUR, RON, GBP)
	// Look for amount near keywords like "total", "amount due", "suma"
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

	// Fallback: try parseAmount on the full text (picks first amount found)
	if (!result.amount) {
		const amountResult = parseAmount(text);
		if (amountResult) {
			result.amount = amountResult.amount;
			result.currency = amountResult.currency;
		}
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

	return result;
}
