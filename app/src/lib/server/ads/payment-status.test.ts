import { describe, expect, test } from 'bun:test';
import {
	mapMetaStatusPure,
	mapGoogleStatusPure,
	mapTikTokStatusPure,
	isKnownMetaAccountStatus,
	isKnownGoogleCustomerStatus,
	isKnownTikTokStatus,
} from './status-mappers';

/**
 * Exhaustive tests for ad-platform status mappings.
 * Run: `bun test src/lib/server/ads/payment-status.test.ts`
 *
 * Status code values verified against official API docs (April 2026).
 * Do not add cases here without confirming the value in the source API.
 */

describe('Meta — mapMetaStatusPure', () => {
	test('account_status=1 ACTIVE → ok (ignores stale disable_reason)', () => {
		expect(mapMetaStatusPure(1, 0)).toBe('ok');
		expect(mapMetaStatusPure(1, 3)).toBe('ok'); // don't fire payment_failed on an active account
	});

	test('account_status=2 DISABLED (no disable_reason) → suspended', () => {
		expect(mapMetaStatusPure(2, 0)).toBe('suspended');
	});

	test('account_status=3 UNSETTLED → payment_failed', () => {
		expect(mapMetaStatusPure(3, 0)).toBe('payment_failed');
	});

	test('account_status=7 PENDING_RISK_REVIEW → risk_review', () => {
		expect(mapMetaStatusPure(7, 0)).toBe('risk_review');
	});

	test('account_status=8 PENDING_SETTLEMENT → payment_failed', () => {
		expect(mapMetaStatusPure(8, 0)).toBe('payment_failed');
	});

	test('account_status=9 IN_GRACE_PERIOD → grace_period', () => {
		expect(mapMetaStatusPure(9, 0)).toBe('grace_period');
	});

	test('account_status=100 PENDING_CLOSURE → suspended', () => {
		expect(mapMetaStatusPure(100, 0)).toBe('suspended');
	});

	test('account_status=101 CLOSED → closed', () => {
		expect(mapMetaStatusPure(101, 0)).toBe('closed');
	});

	test('unknown account_status → risk_review (fail-safer)', () => {
		expect(mapMetaStatusPure(999, 0)).toBe('risk_review');
	});

	// disable_reason overrides — only apply for non-ACTIVE accounts
	test('disable_reason=3 RISK_PAYMENT + status=2 → payment_failed', () => {
		expect(mapMetaStatusPure(2, 3)).toBe('payment_failed');
	});

	test('disable_reason=8 PRE_PAYMENT_ADS_DISABLED + status=2 → payment_failed', () => {
		expect(mapMetaStatusPure(2, 8)).toBe('payment_failed');
	});

	test('disable_reason=2 ADS_IP_REVIEW + status=2 → risk_review', () => {
		expect(mapMetaStatusPure(2, 2)).toBe('risk_review');
	});

	test('disable_reason=1 ADS_INTEGRITY_POLICY + status=2 → suspended', () => {
		expect(mapMetaStatusPure(2, 1)).toBe('suspended');
	});

	test('disable_reason=5 AD_ACCOUNT_DISABLED + status=2 → suspended', () => {
		expect(mapMetaStatusPure(2, 5)).toBe('suspended');
	});

	test('disable_reason=9 PERMISSION_REVOKED + status=2 (real tenant data) → suspended', () => {
		expect(mapMetaStatusPure(2, 9)).toBe('suspended');
	});

	test('disable_reason=11 COMPROMISED_ACCOUNT → suspended', () => {
		expect(mapMetaStatusPure(2, 11)).toBe('suspended');
	});

	test('disable_reason=12 BUSINESS_INTEGRITY_RS → suspended', () => {
		expect(mapMetaStatusPure(2, 12)).toBe('suspended');
	});

	test('isKnownMetaAccountStatus correctness', () => {
		for (const c of [1, 2, 3, 7, 8, 9, 100, 101]) expect(isKnownMetaAccountStatus(c)).toBe(true);
		for (const c of [0, 4, 5, 6, 10, 102, 103, 999]) expect(isKnownMetaAccountStatus(c)).toBe(false);
	});
});

