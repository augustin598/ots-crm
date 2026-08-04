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

// Text aproximat din PDF-ul real FIDA SOLUTIONS (parcare Suceava, factura SV-956589).
// Trimis de primărie (noreply@primariasv.ro): numele furnizorului apare DOAR aici, în PDF.
const FIDA_TEXT = `FIDA SOLUTIONS S.R.L.
Furnizor
FIDA SOLUTIONS
CIF: RO15974040
Reg. Com.: J24/1041/2004
Adresa: Baia Mare, jud. Maramures
FACTURA Nr. SV-956589
Data: 03.08.2026
Cumparator: Persoana fizica
Nr. crt. Denumire serviciu Cantitate Pret unitar Valoare
1 Plata parcare in ZonaMixta pentru 2 ore 1 8.00 8.00
TOTAL PLATĂ 8.00 LEI`;

describe('parseInvoiceText — sume și valute', () => {
	it('FIDA: „TOTAL PLATĂ 8.00 LEI" (fără „de", cu diacritice, majuscule) → 800 bani RON', () => {
		const r = parseInvoiceText(FIDA_TEXT);
		expect(r.amount).toBe(800);
		expect(r.currency).toBe('RON');
	});

	it('„Total plata 100,00 LEI" — valuta scrisă după sumă e normalizată la RON', () => {
		const r = parseInvoiceText('Total plata 100,00 LEI');
		expect(r.amount).toBe(10000);
		expect(r.currency).toBe('RON');
	});

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

	it('nu ia numărul din adresă ("Str. ... nr. 128"), ia numărul facturii', () => {
		const text = `Adresa: Str. Aviatorilor nr. 128, Sector 1, Bucuresti
Factura nr. 900123
Data: 01-01-2026`;
		const r = parseInvoiceText(text);
		expect(r.invoiceNumber).toBe('900123');
	});

	it('nu ia numărul din citarea unui ordin ("Ordinului nr. 2634/2015"), ia numărul din "Invoice number"', () => {
		const text = `Conform Ordinului nr. 2634/2015
Invoice number: INV-4482
Date: 2026-01-01`;
		const r = parseInvoiceText(text);
		expect(r.invoiceNumber).toBe('INV-4482');
	});
});

describe('parseInvoiceText — normalizare sume (separatori mii/zecimale)', () => {
	it('"1.234,56" (format european cu separator de mii) → 123456 bani, RON din antetul de coloană', () => {
		const text = `Valoare fara TVA - RON -
Total de plata (TVA inclus) 1.234,56`;
		const r = parseInvoiceText(text);
		expect(r.amount).toBe(123456);
		expect(r.currency).toBe('RON');
	});
});

describe('parseInvoiceText — grossPatterns "grand total"', () => {
	it('"Grand total: 25.00 USD" → 2500 bani, USD', () => {
		const r = parseInvoiceText('Grand total: 25.00 USD');
		expect(r.amount).toBe(2500);
		expect(r.currency).toBe('USD');
	});
});

describe('parseInvoiceText — numele furnizorului', () => {
	it('FIDA: ia denumirea de sub antetul „Furnizor", nu eticheta', () => {
		expect(parseInvoiceText(FIDA_TEXT).supplierName).toBe('FIDA SOLUTIONS');
	});

	it('forma pe aceeași linie: „Furnizor: KESSELRING SRL"', () => {
		const r = parseInvoiceText('Furnizor: KESSELRING SRL\nTotal plata 100,00 LEI');
		expect(r.supplierName).toBe('KESSELRING SRL');
	});

	it('sare peste liniile de identificare fiscală și ia denumirea', () => {
		const text = `Furnizor
CIF: RO15974040
Reg. Com.: J24/1041/2004
FIDA SOLUTIONS
Total plata 8,00 LEI`;
		expect(parseInvoiceText(text).supplierName).toBe('FIDA SOLUTIONS');
	});

	it('nu confundă o denumire care începe cu un cuvânt de etichetă („Banca Transilvania")', () => {
		const r = parseInvoiceText('Furnizor\nBanca Transilvania SA\nCIF: RO5022670');
		expect(r.supplierName).toBe('Banca Transilvania SA');
	});

	it('fără antet „Furnizor" nu inventează un nume', () => {
		expect(parseInvoiceText('Total in EUR 5,00').supplierName).toBeUndefined();
	});

	it('„Furnizorul se obligă…" din condiții nu e antet de furnizor', () => {
		const r = parseInvoiceText('Furnizorul se obliga sa presteze serviciul.\nTotal plata 8,00 LEI');
		expect(r.supplierName).toBeUndefined();
	});
});

describe('parseInvoiceText — status', () => {
	it('ROTLD: "Achitat cu (RRN)" => paid', () => {
		expect(parseInvoiceText(ROTLD_TEXT).status).toBe('paid');
	});
	it('INWX: "Amount received by prepayment" => paid', () => {
		expect(parseInvoiceText(INWX_TEXT).status).toBe('paid');
	});
	it('fără indicii => status undefined', () => {
		expect(parseInvoiceText('Total in EUR 5,00').status).toBeUndefined();
	});
	it('"Total de achitat" (sumă DATORATĂ) => status undefined, nu paid', () => {
		const r = parseInvoiceText('Total de achitat: 119,00 RON\n- RON -');
		expect(r.status).toBeUndefined();
	});
	it('cerere de prepayment (nu confirmare) => status undefined, nu paid', () => {
		const r = parseInvoiceText('Please transfer the prepayment amount of 50,00 EUR');
		expect(r.status).toBeUndefined();
	});
});
