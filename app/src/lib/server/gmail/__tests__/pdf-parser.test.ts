import { describe, it, expect } from 'bun:test';
import { parseInvoiceText } from '../pdf-parser';

// Text aproximat din PDF-ul real ROTLD (factura 453940)
const ROTLD_TEXT = `Institutul National de Cercetare-Dezvoltare in Informatica - ICI Bucuresti
Cod fiscal: RO2785503
FACTURA
Serie ICI 8
Nr. 453940
Data 21-07-2026
Nr. crt. Denumirea serviciilor Cantitate Pret unitar fara TVA - RON - Valoare fara TVA - RON - TVA (21%)
1 Reinnoire oannaseb.ro 1 62,91 62,91 13,21
Total 62,91 13,21
Total de plata (TVA inclus) 76,12
Achitat cu (RRN):620284779550 / 2026-07-21`;

// Text aproximat din PDF-ul real INWX (document 2026068392)
const INWX_TEXT = `INWX GmbH
Invoice
Customer number: 253104
Document number: 2026068392
Date: 2026-06-30
Pos. Description Amount Price Total
1 REG: proteamwash.be 1.00 9,50 € 9,50 €
Total with VAT: 9,50 €
Total without VAT: 7,85 €
VAT 21.00%: 1,65 €
Amount received by prepayment.`;

describe('parseInvoiceText — sume și valute', () => {
	it('ROTLD: ia totalul de plată cu TVA, în RON', () => {
		const r = parseInvoiceText(ROTLD_TEXT);
		expect(r.amount).toBe(7612);
		expect(r.currency).toBe('RON');
	});

	it('INWX: ia Total with VAT în EUR, nu cantitatea 1.00', () => {
		const r = parseInvoiceText(INWX_TEXT);
		expect(r.amount).toBe(950);
		expect(r.currency).toBe('EUR');
	});

	it('nu întoarce niciodată sumă fără valută', () => {
		const r = parseInvoiceText('Ceva text\nTotal 123.45\nAlt text fara valuta');
		expect(r.amount).toBeUndefined();
	});
});

describe('parseInvoiceText — nr. factură', () => {
	it('ROTLD: extrage 453940 din "Nr. 453940"', () => {
		const r = parseInvoiceText(ROTLD_TEXT);
		expect(r.invoiceNumber).toBe('453940');
	});

	it('INWX: extrage 2026068392 din "Document number"', () => {
		const r = parseInvoiceText(INWX_TEXT);
		expect(r.invoiceNumber).toBe('2026068392');
	});

	it('respinge candidați fără cifre (ex. "available")', () => {
		const r = parseInvoiceText('Your new invoice available now\nTotal in EUR 5,00');
		expect(r.invoiceNumber).toBeUndefined();
	});
});
