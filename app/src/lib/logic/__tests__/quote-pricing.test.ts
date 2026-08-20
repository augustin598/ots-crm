import { describe, it, expect } from 'bun:test';
import {
	computeQuoteSummary,
	defaultTierFor,
	discountPctForCount,
	isTierOffered,
	type QuoteCategory
} from '../quote-pricing';

const RULES = [
	{ minServices: 2, discountPct: 10 },
	{ minServices: 3, discountPct: 15 },
	{ minServices: 4, discountPct: 20 }
];

const ads: QuoteCategory = {
	slug: 'google-ads',
	name: 'Google Ads',
	prices: { bronze: 500, silver: 700, gold: 900, platinum: 1200 },
	setupFees: { bronze: 500, silver: 500, gold: 500, platinum: 500 }
};
const seo: QuoteCategory = {
	slug: 'seo',
	name: 'SEO',
	prices: { bronze: 400, silver: 600, gold: 800, platinum: 1100 }
};
const social: QuoteCategory = {
	slug: 'social',
	name: 'Social',
	prices: { bronze: 300, silver: 450, gold: 650, platinum: 900 }
};
// Web dev: fără abonament lunar, doar setup one-time (și nu pe toate tier-urile).
const web: QuoteCategory = {
	slug: 'web-dev',
	name: 'Website',
	prices: { bronze: null, silver: null, gold: null, platinum: null },
	setupFees: { silver: 1500, gold: 3000 }
};
const CATS = [ads, seo, social, web];

describe('discountPctForCount', () => {
	it('0 sub pragul minim, apoi cea mai mare regulă atinsă', () => {
		expect(discountPctForCount(0, RULES)).toBe(0);
		expect(discountPctForCount(1, RULES)).toBe(0);
		expect(discountPctForCount(2, RULES)).toBe(10);
		expect(discountPctForCount(3, RULES)).toBe(15);
		expect(discountPctForCount(4, RULES)).toBe(20);
		expect(discountPctForCount(9, RULES)).toBe(20);
	});
	it('nu depinde de ordinea regulilor', () => {
		expect(discountPctForCount(3, [...RULES].reverse())).toBe(15);
	});
});

describe('computeQuoteSummary', () => {
	it('un singur serviciu: fără discount', () => {
		const s = computeQuoteSummary([{ categorySlug: 'google-ads', tier: 'bronze' }], CATS, RULES);
		expect(s.serviceCount).toBe(1);
		expect(s.monthlySubtotal).toBe(500);
		expect(s.discountPct).toBe(0);
		expect(s.monthlyDiscount).toBe(0);
		expect(s.monthlyTotal).toBe(500);
		expect(s.setupTotal).toBe(500);
		expect(s.lines[0]).toEqual({
			categorySlug: 'google-ads',
			name: 'Google Ads',
			tier: 'bronze',
			monthlyEur: 500,
			setupEur: 500
		});
	});

	it('tier-uri diferite per serviciu, discount pe suma lunară', () => {
		const s = computeQuoteSummary(
			[
				{ categorySlug: 'google-ads', tier: 'gold' },
				{ categorySlug: 'seo', tier: 'bronze' }
			],
			CATS,
			RULES
		);
		expect(s.monthlySubtotal).toBe(1300);
		expect(s.discountPct).toBe(10);
		expect(s.monthlyDiscount).toBe(130);
		expect(s.monthlyTotal).toBe(1170);
		expect(s.setupTotal).toBe(500);
	});

	it('3 și 4 servicii → 15 % și 20 %', () => {
		const three = computeQuoteSummary(
			[
				{ categorySlug: 'google-ads', tier: 'bronze' },
				{ categorySlug: 'seo', tier: 'bronze' },
				{ categorySlug: 'social', tier: 'bronze' }
			],
			CATS,
			RULES
		);
		expect(three.discountPct).toBe(15);
		expect(three.monthlyTotal).toBe(1020); // 1200 − 15 %

		const four = computeQuoteSummary(
			[
				{ categorySlug: 'google-ads', tier: 'bronze' },
				{ categorySlug: 'seo', tier: 'bronze' },
				{ categorySlug: 'social', tier: 'bronze' },
				{ categorySlug: 'web-dev', tier: 'silver' }
			],
			CATS,
			RULES
		);
		expect(four.serviceCount).toBe(4);
		expect(four.discountPct).toBe(20);
	});

	it('serviciul setup-only contează la număr, dar nu intră în suma lunară', () => {
		const s = computeQuoteSummary(
			[
				{ categorySlug: 'seo', tier: 'silver' },
				{ categorySlug: 'web-dev', tier: 'gold' }
			],
			CATS,
			RULES
		);
		expect(s.serviceCount).toBe(2);
		expect(s.monthlySubtotal).toBe(600);
		expect(s.discountPct).toBe(10);
		expect(s.monthlyTotal).toBe(540);
		expect(s.setupTotal).toBe(3000);
		expect(s.lines[1].monthlyEur).toBeNull();
		expect(s.lines[1].setupEur).toBe(3000);
	});

	it('rotunjește la întreg', () => {
		const s = computeQuoteSummary(
			[
				{ categorySlug: 'seo', tier: 'bronze' }, // 405
				{ categorySlug: 'social', tier: 'bronze' } // 300
			],
			[{ ...seo, prices: { ...seo.prices, bronze: 405 } }, social],
			RULES
		);
		// 705 × 0.9 = 634.5 → 635 (Math.round), discount = 70
		expect(s.monthlyTotal).toBe(635);
		expect(s.monthlyDiscount).toBe(70);
	});

	it('ignoră slug-urile necunoscute și păstrează ordinea', () => {
		const s = computeQuoteSummary(
			[
				{ categorySlug: 'nope', tier: 'gold' },
				{ categorySlug: 'seo', tier: 'gold' }
			],
			CATS,
			RULES
		);
		expect(s.lines.map((l) => l.categorySlug)).toEqual(['seo']);
		expect(s.serviceCount).toBe(1);
	});

	it('coș gol → totul zero', () => {
		const s = computeQuoteSummary([], CATS, RULES);
		expect(s).toEqual({
			lines: [],
			serviceCount: 0,
			monthlySubtotal: 0,
			discountPct: 0,
			monthlyDiscount: 0,
			monthlyTotal: 0,
			setupTotal: 0
		});
	});
});

describe('isTierOffered / defaultTierFor', () => {
	it('un tier e oferit dacă are preț lunar SAU setup', () => {
		expect(isTierOffered(ads, 'bronze')).toBe(true);
		expect(isTierOffered(web, 'bronze')).toBe(false);
		expect(isTierOffered(web, 'silver')).toBe(true);
	});
	it('tier implicit: Silver dacă e oferit, altfel primul oferit, altfel null', () => {
		const TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const;
		expect(defaultTierFor(ads, [...TIERS])).toBe('silver');
		expect(defaultTierFor({ ...web, setupFees: { gold: 3000 } }, [...TIERS])).toBe('gold');
		expect(defaultTierFor({ ...web, setupFees: {} }, [...TIERS])).toBeNull();
	});
});
