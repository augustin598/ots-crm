import { describe, it, expect } from 'bun:test';
import { detectStatus } from '../parsers/index';
import { genericParser } from '../parsers/generic';
import { roSuppliersParser } from '../parsers/ro-suppliers';
import type { GmailMessage } from '../client';

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
		expect(r.invoiceNumber).toContain('453940');
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
});
