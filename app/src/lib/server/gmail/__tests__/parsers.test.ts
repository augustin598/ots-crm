import { describe, it, expect } from 'bun:test';
import type { GmailMessage } from '../client';
import { genericParser } from '../parsers/generic';
import { googleParser } from '../parsers/google';
import { detectStatus } from '../parsers/index';
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
