/**
 * Sumarul unei cereri de ofertă multi-serviciu (coșul de pe /servicii).
 *
 * Modul PUR, fără import de valori din `ots-catalog`: categoriile vin prin
 * argument, fiindcă pe pagina publică ajung în browser doar prin `load`, după
 * parolă. Același modul rulează și pe server (în `submitPublicQuoteRequest`),
 * ca discountul salvat să fie exact cel afișat.
 *
 * Regulile de discount sunt cele din `BUNDLE_TIERS_RULE`: se aplică pe suma
 * abonamentelor lunare (nu pe setup, nu pe bugetul media). Numărul de servicii
 * include și serviciile setup-only (ex. website), la fel ca în wizard
 * (`calculateCost` din wizard-engine).
 */

import type { Category, Tier } from '$lib/constants/ots-catalog';

export type QuoteItem = { categorySlug: string; tier: Tier };

export type DiscountRule = { minServices: number; discountPct: number };

/** Subsetul din `Category` de care are nevoie calculul — ușor de construit în teste. */
export type QuoteCategory = Pick<Category, 'slug' | 'name' | 'prices' | 'setupFees'>;

export type QuoteLine = {
	categorySlug: string;
	name: string;
	tier: Tier;
	monthlyEur: number | null;
	setupEur: number | null;
};

export type QuoteSummary = {
	lines: QuoteLine[];
	serviceCount: number;
	monthlySubtotal: number;
	discountPct: number;
	monthlyDiscount: number;
	monthlyTotal: number;
	setupTotal: number;
};

/** Cea mai mare reducere al cărei prag e atins; 0 sub primul prag. */
export function discountPctForCount(count: number, rules: DiscountRule[]): number {
	let best = 0;
	for (const rule of rules) {
		if (count >= rule.minServices && rule.discountPct > best) best = rule.discountPct;
	}
	return best;
}

export function computeQuoteSummary(
	items: QuoteItem[],
	categories: QuoteCategory[],
	rules: DiscountRule[]
): QuoteSummary {
	const bySlug = new Map(categories.map((c) => [c.slug, c]));

	const lines: QuoteLine[] = [];
	for (const item of items) {
		const cat = bySlug.get(item.categorySlug);
		if (!cat) continue;
		lines.push({
			categorySlug: cat.slug,
			name: cat.name,
			tier: item.tier,
			monthlyEur: cat.prices[item.tier] ?? null,
			setupEur: cat.setupFees?.[item.tier] ?? null
		});
	}

	const serviceCount = lines.length;
	const monthlySubtotal = lines.reduce((sum, l) => sum + (l.monthlyEur ?? 0), 0);
	const discountPct = discountPctForCount(serviceCount, rules);
	const monthlyTotal = Math.round((monthlySubtotal * (100 - discountPct)) / 100);
	const monthlyDiscount = monthlySubtotal - monthlyTotal;
	const setupTotal = lines.reduce((sum, l) => sum + (l.setupEur ?? 0), 0);

	return {
		lines,
		serviceCount,
		monthlySubtotal,
		discountPct,
		monthlyDiscount,
		monthlyTotal,
		setupTotal
	};
}

/** Un tier se poate cere doar dacă există ceva de oferit la el: preț lunar sau setup. */
export function isTierOffered(category: QuoteCategory, tier: Tier): boolean {
	return category.prices[tier] !== null || category.setupFees?.[tier] !== undefined;
}

/**
 * Tier-ul cu care un serviciu intră în coș din lista „Adaugă serviciu":
 * Silver (mijlocul ofertei, recomandat și în comparație) dacă e oferit, altfel
 * primul tier oferit în ordinea catalogului.
 */
export function defaultTierFor(category: QuoteCategory, tiers: Tier[]): Tier | null {
	if (tiers.includes('silver') && isTierOffered(category, 'silver')) return 'silver';
	return tiers.find((t) => isTierOffered(category, t)) ?? null;
}

/**
 * Tier-ul cu care un serviciu intră în coș când vine cu o preferință (ex. tier-ul
 * recomandat de wizard pentru tot bundle-ul): preferința dacă e oferită, altfel
 * tier-ul implicit. Fără asta, „Google Ads Setup" (doar Bronze) ar ajunge în coș
 * la Gold și serverul ar respinge cererea.
 */
export function resolveOfferedTier(
	category: QuoteCategory,
	preferred: Tier,
	tiers: Tier[]
): Tier | null {
	return isTierOffered(category, preferred) ? preferred : defaultTierFor(category, tiers);
}
