import { describe, expect, test } from 'bun:test';
import {
	computeExpiryDate,
	expiredBatches,
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
		expect(computeExpiryDate(d('2026-09-12'), 30)?.toISOString()).toBe(
			'2026-10-12T00:00:00.000Z'
		);
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
