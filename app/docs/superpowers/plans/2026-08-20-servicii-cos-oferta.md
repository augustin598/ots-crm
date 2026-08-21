# /servicii — coș de servicii + cerere de ofertă în 3 pași — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pe pagina publică `/servicii`, vizitatorul adaugă mai multe servicii (fiecare cu tier-ul lui) într-un coș și trimite o singură cerere de ofertă printr-un modal în 3 pași (Servicii → Date contact → Solicită oferta), cu discountul multi-servicii calculat în sumar.

**Architecture:** Logica pură (preț/discount, operații pe coș) stă în module `.ts` testate cu bun; starea reactivă e o clasă mică în `services-cart.svelte.ts` persistată în `sessionStorage`. Modalul refolosește `checkout-modal-shell.svelte` (coaja vizuală din `/pachete-hosting`) cu stiluri locale `sq-*` copiate din modalul de hosting. Backend: un command nou `submitPublicQuoteRequest` care scrie **un singur rând** `service_package_request` cu coloană nouă `items` (JSON cu tier + snapshot preț per serviciu) și `discount_pct`.

**Tech Stack:** SvelteKit 5 (runes), Bun, TypeScript, Drizzle + Turso (libSQL), valibot, `bun run test` (proces per fișier).

**Spec:** `app/docs/superpowers/specs/2026-08-20-servicii-cos-oferta-design.md`

**Reguli de proiect care se aplică:**
- Branch: `feat/wizard-public` (NU main). Working tree-ul are deja modificări necomise ale userului în `PackageWizard.svelte`, `ServicesCatalog.svelte`, `.hostedignore` — nu le include în commit-urile tale decât fișierele pe care le modifici tu (folosește `git add <căi exacte>`). `ServicesCatalog.svelte` îl modifici tu → îl adaugi întreg (include restilizarea userului; e OK, e pe același branch).
- Teste: `bun run test <filtru>` din `app/`, NICIODATĂ `bun test`.
- Migrații: un singur statement per fișier; intrare în `drizzle/meta/_journal.json`; aplică migrația ÎNAINTE de a adăuga coloana în `schema.ts` (`db.select()` fără coloană = crash pe prod; DB dev = DB prod).
- Fișierele de client din `src/routes/servicii/**` NU importă valori din `$lib/constants/ots-catalog` (doar `import type`) — testul `no-price-leak.test.ts` pică altfel.
- Comentariile în cod: română, explică „de ce", nu „ce".

---

## File structure

| Fișier | Responsabilitate |
|---|---|
| `app/drizzle/0452_service_package_request_items.sql` (create) | `ADD items text` |
| `app/drizzle/0453_service_package_request_discount_pct.sql` (create) | `ADD discount_pct integer` |
| `app/drizzle/meta/_journal.json` (modify) | intrările 452, 453 |
| `app/src/lib/server/db/schema.ts:2295-2323` (modify) | coloanele `items`, `discountPct` |
| `app/src/lib/logic/quote-pricing.ts` (create) | pur: sumar ofertă (linii, discount, totaluri), tier oferit, tier implicit |
| `app/src/lib/logic/__tests__/quote-pricing.test.ts` (create) | |
| `app/src/routes/servicii/cart-logic.ts` (create) | pur: upsert/remove/toggle/parse/serialize pe lista de iteme |
| `app/src/routes/servicii/__tests__/cart-logic.test.ts` (create) | |
| `app/src/routes/servicii/services-cart.svelte.ts` (create) | clasa `ServicesCart` (`$state` + sessionStorage) peste `cart-logic.ts` |
| `app/src/lib/remotes/public-services.remote.ts` (modify) | `submitPublicQuoteRequest` + helper comun de gardă |
| `app/src/lib/remotes/__tests__/public-services.remote.test.ts` (modify) | cazuri pentru command-ul nou |
| `app/src/lib/components/checkout-modal-shell.svelte` (modify) | props `badgeText`, `ariaLabel`, `flush` |
| `app/src/routes/servicii/ServicesQuoteModal.svelte` (create) | modalul în 3 pași + sumar + confirmare |
| `app/src/lib/components/services/PackageComparisonView.svelte` (modify) | prop `activeTier` + `activeLabel` |
| `app/src/routes/servicii/ServicesCatalog.svelte` (modify) | coș, bară sticky, buton nav, montarea modalului |
| `app/src/routes/servicii/configurator/+page.svelte` (modify) | bundle → coș → modal |
| `app/src/routes/servicii/RequestQuoteDialog.svelte` (delete) | înlocuit de modal |
| `app/src/lib/remotes/packages.remote.ts:32-84` (modify) | returnează `items`, `discountPct` |
| `app/src/routes/[tenant]/services/+page.svelte:360-420` (modify) | afișare per-serviciu + discount |
| `app/src/lib/server/email.ts:3051-3215` (modify) | secțiunea „Servicii incluse" cu tier + preț + discount |
| `app/scripts/demo-package-request-email.ts` (modify) | fixture multi-serviciu |

---

### Task 1: Migrație — coloanele `items` și `discount_pct`

**Files:**
- Create: `app/drizzle/0452_service_package_request_items.sql`
- Create: `app/drizzle/0453_service_package_request_discount_pct.sql`
- Modify: `app/drizzle/meta/_journal.json` (la final, după intrarea 451)
- Modify (DUPĂ aplicare): `app/src/lib/server/db/schema.ts:2314` (după `companyName`)

- [ ] **Step 1: Creează fișierele SQL (un statement per fișier)**

`app/drizzle/0452_service_package_request_items.sql`:
```sql
ALTER TABLE `service_package_request` ADD `items` text;
```

`app/drizzle/0453_service_package_request_discount_pct.sql`:
```sql
ALTER TABLE `service_package_request` ADD `discount_pct` integer;
```

- [ ] **Step 2: Adaugă intrările în journal**

În `app/drizzle/meta/_journal.json`, după obiectul cu `"idx": 451` (ultimul din `entries`), adaugă:
```json
    {
      "idx": 452,
      "version": "6",
      "when": 1785398836928411,
      "tag": "0452_service_package_request_items",
      "breakpoints": true
    },
    {
      "idx": 453,
      "version": "6",
      "when": 1785398836928412,
      "tag": "0453_service_package_request_discount_pct",
      "breakpoints": true
    }
```
(`when` trebuie strict crescător față de 1785398836928410.)

- [ ] **Step 3: Verifică journal vs fișiere**

Run (din `app/`): `bun -e "const j=require('./drizzle/meta/_journal.json'); const fs=require('fs'); const missing=j.entries.filter(e=>!fs.existsSync('drizzle/'+e.tag+'.sql')).map(e=>e.tag); console.log('missing:',missing, 'last:', j.entries.at(-1).tag)"`
Expected: `missing: [] last: 0453_service_package_request_discount_pct`

- [ ] **Step 4: Aplică migrația pe Turso**

Run: `bun run db:migrate`
Expected: output drizzle-kit fără erori, cele 2 migrații aplicate.

- [ ] **Step 5: Verifică coloanele pe remote**

Run: `bun -e "
const { createClient } = require('@libsql/client');
const c = createClient({ url: process.env.SQLITE_URI, authToken: process.env.SQLITE_AUTH_TOKEN });
c.execute('PRAGMA table_info(service_package_request)').then(r => console.log(r.rows.map(x => x.name).join(', ')))"`
Expected: lista conține `items, discount_pct`.

- [ ] **Step 6: Adaugă coloanele în schema Drizzle**

În `app/src/lib/server/db/schema.ts`, după linia `companyName: text('company_name'),`:
```ts
	// Ofertă multi-serviciu de pe /servicii: JSON `[{ categorySlug, tier, monthlyEur, setupEur }]`.
	// Fiecare serviciu își are tier-ul lui (Google Ads Gold + SEO Bronze), iar prețurile sunt
	// snapshot — catalogul se schimbă în timp, cererea trebuie să arate ce a văzut clientul.
	// `categorySlug`/`tier`/`services` rămân populate cu pivotul și slug-urile, ca rândul să
	// fie citibil de codul existent (admin, email, portal).
	items: text('items'),
	// Discountul multi-servicii aplicat pe abonamentul lunar la momentul cererii (0–100).
	discountPct: integer('discount_pct'),
```

- [ ] **Step 7: Commit**

```bash
git add drizzle/0452_service_package_request_items.sql drizzle/0453_service_package_request_discount_pct.sql drizzle/meta/_journal.json src/lib/server/db/schema.ts
git commit -m "feat(servicii): coloanele items + discount_pct pe service_package_request"
```

---

### Task 2: `quote-pricing.ts` — sumarul ofertei (pur)

**Files:**
- Create: `app/src/lib/logic/quote-pricing.ts`
- Test: `app/src/lib/logic/__tests__/quote-pricing.test.ts`

- [ ] **Step 1: Scrie testele**

`app/src/lib/logic/__tests__/quote-pricing.test.ts`:
```ts
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
				{ categorySlug: 'seo', tier: 'bronze' }, // 400
				{ categorySlug: 'social', tier: 'bronze' } // 300 → 700 − 10 % = 630
			],
			[
				{ ...seo, prices: { ...seo.prices, bronze: 405 } },
				social
			],
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
```

- [ ] **Step 2: Rulează testul — trebuie să pice**

Run: `bun run test quote-pricing`
Expected: FAIL (modulul `../quote-pricing` nu există).

- [ ] **Step 3: Implementează modulul**

`app/src/lib/logic/quote-pricing.ts`:
```ts
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
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

Run: `bun run test quote-pricing`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logic/quote-pricing.ts src/lib/logic/__tests__/quote-pricing.test.ts
git commit -m "feat(servicii): quote-pricing — sumar ofertă multi-serviciu cu discount"
```

---

### Task 3: `cart-logic.ts` — operațiile pe coș (pur) + `ServicesCart` reactiv

**Files:**
- Create: `app/src/routes/servicii/cart-logic.ts`
- Test: `app/src/routes/servicii/__tests__/cart-logic.test.ts`
- Create: `app/src/routes/servicii/services-cart.svelte.ts`

- [ ] **Step 1: Scrie testele**

`app/src/routes/servicii/__tests__/cart-logic.test.ts`:
```ts
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
	it('rotunjește o sesiune salvată și aruncă intrările invalide', () => {
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
```

- [ ] **Step 2: Rulează testul — trebuie să pice**

Run: `bun run test cart-logic`
Expected: FAIL (modulul nu există).