describe('Google — mapGoogleStatusPure', () => {
	test('SUSPENDED → suspended (regardless of billing)', () => {
		expect(mapGoogleStatusPure('SUSPENDED', null)).toBe('suspended');
		expect(mapGoogleStatusPure('SUSPENDED', 'APPROVED')).toBe('suspended');
	});

	test('CANCELLED → closed', () => {
		expect(mapGoogleStatusPure('CANCELLED', null)).toBe('closed');
	});

	test('CLOSED → closed', () => {
		expect(mapGoogleStatusPure('CLOSED', null)).toBe('closed');
	});

	test('ENABLED + APPROVED billing → ok (the common case)', () => {
		expect(mapGoogleStatusPure('ENABLED', 'APPROVED')).toBe('ok');
	});

	test('ENABLED + APPROVED_HELD → ok (enum=3, ads still run)', () => {
		expect(mapGoogleStatusPure('ENABLED', 'APPROVED_HELD')).toBe('ok');
	});

	test('ENABLED + PENDING → risk_review', () => {
		expect(mapGoogleStatusPure('ENABLED', 'PENDING')).toBe('risk_review');
	});

	test('ENABLED + NONE (no billing setup at all) → risk_review', () => {
		expect(mapGoogleStatusPure('ENABLED', 'NONE')).toBe('risk_review');
	});

	test('ENABLED + CANCELLED → payment_failed', () => {
		expect(mapGoogleStatusPure('ENABLED', 'CANCELLED')).toBe('payment_failed');
	});

	test('ENABLED + null billing (API lookup failed) → ok (null-safe)', () => {
		expect(mapGoogleStatusPure('ENABLED', null)).toBe('ok');
	});

	test('UNKNOWN customer status → risk_review', () => {
		expect(mapGoogleStatusPure('UNKNOWN', null)).toBe('risk_review');
	});

	test('UNSPECIFIED → risk_review', () => {
		expect(mapGoogleStatusPure('UNSPECIFIED', null)).toBe('risk_review');
	});

	test('unknown customer status → risk_review', () => {
		expect(mapGoogleStatusPure('SOMETHING_NEW', null)).toBe('risk_review');
	});

	test('isKnownGoogleCustomerStatus correctness', () => {
		for (const s of ['ENABLED', 'SUSPENDED', 'CANCELLED', 'CLOSED', 'UNKNOWN', 'UNSPECIFIED']) {
			expect(isKnownGoogleCustomerStatus(s)).toBe(true);
		}
		expect(isKnownGoogleCustomerStatus('SOMETHING_NEW')).toBe(false);
	});
});

