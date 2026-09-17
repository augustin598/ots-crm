import { describe, test, expect } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import { generateInvoicePDF, resolvePdfCurrencies } from '../invoice-pdf-generator';

async function pdfText(buffer: Buffer): Promise<string> {
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const { text } = await extractText(pdf, { mergePages: true });
	return text.replace(/\s+/g, ' ');
}

const tenant = { name: 'ONE TOP SOLUTION S.R.L.', cui: '39988493' };
const client = { name: 'BEAUTY ONE MEDICAL EUROPA S.R.L.', cui: '31008047' };

describe('resolvePdfCurrencies', () => {
	test('antet RON cu linii EUR (ore / Keez): calcul EUR, factura RON', () => {
		expect(
			resolvePdfCurrencies({ currency: 'RON', invoiceCurrency: null }, [{ currency: 'EUR' }])
		).toEqual({ calcCurr: 'EUR', invCurr: 'RON' });
	});

	test('factură RON cu linii fără monedă rămâne RON/RON', () => {
		expect(
			resolvePdfCurrencies({ currency: 'RON', invoiceCurrency: 'RON' }, [{ currency: null }])
		).toEqual({ calcCurr: 'RON', invCurr: 'RON' });
	});

	test('factură EUR/EUR rămâne EUR/EUR', () => {
		expect(
			resolvePdfCurrencies({ currency: 'EUR', invoiceCurrency: 'EUR' }, [{ currency: 'EUR' }])
		).toEqual({ calcCurr: 'EUR', invCurr: 'EUR' });
	});

	test('calcul EUR cu facturare RON explicită rămâne neschimbată', () => {
		expect(
			resolvePdfCurrencies({ currency: 'EUR', invoiceCurrency: 'RON' }, [{ currency: 'EUR' }])
		).toEqual({ calcCurr: 'EUR', invCurr: 'RON' });
	});

	test('linii în monede diferite: nu ghicim, rămâne moneda antetului', () => {
		expect(
			resolvePdfCurrencies({ currency: 'RON', invoiceCurrency: null }, [
				{ currency: 'EUR' },
				{ currency: 'RON' }
			])
		).toEqual({ calcCurr: 'RON', invCurr: 'RON' });
	});
});

describe('generateInvoicePDF — OTS 560 (3 h × 65 €, antet RON, curs 5,2601)', () => {
	test('totalurile apar în EUR și convertite în RON, nu 235,95 RON', async () => {
		const buffer = await generateInvoicePDF({
			invoice: {
				invoiceNumber: '560',
				status: 'sent',
				issueDate: new Date('2026-09-17'),
				dueDate: new Date('2026-10-02'),
				currency: 'RON',
				invoiceCurrency: null,
				exchangeRate: '5.2601',
				keezStatus: 'Draft',
				taxApplicationType: 'apply'
			},
			lineItems: [
				{
					description: 'Extra work — Development',
					quantity: 3,
					rate: 6500,
					amount: 19500,
					taxRate: 2100,
					currency: 'EUR',
					unitOfMeasure: 'Ora'
				}
			],
			tenant,
			client,
			displayInvoiceNumber: 'OTS 560'
		});
		const text = await pdfText(buffer);
		expect(text).toContain('195,00 EUR');
		expect(text).toContain('1.025,72 RON');
		expect(text).toContain('215,40 RON');
		expect(text).toContain('1.241,12 RON');
		expect(text).not.toContain('235,95 RON');
	});
});
