import { describe, expect, test } from 'bun:test';
import {
	computeExpiryDate,
	expiredBatches,
	expiringBatches,
	nextExpiryEnabledAt,
	remainingBatches,
	type ExpiryLedgerRow
} from './hour-credit-expiry';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Alimentare cu termen. */
function credit(id: string, at: string, minutes: number, expires: string | null): ExpiryLedgerRow {
	return {
		id,
		createdAt: d(at),
		deltaMinutes: minutes,
		expiresAt: expires ? d(expires) : null
	};
}
/** Consum (sau expirare) — minute negative, fără termen. */
function spend(id: string, at: string, minutes: number): ExpiryLedgerRow {
	return { id, createdAt: d(at), deltaMinutes: -Math.abs(minutes), expiresAt: null };
}

describe('computeExpiryDate', () => {
	test('0 zile = creditul nu expiră', () => {
		expect(computeExpiryDate(d('2026-09-12'), 0)).toBeNull();
	});

	test('N zile după data alimentării', () => {
		expect(computeExpiryDate(d('2026-09-12'), 30)?.toISOString()).toBe('2026-10-12T00:00:00.000Z');
	});

	test('zile negative sau invalide = fără termen (nu aruncă)', () => {
		expect(computeExpiryDate(d('2026-09-12'), -5)).toBeNull();
		expect(computeExpiryDate(d('2026-09-12'), Number.NaN)).toBeNull();
	});
});

describe('remainingBatches — FIFO pe expirare', () => {
	test('consumul mănâncă întâi lotul care expiră cel mai devreme', () => {
		const rows = [
			credit('a', '2026-09-01', 600, '2026-12-01'),
			credit('b', '2026-09-02', 600, '2026-10-01'), // expiră mai devreme, deși e mai nou
			spend('s1', '2026-09-03', 600)
		];
		const left = remainingBatches(rows);
		expect(left).toHaveLength(1);
		expect(left[0].id).toBe('a');
		expect(left[0].remainingMinutes).toBe(600);
	});

	test('creditul fără termen se consumă ultimul', () => {
		const rows = [
			credit('noexp', '2026-09-01', 300, null),
			credit('exp', '2026-09-02', 300, '2026-10-01'),
			spend('s1', '2026-09-03', 300)
		];
		const left = remainingBatches(rows);
		expect(left.map((b) => b.id)).toEqual(['noexp']);
	});

	test('consum parțial lasă restul lotului', () => {
		const rows = [credit('a', '2026-09-01', 600, '2026-10-01'), spend('s', '2026-09-02', 250)];
		expect(remainingBatches(rows)[0].remainingMinutes).toBe(350);
	});

	test('consum mai mare decât creditul nu produce loturi negative', () => {
		const rows = [credit('a', '2026-09-01', 120, '2026-10-01'), spend('s', '2026-09-02', 500)];
		expect(remainingBatches(rows)).toHaveLength(0);
	});

	test('fără mișcări = fără loturi', () => {
		expect(remainingBatches([])).toHaveLength(0);
	});
});

