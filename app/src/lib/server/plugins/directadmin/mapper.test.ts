import { describe, expect, test } from 'bun:test';
import {
	mapWHMCSStatus,
	mapWHMCSDomainStatus,
	mapWHMCSBillingCycle,
	priceToCents,
	normalizeWHMCSDate,
	nullIfEmpty,
	BILLING_CYCLE_MONTHS
} from './mapper';

describe('mapWHMCSStatus', () => {
	test('Active → active', () => expect(mapWHMCSStatus('Active')).toBe('active'));
	test('Suspended → suspended', () => expect(mapWHMCSStatus('Suspended')).toBe('suspended'));
	test('Terminated → terminated', () => expect(mapWHMCSStatus('Terminated')).toBe('terminated'));
	test('Cancelled → cancelled', () => expect(mapWHMCSStatus('Cancelled')).toBe('cancelled'));
	test('Fraud → cancelled (treat as no-longer-billable)', () =>
		expect(mapWHMCSStatus('Fraud')).toBe('cancelled'));
	test('Completed → terminated (one-off finished)', () =>
		expect(mapWHMCSStatus('Completed')).toBe('terminated'));
	test('Pending → pending', () => expect(mapWHMCSStatus('Pending')).toBe('pending'));
	test('case-insensitive', () => expect(mapWHMCSStatus('ACTIVE')).toBe('active'));
	test('unknown → pending fallback', () => expect(mapWHMCSStatus('xyz')).toBe('pending'));
	test('null/empty → pending', () => {
		expect(mapWHMCSStatus('')).toBe('pending');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(mapWHMCSStatus(null as any)).toBe('pending');
	});
});

describe('mapWHMCSDomainStatus', () => {
	test('Active → active', () => expect(mapWHMCSDomainStatus('Active')).toBe('active'));
	test('Expired → expired', () => expect(mapWHMCSDomainStatus('Expired')).toBe('expired'));
	test('Grace → expired (recovery window)', () =>
		expect(mapWHMCSDomainStatus('Grace')).toBe('expired'));
	test('Redemption → expired (deeper recovery)', () =>
		expect(mapWHMCSDomainStatus('Redemption')).toBe('expired'));
	test('Cancelled → cancelled', () =>
		expect(mapWHMCSDomainStatus('Cancelled')).toBe('cancelled'));
	test('Fraud → cancelled', () => expect(mapWHMCSDomainStatus('Fraud')).toBe('cancelled'));
	test('Transferred Away → cancelled', () =>
		expect(mapWHMCSDomainStatus('Transferred Away')).toBe('cancelled'));
	test('Pending Registration → pending-transfer', () =>
		expect(mapWHMCSDomainStatus('Pending Registration')).toBe('pending-transfer'));
	test('Pending Transfer → pending-transfer', () =>
		expect(mapWHMCSDomainStatus('Pending Transfer')).toBe('pending-transfer'));
});

describe('mapWHMCSBillingCycle', () => {
	test('Monthly → monthly', () => expect(mapWHMCSBillingCycle('Monthly')).toBe('monthly'));
	test('Quarterly → quarterly', () => expect(mapWHMCSBillingCycle('Quarterly')).toBe('quarterly'));
	test('Semiannually → semiannually (NOT biannually — distinct from biennially)', () =>
		expect(mapWHMCSBillingCycle('Semiannually')).toBe('semiannually'));
	test('Annually → annually', () => expect(mapWHMCSBillingCycle('Annually')).toBe('annually'));
	test('Biennially → biennially (NOT biannually — every 2 years)', () =>
		expect(mapWHMCSBillingCycle('Biennially')).toBe('biennially'));
	test('Triennially → triennially', () =>
		expect(mapWHMCSBillingCycle('Triennially')).toBe('triennially'));
	test('Free Account → one_time', () =>
		expect(mapWHMCSBillingCycle('Free Account')).toBe('one_time'));
	test('case-insensitive', () =>
		expect(mapWHMCSBillingCycle('annually'.toUpperCase())).toBe('annually'));
});

describe('BILLING_CYCLE_MONTHS', () => {
	test('months are correct multipliers used for MRR normalization', () => {
		expect(BILLING_CYCLE_MONTHS.monthly).toBe(1);
		expect(BILLING_CYCLE_MONTHS.quarterly).toBe(3);
		expect(BILLING_CYCLE_MONTHS.semiannually).toBe(6);
		expect(BILLING_CYCLE_MONTHS.annually).toBe(12);
		expect(BILLING_CYCLE_MONTHS.biennially).toBe(24);
		expect(BILLING_CYCLE_MONTHS.triennially).toBe(36);
		expect(BILLING_CYCLE_MONTHS.one_time).toBe(0);
	});
});

describe('priceToCents', () => {
	test('decimal string → integer cents', () => expect(priceToCents('12.50')).toBe(1250));
	test('integer → cents', () => expect(priceToCents(100)).toBe(10000));
	test('null/undefined → 0', () => {
		expect(priceToCents(null)).toBe(0);
		expect(priceToCents(undefined)).toBe(0);
	});
	test('negative → 0 (WHMCS uses -1 for "not available for this cycle")', () => {
		expect(priceToCents('-1.00')).toBe(0);
		expect(priceToCents(-50)).toBe(0);
	});
	test('NaN string → 0', () => expect(priceToCents('not a number')).toBe(0));
	test('rounds to nearest cent', () => expect(priceToCents('12.346')).toBe(1235));
});

describe('normalizeWHMCSDate', () => {
	test('valid YYYY-MM-DD passes through', () =>
		expect(normalizeWHMCSDate('2026-05-12')).toBe('2026-05-12'));
	test("WHMCS '0000-00-00' sentinel → null", () =>
		expect(normalizeWHMCSDate('0000-00-00')).toBeNull());
	test('null/undefined → null', () => {
		expect(normalizeWHMCSDate(null)).toBeNull();
		expect(normalizeWHMCSDate(undefined)).toBeNull();
	});
	test('empty string → null', () => expect(normalizeWHMCSDate('')).toBeNull());
	test('Date object → YYYY-MM-DD', () => {
		const d = new Date('2026-05-12T00:00:00Z');
		expect(normalizeWHMCSDate(d)).toBe('2026-05-12');
	});
	test('invalid Date → null', () => expect(normalizeWHMCSDate(new Date('not-a-date'))).toBeNull());
	test('Buffer (utf8mb3 fallback path) → string then YYYY-MM-DD', () =>
		expect(normalizeWHMCSDate(Buffer.from('2026-05-12'))).toBe('2026-05-12'));
});

describe('nullIfEmpty', () => {
	test('non-empty string → trimmed string', () =>
		expect(nullIfEmpty('  hello  ')).toBe('hello'));
	test('empty string → null', () => expect(nullIfEmpty('')).toBeNull());
	test('whitespace-only → null', () => expect(nullIfEmpty('   ')).toBeNull());
	test('null/undefined → null', () => {
		expect(nullIfEmpty(null)).toBeNull();
		expect(nullIfEmpty(undefined)).toBeNull();
	});
	test('number → string coerced', () => expect(nullIfEmpty(42)).toBe('42'));
	test('Buffer (mysql2 utf8mb3) → string', () =>
		expect(nullIfEmpty(Buffer.from('hello'))).toBe('hello'));
});
