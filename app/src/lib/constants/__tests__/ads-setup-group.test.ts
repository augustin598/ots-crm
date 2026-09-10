import { describe, it, expect } from 'bun:test';
import { CATEGORY_GROUPS, getCategoriesInGroup, getCategory, TIER_LABELS } from '$lib/constants/ots-catalog';
import { FEATURE_HINTS } from '$lib/constants/ots-catalog-feature-hints';
import { tierLabelFor } from '$lib/constants/ots-catalog-format';

const SETUP_SLUGS = ['google-ads-setup', 'meta-ads-setup', 'tiktok-ads-setup'];

/**
 * Tab separat pentru implementările one-time (cerere 10 sep 2026): cele trei
 * setup-uri stau împreună, la același preț, toate ca „Pachet Start".
 */
describe('grupul Setup & Implementare Ads', () => {
	it('există ca tab propriu, cu cele trei setup-uri', () => {
		const group = CATEGORY_GROUPS.find((g) => g.id === 'ads-setup');
		expect(group).toBeDefined();
		expect(group!.slugs).toEqual(SETUP_SLUGS);
		expect(getCategoriesInGroup('ads-setup').map((c) => c.slug)).toEqual(SETUP_SLUGS);
	});

	it('setup-urile nu mai apar în tab-ul de promovare plătită', () => {
		const paid = CATEGORY_GROUPS.find((g) => g.id === 'paid-ads')!;
		expect(paid.slugs).toEqual(['google-ads', 'meta-ads', 'tiktok-ads']);
	});

	it('fiecare slug apare într-un singur grup', () => {
		const all = CATEGORY_GROUPS.flatMap((g) => g.slugs);
		expect(all.length).toBe(new Set(all).size);
	});

	for (const slug of SETUP_SLUGS) {
		describe(slug, () => {
			it('costă 700 € one-time, fără abonament lunar', () => {
				const cat = getCategory(slug)!;
				expect(cat.setupFees?.bronze).toBe(700);
				expect(Object.values(cat.prices).every((p) => p === null)).toBe(true);
			});

			it('se vinde ca „Pachet Start"', () => {
				expect(tierLabelFor(getCategory(slug), 'bronze', TIER_LABELS)).toBe('Pachet Start');
			});

			it('are descriere pentru fiecare funcționalitate', () => {
				const missing = getCategory(slug)!.features.filter((f) => !FEATURE_HINTS[f.id]);
				expect(missing.map((f) => f.id)).toEqual([]);
			});

			it('include crearea contului și acordarea accesului', () => {
				const labels = getCategory(slug)!.features.map((f) => f.label.toLowerCase());
				expect(labels.some((l) => l.includes('creare cont') || l.includes('business'))).toBe(true);
				expect(labels.some((l) => l.includes('acces'))).toBe(true);
			});
		});
	}
});