- [ ] **Step 3: Implementează `cart-logic.ts`**

`app/src/routes/servicii/cart-logic.ts`:
```ts
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
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

Run: `bun run test cart-logic`
Expected: PASS.

- [ ] **Step 5: Scrie clasa reactivă**

`app/src/routes/servicii/services-cart.svelte.ts`:
```ts
/**
 * Starea coșului de servicii (reactivă) + persistență în `sessionStorage`.
 *
 * De ce sessionStorage și nu localStorage: coșul e legat de vizita curentă
 * (parola porții e în cookie de sesiune de 30 zile, dar o ofertă începută azi
 * nu trebuie să reapară peste o lună). Trebuie însă să supraviețuiască
 * navigării /servicii ↔ /servicii/configurator și unui refresh.
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
```

- [ ] **Step 6: Verifică testul anti-scurgere și commit**

Run: `bun run test no-price-leak`
Expected: PASS (ambele fișiere noi folosesc doar `import type` din ots-catalog).

```bash
git add src/routes/servicii/cart-logic.ts src/routes/servicii/__tests__/cart-logic.test.ts src/routes/servicii/services-cart.svelte.ts
git commit -m "feat(servicii): coșul de servicii — logică pură + stare reactivă persistată în sessionStorage"
```

---

### Task 4: `submitPublicQuoteRequest` — command-ul public multi-serviciu

**Files:**
- Modify: `app/src/lib/remotes/public-services.remote.ts`
- Test: `app/src/lib/remotes/__tests__/public-services.remote.test.ts`

- [ ] **Step 1: Adaugă testele pentru command-ul nou**

În `app/src/lib/remotes/__tests__/public-services.remote.test.ts`, schimbă linia de import:
```ts
const { submitPublicPackageRequest, submitPublicQuoteRequest } = await import(
	'../public-services.remote'
);
```
și adaugă la finalul fișierului:
```ts
// ─── submitPublicQuoteRequest (coș multi-serviciu) ────────────────────────────
const QUOTE_INPUT = {
	items: [
		{ categorySlug: 'google-ads', tier: 'gold' as const },
		{ categorySlug: 'seo', tier: 'bronze' as const }
	],
	contactName: 'Maria Ionescu',
	contactEmail: 'Maria@Example.RO',
	contactPhone: '0733 000 111',
	companyName: 'Maria SRL',
	note: 'Vrem să pornim în septembrie.'
};

describe('submitPublicQuoteRequest', () => {
	beforeEach(() => {
		insertedRows = [];
		insertShouldThrow = false;
		gate = { tenantId: 't1', row: { enabled: true } };
		rateLimitAllowed = true;
		rateLimitCalls.length = 0;
		notified.length = 0;
	});

	test('scrie UN rând cu pivot, services, items (snapshot preț) și discount', async () => {
		const result = await submitPublicQuoteRequest(QUOTE_INPUT);

		expect(result.success).toBe(true);
		expect(insertedRows).toHaveLength(1);
		const row = insertedRows[0];

		expect(row.tenantId).toBe('t1');
		expect(row.clientId).toBeNull();
		expect(row.source).toBe('public');
		expect(row.status).toBe('pending');
		// Pivotul = primul serviciu, ca admin/email/portal să poată citi rândul ca până acum.
		expect(row.categorySlug).toBe('google-ads');
		expect(row.tier).toBe('gold');
		expect(row.bundleId).toBeNull();
		expect(JSON.parse(row.services)).toEqual(['google-ads', 'seo']);

		const items = JSON.parse(row.items);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ categorySlug: 'google-ads', tier: 'gold' });
		expect(items[1]).toMatchObject({ categorySlug: 'seo', tier: 'bronze' });
		// Snapshot de preț: numere (sau null pentru setup-only), niciodată undefined.
		expect(typeof items[0].monthlyEur).toBe('number');
		expect('setupEur' in items[0]).toBe(true);
		// 2 servicii → regula de 10 % din catalog.
		expect(row.discountPct).toBe(10);

		expect(row.contactEmail).toBe('maria@example.ro');
		expect(row.contactName).toBe('Maria Ionescu');
		expect(row.companyName).toBe('Maria SRL');
		expect(row.note).toBe('Vrem să pornim în septembrie.');
		expect(notified).toEqual([{ tenantId: 't1', requestId: result.requestId }]);
	});

	test('un singur serviciu → services tot JSON, discount 0', async () => {
		await submitPublicQuoteRequest({ ...QUOTE_INPUT, items: [QUOTE_INPUT.items[1]] });
		const row = insertedRows[0];
		expect(JSON.parse(row.services)).toEqual(['seo']);
		expect(row.discountPct).toBe(0);
		expect(row.categorySlug).toBe('seo');
		expect(row.tier).toBe('bronze');
	});

	test('slug necunoscut → 400, nimic inserat', async () => {
		await expect(
			submitPublicQuoteRequest({
				...QUOTE_INPUT,
				items: [{ categorySlug: 'nu-exista', tier: 'gold' }]
			})
		).rejects.toMatchObject({ status: 400 });
		expect(insertedRows).toHaveLength(0);
	});

	test('același serviciu de două ori → 400', async () => {
		await expect(
			submitPublicQuoteRequest({
				...QUOTE_INPUT,
				items: [
					{ categorySlug: 'seo', tier: 'gold' },
					{ categorySlug: 'seo', tier: 'bronze' }
				]
			})
		).rejects.toMatchObject({ status: 400 });
		expect(insertedRows).toHaveLength(0);
	});

	test('tier neoferit pentru categorie (fără preț și fără setup) → 400', async () => {
		// Găsim din catalogul real o combinație (slug, tier) fără preț lunar și fără setup.
		const { CATEGORIES, TIERS } = await import('$lib/constants/ots-catalog');
		let combo: { categorySlug: string; tier: (typeof TIERS)[number] } | null = null;
		for (const c of CATEGORIES) {
			for (const t of TIERS) {
				if (c.prices[t] === null && c.setupFees?.[t] === undefined) {
					combo = { categorySlug: c.slug, tier: t };
					break;
				}
			}
			if (combo) break;
		}
		if (!combo) return; // catalogul nu are o astfel de combinație; nimic de verificat
		await expect(
			submitPublicQuoteRequest({ ...QUOTE_INPUT, items: [combo] })
		).rejects.toMatchObject({ status: 400 });
		expect(insertedRows).toHaveLength(0);
	});

	test('poarta închisă → 403', async () => {
		gate = null;
		await expect(submitPublicQuoteRequest(QUOTE_INPUT)).rejects.toMatchObject({ status: 403 });
		expect(insertedRows).toHaveLength(0);
	});

	test('rate limit depășit → 429, aceeași găleată ca formularul simplu', async () => {
		rateLimitAllowed = false;
		await expect(submitPublicQuoteRequest(QUOTE_INPUT)).rejects.toMatchObject({ status: 429 });
		expect(rateLimitCalls[0]).toEqual({ kind: 'public-services-request', ip: '10.0.0.7' });
		expect(insertedRows).toHaveLength(0);
	});

	test('INSERT eșuat → 500, fără notificare', async () => {
		insertShouldThrow = true;
		await expect(submitPublicQuoteRequest(QUOTE_INPUT)).rejects.toMatchObject({ status: 500 });
		expect(notified).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Rulează testul — trebuie să pice**

Run: `bun run test public-services`
Expected: FAIL (`submitPublicQuoteRequest` nu e exportat).

- [ ] **Step 3: Implementează command-ul + helperul comun**

În `app/src/lib/remotes/public-services.remote.ts`:

(a) Completează importurile:
```ts
import { BUNDLE_TIERS_RULE, CATEGORIES, getCategory, TIERS } from '$lib/constants/ots-catalog';
import { computeQuoteSummary, isTierOffered } from '$lib/logic/quote-pricing';
import type { RequestEvent } from '@sveltejs/kit';
```

(b) Înlocuiește blocul din `submitPublicPackageRequest` care face gate + ip + rateLimit (de la `const gate = await requireUnlockedPublicPage(...)` până la `throw error(429, ...)` inclusiv) cu un apel la helperul de mai jos, pe care îl adaugi ÎNAINTE de `export const submitPublicPackageRequest`:
```ts
/**
 * Garda comună a formularelor publice: poarta cu parolă + rate-limit per IP.
 * Ambele command-uri (serviciu simplu și ofertă multi-serviciu) împart aceeași
 * găleată — altfel un vizitator ar avea dublul limitei doar alternând formularele.
 */
async function guardPublicSubmission(event: RequestEvent): Promise<{ tenantId: string; ip: string }> {
	const gate = await requireUnlockedPublicPage(event, PUBLIC_SERVICES_PAGE_KEY);
	if (!gate) {
		throw error(403, 'Sesiunea a expirat. Reîncarcă pagina și introdu parola din nou.');
	}

	const ip =
		event.getClientAddress?.() ??
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';

	const rl = await rateLimit({
		kind: 'public-services-request',
		ip,
		limit: SUBMIT_LIMIT.limit,
		windowSec: SUBMIT_LIMIT.windowSec
	});
	if (!rl.allowed) {
		logWarning('packages', 'cerere ofertă publică rate-limited', {
			tenantId: gate.tenantId,
			metadata: { ip, count: rl.count }
		});
		throw error(429, 'Prea multe cereri trimise. Te rugăm să încerci din nou peste o oră.');
	}

	return { tenantId: gate.tenantId, ip };
}
```
În `submitPublicPackageRequest` corpul devine:
```ts
export const submitPublicPackageRequest = command(requestSchema, async (data) => {
	const event = getRequestEvent();
	const { tenantId } = await guardPublicSubmission(event);

	const category = getCategory(data.categorySlug);
	if (!category) {
		throw error(400, 'Serviciul selectat nu mai este disponibil.');
	}
	// ... restul neschimbat, cu `gate.tenantId` înlocuit peste tot de `tenantId`
```
și adaugă deasupra lui docblock-ul:
```ts
/**
 * @deprecated UI-ul public folosește `submitPublicQuoteRequest` (coș multi-serviciu).
 * Rămâne până se confirmă că nu mai există apelanți; se șterge într-un PR separat.
 */
```

(c) Adaugă schema și command-ul nou la finalul fișierului:
```ts
const quoteItemSchema = v.object({
	categorySlug: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
	tier: v.picklist(TIERS)
});

const quoteSchema = v.object({
	// Plafonul e generos (catalogul are ~15 categorii), dar există ca payload-ul
	// să nu poată fi umflat arbitrar.
	items: v.pipe(v.array(quoteItemSchema), v.minLength(1), v.maxLength(20)),
	contactName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
	contactEmail: v.pipe(v.string(), v.trim(), v.maxLength(255), v.regex(EMAIL_REGEX)),
	contactPhone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	companyName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)))
});

