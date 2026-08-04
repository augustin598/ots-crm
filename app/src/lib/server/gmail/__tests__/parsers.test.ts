import { describe, it, expect } from 'bun:test';
import type { GmailMessage } from '../client';
import { cursorParser } from '../parsers/cursor';
import { directadminParser } from '../parsers/directadmin';
import { genericParser } from '../parsers/generic';
import { googleParser } from '../parsers/google';
import { detectStatus, findParser } from '../parsers/index';
import { inwxParser } from '../parsers/inwx';
import { openaiParser } from '../parsers/openai';
import { roSuppliersParser } from '../parsers/ro-suppliers';
import { whmcsParser } from '../parsers/whmcs';

function makeEmail(overrides: Partial<GmailMessage>): GmailMessage {
	return {
		id: 'm1',
		threadId: 't1',
		from: 'INWX GmbH <noreply@inwx.de>',
		subject: 'New Invoice available',
		date: new Date('2026-07-01'),
		body: 'A new invoice is available in your account.',
		attachments: [],
		...overrides
	};
}

describe('detectStatus — cuvinte-cheie noi', () => {
	it('achitat => paid', () => {
		expect(detectStatus('Factura a fost achitata cu cardul')).toBe('paid');
	});
	it('amount received by prepayment => paid', () => {
		expect(detectStatus('Amount received by prepayment.')).toBe('paid');
	});
});

describe('detectStatus — fără fals pozitiv pe neachitat/de achitat/prepayment', () => {
	it('neachitată => unpaid (nu paid)', () => {
		expect(detectStatus('Factura dvs. este neachitată')).toBe('unpaid');
	});
	it('de achitat => unpaid', () => {
		expect(detectStatus('Aveți de achitat suma de 100 RON')).toBe('unpaid');
	});
	it('prepayment bar (cerere, nu confirmare) => nu paid', () => {
		expect(detectStatus('Prepayment invoice for your order')).not.toBe('paid');
	});
});

describe('extragere nr. factură din email', () => {
	it('generic: nu ia "available" din "New Invoice available"', () => {
		const r = genericParser.parseInvoice(makeEmail({}));
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: acceptă numere reale ("Invoice #12345")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice #12345' }));
		expect(r.invoiceNumber).toBe('12345');
	});
	it('ro-suppliers: extrage 453940 din subiect ROTLD', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'ROTLD Factura #453940/2026-07-21', body: '' })
		);
		expect(r.invoiceNumber).toBe('453940');
	});
	it('generic: nu confundă anul din subiect cu nr. de factură ("Invoice 2026 renewal reminder")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'Invoice 2026 renewal reminder', body: 'Your invoice for this year is attached.' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('ro-suppliers: nu confundă anul din subiect cu nr. de factură ("Factura 2026 emisa")', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'Factura 2026 emisa', body: '' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('generic: subiect respins ("available") nu blochează fallback-ul din body ("Invoice number: 12345")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice number: 12345' })
		);
		expect(r.invoiceNumber).toBe('12345');
	});
	it('generic: an cu marcaj explicit "#" e acceptat ("Invoice #2026")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice #2026' }));
		expect(r.invoiceNumber).toBe('2026');
	});
	it('ro-suppliers: subiect respins ("2026" fără marcaj) nu blochează fallback-ul din body ("Factura #5566")', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'Factura 2026 emisa', body: 'Factura #5566' })
		);
		expect(r.invoiceNumber).toBe('5566');
	});
	it('generic: candidat respins din subiect nu blochează un nr. real mai departe în ACELAȘI subiect ("New Invoice available - #INV-2026-0042")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available - #INV-2026-0042' })
		);
		expect(r.invoiceNumber).toBe('INV-2026-0042');
	});
	it('generic: candidat respins din subiect nu blochează un nr. real mai departe în ACELAȘI subiect ("New Invoice available: 12345")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'New Invoice available: 12345' }));
		expect(r.invoiceNumber).toBe('12345');
	});
	it('ro-suppliers: candidat respins din subiect nu blochează un nr. real mai departe în ACELAȘI subiect ("Factura disponibila - #5566")', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@rotld.ro', subject: 'Factura disponibila - #5566', body: '' })
		);
		expect(r.invoiceNumber).toBe('5566');
	});
	it('generic: body cu marcaj explicit acceptă anul ("Invoice number: 2026")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice number: 2026' })
		);
		expect(r.invoiceNumber).toBe('2026');
	});
	it('ro-suppliers: formatul "Seria X nr Y" tot funcționează după refactor', () => {
		const r = roSuppliersParser.parseInvoice(
			makeEmail({ from: 'facturi@emag.ro', subject: 'Factura emisa', body: 'Seria ABC nr 12345' })
		);
		expect(r.invoiceNumber).toBe('ABC-12345');
	});
});

