# AEO & GEO în catalogul de servicii — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă serviciul vandabil „AEO & GEO" (4 pachete, 350–1.100 €/lună) în catalogul OTS, integrat în bundle-uri și în wizardul de recomandare.

**Architecture:** Catalogul e un singur fișier de constante TypeScript (`ots-catalog.ts`) citit de 9 consumatori — ambele pagini de servicii, wizardul, dialogul de comparație, dialogul de discounturi și remote-ul de cereri. O intrare nouă în `CATEGORIES` plus slug-ul ei în `CATEGORY_GROUPS` apare automat în toate. Singurele fișiere care mai cer atingere sunt `CategoryIcon.svelte` (maparea slug → icon) și `wizard-engine.ts` (regulile de scoring, care au sluguri hardcodate).

**Tech Stack:** TypeScript, SvelteKit 5, `bun:test`, `@lucide/svelte`.

**Spec:** `app/docs/superpowers/specs/2026-08-12-servicii-aeo-geo-design.md`

**Rulează testele cu `bun run test`, NU `bun test`** — `bun test` pune toate fișierele în același proces, iar `mock.module()` scrie într-un registru global; rezultatul sunt ~238 de eșecuri fantomă fără legătură cu taskul.

---

## File Structure

| Fișier | Rol | Acțiune |
|---|---|---|
| `app/src/lib/constants/ots-catalog.ts` | sursa unică de adevăr: servicii, grupuri, bundles | Modify |
| `app/src/lib/components/services/CategoryIcon.svelte` | slug → icon, folosit de ambele pagini | Modify |
| `app/src/lib/logic/wizard-engine.ts` | scoring bundles pentru wizardul de recomandare | Modify |
| `app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts` | integritatea catalogului | Create |
| `app/src/lib/logic/__tests__/wizard-organic.test.ts` | wizardul recunoaște aeo-geo ca organic | Create |

Toate căile de mai jos sunt relative la `/Users/augustin598/Projects/CRM`. Comenzile se rulează din `app/`.

---

### Task 1: Serviciul `aeo-geo` în CATEGORIES