/**
 * Cerere de ofertă pentru un coș de servicii (fiecare cu tier-ul lui).
 *
 * Un singur rând `service_package_request`:
 *  - `categorySlug`/`tier` = primul serviciu (pivot) și `services` = toate
 *    slug-urile — forma pe care o înțeleg deja admin-ul, emailul și portalul;
 *  - `items` = tier-ul și prețurile fiecărui serviciu la momentul cererii;
 *  - `discountPct` = calculat AICI, din aceleași reguli ca sumarul din browser,
 *    nu preluat din payload.
 */
export const submitPublicQuoteRequest = command(quoteSchema, async (data) => {
	const event = getRequestEvent();
	const { tenantId } = await guardPublicSubmission(event);

	const seen = new Set<string>();
	for (const item of data.items) {
		const category = getCategory(item.categorySlug);
		if (!category) {
			throw error(400, 'Unul dintre serviciile selectate nu mai este disponibil.');
		}
		if (!isTierOffered(category, item.tier)) {
			throw error(400, `Pachetul ales nu este disponibil pentru ${category.name}.`);
		}
		if (seen.has(item.categorySlug)) {
			throw error(400, 'Un serviciu apare de două ori în cerere.');
		}
		seen.add(item.categorySlug);
	}

	const summary = computeQuoteSummary(data.items, CATEGORIES, BUNDLE_TIERS_RULE);
	const pivot = data.items[0];
	const requestId = generateRequestId();

	try {
		await db.insert(table.servicePackageRequest).values({
			id: requestId,
			tenantId,
			clientId: null,
			clientUserId: null,
			categorySlug: pivot.categorySlug,
			bundleId: null,
			services: JSON.stringify(data.items.map((i) => i.categorySlug)),
			tier: pivot.tier,
			items: JSON.stringify(
				summary.lines.map((l) => ({
					categorySlug: l.categorySlug,
					tier: l.tier,
					monthlyEur: l.monthlyEur,
					setupEur: l.setupEur
				}))
			),
			discountPct: summary.discountPct,
			note: data.note || null,
			source: 'public',
			contactName: data.contactName,
			contactEmail: data.contactEmail.toLowerCase(),
			contactPhone: data.contactPhone || null,
			companyName: data.companyName || null,
			status: 'pending'
		});
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('packages', `cerere ofertă publică (coș): INSERT eșuat — ${message}`, {
			tenantId,
			stackTrace: stack,
			metadata: { items: data.items }
		});
		throw error(500, 'Nu am putut salva cererea. Te rugăm să încerci din nou.');
	}

	logInfo('packages', 'cerere ofertă publică (coș) primită', {
		tenantId,
		metadata: {
			requestId,
			serviceCount: summary.serviceCount,
			discountPct: summary.discountPct,
			contactEmail: data.contactEmail
		}
	});

	notifyAdminsOfPackageRequestInBackground(tenantId, requestId);

	return { success: true as const, requestId };
});
```

- [ ] **Step 4: Rulează testele — toate trebuie să treacă (și cele vechi)**

Run: `bun run test public-services`
Expected: PASS, 0 fail (vechile teste pentru `submitPublicPackageRequest` rămân verzi după refactor).

- [ ] **Step 5: Commit**

```bash
git add src/lib/remotes/public-services.remote.ts src/lib/remotes/__tests__/public-services.remote.test.ts
git commit -m "feat(servicii): submitPublicQuoteRequest — o cerere pentru un coș de servicii"
```

---

### Task 5: `checkout-modal-shell.svelte` — badge, aria-label și corp fără padding

**Files:**
- Modify: `app/src/lib/components/checkout-modal-shell.svelte`

- [ ] **Step 1: Adaugă props-urile**

Înlocuiește destructurarea de props cu:
```ts
	let {
		onClose,
		canClose = true,
		maxWidth = '560px',
		badgeText = 'Plată securizată · SSL 256-bit',
		ariaLabel = 'Plată cu cardul',
		flush = false,
		children,
		footer
	}: {
		onClose: () => void;
		canClose?: boolean;
		maxWidth?: string;
		/** Textul pastilei verzi din antet — modalul de ofertă nu e o plată. */
		badgeText?: string;
		ariaLabel?: string;
		/**
		 * Fără padding pe corp: modalul de ofertă își desenează singur coloana de
		 * sumar până la margine, ca în checkout-ul de hosting.
		 */
		flush?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();
```
Actualizează și docblock-ul de deasupra (un rând): „Folosită de plata facturilor și de modalul de ofertă /servicii."

- [ ] **Step 2: Folosește-le în markup**

- `aria-label="Plată cu cardul"` → `aria-label={ariaLabel}`
- `<span>Plată securizată · SSL 256-bit</span>` → `<span>{badgeText}</span>`
- `<div class="co-body">` → `<div class="co-body" class:co-body-flush={flush}>`

Și în `<style>`, după blocul `.co-body { ... }`:
```css
	.co-body.co-body-flush {
		padding: 0;
	}
```
(și în media query-ul de 480px nu e nevoie de nimic: `padding: 0` din clasa flush are aceeași specificitate + vine după, deci câștigă — verifică vizual la Task 10.)

- [ ] **Step 3: Verifică cu autofixer-ul Svelte**

Rulează `mcp__svelte__svelte-autofixer` pe conținutul fișierului. Expected: fără issues.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/checkout-modal-shell.svelte
git commit -m "refactor(checkout-shell): badge, aria-label și corp flush configurabile"
```

---

### Task 6: `PackageComparisonView.svelte` — evidențierea tier-ului aflat în coș

**Files:**
- Modify: `app/src/lib/components/services/PackageComparisonView.svelte`

- [ ] **Step 1: Props noi**

În `type Props` adaugă:
```ts
		/** Tier-ul deja ales pentru această categorie (în coșul de pe /servicii); butonul lui arată `activeLabel`. */
		activeTier?: Tier | null;
		activeLabel?: string;
```
și în destructurare: `activeTier = null, activeLabel = 'În ofertă ✓'`.

- [ ] **Step 2: Butonul**

Liniile ~128-136 (blocul `{#if onRequest} <Button ... onclick={() => onRequest(tier)}>`): înlocuiește eticheta și varianta:
```svelte
								{#if onRequest}
									{@const isActive = activeTier === tier}
									<Button
										size="sm"
										variant={isActive ? 'secondary' : 'default'}
										class="w-full mt-3"
										aria-pressed={isActive}
										onclick={() => onRequest(tier)}
									>
										{isActive ? activeLabel : requestLabel.replace('{tier}', tierLabels[tier])}
									</Button>
								{/if}
```
(păstrează orice alte atribute existente ale butonului — citește blocul înainte de a-l înlocui.)

- [ ] **Step 3: Autofixer + commit**

Rulează `svelte-autofixer` pe fișier; expected fără issues.
```bash
git add src/lib/components/services/PackageComparisonView.svelte
git commit -m "feat(services): PackageComparisonView — stare „în ofertă" pe tier-ul din coș"
```

---

### Task 7: `ServicesQuoteModal.svelte` — modalul în 3 pași

**Files:**
- Create: `app/src/routes/servicii/ServicesQuoteModal.svelte`

- [ ] **Step 1: Scrie componenta**

```svelte
<!--
	Modalul „Solicită oferta" de pe /servicii — coșul de servicii trimis ca o
	singură cerere, în 3 pași: Servicii → Date contact → Solicită oferta.

	Aceeași coajă ca checkout-ul din /pachete-hosting (`checkout-modal-shell`),
	cu stepper-ul și coloana de sumar reproduse aici cu clase locale `sq-*`
	(în modalul de hosting trăiesc ca `:global(.co-*)` într-un fișier de 3.500
	de linii; nu le importăm de acolo).

	Montat condiționat de părinte (`{#if open}`), deci fiecare deschidere pornește
	cu stare curată — nu e nevoie de {#key}.

	Nu importă valori din `ots-catalog`: catalogul vine prin props, de la `load`.
-->
<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import SendIcon from '@lucide/svelte/icons/send';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check-big';
	import CheckoutModalShell from '$lib/components/checkout-modal-shell.svelte';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import { formatEur } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier } from '$lib/constants/ots-catalog';
	import { computeQuoteSummary, defaultTierFor, isTierOffered } from '$lib/logic/quote-pricing';
	import { submitPublicQuoteRequest } from '$lib/remotes/public-services.remote';
	import type { ServicesCart } from './services-cart.svelte';
	import type { PublicCatalog } from './types';

	type Props = {
		cart: ServicesCart;
		catalog: PublicCatalog;
		/** Nota inițială din „Detalii despre proiect" (configuratorul o preîncarcă). */
		initialNote?: string;
		onClose: () => void;
	};

	let { cart, catalog, initialNote = '', onClose }: Props = $props();

	const STEPS = [
		{ n: 1, label: 'Servicii' },
		{ n: 2, label: 'Date contact' },
		{ n: 3, label: 'Solicită oferta' }
	] as const;

	let step = $state<1 | 2 | 3>(1);

	const bySlug = $derived(new Map(catalog.categories.map((c) => [c.slug, c])));
	const summary = $derived(
		computeQuoteSummary(cart.items, catalog.categories, catalog.discountRules)
	);
	const available = $derived(
		catalog.categories.filter((c) => !cart.has(c.slug) && defaultTierFor(c, catalog.tiers))
	);

	// ── Pas 2: contact ──
	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let companyName = $state('');
	let note = $state(initialNote);
	let touched = $state(false);

	const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const nameError = $derived(contactName.trim().length < 2 ? 'Scrie numele complet.' : null);
	const emailError = $derived(
		EMAIL_REGEX.test(contactEmail.trim()) ? null : 'Scrie o adresă de email validă.'
	);
	const contactValid = $derived(!nameError && !emailError);

	// ── Pas 3: trimitere ──
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let sent = $state(false);
	let sentTo = $state('');

	const canContinue = $derived(
		step === 1 ? summary.serviceCount > 0 : step === 2 ? contactValid : true
	);
	const footerHint = $derived(
		step === 1 && summary.serviceCount === 0
			? 'Alege cel puțin un serviciu.'
			: step === 2 && touched && !contactValid
				? (nameError ?? emailError)
				: null
	);

	function next() {
		if (step === 1 && summary.serviceCount === 0) return;
		if (step === 2) {
			touched = true;
			if (!contactValid) return;
		}
		if (step < 3) step = (step + 1) as 2 | 3;
	}
	function back() {
		if (step > 1) step = (step - 1) as 1 | 2;
	}

	function addCategory(cat: Category) {
		const tier = defaultTierFor(cat, catalog.tiers);
		if (tier) cart.set(cat.slug, tier);
	}

	async function submit() {
		if (submitting || summary.serviceCount === 0 || !contactValid) return;
		submitting = true;
		errorMessage = null;
		try {
			await submitPublicQuoteRequest({
				items: cart.items.map((i) => ({ categorySlug: i.categorySlug, tier: i.tier })),
				contactName: contactName.trim(),
				contactEmail: contactEmail.trim(),
				contactPhone: contactPhone.trim() || undefined,
				companyName: companyName.trim() || undefined,
				note: note.trim() || undefined
			});
			sentTo = contactEmail.trim();
			sent = true;
			cart.clear();
		} catch (err) {
			errorMessage =
				err instanceof Error && err.message
					? err.message
					: 'Nu am putut trimite cererea. Te rugăm să încerci din nou.';
		} finally {
			submitting = false;
		}
	}

	function tierLabel(t: Tier) {
		return catalog.tierLabels[t];
	}
</script>

<CheckoutModalShell
	{onClose}
	canClose={!submitting}
	maxWidth={sent ? '560px' : '980px'}
	badgeText="Cerere fără obligații"
	ariaLabel="Cerere de ofertă"
	flush={!sent}
>
	{#if sent}
		<div class="sq-success">
			<CheckCircleIcon class="sq-success-icon" />
			<h2>Cererea a fost trimisă</h2>
			<p>
				Am înregistrat oferta pentru <strong>{summary.serviceCount || ''}</strong>
				serviciile alese. Echipa One Top Solution te contactează pe
				<strong>{sentTo}</strong> în cel mai scurt timp.
			</p>
			<button type="button" class="sq-btn-primary" onclick={onClose}>Închide</button>
		</div>
	{:else}
		<div class="sq-stepper" aria-label="Pașii cererii">
			{#each STEPS as s, i (s.n)}
				<div
					class="sq-step"
					class:active={step === s.n}
					class:done={step > s.n}
					aria-current={step === s.n ? 'step' : undefined}
				>
					<div class="sq-step-circle">
						{#if step > s.n}
							<CheckIcon size={14} />
						{:else if s.n === 1}
							<LayersIcon size={14} />
						{:else if s.n === 2}
							<UserIcon size={14} />
						{:else}
							<SendIcon size={14} />
						{/if}
					</div>
					<div class="sq-step-label">
						<div class="sq-step-num">Pas {s.n}</div>
						<div>{s.label}</div>
					</div>
				</div>
				{#if i < STEPS.length - 1}
					<div class="sq-step-line" class:done={step > s.n}></div>
				{/if}
			{/each}
		</div>

		<div class="sq-layout">
			<div class="sq-content">
				{#if step === 1}
					<h2 class="sq-h2">Alege serviciile</h2>
					<p class="sq-sub">
						Fiecare serviciu are pachetul lui — combină-le cum ai nevoie. Discountul se aplică
						automat pe abonamentul lunar când alegi două sau mai multe.
					</p>

					{#if summary.lines.length === 0}
						<div class="sq-empty">Coșul e gol. Adaugă un serviciu din lista de mai jos.</div>
					{:else}
						<ul class="sq-items">
							{#each summary.lines as line (line.categorySlug)}
								{@const cat = bySlug.get(line.categorySlug)}
								<li class="sq-item">
									<div class="sq-item-head">
										<span class="sq-item-icon"><CategoryIcon slug={line.categorySlug} class="h-4 w-4" /></span>
										<div class="sq-item-name">
											<strong>{line.name}</strong>
											<span>
												{#if line.monthlyEur !== null}
													{formatEur(line.monthlyEur)}/lună
													{#if line.setupEur}· setup {formatEur(line.setupEur)}{/if}
												{:else if line.setupEur}
													{formatEur(line.setupEur)} one-time
												{/if}
											</span>
										</div>
										<button
											type="button"
											class="sq-remove"
											aria-label={`Scoate ${line.name} din ofertă`}
											onclick={() => cart.remove(line.categorySlug)}
										>
											<Trash2Icon size={14} />
										</button>
									</div>
									{#if cat}
										<div class="sq-segmented" role="group" aria-label={`Pachet pentru ${line.name}`}>
											{#each catalog.tiers as t (t)}
												{#if isTierOffered(cat, t)}
													<button
														type="button"
														class:active={line.tier === t}
														aria-pressed={line.tier === t}
														onclick={() => cart.set(line.categorySlug, t)}
													>
														<span class="sq-tierdot" data-tier={t}></span>
														{tierLabel(t)}
													</button>
												{/if}
											{/each}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if available.length > 0}
						<h3 class="sq-h3">Adaugă alt serviciu</h3>
						<ul class="sq-add-list">
							{#each available as cat (cat.slug)}
								{@const tier = defaultTierFor(cat, catalog.tiers)}
								{@const monthly = tier ? cat.prices[tier] : null}
								{@const setup = tier ? (cat.setupFees?.[tier] ?? null) : null}
								<li>
									<button type="button" class="sq-add" onclick={() => addCategory(cat)}>
										<span class="sq-item-icon"><CategoryIcon slug={cat.slug} class="h-4 w-4" /></span>
										<span class="sq-add-name">
											<strong>{cat.name}</strong>
											<span>
												{#if tier}{tierLabel(tier)} ·{/if}
												{#if monthly !== null}{formatEur(monthly)}/lună{:else if setup}{formatEur(setup)} one-time{/if}
											</span>
										</span>
										<span class="sq-add-cta"><PlusIcon size={14} /> Adaugă</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else if step === 2}
					<h2 class="sq-h2">Datele tale de contact</h2>
					<p class="sq-sub">Ne folosim de ele doar ca să-ți trimitem oferta și să te sunăm dacă ai întrebări.</p>

					<form
						class="sq-grid-2"
						onsubmit={(e) => {
							e.preventDefault();
							next();
						}}
					>
						<div class="sq-field sq-span-2">
							<label class="sq-label" for="sq-name">Nume și prenume *</label>
							<input
								id="sq-name"
								class="sq-input"
								class:sq-input-error={touched && !!nameError}
								bind:value={contactName}
								required
								maxlength="120"
								autocomplete="name"
								aria-invalid={touched && !!nameError ? 'true' : undefined}
								aria-describedby={touched && nameError ? 'sq-name-err' : undefined}
							/>
							{#if touched && nameError}<span id="sq-name-err" class="sq-hint sq-hint-err">{nameError}</span>{/if}
						</div>
						<div class="sq-field">
							<label class="sq-label" for="sq-email">Email *</label>
							<input
								id="sq-email"
								class="sq-input"
								class:sq-input-error={touched && !!emailError}
								type="email"
								bind:value={contactEmail}
								required
								maxlength="255"
								autocomplete="email"
								aria-invalid={touched && !!emailError ? 'true' : undefined}
								aria-describedby={touched && emailError ? 'sq-email-err' : undefined}
							/>
							{#if touched && emailError}<span id="sq-email-err" class="sq-hint sq-hint-err">{emailError}</span>{/if}
						</div>
						<div class="sq-field">
							<label class="sq-label" for="sq-phone">Telefon</label>
							<input id="sq-phone" class="sq-input" type="tel" bind:value={contactPhone} maxlength="40" autocomplete="tel" />
						</div>
						<div class="sq-field sq-span-2">
							<label class="sq-label" for="sq-company">Companie</label>
							<input id="sq-company" class="sq-input" bind:value={companyName} maxlength="160" autocomplete="organization" />
						</div>
						<div class="sq-field sq-span-2">
							<label class="sq-label" for="sq-note">Detalii despre proiect</label>
							<textarea
								id="sq-note"
								class="sq-input sq-textarea"
								bind:value={note}
								rows="5"
								maxlength="2000"
								placeholder="Industrie, website, obiective, buget media estimat, dată de start..."
							></textarea>
						</div>
						<!-- Enter în orice câmp = „Continuă"; butonul vizibil e în footer. -->
						<button type="submit" class="sq-sr">Continuă</button>
					</form>
				{:else}
					<h2 class="sq-h2">Verifică și trimite</h2>
					<p class="sq-sub">Îți pregătim o ofertă personalizată pentru serviciile de mai jos și revenim pe email.</p>

					<div class="sq-review">
						<div class="sq-review-head">Servicii</div>
						<ul class="sq-review-list">
							{#each summary.lines as line (line.categorySlug)}
								<li>
									<span class="sq-item-icon"><CategoryIcon slug={line.categorySlug} class="h-4 w-4" /></span>
									<strong>{line.name}</strong>
									<span class="sq-chip" data-tier={line.tier}>{tierLabel(line.tier)}</span>
									<span class="sq-review-price">
										{#if line.monthlyEur !== null}{formatEur(line.monthlyEur)}/lună{:else if line.setupEur}{formatEur(line.setupEur)} one-time{/if}
									</span>
								</li>
							{/each}
						</ul>

						<div class="sq-review-head">Contact</div>
						<dl class="sq-review-dl">
							<dt>Nume</dt><dd>{contactName.trim()}</dd>
							<dt>Email</dt><dd>{contactEmail.trim()}</dd>
							{#if contactPhone.trim()}<dt>Telefon</dt><dd>{contactPhone.trim()}</dd>{/if}
							{#if companyName.trim()}<dt>Companie</dt><dd>{companyName.trim()}</dd>{/if}
							{#if note.trim()}<dt>Detalii</dt><dd class="sq-pre">{note.trim()}</dd>{/if}
						</dl>
					</div>

					{#if errorMessage}
						<div class="sq-submit-err" role="alert">
							<strong>Cererea nu a plecat.</strong>
							{errorMessage}
						</div>
					{/if}

					<p class="sq-consent">
						Trimițând cererea ești de acord să te contactăm pe datele de mai sus. Nu le folosim
						pentru altceva.
					</p>
				{/if}
			</div>

			<aside class="sq-summary" aria-label="Sumar ofertă">
				<div class="sq-summary-head">Sumar ofertă</div>

				{#if summary.lines.length === 0}
					<p class="sq-summary-empty">Niciun serviciu ales încă.</p>
				{:else}
					{#each summary.lines as line (line.categorySlug)}
						<div class="sq-cart-item">
							<div class="sq-cart-name">
								<strong>{line.name}</strong>
								<span>{tierLabel(line.tier)}</span>
							</div>
							<div class="sq-cart-price">
								{#if line.monthlyEur !== null}
									{formatEur(line.monthlyEur)}<small>/lună</small>
								{:else if line.setupEur}
									{formatEur(line.setupEur)}<small> one-time</small>
								{:else}
									—
								{/if}
							</div>
						</div>
					{/each}

					<div class="sq-totals">
						<div class="sq-total-row">
							<span>Subtotal lunar</span>
							<strong>{formatEur(summary.monthlySubtotal)}</strong>
						</div>
						{#if summary.discountPct > 0}
							<div class="sq-total-row sq-total-discount">
								<span>Discount {summary.serviceCount} servicii (−{summary.discountPct} %)</span>
								<strong>−{formatEur(summary.monthlyDiscount)}</strong>
							</div>
						{/if}
						<div class="sq-total-row big">
							<span>Total lunar estimat</span>
							<strong>{formatEur(summary.monthlyTotal)}</strong>
						</div>
						{#if summary.setupTotal > 0}
							<div class="sq-total-row">
								<span>Setup one-time</span>
								<strong>{formatEur(summary.setupTotal)}</strong>
							</div>
						{/if}
					</div>
				{/if}

				<p class="sq-fine">
					Prețuri în EUR, fără TVA. Bugetul media și costul platformelor externe se plătesc
					separat, direct către furnizor. Oferta finală vine de la echipa noastră.
				</p>
			</aside>
		</div>
	{/if}

	{#snippet footer()}
		{#if !sent}
			<div class="sq-foot">
				{#if step > 1}
					<button type="button" class="sq-btn-ghost" onclick={back} disabled={submitting}>
						<ChevronLeftIcon size={14} /> Înapoi
					</button>
				{:else}
					<div></div>
				{/if}
				<div class="sq-foot-meta" class:sq-foot-warn={!!footerHint} aria-live="polite">
					{footerHint ?? ''}
				</div>
				{#if step < 3}
					<button type="button" class="sq-btn-primary" onclick={next} disabled={!canContinue && step === 1}>
						Continuă <ChevronRightIcon size={14} />
					</button>
				{:else}
					<button type="button" class="sq-btn-primary" onclick={submit} disabled={submitting}>
						{#if submitting}Se trimite...{:else}<SendIcon size={14} /> Trimite cererea de ofertă{/if}
					</button>
				{/if}
			</div>
		{/if}
	{/snippet}
</CheckoutModalShell>

<style>
	/* Tokenii sunt cei din /pachete-hosting și din ServicesCatalog (--accent #1877f2,
	   --ink #0b1220, --border #e5e9f0), ca modalul să pară din același produs. */
	.sq-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* ===== Stepper ===== */
	.sq-stepper {
		padding: 22px 28px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 8px;
		background: #f7f8fa;
	}
	.sq-step {
		display: flex;
		align-items: center;
		gap: 12px;
		color: #94a3b8;
	}
	.sq-step.active {
		color: #1877f2;
	}
	.sq-step.done {
		color: #10b981;
	}
	.sq-step-circle {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: white;
		border: 2px solid #e5e9f0;
		display: grid;
		place-items: center;
		color: #94a3b8;
		transition: all 0.15s;
	}
	.sq-step.active .sq-step-circle {
		background: #1877f2;
		border-color: #1877f2;
		color: white;
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.25);
	}
	.sq-step.done .sq-step-circle {
		background: #10b981;
		border-color: #10b981;
		color: white;
	}
	.sq-step-num {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #94a3b8;
	}
	.sq-step.active .sq-step-num {
		color: #1877f2;
	}
	.sq-step.done .sq-step-num {
		color: #10b981;
	}
	.sq-step-label > div:last-child {
		font-size: 13.5px;
		font-weight: 600;
		color: #0b1220;
		margin-top: 1px;
	}
	.sq-step.active .sq-step-label > div:last-child {
		color: #1877f2;
	}
	.sq-step-line {
		flex: 1;
		height: 2px;
		background: #e5e9f0;
		margin: 0 4px;
		border-radius: 2px;
	}
	.sq-step-line.done {
		background: #10b981;
	}

	/* ===== Layout ===== */
	.sq-layout {
		display: grid;
		grid-template-columns: 1fr 340px;
		min-height: 440px;
	}
	.sq-content {
		padding: 28px 32px 32px;
		min-width: 0;
	}
	.sq-summary {
		background: #f7f8fa;
		border-left: 1px solid #e5e9f0;
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-self: stretch;
	}

	.sq-h2 {
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 6px;
		color: #0b1220;
	}
	.sq-h3 {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #94a3b8;
		margin: 26px 0 10px;
	}
	.sq-sub {
		font-size: 14px;
		color: #475569;
		margin: 0 0 20px;
		max-width: 540px;
	}
	.sq-empty {
		padding: 18px;
		border: 1px dashed #cbd5e1;
		border-radius: 12px;
		color: #475569;
		font-size: 13.5px;
		background: #fafbfd;
	}

	/* ===== Pas 1: iteme ===== */
	.sq-items,
	.sq-add-list,
	.sq-review-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sq-item {
		border: 1px solid #e5e9f0;
		border-radius: 14px;
		padding: 14px 16px;
		background: white;
	}
	.sq-item-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.sq-item-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: #f1f5f9;
		display: grid;
		place-items: center;
		color: #0b1220;
		flex-shrink: 0;
	}
	.sq-item-name {
		flex: 1;
		min-width: 0;
	}
	.sq-item-name strong,
	.sq-add-name strong {
		display: block;
		font-size: 14px;
		color: #0b1220;
	}
	.sq-item-name span,
	.sq-add-name span {
		display: block;
		font-size: 12px;
		color: #475569;
		margin-top: 1px;
	}
	.sq-remove {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid #e5e9f0;
		background: white;
		color: #475569;
		display: grid;
		place-items: center;
		cursor: pointer;
		flex-shrink: 0;
	}
	.sq-remove:hover {
		color: #b91c1c;
		border-color: #fecaca;
		background: #fff5f5;
	}
	.sq-remove:focus-visible,
	.sq-add:focus-visible,
	.sq-segmented button:focus-visible,
	.sq-btn-primary:focus-visible,
	.sq-btn-ghost:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}

	.sq-segmented {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		margin-top: 12px;
		padding: 3px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
	}
	.sq-segmented button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 5px;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	.sq-segmented button.active {
		background: white;
		color: #0b1220;
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
	}
	.sq-tierdot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #94a3b8;
	}
	/* Aceleași culori pe tier ca în ServicesCatalog (.sv-tierdot). */
	.sq-tierdot[data-tier='bronze'],
	.sq-chip[data-tier='bronze'] {
		--tier: #d97706;
	}
	.sq-tierdot[data-tier='silver'],
	.sq-chip[data-tier='silver'] {
		--tier: #64748b;
	}
	.sq-tierdot[data-tier='gold'],
	.sq-chip[data-tier='gold'] {
		--tier: #ca8a04;
	}
	.sq-tierdot[data-tier='platinum'],
	.sq-chip[data-tier='platinum'] {
		--tier: #7c3aed;
	}
	.sq-tierdot[data-tier] {
		background: var(--tier);
	}

	.sq-add {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		background: white;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.sq-add:hover {
		border-color: #1877f2;
		background: rgba(24, 119, 242, 0.04);
	}
	.sq-add-name {
		flex: 1;
		min-width: 0;
	}
	.sq-add-cta {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		font-weight: 700;
		color: #1877f2;
		white-space: nowrap;
	}

	/* ===== Pas 2: formular ===== */
	.sq-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.sq-span-2 {
		grid-column: span 2;
	}
	.sq-field {
		display: flex;
		flex-direction: column;
	}
	.sq-label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		margin-bottom: 6px;
	}
	.sq-input {
		width: 100%;
		padding: 11px 14px;
		background: white;
		border: 1.5px solid #e5e9f0;
		border-radius: 9px;
		font-family: inherit;
		font-size: 14px;
		color: #0b1220;
		outline: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.sq-input:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.sq-input.sq-input-error {
		border-color: #ef4444;
		background: #fff5f5;
	}
	.sq-textarea {
		resize: vertical;
		min-height: 110px;
		line-height: 1.5;
	}
	.sq-hint {
		font-size: 11.5px;
		margin-top: 4px;
		color: #94a3b8;
	}
	.sq-hint-err {
		color: #b91c1c;
	}

	/* ===== Pas 3: recapitulare ===== */
	.sq-review {
		border: 1px solid #e5e9f0;
		border-radius: 14px;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sq-review-head {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #94a3b8;
	}
	.sq-review-head + .sq-review-head,
	.sq-review-list + .sq-review-head {
		margin-top: 8px;
	}
	.sq-review-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
	}
	.sq-review-list strong {
		flex: 1;
		min-width: 0;
		color: #0b1220;
	}
	.sq-review-price {
		color: #475569;
		white-space: nowrap;
	}
	.sq-chip {
		font-size: 11px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 999px;
		color: var(--tier, #475569);
		border: 1px solid color-mix(in srgb, var(--tier, #94a3b8) 35%, transparent);
		background: color-mix(in srgb, var(--tier, #94a3b8) 10%, white);
		white-space: nowrap;
	}
	.sq-review-dl {
		display: grid;
		grid-template-columns: 96px 1fr;
		gap: 6px 12px;
		margin: 0;
		font-size: 13.5px;
	}
	.sq-review-dl dt {
		color: #94a3b8;
	}
	.sq-review-dl dd {
		margin: 0;
		color: #0b1220;
		overflow-wrap: anywhere;
	}
	.sq-pre {
		white-space: pre-line;
	}
	.sq-submit-err {
		margin-top: 14px;
		padding: 12px 14px;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 10px;
		color: #b91c1c;
		font-size: 13px;
		line-height: 1.5;
	}
	.sq-submit-err strong {
		display: block;
		margin-bottom: 2px;
		color: #991b1b;
	}
	.sq-consent {
		margin: 16px 0 0;
		font-size: 12px;
		color: #94a3b8;
		line-height: 1.5;
	}

	/* ===== Sumar ===== */
	.sq-summary-head {
		font-size: 11px;
		font-weight: 800;
		color: #94a3b8;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding-bottom: 4px;
	}
	.sq-summary-empty {
		margin: 0;
		font-size: 13px;
		color: #94a3b8;
	}
	.sq-cart-item {
		padding: 10px 0;
		border-top: 1px solid #e5e9f0;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.sq-cart-name strong {
		display: block;
		font-size: 13.5px;
		color: #0b1220;
	}
	.sq-cart-name span {
		font-size: 11.5px;
		color: #475569;
		margin-top: 2px;
		display: block;
	}
	.sq-cart-price {
		font-weight: 700;
		font-size: 14px;
		color: #0b1220;
		white-space: nowrap;
	}
	.sq-cart-price small {
		font-size: 11px;
		font-weight: 500;
		color: #94a3b8;
	}
	.sq-totals {
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sq-total-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		color: #475569;
	}
	.sq-total-row strong {
		color: #0b1220;
		font-weight: 600;
		white-space: nowrap;
	}
	.sq-total-discount,
	.sq-total-discount strong {
		color: #047857;
	}
	.sq-total-row.big {
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 15px;
	}
	.sq-total-row.big strong {
		font-size: 24px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #1877f2;
	}
	.sq-fine {
		margin: 12px 0 0;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 11.5px;
		line-height: 1.5;
		color: #94a3b8;
	}

	/* ===== Footer & butoane ===== */
	.sq-foot {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.sq-foot-meta {
		flex: 1;
		text-align: center;
		font-size: 12.5px;
		color: #94a3b8;
	}
	.sq-foot-warn {
		color: #b45309;
	}
	.sq-btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 22px;
		border-radius: 10px;
		background: #1877f2;
		color: white;
		border: none;
		font-family: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.sq-btn-primary:not(:disabled):hover {
		background: #0d5cc7;
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(24, 119, 242, 0.25);
	}
	.sq-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.sq-btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-radius: 9px;
		background: transparent;
		border: 1px solid #e5e9f0;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	.sq-btn-ghost:not(:disabled):hover {
		background: white;
		color: #0b1220;
	}
	.sq-btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ===== Confirmare ===== */
	.sq-success {
		text-align: center;
		padding: 16px 8px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.sq-success :global(.sq-success-icon) {
		width: 52px;
		height: 52px;
		color: #10b981;
	}
	.sq-success h2 {
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 4px 0 0;
		color: #0b1220;
	}
	.sq-success p {
		margin: 0 0 12px;
		font-size: 14px;
		color: #475569;
		max-width: 420px;
		line-height: 1.55;
	}

	@media (max-width: 880px) {
		.sq-layout {
			grid-template-columns: 1fr;
		}
		.sq-summary {
			border-left: none;
			border-top: 1px solid #e5e9f0;
		}
		.sq-content {
			padding: 22px 20px 24px;
		}
		.sq-grid-2 {
			grid-template-columns: 1fr;
		}
		.sq-span-2 {
			grid-column: span 1;
		}
		.sq-stepper {
			padding: 16px 18px;
		}
		.sq-step-label {
			display: none;
		}
		.sq-step.active .sq-step-label {
			display: block;
		}
		.sq-foot-meta {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sq-btn-primary:not(:disabled):hover {
			transform: none;
		}
	}
</style>
```

Note de implementare:
- `CategoryIcon` primește `class` — verifică semnătura în `$lib/components/services/CategoryIcon.svelte` înainte (există deja utilizări identice în `RequestQuoteDialog`).
- Culorile tier-urilor (`--tier`) trebuie să coincidă cu `.sv-tierdot[data-tier=...]` din `ServicesCatalog.svelte` — citește acel bloc și copiază valorile exacte dacă diferă de cele de mai sus.
- `color-mix` e suportat de toate browserele evergreen din 2023; acceptabil pentru pagina publică.

- [ ] **Step 2: Autofixer**

Rulează `mcp__svelte__svelte-autofixer` pe fișier; repară orice semnalează (ex. `{@const}` trebuie să fie primul copil al blocului; `aria-describedby` cu `undefined` e OK).

- [ ] **Step 3: Verifică anti-scurgere și commit**

Run: `bun run test no-price-leak` → PASS.
```bash
git add src/routes/servicii/ServicesQuoteModal.svelte
git commit -m "feat(servicii): ServicesQuoteModal — Servicii → Date contact → Solicită oferta"
```

---

### Task 8: `ServicesCatalog.svelte` — coșul în pagină (comparație, bară sticky, nav, modal)

**Files:**
- Modify: `app/src/routes/servicii/ServicesCatalog.svelte`
- Delete: `app/src/routes/servicii/RequestQuoteDialog.svelte`

- [ ] **Step 1: Script — înlocuiește starea de „request" cu coșul**

În `<script>`:
- Șterge importul `RequestQuoteDialog` și adaugă:
```ts
	import { onMount } from 'svelte';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import XIcon from '@lucide/svelte/icons/x';
	import ServicesQuoteModal from './ServicesQuoteModal.svelte';
	import { ServicesCart } from './services-cart.svelte';
	import { computeQuoteSummary } from '$lib/logic/quote-pricing';
```
- Șterge `requestCategory`, `requestTier`, `requestOpen`, `requestSeq` și funcția `handleRequest`. În loc:
```ts
	// Coșul de servicii: un serviciu = un tier; cererea pleacă o singură dată, din modal.
	const cart = new ServicesCart();
	onMount(() => {
		cart.load((slug, tier) => bySlug.has(slug) && (catalog.tiers as string[]).includes(tier));
	});
	const cartSummary = $derived(
		computeQuoteSummary(cart.items, catalog.categories, catalog.discountRules)
	);

	let quoteOpen = $state(false);

	/** Din comparație: același tier = scoate, alt tier = înlocuiește, serviciu nou = adaugă. */
	function handleTierPick(tier: Tier) {
		if (!selectedCategory) return;
		cart.toggle(selectedCategory.slug, tier);
		compareOpen = false;
	}
```

- [ ] **Step 2: Nav — butonul „Oferta mea"**

În `<nav>`, înainte de `<a href="/servicii/configurator" class="sv-nav-secondary">`:
```svelte
			{#if cart.count > 0}
				<button type="button" class="sv-nav-cart" onclick={() => (quoteOpen = true)}>
					<ShoppingBagIcon class="h-4 w-4" />
					Oferta mea <i>{cart.count}</i>
				</button>
			{/if}
```

- [ ] **Step 3: Textul din secțiunea Categorii**

`Click pe orice categorie pentru comparația completă Bronze → Platinum și cerere de ofertă.` →
`Click pe o categorie pentru comparația Bronze → Platinum, adaugă pachetul dorit în ofertă și combină mai multe servicii pentru discount.`

- [ ] **Step 4: Bara sticky + modalul (înlocuiește blocul `{#key requestSeq} ... {/key}`)**

```svelte
<PackageComparisonView
	bind:open={compareOpen}
	category={selectedCategory}
	tiers={catalog.tiers}
	tierLabels={catalog.tierLabels}
	tierColors={catalog.tierColors}
	setupDefaultDescription={catalog.setupDefaultDescription}
	hourlyRates={catalog.hourlyRates}
	{isWebDev}
	onRequest={handleTierPick}
	requestLabel={'Adaugă {tier}'}
	activeTier={selectedCategory ? cart.tierOf(selectedCategory.slug) : null}
	activeLabel="În ofertă ✓"
/>

{#if cart.count > 0 && !quoteOpen}
	<div class="sv-cartbar" role="region" aria-label="Oferta ta">
		<div class="sv-cartbar-inner">
			<div class="sv-cartbar-info">
				<span class="sv-cartbar-count"><ShoppingBagIcon class="h-4 w-4" /> {cart.count} {cart.count === 1 ? 'serviciu' : 'servicii'}</span>
				<span class="sv-cartbar-names">{cartSummary.lines.map((l) => `${l.name} ${catalog.tierLabels[l.tier]}`).join(' · ')}</span>
			</div>
			<div class="sv-cartbar-total">
				{#if cartSummary.discountPct > 0}
					<s>{formatEur(cartSummary.monthlySubtotal)}</s>
					<span class="sv-cartbar-discount">−{cartSummary.discountPct}%</span>
				{/if}
				<strong>{formatEur(cartSummary.monthlyTotal)}</strong><small>/lună</small>
			</div>
			<button type="button" class="sv-cartbar-clear" onclick={() => cart.clear()} aria-label="Golește oferta">
				<XIcon class="h-4 w-4" />
			</button>
			<button type="button" class="sv-btn sv-btn-primary" onclick={() => (quoteOpen = true)}>
				Solicită oferta <ArrowRightIcon class="h-4 w-4" />
			</button>
		</div>
	</div>
{/if}

{#if quoteOpen}
	<ServicesQuoteModal {cart} {catalog} onClose={() => (quoteOpen = false)} />
{/if}
```
(Înlocuiește și `onRequest={handleRequest}` / `requestLabel={'Cere ofertă {tier}'}` din `PackageComparisonView` cu cele de mai sus — e același bloc.)

- [ ] **Step 5: Stiluri (în `<style>`, lângă `.sv-nav-secondary` și la final)**

```css
	.sv-nav-cart {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		cursor: pointer;
	}
	.sv-nav-cart:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.sv-nav-cart:focus-visible,
	.sv-cartbar-clear:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sv-nav-cart i {
		font-style: normal;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--accent);
		color: white;
		font-size: 11px;
		font-weight: 800;
		display: inline-grid;
		place-items: center;
	}

	/* ===== Bara de coș (sticky jos) ===== */
	.sv-cartbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 60;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
		background: rgba(255, 255, 255, 0.96);
		backdrop-filter: blur(10px);
		border-top: 1px solid var(--border);
		box-shadow: 0 -12px 32px rgba(11, 18, 32, 0.08);
		animation: svSlideUp 0.2s ease-out;
	}
	@keyframes svSlideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sv-cartbar {
			animation: none;
		}
	}
	.sv-cartbar-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.sv-cartbar-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sv-cartbar-count {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
	}
	.sv-cartbar-names {
		font-size: 12px;
		color: var(--ink2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sv-cartbar-total {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		white-space: nowrap;
	}
	.sv-cartbar-total s {
		font-size: 12px;
		color: var(--muted);
	}
	.sv-cartbar-discount {
		font-size: 11px;
		font-weight: 800;
		color: #047857;
		background: rgba(16, 185, 129, 0.12);
		padding: 2px 7px;
		border-radius: 999px;
	}
	.sv-cartbar-total strong {
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--accent);
	}
	.sv-cartbar-total small {
		font-size: 12px;
		color: var(--ink2);
	}
	.sv-cartbar-clear {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--ink2);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.sv-cartbar-clear:hover {
		color: #b91c1c;
		border-color: #fecaca;
	}
	@media (max-width: 720px) {
		.sv-cartbar-inner {
			flex-wrap: wrap;
			gap: 10px;
		}
		.sv-cartbar-info {
			flex-basis: 100%;
		}
		.sv-cartbar-names {
			display: none;
		}
		.sv-cartbar-total {
			flex: 1;
		}
	}
	/* Bara acoperă ultimele rânduri ale paginii — lăsăm loc sub subsol. */
	.sv-page:has(.sv-cartbar) .sv-foot {
		padding-bottom: 96px;
	}
```
(Dacă `.sv-foot` are deja padding-bottom, regula `:has` îl suprascrie doar când bara există — verifică vizual.)

- [ ] **Step 6: Șterge dialogul vechi**

```bash
git rm src/routes/servicii/RequestQuoteDialog.svelte
```
Caută alți importatori: `grep -rn "RequestQuoteDialog" src` → singurul rămas trebuie să fie `configurator/+page.svelte` (se repară în Task 9).

- [ ] **Step 7: Autofixer + commit**

Rulează `svelte-autofixer` pe `ServicesCatalog.svelte`.
```bash
git add src/routes/servicii/ServicesCatalog.svelte
git commit -m "feat(servicii): coș de servicii în catalog — adaugă pe tier, bară sticky, modal de ofertă"
```

---

### Task 9: Configuratorul trece prin coș + modal

**Files:**
- Modify: `app/src/routes/servicii/configurator/+page.svelte`

- [ ] **Step 1: Rescrie pagina**

```svelte
<!--
  Wizardul public. Aceeași componentă ca în portalul clientului
  (`$lib/components/services/PackageWizard.svelte`) — diferă doar de unde vine
  catalogul și cum pleacă cererea.

  Vizitatorul nu are cont, deci recomandarea nu se trimite direct: serviciile
  bundle-ului intră în coșul paginii /servicii (la tier-ul recomandat) și se
  deschide modalul de ofertă, cu nota wizardului preîncărcată. Coșul e partajat
  prin sessionStorage, deci întoarcerea la catalog arată aceleași servicii.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import PackageWizard from '$lib/components/services/PackageWizard.svelte';
	import ServicesQuoteModal from '../ServicesQuoteModal.svelte';
	import { ServicesCart } from '../services-cart.svelte';
	import type { Recommendation } from '$lib/logic/wizard-engine';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const catalog = $derived({
		categories: data.catalog.categories,
		bundles: data.catalog.bundles,
		bundleTiersRule: data.catalog.discountRules,
		tierLabels: data.catalog.tierLabels,
		tierColors: data.catalog.tierColors
	});

	const cart = new ServicesCart();
	const validSlugs = $derived(new Set(data.catalog.categories.map((c) => c.slug)));
	onMount(() => {
		cart.load((slug, tier) => validSlugs.has(slug) && (data.catalog.tiers as string[]).includes(tier));
	});

	let quoteOpen = $state(false);
	let quoteNote = $state('');

	async function handleRequest(rec: Recommendation, note: string) {
		// Recomandarea înlocuiește coșul: vizitatorul a cerut explicit acest bundle.
		cart.clear();
		for (const slug of rec.bundle.services) {
			if (validSlugs.has(slug)) cart.set(slug, rec.tier);
		}
		quoteNote = note;
		quoteOpen = true;
	}
</script>

<svelte:head>
	<title>Ce pachet aleg? — One Top Solution</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PackageWizard {catalog} backHref="/servicii" onRequest={handleRequest} />

{#if quoteOpen}
	<ServicesQuoteModal
		{cart}
		catalog={data.catalog}
		initialNote={quoteNote}
		onClose={() => (quoteOpen = false)}
	/>
{/if}
```

- [ ] **Step 2: Verifică că nu mai există referințe la dialogul vechi**

Run: `grep -rn "RequestQuoteDialog\|submitPublicPackageRequest" src --include=*.svelte`
Expected: niciun rezultat.

- [ ] **Step 3: Autofixer + teste + commit**

Rulează `svelte-autofixer`; apoi `bun run test servicii` → PASS.
```bash
git add src/routes/servicii/configurator/+page.svelte
git commit -m "feat(servicii): configuratorul trimite bundle-ul prin coș + modalul de ofertă"
```

---

### Task 10: Admin — `getPackageRequests` + cardul cererii afișează tier per serviciu și discount

**Files:**
- Modify: `app/src/lib/remotes/packages.remote.ts:40-70`
- Modify: `app/src/routes/[tenant]/services/+page.svelte:364-420`

- [ ] **Step 1: Remote — select + parse**

În select-ul din `getPackageRequests` adaugă după `companyName`:
```ts
				items: table.servicePackageRequest.items,
				discountPct: table.servicePackageRequest.discountPct
```
și în `rows.map`:
```ts
		return rows.map((r) => ({
			...r,
			services: r.services ? (JSON.parse(r.services) as string[]) : null,
			items: r.items ? (JSON.parse(r.items) as QuoteRequestItem[]) : null
		}));
```
cu tipul definit deasupra query-ului:
```ts
/** Forma unui element din coloana `items` (ofertă multi-serviciu de pe /servicii). */
export type QuoteRequestItem = {
	categorySlug: string;
	tier: Tier;
	monthlyEur: number | null;
	setupEur: number | null;
};
```
și `import { getCategory, TIERS, type Tier } from '$lib/constants/ots-catalog';`.

- [ ] **Step 2: Card — titlu, badge și lista per serviciu**

În `[tenant]/services/+page.svelte`, blocul `{@const isBundle = ...}` devine:
```svelte
					{@const isQuote = Array.isArray(req.items) && req.items.length > 0}
					{@const isBundle = !isQuote && Array.isArray(req.services) && req.services.length > 1}
```
Titlul (blocul `{#if isBundle} ... {:else} ...`):
```svelte
										{#if isQuote}
											<Badge class="bg-primary/10 text-primary border-primary/20">Ofertă</Badge>
											<h3 class="font-semibold">
												{req.items!.length} {req.items!.length === 1 ? 'serviciu' : 'servicii'}
											</h3>
										{:else if isBundle}
											<Badge class="bg-primary/10 text-primary border-primary/20">Bundle</Badge>
											<h3 class="font-semibold">
												{req.bundleId || 'Pachet custom'}
											</h3>
										{:else}
											<CategoryIcon slug={req.categorySlug} class="h-4 w-4" />
											<h3 class="font-semibold">{categoryLabel(req.categorySlug)}</h3>
										{/if}
```
Chip-ul de tier de după titlu se afișează doar când `!isQuote` (înfășoară `<span class="inline-flex ... {tierColors.border} ...">...</span>` în `{#if !isQuote} ... {/if}`) — la ofertă fiecare serviciu are tier-ul lui, iar un chip global ar induce în eroare.

Lista per serviciu (înlocuiește `{#if isBundle && req.services} ... {/if}`):
```svelte
								{#if isQuote && req.items}
									<ul class="grid gap-1.5 mb-2 sm:grid-cols-2">
										{#each req.items as item (item.categorySlug)}
											{@const c = TIER_COLORS[item.tier]}
											<li class="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border bg-muted/40">
												<CategoryIcon slug={item.categorySlug} class="h-3.5 w-3.5 shrink-0" />
												<span class="font-medium truncate">{categoryLabel(item.categorySlug)}</span>
												<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border {c.border} {c.text} {c.bg}">
													<span class="h-1.5 w-1.5 rounded-full {c.dot}"></span>
													{TIER_LABELS[item.tier]}
												</span>
												<span class="ml-auto text-muted-foreground whitespace-nowrap">
													{#if item.monthlyEur !== null}{formatEur(item.monthlyEur)}/lună{:else if item.setupEur}{formatEur(item.setupEur)} setup{/if}
												</span>
											</li>
										{/each}
									</ul>
									{#if req.discountPct}
										<p class="text-xs text-emerald-700 mb-2">
											Discount multi-servicii aplicat în sumar: −{req.discountPct}% pe abonamentul lunar
										</p>
									{/if}
								{:else if isBundle && req.services}
									<div class="flex flex-wrap gap-1.5 mb-2">
										{#each req.services as slug (slug)}
											<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted">
												<CategoryIcon {slug} class="h-3 w-3" />
												{categoryLabel(slug)}
											</span>
										{/each}
									</div>
								{/if}
```
(`TIER_COLORS`, `TIER_LABELS`, `formatEur`, `CategoryIcon` există deja în fișier — verifică importurile.)

- [ ] **Step 3: Autofixer + commit**

```bash
git add src/lib/remotes/packages.remote.ts "src/routes/[tenant]/services/+page.svelte"
git commit -m "feat(services): cererile de ofertă multi-serviciu afișează tier-ul per serviciu și discountul"
```

---

### Task 11: Email „Cerere pachet nouă" — servicii cu tier + preț + discount

**Files:**
- Modify: `app/src/lib/server/email.ts:3051-3215`
- Modify: `app/scripts/demo-package-request-email.ts`

- [ ] **Step 1: Import**

La importurile din `email.ts` adaugă:
```ts
import { getCategory, TIER_LABELS, type Tier } from '$lib/constants/ots-catalog';
```

- [ ] **Step 2: Parsează `items` și construiește secțiunea**

După blocul `const isBundle = bundleServices.length > 1;` adaugă:
```ts
			// Ofertă multi-serviciu de pe /servicii: fiecare serviciu cu tier-ul și prețul lui.
			type QuoteItem = { categorySlug: string; tier: Tier; monthlyEur: number | null; setupEur: number | null };
			let quoteItems: QuoteItem[] = [];
			if (request.items) {
				try {
					const parsed = JSON.parse(request.items);
					if (Array.isArray(parsed)) quoteItems = parsed;
				} catch {
					// JSON stricat → cădem pe afișarea clasică (pivot)
				}
			}
			const isQuote = quoteItems.length > 0;
			const eur = (n: number) => `${n.toLocaleString('ro-RO')} €`;
			const quoteMonthly = quoteItems.reduce((s, i) => s + (i.monthlyEur ?? 0), 0);
			const quoteDiscountPct = request.discountPct ?? 0;
			const quoteMonthlyTotal = Math.round((quoteMonthly * (100 - quoteDiscountPct)) / 100);
			const quoteSetup = quoteItems.reduce((s, i) => s + (i.setupEur ?? 0), 0);
			const quoteRowsHtml = quoteItems
				.map((i) => {
					const name = escapeHtml(getCategory(i.categorySlug)?.name ?? i.categorySlug);
					const tier = escapeHtml(TIER_LABELS[i.tier] ?? i.tier);
					const price =
						i.monthlyEur !== null ? `${eur(i.monthlyEur)}/lună` : i.setupEur ? `${eur(i.setupEur)} one-time` : '—';
					return `<tr><td style="padding: 4px 0; color: #111827;">${name}</td><td style="padding: 4px 10px; color: #6b7280;">${tier}</td><td style="padding: 4px 0; text-align: right; color: #111827; white-space: nowrap;">${price}</td></tr>`;
				})
				.join('');
			const quoteHtml = isQuote
				? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Servicii cerute</span></div>
					<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; font-size: 14px; margin-bottom: 8px;">${quoteRowsHtml}</table>
					<div style="margin-bottom: 4px;"><span style="color: #6b7280;">Subtotal lunar</span> &nbsp;·&nbsp; <strong>${eur(quoteMonthly)}</strong></div>
					${quoteDiscountPct > 0 ? `<div style="margin-bottom: 4px;"><span style="color: #6b7280;">Discount ${quoteItems.length} servicii</span> &nbsp;·&nbsp; <strong style="color:#047857;">−${quoteDiscountPct}%</strong></div>` : ''}
					<div style="margin-bottom: 4px;"><span style="color: #6b7280;">Total lunar estimat</span> &nbsp;·&nbsp; <strong>${eur(quoteMonthlyTotal)}</strong></div>
					${quoteSetup > 0 ? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Setup one-time</span> &nbsp;·&nbsp; <strong>${eur(quoteSetup)}</strong></div>` : ''}`
				: '';
```

- [ ] **Step 3: Folosește-l în HTML și text**

În `bodyHtml`, înlocuiește:
```ts
							${isBundle
								? `...Bundle...`
								: `...Categorie...`}
							<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Pachet</span> &nbsp;·&nbsp; <strong>${tierLabel}</strong></div>
```
cu:
```ts
							${isQuote
								? quoteHtml
								: isBundle
									? `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Bundle</span> &nbsp;·&nbsp; <strong>${bundleIdLabel}</strong></div>${servicesListHtml}<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Pachet</span> &nbsp;·&nbsp; <strong>${tierLabel}</strong></div>`
									: `<div style="margin-bottom: 6px;"><span style="color: #6b7280;">Categorie</span> &nbsp;·&nbsp; <strong>${categoryLabel}</strong></div><div style="margin-bottom: 6px;"><span style="color: #6b7280;">Pachet</span> &nbsp;·&nbsp; <strong>${tierLabel}</strong></div>`}
```
Fraza introductivă: `${isPublicRequest ? 'O cerere de ofertă a fost trimisă de pe pagina publică' : ...}` rămâne.

Subiectul (în ambele locuri — `sendWithPersistence` și obiectul returnat) și `previewTitle`:
```ts
	const subject = isQuoteRow
		? `Cerere ofertă nouă — ${quoteCount} servicii`
		: `Cerere pachet nouă — ${request.categorySlug} ${request.tier}`;
```
unde, imediat după `if (!request) throw ...`, calculezi:
```ts
	let quoteCount = 0;
	try {
		const parsed = request.items ? JSON.parse(request.items) : null;
		if (Array.isArray(parsed)) quoteCount = parsed.length;
	} catch {
		// ignorăm — subiectul cade pe varianta clasică
	}
	const isQuoteRow = quoteCount > 0;
```
(Atenție: `subject` din `sendWithPersistence` e evaluat în afara callback-ului, de aceea numărătoarea se face sus, separat de `quoteItems` din callback.)

Textul simplu: după linia `Pachet: ${request.tier}` adaugă:
```ts
					${isQuote ? `\nServicii cerute:\n${quoteItems.map((i) => `- ${getCategory(i.categorySlug)?.name ?? i.categorySlug} — ${TIER_LABELS[i.tier] ?? i.tier}${i.monthlyEur !== null ? ` (${i.monthlyEur} EUR/luna)` : i.setupEur ? ` (${i.setupEur} EUR one-time)` : ''}`).join('\n')}\nSubtotal lunar: ${quoteMonthly} EUR${quoteDiscountPct > 0 ? `\nDiscount: -${quoteDiscountPct}%` : ''}\nTotal lunar estimat: ${quoteMonthlyTotal} EUR\n` : ''}
```

- [ ] **Step 4: Demo-ul de email**

În `app/scripts/demo-package-request-email.ts`:
- extinde tipul `Request` cu `items?: { name: string; tier: string; price: string }[]; discountPct?: number;`
- adaugă fixture-ul:
```ts
	{
		label: 'Cerere de ofertă multi-serviciu (coș /servicii)',
		source: 'public',
		clientName: 'Maria Ionescu',
		clientEmail: 'maria@example.ro',
		companyName: 'Maria SRL',
		contactPhone: '0733 000 111',
		categorySlug: 'google-ads',
		tier: 'gold',
		items: [
			{ name: 'Google Ads', tier: 'Gold', price: '900 €/lună' },
			{ name: 'SEO', tier: 'Bronze', price: '400 €/lună' },
			{ name: 'Website WordPress', tier: 'Silver', price: '1.500 € one-time' }
		],
		discountPct: 15,
		note: 'Vrem să pornim în septembrie.'
	}
```
- în `renderBody`, când `r.items` există, randează tabelul de servicii + discount (aceeași structură HTML ca în `quoteHtml`) în locul rândurilor „Categorie/Pachet".

Run: `bun --bun scripts/demo-package-request-email.ts > /tmp/package-request-preview.html && open /tmp/package-request-preview.html`
Expected: 3 variante randate, a treia cu tabelul de servicii, „Discount 3 servicii · −15%", total.

- [ ] **Step 5: Teste + commit**

Run: `bun run test email` → PASS (nicio regresie).
```bash
git add src/lib/server/email.ts scripts/demo-package-request-email.ts
git commit -m "feat(email): cererea de ofertă multi-serviciu listează serviciile cu tier, preț și discount"
```

---

### Task 12: Verificare — build, suite completă, browser, audit design

- [ ] **Step 1: Suite completă**

Run: `bun run test`
Expected: 0 fail (baseline: 1436+ pass; noile fișiere adaugă ~30).

- [ ] **Step 2: svelte-check**

Run: `/build-check` (sau `NODE_OPTIONS=--max-old-space-size=8192 bunx --bun svelte-check --tsconfig ./tsconfig.json`)
Expected: fără erori NOI față de baseline (16 err / 56 warn). Orice eroare în fișierele atinse se repară.

- [ ] **Step 3: Browser (testermcp, HEADLESS=false) — golden path**

1. `http://localhost:5173/servicii` → parola → catalog.
2. Click „Google Ads" → comparație → „Adaugă Gold" → comparația se închide, bara jos: „1 serviciu · 900 €/lună".
3. Click „SEO" → „Adaugă Bronze" → bara: „2 servicii · 1.300 € tăiat · −10% · 1.170 €/lună".
4. Redeschide „Google Ads": butonul Gold arată „În ofertă ✓"; click pe „Adaugă Platinum" → înlocuiește.
5. „Solicită oferta" → modal Pas 1: 2 iteme cu segmented; schimbă tier-ul SEO pe Silver; „+ Adaugă" la Email marketing → 3 servicii, −15 %.
6. „Continuă" cu nume gol → mesaj „Scrie numele complet." în footer + câmp roșu; completează → „Continuă".
7. Pas 3: recapitulare corectă; „Trimite cererea de ofertă" → confirmare; „Închide" → bara dispare (coș golit).
8. În CRM `/ots/services?tab=requests`: cardul nou „Ofertă · 3 servicii", lista per serviciu cu tier + preț, discount −15 %.
9. Refresh `/servicii` după ce adaugi 1 serviciu → bara persistă (sessionStorage).
10. `/servicii/configurator` → răspunde la întrebări → „Trimit cerere pentru acest pachet" → modalul la Pas 1 cu serviciile bundle-ului și, la Pas 2, nota preîncărcată.
11. Viewport 390×844: bara se împachetează, modalul pune sumarul sub conținut, stepper-ul arată doar pasul activ.

Salvează screenshot-urile în scratchpad (nu în repo).

- [ ] **Step 4: Audit design**

Rulează `design-auditor` + `web-design-guidelines` pe `ServicesQuoteModal.svelte` și pe bara din `ServicesCatalog.svelte` (contrast, aria, focus, states, responsive). Repară Critical/High.

- [ ] **Step 5: Commit final (dacă au rezultat reparări) și graphify**

```bash
git add -A src/routes/servicii src/lib/components/checkout-modal-shell.svelte
git commit -m "fix(servicii): reparări din audit design + verificare în browser"
cd .. && graphify . --update
```

---

## Self-review (făcut la scriere)

- **Spec coverage:** flux pe pagină (T8), modal 3 pași + sumar + stări (T7), coș + sessionStorage (T3), pricing (T2), backend + migrație + rând unic + snapshot + discount server-side (T1, T4), admin + email (T10, T11), configurator (T9), ștergere RequestQuoteDialog (T8/T9), `@deprecated` pe command-ul vechi (T4), teste (T2–T4, T12), browser + audit (T12). ✔
- **Type consistency:** `QuoteItem {categorySlug, tier}` folosit identic în cart-logic, ServicesCart, modal, remote; `computeQuoteSummary(items, categories, rules)` cu aceeași semnătură în T2, T7, T8, T4; `defaultTierFor(cat, tiers)` / `isTierOffered(cat, tier)` în T2, T4, T7; `ServicesCart.{items,count,tierOf,has,set,remove,toggle,clear,load}` în T3, T7, T8, T9; props shell `badgeText/ariaLabel/flush` în T5 și T7; `PackageComparisonView.activeTier/activeLabel` în T6 și T8. ✔
- **Placeholder scan:** fără TBD/TODO; singurele „verifică înainte" sunt instrucțiuni de citit codul existent (CategoryIcon, culori tier, atributele butonului), nu lipsuri de conținut. ✔
