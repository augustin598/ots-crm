import { describe, it, expect } from 'bun:test';
import { findRateOnOrBefore, resolveFxRates, type BnrRateRow } from '../rate-lookup';

/**
 * Cotații reale din `bnr_exchange_rate` (prod), prima săptămână din iulie 2026.
 * 04 și 05 iulie sunt sâmbătă și duminică: BNR nu cotează, deci nu există rânduri.
 */
const ROWS: BnrRateRow[] = [
	{ currency: 'EUR', rate: 5.243, multiplier: 1, rateDate: '2026-06-29' },
	{ currency: 'EUR', rate: 5.2438, multiplier: 1, rateDate: '2026-06-30' },
	{ currency: 'EUR', rate: 5.2409, multiplier: 1, rateDate: '2026-07-01' },
	{ currency: 'EUR', rate: 5.2359, multiplier: 1, rateDate: '2026-07-02' },
	{ currency: 'EUR', rate: 5.2374, multiplier: 1, rateDate: '2026-07-03' },
	{ currency: 'EUR', rate: 5.2317, multiplier: 1, rateDate: '2026-07-06' },
	{ currency: 'USD', rate: 4.6227, multiplier: 1, rateDate: '2026-07-02' },
	{ currency: 'HUF', rate: 1.4757, multiplier: 100, rateDate: '2026-07-02' }
];

describe('findRateOnOrBefore', () => {
	it('cotația exactă a zilei', () => {
		expect(findRateOnOrBefore(ROWS, 'EUR', '2026-07-02')).toEqual({
			ronPerUnit: 5.2359,
			rateDate: '2026-07-02'
		});
	});

	it('weekend: sâmbăta cade pe cotația de vineri', () => {
		expect(findRateOnOrBefore(ROWS, 'EUR', '2026-07-04')?.rateDate).toBe('2026-07-03');
	});

	it('weekend: duminica cade tot pe vineri, nu pe luni', () => {
		const found = findRateOnOrBefore(ROWS, 'EUR', '2026-07-05');
		expect(found?.rateDate).toBe('2026-07-03');
		expect(found?.ronPerUnit).toBe(5.2374);
	});

	it('luni are cotație proprie', () => {
		expect(findRateOnOrBefore(ROWS, 'EUR', '2026-07-06')?.rateDate).toBe('2026-07-06');
	});

	it('o dată anterioară oricărei cotații nu inventează un curs', () => {
		expect(findRateOnOrBefore(ROWS, 'EUR', '2026-01-15')).toBeNull();
	});

	it('valută fără nicio cotație → null', () => {
		expect(findRateOnOrBefore(ROWS, 'GBP', '2026-07-02')).toBeNull();
	});

	it('codul valutei e insensibil la majuscule', () => {
		expect(findRateOnOrBefore(ROWS, 'eur', '2026-07-02')?.ronPerUnit).toBe(5.2359);
	});

	it('NU sare înainte: pentru 01.07 folosește cotația de 01.07, nu pe cea de 02.07', () => {
		expect(findRateOnOrBefore(ROWS, 'EUR', '2026-07-01')?.ronPerUnit).toBe(5.2409);
	});

	describe('multiplicator', () => {
		// BNR cotează HUF pentru 100 de unități: 1,4757 lei / 100 HUF.
		it('HUF (cotat la 100) dă lei pe UNITATE, nu pe sută', () => {
			const found = findRateOnOrBefore(ROWS, 'HUF', '2026-07-02');
			expect(found?.ronPerUnit).toBeCloseTo(0.014757, 9);
		});

		it('multiplicator absent (null) = 1', () => {
			const rows: BnrRateRow[] = [
				{ currency: 'EUR', rate: 5.2359, multiplier: null, rateDate: '2026-07-02' }
			];
			expect(findRateOnOrBefore(rows, 'EUR', '2026-07-02')?.ronPerUnit).toBe(5.2359);
		});

		it('multiplicator 0 (dată coruptă) e tratat ca 1, nu ca împărțire la zero', () => {
			const rows: BnrRateRow[] = [
				{ currency: 'EUR', rate: 5.2359, multiplier: 0, rateDate: '2026-07-02' }
			];
			expect(findRateOnOrBefore(rows, 'EUR', '2026-07-02')?.ronPerUnit).toBe(5.2359);
		});
	});

	describe('rânduri corupte', () => {
		const withRate = (rate: number): BnrRateRow[] => [
			{ currency: 'EUR', rate, multiplier: 1, rateDate: '2026-07-02' }
		];

		it('un curs 0, negativ sau NaN e ignorat, nu propagat în potrivire', () => {
			for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
				expect(findRateOnOrBefore(withRate(bad), 'EUR', '2026-07-02')).toBeNull();
			}
		});

		it('rândul corupt nu ascunde o cotație valabilă mai veche', () => {
			const rows: BnrRateRow[] = [
				{ currency: 'EUR', rate: 5.2359, multiplier: 1, rateDate: '2026-07-02' },
				{ currency: 'EUR', rate: 0, multiplier: 1, rateDate: '2026-07-03' }
			];
			expect(findRateOnOrBefore(rows, 'EUR', '2026-07-03')?.rateDate).toBe('2026-07-02');
		});
	});
});

describe('resolveFxRates', () => {
	it('indexează pe (dată, valută) — forma cerută de matchPayments', () => {
		const fx = resolveFxRates(ROWS, ['2026-07-02', '2026-07-04']);
		expect(fx['2026-07-02'].EUR.ronPerUnit).toBe(5.2359);
		expect(fx['2026-07-02'].USD.ronPerUnit).toBe(4.6227);
		// Sâmbătă: aceleași valute, fiecare cu ultima ei cotație anterioară — EUR de vineri,
		// USD (nesincronizat după 02) tot de pe 02.
		expect(fx['2026-07-04'].EUR).toEqual({ ronPerUnit: 5.2374, rateDate: '2026-07-03' });
		expect(fx['2026-07-04'].USD).toEqual({ ronPerUnit: 4.6227, rateDate: '2026-07-02' });
	});

	it('zilele fără nicio cotație lipsesc din rezultat', () => {
		const fx = resolveFxRates(ROWS, ['2026-01-15']);
		expect(fx['2026-01-15']).toBeUndefined();
	});

	it('tabel gol → obiect gol, fără excepție', () => {
		expect(resolveFxRates([], ['2026-07-02'])).toEqual({});
	});

	it('datele duplicate nu duplică munca și nu strică rezultatul', () => {
		const fx = resolveFxRates(ROWS, ['2026-07-02', '2026-07-02']);
		expect(Object.keys(fx)).toEqual(['2026-07-02']);
	});
});
