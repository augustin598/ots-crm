import { describe, it, expect } from 'bun:test';
import { CATEGORIES, TIERS, getCategory } from '$lib/constants/ots-catalog';

describe('serviciul AEO & GEO', () => {
	it('există în catalog cu grila de preț decisă', () => {
		const cat = getCategory('aeo-geo');
		expect(cat).toBeDefined();
		expect(cat!.name).toBe('AEO & GEO');
		expect(cat!.prices).toEqual({ bronze: 350, silver: 500, gold: 750, platinum: 1100 });
	});

	it('are setup 400 € pe toate palierele', () => {
		const cat = getCategory('aeo-geo')!;
		for (const tier of TIERS) {
			expect(cat.setupFees?.[tier]).toBe(400);
		}
	});

	it('are toate feature-urile definite pe toate cele 4 paliere', () => {
		const cat = getCategory('aeo-geo')!;
		expect(cat.features.length).toBeGreaterThanOrEqual(20);
		for (const feat of cat.features) {
			for (const tier of TIERS) {
				expect(feat.values[tier]).toBeDefined();
			}
		}
	});

	it('nu are ID-uri de feature duplicate', () => {
		const ids = getCategory('aeo-geo')!.features.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('nu introduce sluguri duplicate în catalog', () => {
		const slugs = CATEGORIES.map((c) => c.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});
