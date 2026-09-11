import { describe, test, expect } from 'bun:test';
import {
	roundToStep,
	netToEurCents,
	eurCentsToReferenceMinutes,
	invoiceCreditEligibility,
	startOfMonthUtc,
	type InvoiceCreditCandidate
} from '../hour-credits';

describe('roundToStep', () => {
	test('rotunjește la cel mai apropiat pas', () => {
		expect(roundToStep(0, 15)).toBe(0);
		expect(roundToStep(7, 15)).toBe(0);
		expect(roundToStep(8, 15)).toBe(15);
		expect(roundToStep(1232.7, 15)).toBe(1230);
		expect(roundToStep(100, 30)).toBe(90);
		expect(roundToStep(100, 60)).toBe(120);
	});

	test('pas invalid → minut întreg; NaN → 0', () => {
		expect(roundToStep(37.4, 0)).toBe(37);
		expect(roundToStep(NaN, 15)).toBe(0);
	});
});

describe('netToEurCents', () => {
	test('EUR rămâne, RON se împarte la cursul BNR', () => {
		expect(netToEurCents(65000, 'EUR', null)).toBe(65000);
		expect(netToEurCents(560800, 'ron', 4.96)).toBe(113065); // 5.608 lei / 4,96 = 1.130,65 €
	});

	test('aruncă pe sumă invalidă, curs lipsă la RON sau monedă neacceptată', () => {
		expect(() => netToEurCents(0, 'EUR', null)).toThrow();
		expect(() => netToEurCents(100, 'RON', null)).toThrow(/Curs BNR/);
		expect(() => netToEurCents(100, 'USD', 4.5)).toThrow(/neacceptată/);
	});
});

describe('eurCentsToReferenceMinutes', () => {
	test('exemplul din spec: 5.608 RON ≈ 1.130,65 € ÷ 55 €/h ≈ 20,5 h', () => {
		expect(eurCentsToReferenceMinutes(113065, 55, 15)).toBe(1230); // 20 h 30 min
	});

	test('10 h Development la 65 € = 650 € → 11 h 45 min la referința 55 €', () => {
		expect(eurCentsToReferenceMinutes(65000, 55, 15)).toBe(705);
	});

	test('sub jumătate de pas → 0 (nu se creditează nimic)', () => {
		expect(eurCentsToReferenceMinutes(100, 55, 15)).toBe(0);
	});

	test('validări', () => {
		expect(() => eurCentsToReferenceMinutes(-1, 55, 15)).toThrow();
		expect(() => eurCentsToReferenceMinutes(1000, 0, 15)).toThrow(/referință/);
	});
});

describe('invoiceCreditEligibility', () => {
	const paid = (over: Partial<InvoiceCreditCandidate> = {}): InvoiceCreditCandidate => ({
		status: 'paid',
		hostingAccountId: null,
		externalSource: null,
		amount: 100000,
		currency: 'RON',
		...over
	});
	const ok = { clientOptedIn: true, isHoursOrderInvoice: false };

	test('factura plătită a unui client bifat e eligibilă', () => {
		expect(invoiceCreditEligibility(paid(), ok)).toEqual({ eligible: true, reason: null });
		expect(invoiceCreditEligibility(paid({ currency: 'eur' }), ok).eligible).toBe(true);
	});

	test('excluderile structurale vin înaintea bifei clientului', () => {
		const noOptIn = { clientOptedIn: false, isHoursOrderInvoice: false };
		expect(
			invoiceCreditEligibility(paid({ externalSource: 'hour-overage' }), noOptIn).reason
		).toMatch(/depășire/);
		expect(invoiceCreditEligibility(paid({ hostingAccountId: 'h1' }), noOptIn).reason).toMatch(
			/hosting/
		);
		expect(invoiceCreditEligibility(paid({ externalSource: 'meta-ads' }), noOptIn).reason).toMatch(
			/ads/
		);
		expect(
			invoiceCreditEligibility(paid(), { clientOptedIn: true, isHoursOrderInvoice: true }).reason
		).toMatch(/comenzi de ore/);
	});

	test('neplătită, nebifat, sumă zero, monedă neacceptată', () => {
		expect(invoiceCreditEligibility(paid({ status: 'sent' }), ok).reason).toMatch(/nu e plătită/);
		expect(invoiceCreditEligibility(paid(), { ...ok, clientOptedIn: false }).reason).toMatch(
			/bifa/
		);
		expect(invoiceCreditEligibility(paid({ amount: 0 }), ok).reason).toMatch(/zero/);
		expect(invoiceCreditEligibility(paid({ currency: 'USD' }), ok).reason).toMatch(/USD/);
	});
});

describe('startOfMonthUtc', () => {
	test('prima zi a lunii, ora 00:00 UTC', () => {
		expect(startOfMonthUtc(new Date('2026-09-11T10:00:00Z')).toISOString()).toBe(
			'2026-09-01T00:00:00.000Z'
		);
	});
});
