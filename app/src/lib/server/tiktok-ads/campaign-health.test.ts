// app/src/lib/server/tiktok-ads/campaign-health.test.ts
import { describe, expect, test } from 'bun:test';
import { isCampaignDelivering, classifySecondaryStatus } from './campaign-health';

describe('isCampaignDelivering', () => {
	test('DELIVERY_OK → true', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DELIVERY_OK')).toBe(true);
		expect(isCampaignDelivering('STATUS_DELIVERY_OK')).toBe(true);
	});

	test('PARTIAL_AUDIT_DENY → true (campaign still serves approved ads)', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY')).toBe(true);
	});

	test('CAMPAIGN_STATUS_ENABLE → true (user-enabled, no platform blocker)', () => {
		// Seen on Heylux TikTok account 2026-04-24 — TikTok returns this as
		// secondary_status instead of DELIVERY_OK in some cases.
		expect(isCampaignDelivering('CAMPAIGN_STATUS_ENABLE')).toBe(true);
	});

	test('BUDGET_EXCEED → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_BUDGET_EXCEED')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_BUDGET_EXCEED')).toBe(false);
	});

	test('full audit deny / punish / not delivery → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_PUNISH')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_NOT_DELIVERY')).toBe(false);
	});

	test('lifecycle non-delivering → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_NOT_START')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_TIME_DONE')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DONE')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_NO_SCHEDULE')).toBe(false);
	});

	test('disabled / deleted → false', () => {
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DISABLE')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_DELETE')).toBe(false);
	});

	test('case-insensitive (uppercase-normalized)', () => {
		expect(isCampaignDelivering('campaign_status_delivery_ok')).toBe(true);
		expect(isCampaignDelivering('campaign_status_partial_audit_deny')).toBe(true);
	});

	test('empty / unknown → false (conservative)', () => {
		expect(isCampaignDelivering('')).toBe(false);
		expect(isCampaignDelivering('CAMPAIGN_STATUS_SOMETHING_NEW')).toBe(false);
	});
});

describe('classifySecondaryStatus', () => {
	test('delivering + partial_audit_deny → delivering', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_DELIVERY_OK')).toBe('delivering');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_PARTIAL_AUDIT_DENY')).toBe('delivering');
	});

	test('budget exceed → budget_exceeded', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_BUDGET_EXCEED')).toBe('budget_exceeded');
		expect(classifySecondaryStatus('CAMPAIGN_BUDGET_EXCEED')).toBe('budget_exceeded');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_BALANCE_EXCEED')).toBe('budget_exceeded');
	});

	test('audit deny / punish / pending → blocked', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY')).toBe('blocked');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_PUNISH')).toBe('blocked');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_ADVERTISER_AUDIT')).toBe('blocked');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_ADVERTISER_CONTRACT_PENDING')).toBe('blocked');
	});

	test('lifecycle / disabled → inactive', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_NOT_START')).toBe('inactive');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_DONE')).toBe('inactive');
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_DISABLE')).toBe('inactive');
	});

	test('unknown → inactive (fail-closed)', () => {
		expect(classifySecondaryStatus('CAMPAIGN_STATUS_WEIRD')).toBe('inactive');
	});
});
