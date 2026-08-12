import { describe, it, expect } from 'bun:test';
import {
	CATEGORIES,
	CATEGORY_GROUPS,
	TIERS,
	getCategory,
	getCategoriesInGroup
} from '$lib/constants/ots-catalog';

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

describe('grupul Organic, SEO & AI Search', () => {
	it('conține exact seo + aeo-geo, în ordinea asta', () => {
		const group = CATEGORY_GROUPS.find((g) => g.id === 'organic');
		expect(group).toBeDefined();
		expect(group!.label).toBe('Organic, SEO & AI Search');
		expect(group!.slugs).toEqual(['seo', 'aeo-geo']);
	});

	it('getCategoriesInGroup întoarce ambele categorii rezolvate', () => {
		const cats = getCategoriesInGroup('organic');
		expect(cats.map((c) => c.slug)).toEqual(['seo', 'aeo-geo']);
	});

	it('fiecare slug din fiecare grup există în CATEGORIES', () => {
		const known = new Set(CATEGORIES.map((c) => c.slug));
		for (const group of CATEGORY_GROUPS) {
			for (const slug of group.slugs) {
				expect(known.has(slug)).toBe(true);
			}
		}
	});

	it('fiecare categorie apare în exact un grup', () => {
		const grouped = CATEGORY_GROUPS.flatMap((g) => g.slugs);
		expect(new Set(grouped).size).toBe(grouped.length);
		expect(grouped.length).toBe(CATEGORIES.length);
	});
});

describe('SEO fără suprapunere pe AI', () => {
	it('nu mai conține feature-ul AI Overviews / SGE', () => {
		const seo = getCategory('seo')!;
		expect(seo.features.find((f) => f.id === 'seo-22')).toBeUndefined();
		expect(seo.features.some((f) => f.label.includes('AI Overviews'))).toBe(false);
	});

	it('trimite explicit către AEO & GEO în note', () => {
		const seo = getCategory('seo')!;
		expect(seo.notes?.some((n) => n.includes('AEO & GEO'))).toBe(true);
	});

	it('păstrează prețurile neschimbate', () => {
		expect(getCategory('seo')!.prices).toEqual({
			bronze: 500,
			silver: 700,
			gold: 950,
			platinum: 1400
		});
	});
});