describe('extractInvoiceNumber — ancorat pe cuvântul-cheie (regresie: NU mai ia primul token cu cifră din tot textul)', () => {
	it('generic: nu ia "4471" (nr. de comandă) din "Renewal for order 4471 - invoice #INV-2026-0042"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'Renewal for order 4471 - invoice #INV-2026-0042' })
		);
		expect(r.invoiceNumber).toBe('INV-2026-0042');
	});
	it('generic: nu ia "2" (nr. de produse) din "Your 2 items shipped, invoice #123"', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Your 2 items shipped, invoice #123' }));
		expect(r.invoiceNumber).toBe('123');
	});
	it('generic: nu ia "15" (ziua din dată) din body "Hi John, on 15 July 2026 we issued invoice #5566."', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Hi John, on 15 July 2026 we issued invoice #5566.'
			})
		);
		expect(r.invoiceNumber).toBe('5566');
	});
	it('generic: nu ia "998877" (nr. de cont) din body "Hello, account 998877 was billed. Invoice number: 12345"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Hello, account 998877 was billed. Invoice number: 12345'
			})
		);
		expect(r.invoiceNumber).toBe('12345');
	});
	it('generic: nu ia "49" (din suma 49.99) din body "Total: 49.99 USD. Invoice #A-771"', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Total: 49.99 USD. Invoice #A-771' })
		);
		expect(r.invoiceNumber).toBe('A-771');
	});
	it('whmcs: nu ia "9912" (nr. de tichet suport) din "Support ticket #9912 - invoice ready"', () => {
		const r = whmcsParser.parseInvoice(
			makeEmail({ from: 'billing@whmcs.com', subject: 'Support ticket #9912 - invoice ready', body: '' })
		);
		expect(r.invoiceNumber).toBeUndefined();
	});
	it('google: idiomul RO "Numărul facturii:" e verificat ÎNAINTE de scanarea generică, nu ia "777" din body "Comanda 777. Numarul facturii: 12345"', () => {
		const r = googleParser.parseInvoice(
			makeEmail({
				from: 'billing@google.com',
				subject: 'Google Cloud',
				body: 'Comanda 777. Numarul facturii: 12345'
			})
		);
		expect(r.invoiceNumber).toBe('12345');
	});
});

describe('extractInvoiceNumber — fereastră pe TOKENI (regresie: fereastra pe caractere trunchia candidații lungi)', () => {
	it('generic: nu trunchiază nr. lung după marcajul "no." ("...subscription no. 1234567890")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Invoice for your monthly subscription no. 1234567890'
			})
		);
		expect(r.invoiceNumber).toBe('1234567890');
	});
	it('generic: nu trunchiază nr. lung după "#" chiar cu mult text de umplutură înainte', () => {
		const r = genericParser.parseInvoice(
			makeEmail({
				subject: 'New Invoice available',
				body: 'Invoice regarding your subscription #987654321098'
			})
		);
		expect(r.invoiceNumber).toBe('987654321098');
	});
});

describe('extractInvoiceNumber — marcajele cer delimitare de cuvânt (regresie: "no." se potrivea în interiorul "not"/"now"/"notification")', () => {
	it('generic: "not" nu blochează marcajul real "no." mai departe ("Invoice not yet paid, no. 8899")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice not yet paid, no. 8899' })
		);
		expect(r.invoiceNumber).toBe('8899');
	});
	it('generic: "now" nu blochează marcajul real "#" mai departe ("Invoice is now ready, see #12345")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice is now ready, see #12345' })
		);
		expect(r.invoiceNumber).toBe('12345');
	});
	it('generic: "notification" nu blochează marcajul real "#" mai departe ("Invoice notification for you: #12345")', () => {
		const r = genericParser.parseInvoice(
			makeEmail({ subject: 'New Invoice available', body: 'Invoice notification for you: #12345' })
		);
		expect(r.invoiceNumber).toBe('12345');
	});
});

