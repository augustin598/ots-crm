import { describe, test, expect } from 'bun:test';
import * as v from 'valibot';
import {
	parseAmountString,
	parseInvoiceDateText,
	parseIssueDate,
	isPdfBuffer,
	decodePdfBase64,
	ingestInvoiceSchema,
	checkInvoicesSchema
} from '../invoice-parsing';

describe('parseAmountString', () => {
	test('European format with currency suffix', () => {
		expect(parseAmountString('7.536,54 RON')).toBe(7536.54);
		expect(parseAmountString('1.234,56 lei')).toBe(1234.56);
		expect(parseAmountString('12,50 RON')).toBe(12.5);
	});

	test('US format', () => {
		expect(parseAmountString('7,536.54 USD')).toBe(7536.54);
		expect(parseAmountString('USD 99.90')).toBe(99.9);
	});

	test('non-breaking spaces and plain integers', () => {
		expect(parseAmountString('2.210,21 USD')).toBe(2210.21);
		expect(parseAmountString('500 RON')).toBe(500);
	});

	test('empty or garbage → null', () => {
		expect(parseAmountString('')).toBeNull();
		expect(parseAmountString(undefined)).toBeNull();
		expect(parseAmountString('n/a')).toBeNull();
	});
});

describe('parseInvoiceDateText', () => {
	test('Romanian short and long month names', () => {
		expect(parseInvoiceDateText('31 aug. 2026')).toBe('2026-08-31');
		expect(parseInvoiceDateText('30 noiembrie 2025')).toBe('2025-11-30');
		expect(parseInvoiceDateText('1 mai 2026')).toBe('2026-05-01');
	});

	test('English formats', () => {
		expect(parseInvoiceDateText('August 31, 2026')).toBe('2026-08-31');
		expect(parseInvoiceDateText('9 Apr 2025')).toBe('2025-04-09');
	});

	test('picks the date out of a whole row text', () => {
		expect(parseInvoiceDateText('5562077861\n31 aug. 2026\n2.210,21 USD\nDescărcați')).toBe('2026-08-31');
	});

	test('no date → undefined', () => {
		expect(parseInvoiceDateText('n/a')).toBeUndefined();
		expect(parseInvoiceDateText('')).toBeUndefined();
	});
});

describe('parseIssueDate', () => {
	test('ISO date → UTC midnight', () => {
		expect(parseIssueDate('2026-08-31')?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
	});

	test('Romanian text → same day', () => {
		expect(parseIssueDate('31 aug. 2026')?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
	});

	test('garbage / missing → null', () => {
		expect(parseIssueDate('garbage')).toBeNull();
		expect(parseIssueDate(undefined)).toBeNull();
	});
});

describe('isPdfBuffer / decodePdfBase64', () => {
	const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(200));

	test('magic bytes', () => {
		expect(isPdfBuffer(pdf)).toBe(true);
		expect(isPdfBuffer(Buffer.from('<html>login</html>'))).toBe(false);
	});

	test('valid base64 PDF decodes', () => {
		const r = decodePdfBase64(pdf.toString('base64'), 1_000_000);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.buffer.equals(pdf)).toBe(true);
	});

	test('HTML disguised as PDF → not_pdf', () => {
		const r = decodePdfBase64(Buffer.from('<html>' + 'x'.repeat(200)).toString('base64'), 1_000_000);
		expect(r).toEqual({ ok: false, reason: 'not_pdf' });
	});

	test('over the size cap → too_large (checked before decoding)', () => {
		const r = decodePdfBase64(pdf.toString('base64'), 50);
		expect(r).toEqual({ ok: false, reason: 'too_large' });
	});

	test('not base64 → invalid_base64', () => {
		expect(decodePdfBase64('%%%not base64%%%', 1_000_000)).toEqual({ ok: false, reason: 'invalid_base64' });
	});
});

describe('valibot schemas', () => {
	test('ingestInvoiceSchema accepts a valid payload', () => {
		const r = v.safeParse(ingestInvoiceSchema, {
			customerId: '524-929-9051',
			invoiceId: '5562077861',
			date: '2026-08-31',
			amountText: '2.210,21 USD',
			accountName: 'Heylux.ro',
			pdfBase64: 'A'.repeat(200)
		});
		expect(r.success).toBe(true);
	});

	test('ingestInvoiceSchema rejects an invoice id with letters', () => {
		const r = v.safeParse(ingestInvoiceSchema, { customerId: '5249299051', invoiceId: 'abc', pdfBase64: 'A'.repeat(200) });
		expect(r.success).toBe(false);
	});

	test('checkInvoicesSchema caps the id list', () => {
		const ok = v.safeParse(checkInvoicesSchema, { customerId: '5249299051', invoiceIds: ['5562077861'] });
		expect(ok.success).toBe(true);
		const tooMany = v.safeParse(checkInvoicesSchema, { customerId: '5249299051', invoiceIds: Array.from({ length: 501 }, (_, i) => String(1000000 + i)) });
		expect(tooMany.success).toBe(false);
	});
});
