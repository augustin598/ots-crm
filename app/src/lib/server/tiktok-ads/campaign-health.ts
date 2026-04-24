// app/src/lib/server/tiktok-ads/campaign-health.ts
/**
 * Pure helpers for TikTok campaign-level secondary_status values.
 *
 * TikTok Business API /campaign/get/ returns a secondary_status field
 * distinct from operation_status. operation_status = user intent
 * (ENABLE/DISABLE/DELETE), secondary_status = current platform state.
 *
 * Critical: PARTIAL_AUDIT_DENY means SOME ads were denied, but the
 * campaign is still serving the approved ads. Treating this as
 * "not delivering" causes false-positive risk_review on accounts
 * where only ad-level policy rejections happened.
 */

export type SecondaryClass = 'delivering' | 'budget_exceeded' | 'blocked' | 'inactive';

const DELIVERING = new Set([
	'CAMPAIGN_STATUS_DELIVERY_OK',
	'STATUS_DELIVERY_OK',
	'CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY',
	// TikTok returns `CAMPAIGN_STATUS_ENABLE` as secondary_status for
	// user-enabled campaigns with no explicit platform blocker. Treating
	// this as non-delivering caused the Heylux false-positive (April 2026).
	'CAMPAIGN_STATUS_ENABLE',
]);

const BUDGET_EXCEEDED = new Set([
	'CAMPAIGN_STATUS_BUDGET_EXCEED',
	'CAMPAIGN_BUDGET_EXCEED',
	'CAMPAIGN_STATUS_BALANCE_EXCEED',
]);

const BLOCKED = new Set([
	'CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY',
	'CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_PUNISH',
	'CAMPAIGN_STATUS_ADVERTISER_AUDIT',
	'CAMPAIGN_STATUS_ADVERTISER_CONTRACT_PENDING',
	'CAMPAIGN_STATUS_NOT_DELIVERY',
]);

export function isCampaignDelivering(secondaryStatus: string): boolean {
	return DELIVERING.has(secondaryStatus.toUpperCase());
}

export function classifySecondaryStatus(secondaryStatus: string): SecondaryClass {
	const s = secondaryStatus.toUpperCase();
	if (DELIVERING.has(s)) return 'delivering';
	if (BUDGET_EXCEEDED.has(s)) return 'budget_exceeded';
	if (BLOCKED.has(s)) return 'blocked';
	return 'inactive';
}
