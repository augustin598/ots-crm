/**
 * Operațiile pe coșul de servicii de pe /servicii — funcții pure pe liste
 * imutabile, ca să fie testabile cu bun fără runtime Svelte. Starea reactivă și
 * persistența stau în `services-cart.svelte.ts`, care doar le apelează.
 *
 * Invariant: un serviciu (slug) apare o singură dată în coș, cu un singur tier.
 */

import type { Tier } from '$lib/constants/ots-catalog';
import type { QuoteItem } from '$lib/logic/quote-pricing';

/** Versionată: dacă forma itemelor se schimbă, schimbăm sufixul și sesiunile vechi se ignoră. */
export const CART_STORAGE_KEY = 'ots-servicii-cart:v1';

export function upsertItem(items: QuoteItem[], categorySlug: string, tier: Tier): QuoteItem[] {
	const idx = items.findIndex((i) => i.categorySlug === categorySlug);
	if (idx === -1) return [...items, { categorySlug, tier }];
	return items.map((i, n) => (n === idx ? { categorySlug, tier } : i));
}

export function removeItem(items: QuoteItem[], categorySlug: string): QuoteItem[] {
	return items.filter((i) => i.categorySlug !== categorySlug);
}

/** Același tier = scoate din coș; alt tier = înlocuiește; slug nou = adaugă. */
export function toggleItem(items: QuoteItem[], categorySlug: string, tier: Tier): QuoteItem[] {
	const existing = items.find((i) => i.categorySlug === categorySlug);
	if (existing && existing.tier === tier) return removeItem(items, categorySlug);
	return upsertItem(items, categorySlug, tier);
}

export function serializeCart(items: QuoteItem[]): string {
	return JSON.stringify(items);
}

/**
 * Citește o sesiune salvată, tolerant: JSON stricat sau intrări care nu mai
 * există în catalog (slug/tier) se ignoră, fără să pice pagina. `isValid` vine
 * de la apelant fiindcă acest modul nu are voie să importe catalogul.
 */
export function parseStoredCart(
	raw: string | null,
	isValid: (categorySlug: string, tier: string) => boolean
): QuoteItem[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const out: QuoteItem[] = [];
	const seen = new Set<string>();
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') continue;
		const { categorySlug, tier } = entry as Record<string, unknown>;
		if (typeof categorySlug !== 'string' || typeof tier !== 'string') continue;
		if (seen.has(categorySlug) || !isValid(categorySlug, tier)) continue;
		seen.add(categorySlug);
		out.push({ categorySlug, tier: tier as Tier });
	}
	return out;
}