describe('extractInvoiceNumber — fereastra de tokeni FĂRĂ marcaj lărgită la ~4 (dar cu prag de lungime)', () => {
	it('generic: al 3-lea token fără marcaj e găsit ("Your invoice is available INV-0042")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Your invoice is available INV-0042' }));
		expect(r.invoiceNumber).toBe('INV-0042');
	});
	it('generic: pragul de lungime (>=3) respinge un token scurt fără marcaj ("Invoice 42")', () => {
		const r = genericParser.parseInvoice(makeEmail({ subject: 'Invoice 42' }));
		expect(r.invoiceNumber).toBeUndefined();
	});
});

describe('extragere nr. factură — google/openai/whmcs nu mai capturează cuvinte gunoi', () => {
	it('google: nu ia "is" din "Your Google invoice is available - #INV-9911"', () => {
		const r = googleParser.parseInvoice(
			makeEmail({
				from: 'billing@google.com',
				subject: 'Your Google invoice is available - #INV-9911',
				body: ''
			})
		);
		expect(r.invoiceNumber).not.toBe('is');
		expect(r.invoiceNumber).toBe('INV-9911');
	});
	it('openai: nu ia "is" din "Your OpenAI invoice is ready - #INV-7788"', () => {
		const r = openaiParser.parseInvoice(
			makeEmail({
				from: 'billing@openai.com',
				subject: 'Your OpenAI invoice is ready - #INV-7788',
				body: ''
			})
		);
		expect(r.invoiceNumber).not.toBe('is');
		expect(r.invoiceNumber).toBe('INV-7788');
	});
	it('whmcs: nu ia "available" din "New Invoice available - #4455"', () => {
		const r = whmcsParser.parseInvoice(
			makeEmail({
				from: 'billing@whmcs.com',
				subject: 'New Invoice available - #4455',
				body: ''
			})
		);
		expect(r.invoiceNumber).not.toBe('available');
		expect(r.invoiceNumber).toBe('4455');
	});
});

describe('parsere noi', () => {
	it('directadmin match pe expeditor', () => {
		expect(findParser('DirectAdmin <billing@directadmin.com>', 'Invoice')?.id).toBe('directadmin');
	});
	it('cursor match pe anysphere/cursor.com', () => {
		expect(findParser('Anysphere <billing@cursor.com>', 'Your receipt')?.id).toBe('cursor');
	});
	it('inwx match pe inwx.de', () => {
		expect(findParser('INWX GmbH <buchhaltung@inwx.de>', 'New Invoice available')?.id).toBe('inwx');
	});

	it('directadmin: extrage nr. facturii din subiect', () => {
		const r = directadminParser.parseInvoice(
			makeEmail({
				from: 'DirectAdmin <billing@directadmin.com>',
				subject: 'Invoice #DA-2026-0099',
				body: 'Your DirectAdmin license invoice is attached. Total: $24.00 USD'
			})
		);
		expect(r.supplierType).toBe('directadmin');
		expect(r.invoiceNumber).toBe('DA-2026-0099');
	});

	it('cursor: extrage nr. chitanței din corp', () => {
		const r = cursorParser.parseInvoice(
			makeEmail({
				from: 'Anysphere <billing@cursor.com>',
				subject: 'Your receipt from Cursor',
				body: 'Receipt number: 2345-6789. Amount paid: $20.00 USD'
			})
		);
		expect(r.supplierType).toBe('cursor');
		expect(r.invoiceNumber).toBe('2345-6789');
	});

	it('inwx: "New Invoice available" nu produce nr. gunoi', () => {
		const r = inwxParser.parseInvoice(
			makeEmail({
				from: 'INWX GmbH <buchhaltung@inwx.de>',
				subject: 'New Invoice available',
				body: 'A new invoice is available in your account.'
			})
		);
		expect(r.supplierType).toBe('inwx');
		expect(r.invoiceNumber).toBeUndefined();
	});
});
