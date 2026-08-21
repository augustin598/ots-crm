import { describe, it, expect } from 'bun:test';
import {
	CART_STORAGE_KEY,
	parseStoredCart,
	removeItem,
	serializeCart,
	toggleItem,
	upsertItem
} from '../cart-logic';

const isValid = (slug: string, tier: string) =>
	['google-ads', 'seo'].includes(slug) && ['bronze', 'silver', 'gold', 'platinum'].includes(tier);

describe('upsertItem', () => {
	it('adaugă un serviciu nou la final', () => {
		const next = upsertItem([{ categorySlug: 'seo', tier: 'bronze' }], 'google-ads', 'gold');
		expect(next).toEqual([
			{ categorySlug: 'seo', tier: 'bronze' },
			{ categorySlug: 'google-ads', tier: 'gold' }
		]);
	});
	it('înlocuiește tier-ul unui serviciu existent, păstrând poziția', () => {
		const next = upsertItem(
			[
				{ categorySlug: 'seo', tier: 'bronze' },
				{ categorySlug: 'google-ads', tier: 'gold' }
			],
			'seo',
			'platinum'
		);
		expect(next).toEqual([
			{ categorySlug: 'seo', tier: 'platinum' },
			{ categorySlug: 'google-ads', tier: 'gold' }
		]);
	});
	it('nu mută lista originală', () => {
		const original = [{ categorySlug: 'seo', tier: 'bronze' as const }];
		upsertItem(original, 'seo', 'gold');
		expect(original[0].tier).toBe('bronze');
	});
});

describe('removeItem / toggleItem', () => {
	it('removeItem scoate serviciul; necunoscut = no-op', () => {
		const items = [
			{ categorySlug: 'seo', tier: 'bronze' as const },
			{ categorySlug: 'google-ads', tier: 'gold' as const }
		];
		expect(removeItem(items, 'seo')).toEqual([{ categorySlug: 'google-ads', tier: 'gold' }]);
		expect(removeItem(items, 'nope')).toEqual(items);
	});
	it('toggle pe același tier scoate, pe alt tier înlocuiește, pe slug nou adaugă', () => {
		const base = [{ categorySlug: 'seo', tier: 'bronze' as const }];
		expect(toggleItem(base, 'seo', 'bronze')).toEqual([]);
		expect(toggleItem(base, 'seo', 'gold')).toEqual([{ categorySlug: 'seo', tier: 'gold' }]);
		expect(toggleItem(base, 'google-ads', 'silver')).toEqual([
			{ categorySlug: 'seo', tier: 'bronze' },
			{ categorySlug: 'google-ads', tier: 'silver' }
		]);
	});
});

describe('parseStoredCart', () => {
	it('citește o sesiune salvată și aruncă intrările invalide', () => {
		const raw = JSON.stringify([
			{ categorySlug: 'seo', tier: 'gold' },
			{ categorySlug: 'tiktok-ads', tier: 'gold' }, // slug necunoscut
			{ categorySlug: 'google-ads', tier: 'diamond' }, // tier necunoscut
			{ categorySlug: 'google-ads', tier: 'silver' },
			{ categorySlug: 'google-ads', tier: 'bronze' }, // duplicat → rămâne primul
			'garbage',
			null
		]);
		expect(parseStoredCart(raw, isValid)).toEqual([
			{ categorySlug: 'seo', tier: 'gold' },
			{ categorySlug: 'google-ads', tier: 'silver' }
		]);
	});
	it('JSON stricat, null sau non-array → coș gol', () => {
		expect(parseStoredCart('{not json', isValid)).toEqual([]);
		expect(parseStoredCart(null, isValid)).toEqual([]);
		expect(parseStoredCart('{"a":1}', isValid)).toEqual([]);
	});
	it('serializeCart ↔ parseStoredCart', () => {
		const items = [{ categorySlug: 'seo', tier: 'gold' as const }];
		expect(parseStoredCart(serializeCart(items), isValid)).toEqual(items);
	});
	it('cheia de stocare e versionată', () => {
		expect(CART_STORAGE_KEY).toBe('ots-servicii-cart:v1');
	});
});