**Files:**
- Create: `app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts`
- Modify: `app/src/lib/constants/ots-catalog.ts` (după intrarea `seo`, care se termină la linia 224)

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun run test ots-catalog-aeo-geo`
Expected: FAIL — `expect(received).toBeDefined()` pe `getCategory('aeo-geo')`, care întoarce `undefined`.

- [ ] **Step 3: Write minimal implementation**

În `app/src/lib/constants/ots-catalog.ts`, imediat după obiectul cu `slug: 'seo'` (se închide la linia 224 cu `},`) și înainte de `slug: 'wordpress-maintenance'`, inserează:

```ts
	{
		slug: 'aeo-geo',
		name: 'AEO & GEO',
		tagline: 'Vizibilitate în AI Search (AI Overviews, ChatGPT, Perplexity)',
		icon: 'sparkles',
		prices: { bronze: 350, silver: 500, gold: 750, platinum: 1100 },
		setupFees: { bronze: 400, silver: 400, gold: 400, platinum: 400 },
		setupDescription:
			'Audit AI-visibility inițial: baseline citări brand pe platformele monitorizate, audit entități și schema markup, verificare acces boți AI (GPTBot, ClaudeBot, PerplexityBot, Google-Extended), implementare llms.txt, plan de acțiune pe 3-6 luni. GRATUIT la contractare minimă 6 luni.',
		priceNote:
			'Abonament lunar, EUR fără TVA. Audit inclus dacă contract 6+ luni. Rezultatele se măsoară în citări și share of voice, nu în poziții — primele mișcări apar tipic în 2-4 luni.',
		features: [
			{ id: 'aeo-1', label: 'Audit vizibilitate AI (baseline citări brand)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-2', label: 'Platforme monitorizate', values: { bronze: 'ChatGPT + AI Overviews', silver: '+ Perplexity', gold: '+ Gemini + Copilot', platinum: 'Toate + Claude + Grok' } },
			{ id: 'aeo-3', label: 'Prompturi monitorizate lunar', values: { bronze: 10, silver: 25, gold: 50, platinum: 100 } },
			{ id: 'aeo-4', label: 'Optimizare AI Overviews (Google SGE)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-5', label: 'Featured snippets și People Also Ask', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-6', label: 'Schema markup entități (Organization, Person, Product)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-7', label: 'llms.txt + acces boți AI (GPTBot, ClaudeBot, PerplexityBot)', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-8', label: 'Restructurare conținut în format citabil (pagini/lună)', values: { bronze: 2, silver: 4, gold: 8, platinum: 15 } },
			{ id: 'aeo-9', label: 'Conținut nou optimizat AEO (articole/lună)', values: { bronze: 'Nu', silver: '1/lună', gold: '3/lună', platinum: '6/lună' } },
			{ id: 'aeo-10', label: 'Pagini FAQ + FAQPage schema', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-11', label: 'Statistici și date proprii (citation bait)', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-12', label: 'E-E-A-T: autor, bio, credențiale, surse', values: { bronze: false, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-13', label: 'Knowledge Graph / Wikidata entity building', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'aeo-14', label: 'Mențiuni pe surse citate de LLM-uri (Reddit, Quora, forumuri)', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'aeo-15', label: 'Prezență în listicle și comparații („best X")', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'aeo-16', label: 'Share of Voice vs. competiție în AI answers', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'aeo-17', label: 'Raport lunar citări în CRM', values: { bronze: true, silver: true, gold: true, platinum: true } },
			{ id: 'aeo-18', label: 'Raportare săptămânală în CRM', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'aeo-19', label: 'Alertă la pierderea unei citări', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'aeo-20', label: 'Optimizare AI shopping (Perplexity Shopping, Google AI)', values: { bronze: false, silver: false, gold: false, platinum: true } },
			{ id: 'aeo-21', label: 'Suport clienți', values: { bronze: 'E-mail', silver: 'E-mail', gold: 'E-mail și telefon', platinum: 'E-mail și telefon' } },
			{ id: 'aeo-22', label: 'Consultanță strategie AI Search', values: { bronze: false, silver: false, gold: true, platinum: true } },
			{ id: 'aeo-23', label: 'Meeting lunar de strategie', values: { bronze: false, silver: false, gold: true, platinum: true } }
		],
		notes: [
			'AEO & GEO nu înlocuiește SEO. Motoarele generative se alimentează din indexul clasic: fără un site indexabil corect, nu ai ce cita. Cele două servicii se rulează împreună.',
			'Citările în LLM-uri nu se pot garanta contractual — modelele se reantrenează periodic, iar răspunsurile variază de la o sesiune la alta. Raportăm frecvența de apariție pe un set fix de prompturi, măsurată lunar.'
		]
	},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun run test ots-catalog-aeo-geo`
Expected: PASS — 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/constants/ots-catalog.ts app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts
git commit -m "feat(services): serviciu AEO & GEO in catalog (350-1100 EUR/luna)"
```

---

### Task 2: Grupul organic redenumit + suprapunerea scoasă din SEO

**Files:**
- Modify: `app/src/lib/constants/ots-catalog.ts` (grupul `organic` la liniile 558-563; feature-ul `seo-22` la linia 220)
- Modify: `app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts`

- [ ] **Step 1: Write the failing test**

Adaugă la finalul fișierului de test:

```ts
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
```

Extinde importul din capul fișierului:

```ts
import {
	CATEGORIES,
	CATEGORY_GROUPS,
	TIERS,
	getCategory,
	getCategoriesInGroup
} from '$lib/constants/ots-catalog';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun run test ots-catalog-aeo-geo`
Expected: FAIL — `expect('Organic & SEO').toBe('Organic, SEO & AI Search')` și `expect(seo-22).toBeUndefined()`.

- [ ] **Step 3: Write minimal implementation**

3a. Șterge din `CATEGORIES['seo'].features` linia:

```ts
			{ id: 'seo-22', label: 'AI Overviews și SGE optimization', values: { bronze: false, silver: false, gold: true, platinum: true } },
```

3b. Adaugă `notes` pe serviciul SEO, imediat după închiderea array-ului `features` (după `{ id: 'seo-24', ... }` și paranteza `]`):

```ts
		],
		notes: [
			'Vizibilitatea în răspunsurile AI (AI Overviews, ChatGPT, Perplexity) e acoperită de serviciul dedicat AEO & GEO. SEO rămâne fundația: fără indexare corectă, motoarele generative nu au ce cita.'
		]
```

3c. Înlocuiește grupul `organic` din `CATEGORY_GROUPS`:

```ts
	{
		id: 'organic',
		label: 'Organic, SEO & AI Search',
		description:
			'Trafic organic pe termen lung, fără buget media — din Google și din motoarele de răspuns AI.',
		slugs: ['seo', 'aeo-geo']
	},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun run test ots-catalog-aeo-geo`
Expected: PASS — 12 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/constants/ots-catalog.ts app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts
git commit -m "feat(services): grup Organic, SEO & AI Search; AI Overviews muta din SEO in AEO & GEO"
```

---

### Task 3: Bundle-uri

**Files:**
- Modify: `app/src/lib/constants/ots-catalog.ts` (`BUNDLES`: `full-paid-organic` la 885-895, `enterprise` la 906-916, plus intrarea nouă)
- Modify: `app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts`

- [ ] **Step 1: Write the failing test**

Adaugă la finalul fișierului de test:

```ts
describe('bundle-uri cu AEO & GEO', () => {
	it('AI Search Duo există cu seo + aeo-geo la −15%', () => {
		const b = BUNDLES.find((x) => x.id === 'ai-search-duo');
		expect(b).toBeDefined();
		expect(b!.services).toEqual(['seo', 'aeo-geo']);
		expect(b!.discountPct).toBe(15);
	});

	it('AI Search Duo costă 723 €/lună pe Bronze după discount', () => {
		const b = BUNDLES.find((x) => x.id === 'ai-search-duo')!;
		const list = b.services.reduce((sum, slug) => sum + (getCategory(slug)!.prices.bronze ?? 0), 0);
		expect(list).toBe(850);
		expect(Math.round(list * (1 - b.discountPct / 100))).toBe(723);
	});

	it('full-paid-organic și enterprise includ aeo-geo', () => {
		for (const id of ['full-paid-organic', 'enterprise']) {
			const b = BUNDLES.find((x) => x.id === id);
			expect(b).toBeDefined();
			expect(b!.services).toContain('aeo-geo');
		}
	});

	it('fiecare slug din fiecare bundle există în CATEGORIES', () => {
		const known = new Set(CATEGORIES.map((c) => c.slug));
		for (const bundle of BUNDLES) {
			for (const slug of bundle.services) {
				expect(known.has(slug)).toBe(true);
			}
		}
	});

	it('nu există ID-uri de bundle duplicate', () => {
		const ids = BUNDLES.map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
```

Extinde importul cu `BUNDLES`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun run test ots-catalog-aeo-geo`
Expected: FAIL — `ai-search-duo` e `undefined`.

- [ ] **Step 3: Write minimal implementation**

3a. În `BUNDLES`, la finalul secțiunii `// -------- Branding & Awareness --------` (după bundle-ul `awareness-plus`), adaugă:

```ts
	{
		id: 'ai-search-duo',
		name: 'AI Search Duo',
		tagline: 'SEO + AEO/GEO',
		useCase: 'branding',
		services: ['seo', 'aeo-geo'],
		discountPct: 15,
		badge: 'new',
		rationale:
			'Aceeași fundație tehnică, două destinații: Google clasic și motoarele de răspuns AI. Schema, entitățile și conținutul citabil se lucrează o singură dată și lucrează pentru ambele, de aceea combinația costă mai puțin decât suma serviciilor.'
	},
```

3b. În bundle-ul `full-paid-organic`, înlocuiește `tagline` și `services`:

```ts
		tagline: 'Google + Meta + TikTok + SEO + AI Search',
		useCase: 'full-stack',
		services: ['google-ads', 'meta-ads', 'tiktok-ads', 'seo', 'aeo-geo'],
```

3c. În bundle-ul `enterprise`, înlocuiește `tagline` și `services`:

```ts
		tagline: 'Ads + SEO + AI Search + CRO + Email + Automation',
		useCase: 'full-stack',
		services: ['google-ads', 'meta-ads', 'seo', 'aeo-geo', 'cro', 'email-marketing', 'marketing-automation'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun run test ots-catalog-aeo-geo`
Expected: PASS — 17 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/constants/ots-catalog.ts app/src/lib/constants/__tests__/ots-catalog-aeo-geo.test.ts
git commit -m "feat(services): bundle AI Search Duo + aeo-geo in full-paid-organic si enterprise"
```

---

### Task 4: Wizardul recunoaște aeo-geo ca organic

**Files:**
- Create: `app/src/lib/logic/__tests__/wizard-organic.test.ts`
- Modify: `app/src/lib/logic/wizard-engine.ts` (`funnelCoverageScore` la linia 307, `platformBonus` la 369-380)

- [ ] **Step 1: Write the failing test**

`Recommendation.score` e un `number | undefined`, nu vectorul de scoring — deci prin `recommend()`
nu se poate inspecta `funnelCoverage` sau `platformBonus`. Testul apelează direct
`scoreBundleNuanced`, care azi e privată: Step 3a o exportă. E o funcție pură al cărei tip de
retur (`ScoringVector`) e deja exportat, deci exportul nu lărgește real suprafața modulului.

`WizardAnswers` are 6 câmpuri obligatorii (`businessTypeOther` inclus), iar `mediaBudget` e un
`BudgetBand` — `'500-1500'`, nu `'medium'`. Pornim de la `emptyAnswers()` ca testul să nu se
strice dacă se adaugă un câmp nou.

```ts
import { describe, it, expect } from 'bun:test';
import { BUNDLES } from '$lib/constants/ots-catalog';
import { emptyAnswers, scoreBundleNuanced, type WizardAnswers } from '$lib/logic/wizard-engine';

const ANSWERS: WizardAnswers = {
	...emptyAnswers(),
	businessType: 'b2b-services',
	goal: 'brand-awareness',
	mediaBudget: '500-1500',
	projectStatus: 'continuing'
};

const duo = () => BUNDLES.find((b) => b.id === 'ai-search-duo')!;

describe('wizard: AEO & GEO ca trafic organic', () => {
	it('AI Search Duo primește acoperire organică pe brand-awareness', () => {
		// brand-awareness: 50 de bază fără canal de awareness, +10 dacă e organic
		expect(scoreBundleNuanced(duo(), ANSWERS).funnelCoverage.score).toBe(60);
	});

	it('un bundle doar cu aeo-geo contează tot ca organic', () => {
		const onlyAeo = { ...duo(), id: 'test-only-aeo', services: ['aeo-geo'] };
		expect(scoreBundleNuanced(onlyAeo, ANSWERS).funnelCoverage.score).toBe(60);
	});

	it('aeo-geo aduce bonus de platformă pe brand-awareness și pe leads', () => {
		for (const goal of ['brand-awareness', 'leads'] as const) {
			const answers = { ...ANSWERS, goal };
			const withAeo = scoreBundleNuanced(duo(), answers).platformBonus;
			const withoutAeo = scoreBundleNuanced(
				{ ...duo(), services: ['seo'] },
				answers
			).platformBonus;
			expect(withAeo - withoutAeo).toBe(8);
		}
	});

	it('nu acordă bonusul pe obiective fără legătură cu AI Search', () => {
		const answers = { ...ANSWERS, goal: 'retention' as const };
		const withAeo = scoreBundleNuanced(duo(), answers).platformBonus;
		const withoutAeo = scoreBundleNuanced({ ...duo(), services: ['seo'] }, answers).platformBonus;
		expect(withAeo).toBe(withoutAeo);
	});

	it('toate bundle-urile din catalog primesc un scor finit', () => {
		for (const bundle of BUNDLES) {
			expect(Number.isFinite(scoreBundleNuanced(bundle, ANSWERS).finalScore)).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun run test wizard-organic`
Expected: FAIL la import — `scoreBundleNuanced` nu e exportată din `wizard-engine`.

- [ ] **Step 3: Write minimal implementation**

3a. Exportă funcția de scoring:

```ts
export function scoreBundleNuanced(bundle: Bundle, answers: WizardAnswers): ScoringVector {
```

3b. În `funnelCoverageScore`, înlocuiește:

```ts
	const hasOrganic = bundle.services.includes('seo');
```

cu:

```ts
	const hasOrganic = bundle.services.some((s) => ['seo', 'aeo-geo'].includes(s));
```

3c. În `platformBonus`, înainte de `return bonus;`, adaugă:

```ts
	// AI Search ajută mai ales notorietatea de brand și lead gen-ul B2B,
	// unde deciziile încep tot mai des cu o întrebare pusă unui LLM.
	if ((goal === 'brand-awareness' || goal === 'leads') && has('aeo-geo')) bonus += 8;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun run test wizard-organic`
Expected: PASS — 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/logic/wizard-engine.ts app/src/lib/logic/__tests__/wizard-organic.test.ts
git commit -m "feat(services): wizardul trateaza aeo-geo ca trafic organic"
```

---

### Task 5: Icon dedicat

**Files:**
- Modify: `app/src/lib/components/services/CategoryIcon.svelte`

Fără test unitar — componenta e o singură scară de `{:else if}` fără logică. Verificarea e vizuală, în Task 6.

- [ ] **Step 1: Adaugă importul**

După linia `import SearchIcon from '@lucide/svelte/icons/search';`:

```svelte
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
```

- [ ] **Step 2: Adaugă ramura**

Imediat după ramura `seo` (`{:else if slug === 'seo'}` / `<SearchIcon class={className} />`):

```svelte
{:else if slug === 'aeo-geo'}
	<SparklesIcon class={className} />
```

- [ ] **Step 3: Rulează autofixer-ul**

Rulează `svelte-autofixer` (MCP `svelte`) pe `app/src/lib/components/services/CategoryIcon.svelte`.
Expected: fără issues.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/services/CategoryIcon.svelte
git commit -m "feat(services): icon sparkles pentru AEO & GEO"
```

---

### Task 6: Verificare completă

**Files:** niciunul (doar verificare)

- [ ] **Step 1: Suita completă de teste**

Run: `cd app && bun run test`
Expected: zero fail. Notează numărul de pass ca baseline.

- [ ] **Step 2: build-check**

Run: `/build-check` (svelte-check cu `NODE_OPTIONS=--max-old-space-size=8192`)
Expected: fără erori sau warninguri **noi** față de baseline-ul cunoscut (16 erori / 56 warninguri).

- [ ] **Step 3: Audit de design**

Rulează `design-auditor` + `web-design-guidelines` pe cardul nou din ambele pagini de servicii.
Verifică specific: contrast pe badge-ul `new` al bundle-ului, overflow pe eticheta lungă `Mențiuni pe surse citate de LLM-uri (Reddit, Quora, forumuri)` în tabelul de comparație la 4 coloane, și dark mode.
Orice issue Critical/High se repară înainte de review.

- [ ] **Step 4: Verificare în browser**

Cu `testermcp` (`HEADLESS=false`), autentificat cu `office@onetopsolution.ro`:
1. `/ots/services` → chipul „Organic, SEO & AI Search (2)" → cardul AEO & GEO afișează `350 €/lună` și `până la 1.100 €`
2. Click pe card → dialogul de comparație afișează cele 4 paliere, setup 400 €, cele 2 note
3. Butonul „Discount multi-servicii" → „AI Search Duo" apare cu −15%
4. `/ots/services` cu SEO deschis → rândul „AI Overviews și SGE optimization" nu mai există
5. Portalul clientului `/client/ots/services` → același card apare și acolo

Screenshot pe fiecare pas, pentru regresie vizuală.

- [ ] **Step 5: Commit final dacă au fost fixuri**

```bash
git add -A
git commit -m "fix(services): ajustari din audit design AEO & GEO"
```
