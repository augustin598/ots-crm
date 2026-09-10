import { describe, it, expect } from 'bun:test';
import { tierLabelFor } from '$lib/constants/ots-catalog-format';
import { TIER_LABELS, getCategory } from '$lib/constants/ots-catalog';

/**
 * Serviciile one-time cu un singur tarif nu sunt „Bronze": Google Ads Setup se
 * vinde ca „Pachet Start" (cerere 10 sep 2026). Override-ul stă pe categorie.
 */
describe('tierLabelFor', () => {
	it('Google Ads Setup → „Pachet Start" în loc de Bronze', () => {
		expect(tierLabelFor(getCategory('google-ads-setup'), 'bronze', TIER_LABELS)).toBe('Pachet Start');
	});

	it('serviciile fără override păstrează numele standard al pachetului', () => {
		expect(tierLabelFor(getCategory('google-ads'), 'bronze', TIER_LABELS)).toBe('Bronze');
		expect(tierLabelFor(getCategory('google-ads'), 'platinum', TIER_LABELS)).toBe('Platinum');
	});

	it('fără categorie → eticheta implicită', () => {
		expect(tierLabelFor(null, 'silver', TIER_LABELS)).toBe('Silver');
		expect(tierLabelFor(undefined, 'gold', TIER_LABELS)).toBe('Gold');
	});

	it('override parțial: tier-urile nedefinite cad pe implicit', () => {
		expect(tierLabelFor({ tierLabels: { bronze: 'Start' } }, 'silver', TIER_LABELS)).toBe('Silver');
	});
});
