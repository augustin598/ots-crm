import { describe, test, expect } from 'bun:test';
import {
	checkCardPaymentEligibility,
	checkPortalCardPaymentEligibility,
	isPayableInvoiceStatus,
	minCardAmountCents
} from '../invoice-payable';

describe('minCardAmountCents', () => {
	test('RON are pragul Stripe de 2 lei', () => {
		expect(minCardAmountCents('RON')).toBe(200);
	});

	test('EUR și USD au pragul de 0,50', () => {
		expect(minCardAmountCents('EUR')).toBe(50);
		expect(minCardAmountCents('USD')).toBe(50);
	});

	test('moneda necunoscută sau lipsă cade pe pragul conservator', () => {
		expect(minCardAmountCents('GBP')).toBe(200);
		expect(minCardAmountCents(null)).toBe(200);
		expect(minCardAmountCents(undefined)).toBe(200);
	});

	test('moneda e case-insensitive', () => {
		expect(minCardAmountCents('eur')).toBe(50);
	});
});

describe('isPayableInvoiceStatus', () => {
	test('draft, sent și overdue sunt plătibile', () => {
		expect(isPayableInvoiceStatus('draft')).toBe(true);
		expect(isPayableInvoiceStatus('sent')).toBe(true);
		expect(isPayableInvoiceStatus('overdue')).toBe(true);
	});

	test('paid, cancelled, partially_paid și refunded NU sunt plătibile cu cardul', () => {
		expect(isPayableInvoiceStatus('paid')).toBe(false);
		expect(isPayableInvoiceStatus('cancelled')).toBe(false);
		expect(isPayableInvoiceStatus('partially_paid')).toBe(false);
		expect(isPayableInvoiceStatus('refunded')).toBe(false);
		expect(isPayableInvoiceStatus(null)).toBe(false);
		expect(isPayableInvoiceStatus(undefined)).toBe(false);
	});
});

describe('checkCardPaymentEligibility', () => {
	test('factură trimisă, peste prag → eligibilă', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 90629, currency: 'RON' })
		).toEqual({ eligible: true });
	});

	test('factură deja plătită → already_paid (nu e o eroare)', () => {
		expect(
			checkCardPaymentEligibility({ status: 'paid', totalAmount: 90629, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'already_paid' });
	});

	test('factură anulată → respinsă pe status', () => {
		expect(
			checkCardPaymentEligibility({ status: 'cancelled', totalAmount: 90629, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'status' });
	});

	test('factură parțial plătită → respinsă pe status (rămâne pe transfer bancar)', () => {
		expect(
			checkCardPaymentEligibility({ status: 'partially_paid', totalAmount: 5000, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'status' });
	});

	test('storno / notă de credit → respinsă pe status', () => {
		expect(
			checkCardPaymentEligibility({ status: 'refunded', totalAmount: 5000, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'status' });
	});

	test('sub pragul Stripe → respinsă pe sumă', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 150, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
	});

	test('sumă zero, lipsă sau negativă → respinsă pe sumă', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 0, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: null, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: -500, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
	});

	test('1,00 EUR trece pragul EUR deși e sub pragul RON', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 100, currency: 'EUR' })
		).toEqual({ eligible: true });
	});

	test('moneda lipsă foloseste pragul conservator', () => {
		expect(
			checkCardPaymentEligibility({ status: 'sent', totalAmount: 100, currency: null })
		).toEqual({ eligible: false, reason: 'amount' });
	});
});

describe('checkPortalCardPaymentEligibility', () => {
	test('CIORNA e respinsă în portal (deși fluxul public cu token o acceptă)', () => {
		expect(
			checkPortalCardPaymentEligibility({ status: 'draft', totalAmount: 10000, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'status' });
		expect(
			checkCardPaymentEligibility({ status: 'draft', totalAmount: 10000, currency: 'RON' })
		).toEqual({ eligible: true });
	});

	test('sent și overdue rămân eligibile, cu aceleași reguli de sumă', () => {
		expect(
			checkPortalCardPaymentEligibility({ status: 'sent', totalAmount: 10000, currency: 'RON' })
		).toEqual({ eligible: true });
		expect(
			checkPortalCardPaymentEligibility({ status: 'overdue', totalAmount: 10000, currency: 'RON' })
		).toEqual({ eligible: true });
		expect(
			checkPortalCardPaymentEligibility({ status: 'sent', totalAmount: 150, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'amount' });
	});

	test('paid → alreadyPaid, ca în varianta publică', () => {
		expect(
			checkPortalCardPaymentEligibility({ status: 'paid', totalAmount: 10000, currency: 'RON' })
		).toEqual({ eligible: false, reason: 'already_paid' });
	});
});