describe('TikTok — mapTikTokStatusPure', () => {
	test('STATUS_ENABLE → ok', () => {
		expect(mapTikTokStatusPure('STATUS_ENABLE')).toBe('ok');
	});

	test('STATUS_DISABLE → suspended', () => {
		expect(mapTikTokStatusPure('STATUS_DISABLE')).toBe('suspended');
	});

	test('STATUS_CBD_DISABLE (Credit-Based Delivery disabled) → payment_failed', () => {
		expect(mapTikTokStatusPure('STATUS_CBD_DISABLE')).toBe('payment_failed');
	});

	test('STATUS_CBT_ACCOUNT_CLOSED → closed', () => {
		expect(mapTikTokStatusPure('STATUS_CBT_ACCOUNT_CLOSED')).toBe('closed');
	});

	test('STATUS_DELETED → closed', () => {
		expect(mapTikTokStatusPure('STATUS_DELETED')).toBe('closed');
	});

	test('STATUS_PUNISH → suspended', () => {
		expect(mapTikTokStatusPure('STATUS_PUNISH')).toBe('suspended');
	});

	test('STATUS_PUNISH_END_ADS → suspended', () => {
		expect(mapTikTokStatusPure('STATUS_PUNISH_END_ADS')).toBe('suspended');
	});

	test('STATUS_LIMIT (real data — 7 tenant accounts have this) → risk_review', () => {
		expect(mapTikTokStatusPure('STATUS_LIMIT')).toBe('risk_review');
	});

	test('STATUS_CONTRACT_PENDING → risk_review', () => {
		expect(mapTikTokStatusPure('STATUS_CONTRACT_PENDING')).toBe('risk_review');
	});

	test('STATUS_CONFIRM_FAIL → risk_review', () => {
		expect(mapTikTokStatusPure('STATUS_CONFIRM_FAIL')).toBe('risk_review');
	});

	test('STATUS_WAIT_FOR_PUBLIC_AUTHORIZE → risk_review', () => {
		expect(mapTikTokStatusPure('STATUS_WAIT_FOR_PUBLIC_AUTHORIZE')).toBe('risk_review');
	});

	test('STATUS_ADVERTISER_AUTHORIZATION_PENDING (legacy) → risk_review', () => {
		expect(mapTikTokStatusPure('STATUS_ADVERTISER_AUTHORIZATION_PENDING')).toBe('risk_review');
	});

	test('unknown status → risk_review', () => {
		expect(mapTikTokStatusPure('STATUS_FUTURE_UNKNOWN')).toBe('risk_review');
	});

	test('isKnownTikTokStatus correctness', () => {
		for (const s of [
			'STATUS_ENABLE',
			'STATUS_DISABLE',
			'STATUS_CBD_DISABLE',
			'STATUS_CBT_ACCOUNT_CLOSED',
			'STATUS_DELETED',
			'STATUS_PUNISH',
			'STATUS_PUNISH_END_ADS',
			'STATUS_LIMIT',
			'STATUS_CONTRACT_PENDING',
			'STATUS_CONFIRM_FAIL',
			'STATUS_WAIT_FOR_PUBLIC_AUTHORIZE',
			'STATUS_ADVERTISER_AUTHORIZATION_PENDING',
		]) {
			expect(isKnownTikTokStatus(s)).toBe(true);
		}
		expect(isKnownTikTokStatus('STATUS_SOMETHING_ELSE')).toBe(false);
	});
});

describe('Cross-provider sanity', () => {
	test('no mapper returns undefined for any documented input', () => {
		const metaPairs: Array<[number, number]> = [
			[1, 0], [2, 0], [3, 0], [7, 0], [8, 0], [9, 0], [100, 0], [101, 0],
			[2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [2, 11], [2, 12],
		];
		for (const [s, r] of metaPairs) expect(mapMetaStatusPure(s, r)).toBeDefined();

		const googleCombos: Array<[string, string | null]> = [
			['ENABLED', 'APPROVED'], ['ENABLED', 'APPROVED_HELD'], ['ENABLED', 'PENDING'],
			['ENABLED', 'CANCELLED'], ['ENABLED', 'NONE'], ['ENABLED', null],
			['SUSPENDED', null], ['CANCELLED', null], ['CLOSED', null],
			['UNKNOWN', null], ['UNSPECIFIED', null],
		];
		for (const [s, b] of googleCombos) expect(mapGoogleStatusPure(s, b)).toBeDefined();

		for (const s of [
			'STATUS_ENABLE', 'STATUS_DISABLE', 'STATUS_CBD_DISABLE',
			'STATUS_CBT_ACCOUNT_CLOSED', 'STATUS_DELETED',
			'STATUS_PUNISH', 'STATUS_PUNISH_END_ADS', 'STATUS_LIMIT',
			'STATUS_CONTRACT_PENDING', 'STATUS_CONFIRM_FAIL',
			'STATUS_WAIT_FOR_PUBLIC_AUTHORIZE', 'STATUS_ADVERTISER_AUTHORIZATION_PENDING',
		]) {
			expect(mapTikTokStatusPure(s)).toBeDefined();
		}
	});

	test('all outputs are one of the 6 valid payment statuses', () => {
		const valid = ['ok', 'grace_period', 'risk_review', 'payment_failed', 'suspended', 'closed'];
		expect(valid).toContain(mapMetaStatusPure(1, 0));
		expect(valid).toContain(mapMetaStatusPure(999, 0));
		expect(valid).toContain(mapGoogleStatusPure('ENABLED', 'APPROVED'));
		expect(valid).toContain(mapGoogleStatusPure('FUTURE', null));
		expect(valid).toContain(mapTikTokStatusPure('STATUS_ENABLE'));
		expect(valid).toContain(mapTikTokStatusPure('STATUS_FUTURE'));
	});
});
