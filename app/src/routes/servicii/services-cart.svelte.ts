/**
 * Starea coșului de servicii (reactivă) + persistență în `sessionStorage`.
 *
 * De ce sessionStorage și nu localStorage: coșul e legat de vizita curentă
 * (parola porții stă în cookie 30 de zile, dar o ofertă începută azi nu trebuie
 * să reapară peste o lună). Trebuie însă să supraviețuiască navigării
 * /servicii ↔ /servicii/configurator și unui refresh.
 *
 * `load()` se apelează din componentă DUPĂ montare (nu în constructor), ca
 * prima randare pe client să fie identică cu cea de pe server — altfel
 * hidratarea ar găsi bara de coș acolo unde serverul n-a pus nimic.
 */

import type { Tier } from '$lib/constants/ots-catalog';
import type { QuoteItem } from '$lib/logic/quote-pricing';
import {
	CART_STORAGE_KEY,
	parseStoredCart,
	removeItem,
	serializeCart,
	toggleItem,
	upsertItem
} from './cart-logic';

export class ServicesCart {
	items = $state<QuoteItem[]>([]);

	get count(): number {
		return this.items.length;
	}

	tierOf(categorySlug: string): Tier | null {
		return this.items.find((i) => i.categorySlug === categorySlug)?.tier ?? null;
	}

	has(categorySlug: string, tier?: Tier): boolean {
		const current = this.tierOf(categorySlug);
		return current !== null && (tier === undefined || current === tier);
	}

	set(categorySlug: string, tier: Tier): void {
		this.items = upsertItem(this.items, categorySlug, tier);
		this.persist();
	}

	remove(categorySlug: string): void {
		this.items = removeItem(this.items, categorySlug);
		this.persist();
	}

	toggle(categorySlug: string, tier: Tier): void {
		this.items = toggleItem(this.items, categorySlug, tier);
		this.persist();
	}

	clear(): void {
		this.items = [];
		this.persist();
	}

	load(isValid: (categorySlug: string, tier: string) => boolean): void {
		const storage = getStorage();
		if (!storage) return;
		let raw: string | null = null;
		try {
			raw = storage.getItem(CART_STORAGE_KEY);
		} catch {
			// Safari privat / storage blocat: pornim cu coș gol.
		}
		this.items = parseStoredCart(raw, isValid);
	}

	private persist(): void {
		const storage = getStorage();
		if (!storage) return;
		try {
			if (this.items.length === 0) storage.removeItem(CART_STORAGE_KEY);
			else storage.setItem(CART_STORAGE_KEY, serializeCart(this.items));
		} catch {
			// Cota depășită sau storage blocat — coșul rămâne în memorie.
		}
	}
}

function getStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}
