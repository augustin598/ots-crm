import { describe, it, expect } from 'bun:test';
import { detectStatus } from '../parsers/index';

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