describe('expiredBatches', () => {
	test('lotul trecut de termen, neconsumat, iese cu tot restul', () => {
		const rows = [credit('a', '2026-08-01', 600, '2026-09-01')];
		const out = expiredBatches(rows, d('2026-09-02'));
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ batchId: 'a', minutes: 600 });
	});

	test('exact la data expirării creditul e încă valabil', () => {
		expect(expiredBatches([credit('a', '2026-08-01', 600, '2026-09-01')], d('2026-09-01'))).toEqual(
			[]
		);
	});

	test('lotul consumat integral nu mai expiră', () => {
		const rows = [credit('a', '2026-08-01', 600, '2026-09-01'), spend('s', '2026-08-15', 600)];
		expect(expiredBatches(rows, d('2026-09-02'))).toEqual([]);
	});

	test('expiră doar restul neconsumat', () => {
		const rows = [credit('a', '2026-08-01', 600, '2026-09-01'), spend('s', '2026-08-15', 200)];
		const out = expiredBatches(rows, d('2026-09-02'));
		expect(out[0].minutes).toBe(400);
	});

	test('creditul fără termen nu expiră niciodată', () => {
		expect(expiredBatches([credit('a', '2020-01-01', 600, null)], d('2026-09-02'))).toEqual([]);
	});

	test('o expirare deja scrisă nu se repetă (e consum în ledger)', () => {
		const rows = [
			credit('a', '2026-08-01', 600, '2026-09-01'),
			spend('exp-a', '2026-09-02', 600) // rândul de expirare scris de job
		];
		expect(expiredBatches(rows, d('2026-09-03'))).toEqual([]);
	});

	test('mai multe loturi expirate se raportează separat', () => {
		const rows = [
			credit('a', '2026-07-01', 300, '2026-08-01'),
			credit('b', '2026-07-15', 180, '2026-08-15')
		];
		const out = expiredBatches(rows, d('2026-09-01'));
		expect(out.map((x) => x.batchId).sort()).toEqual(['a', 'b']);
		expect(out.reduce((s, x) => s + x.minutes, 0)).toBe(480);
	});
});

describe('expiringSoon (pentru KPI „expiră luna asta")', () => {
	test('însumează loturile care expiră în fereastră', () => {
		const rows = [
			credit('a', '2026-09-01', 300, '2026-09-30'),
			credit('b', '2026-09-01', 600, '2026-12-01')
		];
		const soon = remainingBatches(rows).filter(
			(b) => b.expiresAt && b.expiresAt <= d('2026-10-01')
		);
		expect(soon).toHaveLength(1);
		expect(soon[0].remainingMinutes).toBe(300);
	});
});

describe('stornări și expirare (decizie 13 sep 2026)', () => {
	const row = (
		id: string,
		at: string,
		minutes: number,
		kind: string,
		sourceId: string,
		expires: string | null = null
	): ExpiryLedgerRow => ({
		id,
		createdAt: d(at),
		deltaMinutes: minutes,
		expiresAt: expires ? d(expires) : null,
		kind,
		sourceId
	});

	test('reopen înainte de termen: minutele restituite rămân în lotul cu termen', () => {
		const rows = [
			row('a', '2026-09-01', 600, 'invoice_credit', 'inv1', '2026-10-01'),
			row('c', '2026-09-10', -600, 'task_consumption', 't1'),
			row('r', '2026-09-12', 600, 'task_reversal', 't1')
		];
		const left = remainingBatches(rows);
		expect(left.map((b) => [b.id, b.remainingMinutes])).toEqual([['a', 600]]);
		// Înainte, stornarea devenea un lot NOU fără termen: creditul nu mai expira.
		expect(expiredBatches(rows, d('2026-10-02')).map((b) => b.minutes)).toEqual([600]);
	});

	test('reopen după termen: minutele lotului expirat expiră la rularea următoare', () => {
		const rows = [
			row('a', '2026-09-01', 600, 'invoice_credit', 'inv1', '2026-09-30'),
			row('c', '2026-09-10', -600, 'task_consumption', 't1'),
			row('r', '2026-10-05', 600, 'task_reversal', 't1')
		];
		expect(expiredBatches(rows, d('2026-10-06'))).toEqual([
			{ batchId: 'a', expireKey: 'a', minutes: 600, expiresAt: d('2026-09-30') }
		]);
	});

	test('a doua expirare a aceluiași lot primește altă cheie (indexul unic ar bloca-o)', () => {
		const rows = [
			row('a', '2026-09-01', 600, 'invoice_credit', 'inv1', '2026-09-30'),
			row('c', '2026-09-10', -500, 'task_consumption', 't1'),
			row('e1', '2026-10-01', -100, 'expire', 'a'),
			row('r', '2026-10-05', 500, 'task_reversal', 't1')
		];
		const out = expiredBatches(rows, d('2026-10-06'));
		expect(out.map((b) => [b.expireKey, b.minutes])).toEqual([['a#2', 500]]);
	});

	test('stornarea unei alimentări lovește lotul ei, nu lotul care expiră primul', () => {
		const rows = [
			row('a', '2026-09-01', 600, 'purchase', 'ord1', null),
			row('b', '2026-09-02', 300, 'invoice_credit', 'inv1', '2026-10-01'),
			row('x', '2026-09-05', -600, 'purchase_reversal', 'ord1')
		];
		// FIFO pur ar fi mâncat lotul b (expiră primul) și ar fi lăsat 300 fără termen.
		expect(remainingBatches(rows).map((b) => [b.id, b.remainingMinutes])).toEqual([['b', 300]]);
	});

	test('surplusul orei facturate e un lot ca oricare altul; reopen-ul îl retrage pe EL', () => {
		// Depășire 15 min → 1 h facturată → 45 min surplus (`purchase`, sursa = urma depășirii).
		const rows = [
			row('b', '2026-09-02', 300, 'invoice_credit', 'inv1', '2026-09-20'),
			row('ov', '2026-09-05', 0, 'overage_invoiced', 't1'),
			row('s', '2026-09-05', 45, 'purchase', 'ov', '2026-10-05')
		];
		expect(expiredBatches(rows, d('2026-10-06')).map((b) => [b.batchId, b.minutes])).toEqual([
			['b', 300],
			['s', 45]
		]);
		// Reopen: `purchase_reversal` cu aceeași sursă scoate lotul de surplus, nu din `b`.
		const reopened = [...rows, row('sr', '2026-09-06', -45, 'purchase_reversal', 'ov')];
		expect(remainingBatches(reopened).map((b) => [b.id, b.remainingMinutes])).toEqual([
			['b', 300]
		]);
	});
});

