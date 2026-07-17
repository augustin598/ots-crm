import { describe, test, expect } from 'bun:test';
import { shouldFlagGoogleNoDelivery } from './status-mappers';

describe('shouldFlagGoogleNoDelivery', () => {
	test('ENABLED campaigns + zero impressions yesterday → flag (the DS TECH case)', () => {
		// Real account 2026-07-17: 2 enabled campaigns, 0 impressions for 14 days,
		// Google UI banner "Anunturile tale nu sunt difuzate - sold restant",
		// while every Google status field still reported healthy.
		expect(shouldFlagGoogleNoDelivery({ hasEnabledCampaigns: true, impressionsYesterday: 0 })).toBe(true);
	});

	test('delivering account → no flag', () => {
		expect(shouldFlagGoogleNoDelivery({ hasEnabledCampaigns: true, impressionsYesterday: 6639 })).toBe(false);
	});

	test('a single impression is still delivery → no flag', () => {
		expect(shouldFlagGoogleNoDelivery({ hasEnabledCampaigns: true, impressionsYesterday: 1 })).toBe(false);
	});

	test('no ENABLED campaigns → no flag (paused on purpose, not broken)', () => {
		// Meduza / PROFESIONAL RENT / beonemedical: 0 enabled campaigns. Without this
		// guard all three would alert forever.
		expect(shouldFlagGoogleNoDelivery({ hasEnabledCampaigns: false, impressionsYesterday: 0 })).toBe(false);
	});

	test('failed lookup (null) → no flag, never alert on an API hiccup', () => {
		expect(shouldFlagGoogleNoDelivery(null)).toBe(false);
	});
});
