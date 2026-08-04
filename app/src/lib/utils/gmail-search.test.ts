import { describe, expect, test } from 'bun:test';
import {
	MAX_ZIP_ITEMS,
	batchArchiveName,
	chunk,
	merchantShort,
	nextDayIso,
	paymentLabel,
	pluralRo,
	previousMonthRange,
	toIsoDate
} from './gmail-search';

const basePayment = {
	reference: '12326',
	partner: null,
	comment: '',
	amountRon: 0,
	originalAmount: null,
	originalCurrency: null
};

describe('merchantShort', () => {
	test('preferă partenerul când există', () => {
		expect(merchantShort({ ...basePayment, partner: 'Hetzner Online GmbH' })).toBe(
			'HETZNERONLINEGMBH'
		);
	});

	test('extrage comerciantul din descrierea bancară (MPY nu mai scapă)', () => {
		expect(
			merchantShort({
				...basePayment,
				comment: 'PLATA POS 000NVPO261975UOO MPY*KESSELRING SRL valoare tranzactie: 120,00 RON'
			})
		).toBe('KESSELRING');
	});

	test('nu confundă codurile bancare cu numele comerciantului', () => {
		expect(
			merchantShort({ ...basePayment, comment: 'PLATA CARD TID:G0A3LMSE RRN 000NVPO261975' })
		).toBe('FURNIZOR');
	});
});

describe('paymentLabel', () => {
	test('folosește suma originală, cu valuta ei', () => {
		expect(
			paymentLabel({
				...basePayment,
				partner: 'Hetzner',
				amountRon: 90_000,
				originalAmount: 18_004,
				originalCurrency: 'EUR'
			})
		).toBe('12326_HETZNER_180.04EUR');
	});

	test('fără sumă originală cade pe lei — niciodată fără valută', () => {
		expect(paymentLabel({ ...basePayment, partner: 'Rotld', amountRon: 12_345 })).toBe(
			'12326_ROTLD_123.45RON'
		);
	});
});

describe('pluralRo', () => {
	test('1 cere singular', () => {
		expect(pluralRo(1, 'plată', 'plăți')).toBe('1 plată');
		expect(pluralRo(1, 'email', 'emailuri')).toBe('1 email');
	});

	test('2–19 cer plural simplu', () => {
		expect(pluralRo(3, 'plată', 'plăți')).toBe('3 plăți');
		expect(pluralRo(19, 'plată', 'plăți')).toBe('19 plăți');
	});

	test('de la 20 în sus cer „de”', () => {
		expect(pluralRo(20, 'plată', 'plăți')).toBe('20 de plăți');
		expect(pluralRo(100, 'email', 'emailuri')).toBe('100 de emailuri');
	});

	test('101 revine la pluralul simplu', () => {
		expect(pluralRo(101, 'plată', 'plăți')).toBe('101 plăți');
	});

	test('zero rămâne plural fără „de”', () => {
		expect(pluralRo(0, 'plată', 'plăți')).toBe('0 plăți');
	});
});

describe('nextDayIso', () => {
	test('avansează o zi (before: din Gmail e exclusiv)', () => {
		expect(nextDayIso('2026-07-30')).toBe('2026-07-31');
	});

	test('trece corect peste sfârșitul lunii', () => {
		expect(nextDayIso('2026-07-31')).toBe('2026-08-01');
	});

	test('trece corect peste sfârșitul anului', () => {
		expect(nextDayIso('2026-12-31')).toBe('2027-01-01');
	});

	test('anul bisect', () => {
		expect(nextDayIso('2028-02-28')).toBe('2028-02-29');
	});

	test('o valoare neinterpretabilă rămâne neschimbată', () => {
		expect(nextDayIso('')).toBe('');
		expect(nextDayIso('31.07.2026')).toBe('31.07.2026');
	});
});

describe('previousMonthRange', () => {
	test('luna anterioară, derivată din data dată (nu hardcodată)', () => {
		expect(previousMonthRange(new Date(2026, 7, 4))).toEqual({
			from: '2026-07-01',
			to: '2026-07-31'
		});
	});

	test('în ianuarie sare în decembrie anul trecut', () => {
		expect(previousMonthRange(new Date(2026, 0, 15))).toEqual({
			from: '2025-12-01',
			to: '2025-12-31'
		});
	});

	test('februarie bisect', () => {
		expect(previousMonthRange(new Date(2028, 2, 3))).toEqual({
			from: '2028-02-01',
			to: '2028-02-29'
		});
	});
});

describe('toIsoDate', () => {
	test('folosește data locală, nu UTC', () => {
		expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
	});
});

describe('chunk', () => {
	test('sparge selecția în tranșe de MAX_ZIP_ITEMS', () => {
		const items = Array.from({ length: 250 }, (_, i) => i);
		const batches = chunk(items, MAX_ZIP_ITEMS);
		expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
		expect(batches.flat()).toEqual(items);
	});

	test('o selecție sub plafon rămâne o singură tranșă', () => {
		expect(chunk([1, 2, 3], MAX_ZIP_ITEMS)).toEqual([[1, 2, 3]]);
	});

	test('lista goală nu produce tranșe', () => {
		expect(chunk([], MAX_ZIP_ITEMS)).toEqual([]);
	});
});

describe('batchArchiveName', () => {
	test('o singură arhivă păstrează numele serverului', () => {
		expect(batchArchiveName('facturi-gmail-2026-08-04.zip', 0, 1)).toBe(
			'facturi-gmail-2026-08-04.zip'
		);
	});

	test('mai multe arhive primesc numărul tranșei', () => {
		expect(batchArchiveName('facturi-gmail-2026-08-04.zip', 1, 3)).toBe(
			'facturi-gmail-2026-08-04-parte2-din-3.zip'
		);
	});
});