describe('oprire și repornire (decizie 13 sep 2026: fără expirare retroactivă)', () => {
	test('reactivarea fixează momentul; oprirea îl golește; o modificare de zile îl păstrează', () => {
		const now = d('2026-10-01');
		expect(nextExpiryEnabledAt({ prevDays: 0, prevEnabledAt: null, nextDays: 30, now })).toEqual(
			now
		);
		expect(
			nextExpiryEnabledAt({ prevDays: 30, prevEnabledAt: d('2026-09-01'), nextDays: 0, now })
		).toBeNull();
		expect(
			nextExpiryEnabledAt({ prevDays: 30, prevEnabledAt: d('2026-09-01'), nextDays: 60, now })
		).toEqual(d('2026-09-01'));
		// Pornită înainte să existe coloana: fără restricție, rămâne așa.
		expect(
			nextExpiryEnabledAt({ prevDays: 30, prevEnabledAt: null, nextDays: 60, now })
		).toBeNull();
	});

	test('termenele trecute cât expirarea a fost oprită nu mai expiră după repornire', () => {
		const rows = [
			credit('old', '2026-08-01', 300, '2026-09-01'), // termen în perioada oprită
			credit('new', '2026-09-20', 200, '2026-10-05') // termen după repornire
		];
		const out = expiredBatches(rows, d('2026-10-10'), { notBefore: d('2026-09-15') });
		expect(out.map((b) => b.batchId)).toEqual(['new']);
	});

	test('expirare oprită = nimic nu e afișat ca „expiră"', () => {
		const rows = [credit('a', '2026-09-01', 300, '2026-10-01')];
		expect(expiringBatches(rows, { creditExpiryDays: 0, creditExpiryEnabledAt: null })).toEqual([]);
		expect(
			expiringBatches(rows, { creditExpiryDays: 30, creditExpiryEnabledAt: null }).map((b) => b.id)
		).toEqual(['a']);
		expect(
			expiringBatches(rows, { creditExpiryDays: 30, creditExpiryEnabledAt: d('2026-10-02') })
		).toEqual([]);
	});
});

