/**
 * Pure status mappers for the 3 ad platforms.
 *
 * This file is intentionally dependency-free (no SvelteKit env, no DB, no
 * logger) so the mappings can be unit-tested with `bun test`.
 *
 * The wrapping modules (meta-ads/status.ts, google-ads/status.ts,
 * tiktok-ads/status.ts) import these and add fetch + log-on-unknown behavior.
 *
 * Sources — verified against official API docs (April 2026):
 *   Meta:   developers.facebook.com → Marketing API AdAccount reference
 *   Google: developers.google.com/google-ads/api → CustomerStatusEnum, BillingSetupStatusEnum
 *   TikTok: business-api.tiktok.com/portal/docs → /v1.3/advertiser/info/
 */

import type { PaymentStatusSnapshot } from './payment-status-types';

type Status = PaymentStatusSnapshot['paymentStatus'];

// --- META ------------------------------------------------------------------

export function mapMetaStatusPure(accountStatus: number, disableReason: number): Status {
	// ACTIVE wins: ignore disable_reason when status=1 (API shouldn't set both, but
	// we trust ACTIVE as ok to prevent false positives from stale disable_reason).
	if (accountStatus === 1) return 'ok';

	// disable_reason overrides for inactive accounts — payment reasons first.
	switch (disableReason) {
		case 3: // RISK_PAYMENT
		case 8: // PRE_PAYMENT_ADS_DISABLED
			return 'payment_failed';
		case 2: // ADS_IP_REVIEW
			return 'risk_review';
		case 1: // ADS_INTEGRITY_POLICY
		case 4: // GRAY_ACCOUNT_SHUT_DOWN
		case 5: // AD_ACCOUNT_DISABLED
		case 6: // BUSINESS_DISABLED
		case 7: // MPG_AFFILIATE_DISABLED
		case 9: // PERMISSION_REVOKED
		case 11: // COMPROMISED_ACCOUNT
		case 12: // BUSINESS_INTEGRITY_RS
			return 'suspended';
		default:
			break;
	}

	switch (accountStatus) {
		case 2: // DISABLED
			return 'suspended';
		case 3: // UNSETTLED
			return 'payment_failed';
		case 7: // PENDING_RISK_REVIEW
			return 'risk_review';
		case 8: // PENDING_SETTLEMENT
			return 'payment_failed';
		case 9: // IN_GRACE_PERIOD
			return 'grace_period';
		case 100: // PENDING_CLOSURE
			return 'suspended';
		case 101: // CLOSED
			return 'closed';
		default:
			return 'risk_review'; // fail-safer: unknown → alert, not silent ok
	}
}

export function isKnownMetaAccountStatus(accountStatus: number): boolean {
	return [1, 2, 3, 7, 8, 9, 100, 101].includes(accountStatus);
}

// --- GOOGLE ----------------------------------------------------------------

export function mapGoogleStatusPure(
	customerStatus: string,
	billingSetupStatus: string | null,
): Status {
	switch (customerStatus) {
		case 'SUSPENDED':
			return 'suspended';
		case 'CANCELLED':
		case 'CLOSED':
			return 'closed';
		case 'ENABLED':
			if (billingSetupStatus === null) return 'ok'; // billing lookup failed — don't alert on infra issue
			if (billingSetupStatus === 'CANCELLED') return 'payment_failed';
			if (billingSetupStatus === 'PENDING' || billingSetupStatus === 'NONE') return 'risk_review';
			// APPROVED + APPROVED_HELD → ads run
			return 'ok';
		case 'UNKNOWN':
		case 'UNSPECIFIED':
			return 'risk_review';
		default:
			return 'risk_review';
	}
}

export function isKnownGoogleCustomerStatus(status: string): boolean {
	return ['ENABLED', 'SUSPENDED', 'CANCELLED', 'CLOSED', 'UNKNOWN', 'UNSPECIFIED'].includes(status);
}

// --- TIKTOK ----------------------------------------------------------------

export function mapTikTokStatusPure(status: string): Status {
	switch (status) {
		case 'STATUS_ENABLE':
			return 'ok';

		case 'STATUS_CBD_DISABLE':
			return 'payment_failed';

		case 'STATUS_DISABLE':
		case 'STATUS_PUNISH':
		case 'STATUS_PUNISH_END_ADS':
			return 'suspended';

		case 'STATUS_CBT_ACCOUNT_CLOSED':
		case 'STATUS_DELETED':
			return 'closed';

		case 'STATUS_LIMIT':
		case 'STATUS_CONTRACT_PENDING':
		case 'STATUS_CONFIRM_FAIL':
		case 'STATUS_WAIT_FOR_PUBLIC_AUTHORIZE':
		case 'STATUS_ADVERTISER_AUTHORIZATION_PENDING':
			return 'risk_review';

		default:
			return 'risk_review';
	}
}

export function isKnownTikTokStatus(status: string): boolean {
	return [
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
	].includes(status);
}