describe('remainingBatches — corecții', () => {
	test('correction nu e lot: minusul scade lotul corectat, plusul scade consumul', () => {
		const at = (s: string) => new Date(s);
		const rows: ExpiryLedgerRow[] = [
			{
				id: 'b1',
				createdAt: at('2026-09-12T10:00:00Z'),
				deltaMinutes: 321,
				expiresAt: at('2027-09-12T00:00:00Z'),
				kind: 'manual',
				sourceId: 'b1'
			},
			{
				id: 'c1',
				createdAt: at('2026-09-12T11:00:00Z'),
				deltaMinutes: -178,
				expiresAt: null,
				kind: 'task_consumption',
				sourceId: 't1'
			},
			{
				id: 'k1',
				createdAt: at('2026-09-17T10:00:00Z'),
				deltaMinutes: -141,
				expiresAt: null,
				kind: 'correction',
				sourceId: 'b1'
			},
			{
				id: 'k2',
				createdAt: at('2026-09-17T10:00:01Z'),
				deltaMinutes: 28,
				expiresAt: null,
				kind: 'correction',
				sourceId: 'c1'
			}
		];
		const left = remainingBatches(rows);
		expect(left.map((b) => [b.id, b.remainingMinutes])).toEqual([['b1', 30]]);
	});

	test('corecția pozitivă pe un LOT îl mărește pe el, nu restituie consum altui lot', () => {
		const at = (s: string) => new Date(s);
		const rows: ExpiryLedgerRow[] = [
			// Lotul fără termen, corectat cu +50; lotul cu termen se consumă primul (FIFO).
			{
				id: 'soon',
				createdAt: at('2026-09-01T10:00:00Z'),
				deltaMinutes: 100,
				expiresAt: at('2026-10-01T00:00:00Z'),
				kind: 'purchase',
				sourceId: 'ord-1'
			},
			{
				id: 'never',
				createdAt: at('2026-09-02T10:00:00Z'),
				deltaMinutes: 100,
				expiresAt: null,
				kind: 'manual',
				sourceId: 'm-1'
			},
			{
				id: 'c1',
				createdAt: at('2026-09-03T10:00:00Z'),
				deltaMinutes: -60,
				expiresAt: null,
				kind: 'task_consumption',
				sourceId: 't1'
			},
			{
				id: 'k1',
				createdAt: at('2026-09-04T10:00:00Z'),
				deltaMinutes: 50,
				expiresAt: null,
				kind: 'correction',
				sourceId: 'never'
			}
		];
		// Greșit (înainte): +50 scădea consumul → soon 90, never 100. Corect: soon 40, never 150.
		expect(remainingBatches(rows).map((b) => [b.id, b.remainingMinutes])).toEqual([
			['soon', 40],
			['never', 150]
		]);
		// Ordinea rândurilor nu contează: stornarea alimentării retrage netul (100 + 50),
		// chiar dacă apare în listă înaintea corecției.
		const reversed: ExpiryLedgerRow[] = [
			{
				id: 'r1',
				createdAt: at('2026-09-05T10:00:00Z'),
				deltaMinutes: -150,
				expiresAt: null,
				kind: 'purchase_reversal',
				sourceId: 'ord-2'
			},
			{
				id: 'p2',
				createdAt: at('2026-09-01T10:00:00Z'),
				deltaMinutes: 100,
				expiresAt: at('2026-10-01T00:00:00Z'),
				kind: 'purchase',
				sourceId: 'ord-2'
			},
			{
				id: 'other',
				createdAt: at('2026-09-01T11:00:00Z'),
				deltaMinutes: 70,
				expiresAt: at('2026-09-20T00:00:00Z'),
				kind: 'manual',
				sourceId: 'm-2'
			},
			{
				id: 'k2',
				createdAt: at('2026-09-04T10:00:00Z'),
				deltaMinutes: 50,
				expiresAt: null,
				kind: 'correction',
				sourceId: 'p2'
			}
		];
		expect(remainingBatches(reversed).map((b) => [b.id, b.remainingMinutes])).toEqual([
			['other', 70]
		]);
	});
});
