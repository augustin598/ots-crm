# Credit de ore — Faza 1: „Tarife orare" în Settings — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarifele orare (specializări), regimurile de lucru și regulile creditului de ore se mută din constantele hardcodate `HOURLY_RATES` / `RATE_MODES` într-un modul editabil per tenant în Settings, iar `/servicii`, comanda de ore și emitentul Keez citesc din DB.

**Architecture:** Trei tabele noi (`hourly_rate`, `hourly_rate_mode`, `hour_credit_settings`), un singur cititor server-side `getHourlyCatalog(tenantId)` cu seed lazy din constante la prima citire (idempotent prin index unic), un fișier de logică pură `$lib/logic/hourly-catalog.ts` (forme, validări, reguli — testabil fără DB), un remote `hourly-rates.remote.ts` (citire pentru staff/portal, mutații doar owner/admin) și o pagină nouă `settings/hourly-rates`. Constantele din `ots-catalog.ts` rămân doar ca seed.

**Tech Stack:** SvelteKit 5 (remote functions, `$derived(await query())`, `<svelte:boundary>`), Bun, Drizzle ORM pe libSQL/Turso, valibot, shadcn-svelte, `bun run test` (proces per fișier).

**Spec:** `docs/superpowers/specs/2026-09-10-client-hour-credits-design.md` (secțiunile 3.1, 4, 11/F1).

---

## Reguli ale proiectului care se aplică la FIECARE task

- Rulezi totul din `app/` (`cd /Users/augustin598/Projects/CRM/app`).
- **NICIODATĂ `git add -A`** — worktree partajat cu alte sesiuni. Adaugi explicit doar fișierele tale.
- Teste: **`bun run test <filtru>`**, NU `bun test` (mock.module e global; fără proces per fișier apar ~238 eșecuri fantomă).
- Migrări: **o instrucțiune SQL per fișier**, **fără `IF NOT EXISTS`**, nume fără „ensure/fix", `grep` numele tabelului/indexului în `drizzle/*.sql` înainte. `drizzle-kit generate` e STRICAT (coliziune snapshot) → SQL scris de mână + intrare în `drizzle/meta/_journal.json` cu `when` mai mare decât maximul din jurnal **și** decât `max(created_at)` din `__drizzle_migrations` de pe remote. Nu atingi niciodată un fișier de migrare deja comis.
- **Coloanele/tabelele intră în `schema.ts` DOAR după ce migrarea e aplicată și verificată pe remote** (`db.select()` fără listă de coloane ar pica cu „no such column").
- DB-ul de dev = DB-ul de prod. Verifică fiecare migrare cu `PRAGMA table_info` după `bun run db:migrate` („success" nu înseamnă aplicat).
- Orice remote nou cere `requireStaff` sau scoping pe `client.id`; mutațiile de tarife doar owner/admin.
- După fiecare componentă `.svelte` nouă/modificată: `mcp__svelte__svelte-autofixer` cu `desired_svelte_version: 5`; la final `NODE_OPTIONS=--max-old-space-size=8192 bun run check`.
- Fără valori dinamice hardcodate (date, ani, counts).
- Înainte de fiecare commit: `bunx prettier --write <fișierele tale>` (config: tab-uri, ghilimele simple, printWidth 100); `bun run lint` face `prettier --check .` și ar pica altfel. Blocurile de cod din plan NU sunt garantat formatate.
- Commit-uri mici, mesaj în română, format `feat(hourly-rates): …`, cu linia `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` la final.

## Harta fișierelor

| Fișier | Rol |
|---|---|
| `src/lib/logic/hourly-catalog.ts` (nou) | Tipuri + funcții pure: sortare, filtrare active, tarif de referință, forme publice, slugify, reguli de blocare, formatare minute (erorile de remote se afișează cu `remoteErrorMessage` din `$lib/utils/remote-error`) |
| `src/lib/logic/__tests__/hourly-catalog.test.ts` (nou) | Testele logicii pure |
| `drizzle/0537_hourly_rate.sql` … `drizzle/0542_hour_credit_settings_tenant_uidx.sql` (noi) | 3 tabele + 3 indexuri unice, câte o instrucțiune per fișier |
| `drizzle/meta/_journal.json` (modificat) | 6 intrări noi |
| `src/lib/server/db/schema.ts` (modificat) | `hourlyRate`, `hourlyRateMode`, `hourCreditSettings` |
| `src/lib/server/hourly-catalog.ts` (nou) | `getHourlyCatalog(tenantId, { includeInactive })` + seed lazy din constante |
| `src/lib/server/__tests__/hourly-catalog.test.ts` (nou) | Seed lazy, filtrare, reguli implicite (DB mock-uit) |
| `src/lib/remotes/hourly-rates.remote.ts` (nou) | `getHourlyCatalogView` (staff sau portal), `getHourlyRatesAdmin` (staff), `createHourlyRate`, `updateHourlyRate`, `updateRateMode`, `updateHourCreditRules` (owner/admin) |
| `src/routes/[tenant]/settings/hourly-rates/+page.svelte` (nou) | Shell + boundary |
| `src/routes/[tenant]/settings/hourly-rates/HourlyRatesSettings.svelte` (nou) | Cele trei carduri, formular „specializare nouă" |
| `src/routes/[tenant]/settings/hourly-rates/RateRow.svelte` (nou) | Rând editabil specializare |
| `src/routes/[tenant]/settings/hourly-rates/ModeRow.svelte` (nou) | Rând editabil regim |
| `src/routes/[tenant]/settings/hourly-rates/CreditRulesForm.svelte` (nou) | Tarif de referință, prag, pas, notificări |
| `src/routes/[tenant]/settings/+layout.svelte` (modificat) | Tab „Tarife orare" |
| `src/routes/servicii/catalog.server.ts` (modificat) | Citește din `getHourlyCatalog` |
| `src/routes/servicii/+page.server.ts` (modificat) | Scoate importul nefolosit `HOURLY_RATES` |
| `src/lib/remotes/public-hours.remote.ts` (modificat) | Tarif + regim din DB |
| `src/lib/remotes/__tests__/public-hours.remote.test.ts` (modificat) | Mock pentru `$lib/server/hourly-catalog` |
| `src/lib/server/stripe/post-payment/emit-keez-hours-invoice.ts` (modificat) | Eticheta regimului din DB |
| `src/routes/[tenant]/services/PackageComparisonDialog.svelte` (modificat) | Tarife din `getHourlyCatalogView` |
| `src/lib/constants/ots-catalog.ts` (modificat) | `HOURLY_RATES`/`RATE_MODES` = seed; dispar `getHourlyRate`/`getRateMode`; `hourlyRateLabelFor` primește forme minimale |
| `src/lib/logic/__tests__/hours-pricing.test.ts` (modificat) | Fără `getRateMode` |
| `docs/ore-extra-work-regimuri.md` (modificat) | „How to apply": tarifele se schimbă din Settings |

---

### Task 0: Branch

- [ ] **Step 1: Creează branch-ul din main**

```bash
cd /Users/augustin598/Projects/CRM && git status --short | head
git checkout main && git pull --ff-only
git checkout -b feat/hour-credits-f1-hourly-rates
```

Expected: `Switched to a new branch 'feat/hour-credits-f1-hourly-rates'`. Dacă `git status` arată fișiere modificate de altă sesiune, NU le atinge și NU le adăuga la commit-urile tale.

---

### Task 1: Logica pură a catalogului

**Files:**
- Create: `src/lib/logic/hourly-catalog.ts`
- Test: `src/lib/logic/__tests__/hourly-catalog.test.ts`

- [ ] **Step 1: Scrie testele (pică: modulul nu există)**

```ts
// src/lib/logic/__tests__/hourly-catalog.test.ts
import { describe, test, expect } from 'bun:test';
import {
	DEFAULT_HOUR_CREDIT_RULES,
	activeRates,
	activeModes,
	resolveReferenceRate,
	toPublicHourlyRates,
	toPublicRateModes,
	slugifyRateLabel,
	uniqueRateSlug,
	rateDeactivationBlockReason,
	modeUpdateBlockReason,
	referenceRateBlockReason,
	formatMinutes,
	type CatalogRate,
	type CatalogMode
} from '../hourly-catalog';

const rate = (over: Partial<CatalogRate>): CatalogRate => ({
	id: 'r',
	slug: 'development',
	label: 'Development',
	rateEur: 65,
	sortOrder: 0,
	isActive: true,
	...over
});

const mode = (over: Partial<CatalogMode>): CatalogMode => ({
	id: 'm',
	slug: 'standard',
	label: 'Standard',
	suffix: '',
	description: '',
	sla: '',
	multiplierPct: 100,
	maxHours: 100,
	sortOrder: 0,
	isActive: true,
	...over
});

const RATES = [
	rate({ id: 'dev', slug: 'development', label: 'Development', rateEur: 65, sortOrder: 0 }),
	rate({ id: 'des', slug: 'design-ui-ux', label: 'Design UI/UX', rateEur: 70, sortOrder: 1 }),
	rate({ id: 'pm', slug: 'project-management', label: 'Project Management', rateEur: 55, sortOrder: 2 }),
	rate({ id: 'ops', slug: 'devops-api', label: 'DevOps / API', rateEur: 80, sortOrder: 3, isActive: false })
];

describe('activeRates / activeModes', () => {
	test('păstrează doar rândurile active, sortate după sortOrder apoi label', () => {
		const shuffled = [RATES[2], RATES[3], RATES[0], RATES[1]];
		expect(activeRates(shuffled).map((r) => r.slug)).toEqual([
			'development',
			'design-ui-ux',
			'project-management'
		]);
		const modes = [
			mode({ id: 'b', slug: 'urgent', sortOrder: 1 }),
			mode({ id: 'a', slug: 'standard', sortOrder: 0 }),
			mode({ id: 'c', slug: 'night', sortOrder: 3, isActive: false })
		];
		expect(activeModes(modes).map((m) => m.slug)).toEqual(['standard', 'urgent']);
	});
});

describe('resolveReferenceRate', () => {
	test('fără setare explicită = cel mai mic tarif ACTIV', () => {
		expect(resolveReferenceRate(RATES, DEFAULT_HOUR_CREDIT_RULES)?.slug).toBe('project-management');
	});

	test('setarea explicită câștigă dacă e activă', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'design-ui-ux' };
		expect(resolveReferenceRate(RATES, rules)?.slug).toBe('design-ui-ux');
	});

	test('setarea explicită pe un tarif inactiv cade înapoi pe cel mai mic activ', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'devops-api' };
		expect(resolveReferenceRate(RATES, rules)?.slug).toBe('project-management');
	});

	test('fără tarife active → null', () => {
		expect(resolveReferenceRate([rate({ isActive: false })], DEFAULT_HOUR_CREDIT_RULES)).toBeNull();
	});
});

describe('forme publice', () => {
	test('toPublicHourlyRates: doar active, forma { slug, label, rate }', () => {
		expect(toPublicHourlyRates(RATES)).toEqual([
			{ slug: 'development', label: 'Development', rate: 65 },
			{ slug: 'design-ui-ux', label: 'Design UI/UX', rate: 70 },
			{ slug: 'project-management', label: 'Project Management', rate: 55 }
		]);
	});

	test('toPublicRateModes: doar active, fără id/sortOrder/isActive', () => {
		const out = toPublicRateModes([
			mode({ id: 'x', slug: 'urgent', label: 'Urgență', suffix: 'Urgență 48h', multiplierPct: 150, maxHours: 40, sortOrder: 1 }),
			mode({ id: 'y', slug: 'night', sortOrder: 2, isActive: false })
		]);
		expect(out).toEqual([
			{
				slug: 'urgent',
				label: 'Urgență',
				suffix: 'Urgență 48h',
				description: '',
				sla: '',
				multiplierPct: 150,
				maxHours: 40
			}
		]);
	});
});

describe('slug-uri', () => {
	test('slugifyRateLabel elimină diacritice și caractere speciale', () => {
		expect(slugifyRateLabel('Design UI/UX')).toBe('design-ui-ux');
		expect(slugifyRateLabel('  Consultanță & Strategie  ')).toBe('consultanta-strategie');
		expect(slugifyRateLabel('DevOps / API')).toBe('devops-api');
	});

	test('uniqueRateSlug adaugă sufix numeric la coliziune', () => {
		expect(uniqueRateSlug('development', ['development'])).toBe('development-2');
		expect(uniqueRateSlug('development', ['development', 'development-2'])).toBe('development-3');
		expect(uniqueRateSlug('qa', [])).toBe('qa');
	});
});

describe('reguli de blocare', () => {
	test('nu poți dezactiva ultima specializare activă', () => {
		const only = [rate({ slug: 'development' }), rate({ id: 'x', slug: 'qa', isActive: false })];
		expect(rateDeactivationBlockReason(only, 'development', DEFAULT_HOUR_CREDIT_RULES)).toMatch(/ultima/);
	});

	test('nu poți dezactiva tariful de referință ales explicit', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'development' };
		expect(rateDeactivationBlockReason(RATES, 'development', rules)).toMatch(/referin/);
	});

	test('dezactivarea unei specializări obișnuite e permisă', () => {
		expect(rateDeactivationBlockReason(RATES, 'design-ui-ux', DEFAULT_HOUR_CREDIT_RULES)).toBeNull();
	});

	test('regimul standard rămâne 100% și activ', () => {
		expect(modeUpdateBlockReason('standard', { multiplierPct: 150, isActive: true })).toMatch(/standard/);
		expect(modeUpdateBlockReason('standard', { multiplierPct: 100, isActive: false })).toMatch(/standard/);
		expect(modeUpdateBlockReason('standard', { multiplierPct: 100, isActive: true })).toBeNull();
		expect(modeUpdateBlockReason('urgent', { multiplierPct: 150, isActive: false })).toBeNull();
	});

	test('referința trebuie să fie o specializare activă (sau null)', () => {
		expect(referenceRateBlockReason(RATES, null)).toBeNull();
		expect(referenceRateBlockReason(RATES, 'development')).toBeNull();
		expect(referenceRateBlockReason(RATES, 'devops-api')).toMatch(/activ/);
		expect(referenceRateBlockReason(RATES, 'nu-exista')).toMatch(/exist/);
	});
});

describe('formatMinutes', () => {
	test('ore și minute în română', () => {
		expect(formatMinutes(0)).toBe('0 min');
		expect(formatMinutes(45)).toBe('45 min');
		expect(formatMinutes(60)).toBe('1 h');
		expect(formatMinutes(135)).toBe('2 h 15 min');
		expect(formatMinutes(-90)).toBe('-1 h 30 min');
	});
});

```

- [ ] **Step 2: Rulează testul ca să vezi că pică**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run test hourly-catalog
```

Expected: FAIL — `Cannot find module '../hourly-catalog'`.

- [ ] **Step 3: Scrie modulul**

```ts
// src/lib/logic/hourly-catalog.ts
/**
 * Catalogul de tarife orare — tipuri și reguli PURE.
 *
 * Fără DB, fără import de VALORI din `ots-catalog` (constantele cu prețuri
 * rămân server-side; aici doar tipuri). Tot ce e testabil fără bază stă aici:
 * sortare, filtrare, tarif de referință, forme publice, slug-uri, reguli de
 * blocare la editare. Serverul (`$lib/server/hourly-catalog.ts`) și remote-ul
 * doar citesc/scriu rânduri și cheamă funcțiile de aici.
 */
import type { RateModeSlug } from './hours-pricing';

export interface CatalogRate {
	id: string;
	slug: string;
	label: string;
	/** EUR întregi pe oră, fără TVA. */
	rateEur: number;
	sortOrder: number;
	isActive: boolean;
}

export interface CatalogMode {
	id: string;
	slug: RateModeSlug;
	label: string;
	/** Sufixul din `rate_label` / linia Keez („Development (Urgență 48h)"); gol la standard. */
	suffix: string;
	/** O propoziție sub selectorul de regim, pe /servicii. */
	description: string;
	/** Angajamentul comercial; se îngheață în `mode_sla_snapshot` la plată. */
	sla: string;
	/** Procent aplicat tarifului de bază (100 = fără majorare). */
	multiplierPct: number;
	/** Plafon de ore per comandă publică. */
	maxHours: number;
	sortOrder: number;
	isActive: boolean;
}

export interface HourCreditRules {
	/** null = cel mai mic tarif activ; altfel slug-ul ales explicit. */
	referenceRateSlug: string | null;
	lowCreditThresholdMinutes: number;
	stepMinutes: number;
	notifyEmail: boolean;
	notifyWhatsapp: boolean;
}

export interface HourlyCatalog {
	rates: CatalogRate[];
	modes: CatalogMode[];
	rules: HourCreditRules;
}

/** Forma trimisă spre browser (PublicCatalog.hourlyRates, PackageComparisonView). */
export interface PublicHourlyRate {
	slug: string;
	label: string;
	rate: number;
}

/** Forma trimisă spre browser (PublicCatalog.rateModes) — identică cu `RateMode` din ots-catalog. */
export interface PublicRateMode {
	slug: RateModeSlug;
	label: string;
	suffix: string;
	description: string;
	sla: string;
	multiplierPct: number;
	maxHours: number;
}

export const DEFAULT_HOUR_CREDIT_RULES: HourCreditRules = {
	referenceRateSlug: null,
	lowCreditThresholdMinutes: 120,
	stepMinutes: 15,
	notifyEmail: true,
	notifyWhatsapp: true
};

export const STEP_MINUTES_OPTIONS = [15, 30, 60] as const;
export const RATE_EUR_MIN = 1;
export const RATE_EUR_MAX = 999;
export const MULTIPLIER_PCT_MIN = 100;
export const MULTIPLIER_PCT_MAX = 500;
export const MAX_HOURS_MIN = 1;
export const MAX_HOURS_MAX = 500;
export const RATE_SLUG_MAX_LENGTH = 40;

function bySortThenLabel<T extends { sortOrder: number; label: string }>(a: T, b: T): number {
	return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ro');
}

export function sortRates(rates: CatalogRate[]): CatalogRate[] {
	return [...rates].sort(bySortThenLabel);
}

export function sortModes(modes: CatalogMode[]): CatalogMode[] {
	return [...modes].sort(bySortThenLabel);
}

export function activeRates(rates: CatalogRate[]): CatalogRate[] {
	return sortRates(rates.filter((r) => r.isActive));
}

export function activeModes(modes: CatalogMode[]): CatalogMode[] {
	return sortModes(modes.filter((m) => m.isActive));
}

/**
 * Tariful de referință: cel ales explicit în reguli dacă e activ, altfel cel
 * mai mic tarif activ. Null doar dacă nu există nicio specializare activă.
 */
export function resolveReferenceRate(
	rates: CatalogRate[],
	rules: HourCreditRules
): CatalogRate | null {
	const active = activeRates(rates);
	const explicitSlug = rules.referenceRateSlug || null;
	if (explicitSlug) {
		const explicit = active.find((r) => r.slug === explicitSlug);
		if (explicit) return explicit;
	}
	if (active.length === 0) return null;
	return active.reduce((min, r) => (r.rateEur < min.rateEur ? r : min));
}

export function toPublicHourlyRates(rates: CatalogRate[]): PublicHourlyRate[] {
	return activeRates(rates).map((r) => ({ slug: r.slug, label: r.label, rate: r.rateEur }));
}

export function toPublicRateModes(modes: CatalogMode[]): PublicRateMode[] {
	return activeModes(modes).map((m) => ({
		slug: m.slug,
		label: m.label,
		suffix: m.suffix,
		description: m.description,
		sla: m.sla,
		multiplierPct: m.multiplierPct,
		maxHours: m.maxHours
	}));
}

/** „Design UI/UX" → „design-ui-ux"; fără diacritice, doar [a-z0-9-]. */
export function slugifyRateLabel(label: string): string {
	return label
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, RATE_SLUG_MAX_LENGTH)
		.replace(/^-+|-+$/g, '');
}

/** `base` dacă e liber, altfel `base-2`, `base-3`… — mereu ≤ RATE_SLUG_MAX_LENGTH. */
export function uniqueRateSlug(base: string, taken: readonly string[]): string {
	if (!taken.includes(base)) return base;
	for (let n = 2; ; n++) {
		const suffix = `-${n}`;
		const candidate = `${base.slice(0, RATE_SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
		if (!taken.includes(candidate)) return candidate;
	}
}

/** De ce NU se poate dezactiva o specializare; null = permis. */
export function rateDeactivationBlockReason(
	rates: CatalogRate[],
	slug: string,
	rules: HourCreditRules
): string | null {
	if (rules.referenceRateSlug === slug) {
		return 'Specializarea e tariful de referință al creditului de ore. Alege altă referință întâi.';
	}
	const otherActive = rates.filter((r) => r.isActive && r.slug !== slug);
	if (otherActive.length === 0) {
		return 'Nu poți dezactiva ultima specializare activă.';
	}
	return null;
}

/** Regimul standard e ancora grilei: mereu 100% și activ. */
export function modeUpdateBlockReason(
	slug: RateModeSlug,
	input: { multiplierPct: number; isActive: boolean }
): string | null {
	if (slug !== 'standard') return null;
	if (input.multiplierPct !== 100) return 'Regimul standard rămâne la 100% — majorările se setează pe celelalte regimuri.';
	if (!input.isActive) return 'Regimul standard nu poate fi dezactivat.';
	return null;
}

/** Referința explicită trebuie să existe și să fie activă. */
export function referenceRateBlockReason(rates: CatalogRate[], slug: string | null): string | null {
	const wanted = slug || null;
	if (wanted === null) return null;
	const found = rates.find((r) => r.slug === wanted);
	if (!found) return 'Specializarea aleasă ca referință nu există.';
	if (!found.isActive) return 'Specializarea aleasă ca referință trebuie să fie activă.';
	return null;
}

/** 135 → „2 h 15 min"; 60 → „1 h"; 45 → „45 min". */
export function formatMinutes(minutes: number): string {
	if (!Number.isFinite(minutes)) return '—';
	const sign = minutes < 0 ? '-' : '';
	const abs = Math.abs(Math.trunc(minutes));
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	if (h === 0) return `${sign}${m} min`;
	if (m === 0) return `${sign}${h} h`;
	return `${sign}${h} h ${m} min`;
}

```

- [ ] **Step 4: Rulează testele**

```bash
bun run test hourly-catalog
```

Expected: `1 fișier · N pass · 0 fail` (toate testele din `hourly-catalog.test.ts` trec).

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/logic/hourly-catalog.ts app/src/lib/logic/__tests__/hourly-catalog.test.ts
git commit -m "feat(hourly-rates): logica pură a catalogului de tarife orare (forme, referință, slug-uri, reguli)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migrările (3 tabele + 3 indexuri unice)

**Files:**
- Create: `drizzle/0537_hourly_rate.sql`, `drizzle/0538_hourly_rate_tenant_slug_uidx.sql`, `drizzle/0539_hourly_rate_mode.sql`, `drizzle/0540_hourly_rate_mode_tenant_slug_uidx.sql`, `drizzle/0541_hour_credit_settings.sql`, `drizzle/0542_hour_credit_settings_tenant_uidx.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Verifică că numele nu există deja și că ultima migrare e 0536**

```bash
cd /Users/augustin598/Projects/CRM/app
grep -l 'CREATE TABLE `hourly_rate`\|CREATE TABLE `hourly_rate_mode`\|CREATE TABLE `hour_credit_settings`\|hourly_rate_tenant_slug_uidx\|hourly_rate_mode_tenant_slug_uidx\|hour_credit_settings_tenant_uidx' drizzle/*.sql; echo "exit=$?"
ls drizzle/*.sql | tail -1
ls drizzle/*.sql | wc -l; grep -c '"idx"' drizzle/meta/_journal.json
```

Expected: `grep` nu găsește nimic (`exit=1`) — atenție, un grep simplu pe „hourly_rate" prinde și coloana `tenant_user.hourly_rate` din migrările 0047/0258, care NU au legătură; ultima e `drizzle/0536_hours_order_requested_window.sql`; numărul de fișiere `.sql` = numărul de intrări din jurnal (numerotarea are goluri, deci numărul e mai mic decât indexul: la scrierea planului 534 = 534). Dacă ultima migrare NU e 0536 (altă sesiune a adăugat între timp), continuă numerotarea de la ultimul index existent și ajustează numele de mai jos.

- [ ] **Step 2: Scrie cele 6 fișiere SQL (câte o instrucțiune per fișier, fără IF NOT EXISTS)**

```sql
-- drizzle/0537_hourly_rate.sql
CREATE TABLE `hourly_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`rate_eur` integer NOT NULL,
	`sort_order` integer NOT NULL DEFAULT 0,
	`is_active` integer NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
```

```sql
-- drizzle/0538_hourly_rate_tenant_slug_uidx.sql
CREATE UNIQUE INDEX `hourly_rate_tenant_slug_uidx` ON `hourly_rate` (`tenant_id`,`slug`);
```

```sql
-- drizzle/0539_hourly_rate_mode.sql
CREATE TABLE `hourly_rate_mode` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`suffix` text NOT NULL DEFAULT '',
	`description` text NOT NULL DEFAULT '',
	`sla` text NOT NULL DEFAULT '',
	`multiplier_pct` integer NOT NULL DEFAULT 100,
	`max_hours` integer NOT NULL DEFAULT 100,
	`sort_order` integer NOT NULL DEFAULT 0,
	`is_active` integer NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
```

```sql
-- drizzle/0540_hourly_rate_mode_tenant_slug_uidx.sql
CREATE UNIQUE INDEX `hourly_rate_mode_tenant_slug_uidx` ON `hourly_rate_mode` (`tenant_id`,`slug`);
```

```sql
-- drizzle/0541_hour_credit_settings.sql
CREATE TABLE `hour_credit_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`reference_rate_slug` text,
	`low_credit_threshold_minutes` integer NOT NULL DEFAULT 120,
	`step_minutes` integer NOT NULL DEFAULT 15,
	`notify_email` integer NOT NULL DEFAULT 1,
	`notify_whatsapp` integer NOT NULL DEFAULT 1,
	`updated_by_user_id` text REFERENCES `user`(`id`),
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
```

```sql
-- drizzle/0542_hour_credit_settings_tenant_uidx.sql
CREATE UNIQUE INDEX `hour_credit_settings_tenant_uidx` ON `hour_credit_settings` (`tenant_id`);
```

(Scrie fișierele FĂRĂ linia de comentariu `-- drizzle/...` — e doar ca să știi ce fișier e.)

- [ ] **Step 3: Citește `max(created_at)` de pe remote**

```bash
bun -e "import { createClient } from '@libsql/client'; const c = createClient({ url: process.env.SQLITE_URI, authToken: process.env.SQLITE_AUTH_TOKEN }); const r = await c.execute('SELECT max(created_at) AS m FROM __drizzle_migrations'); console.log(String(r.rows[0].m));"
```

Expected: un număr (ex. `1788786476908004`). Notează-l ca `REMOTE_MAX`.

- [ ] **Step 4: Adaugă cele 6 intrări în jurnal cu `when` peste ambele maxime**

```bash
REMOTE_MAX=<numărul de mai sus> bun -e "
const fs = require('fs');
const p = 'drizzle/meta/_journal.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const tags = [
  '0537_hourly_rate',
  '0538_hourly_rate_tenant_slug_uidx',
  '0539_hourly_rate_mode',
  '0540_hourly_rate_mode_tenant_slug_uidx',
  '0541_hour_credit_settings',
  '0542_hour_credit_settings_tenant_uidx'
];
const remoteMax = Number(process.env.REMOTE_MAX);
if (!Number.isFinite(remoteMax) || remoteMax <= 0) throw new Error('REMOTE_MAX lipsă');
let when = Math.max(remoteMax, ...j.entries.map((e) => e.when));
const lastIdx = j.entries[j.entries.length - 1].idx;
for (const [i, tag] of tags.entries()) {
  if (j.entries.some((e) => e.tag === tag)) throw new Error('există deja: ' + tag);
  j.entries.push({ idx: lastIdx + 1 + i, version: '6', when: ++when, tag, breakpoints: true });
}
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('adăugate', tags.length, 'intrări; ultimul when =', when);
"
tail -c 600 drizzle/meta/_journal.json
ls drizzle/*.sql | wc -l; grep -c '"idx"' drizzle/meta/_journal.json
```

Expected: cele 6 intrări la finalul jurnalului, `idx` 537–542, `when` strict crescător și > `REMOTE_MAX`; numărul de `.sql` = numărul de intrări (ambele cu 6 mai mari decât la Step 1, ex. 540 = 540).

- [ ] **Step 5: Aplică și VERIFICĂ pe remote**

```bash
bun run db:migrate
bun -e "import { createClient } from '@libsql/client'; const c = createClient({ url: process.env.SQLITE_URI, authToken: process.env.SQLITE_AUTH_TOKEN }); for (const t of ['hourly_rate','hourly_rate_mode','hour_credit_settings']) { const r = await c.execute('PRAGMA table_info(' + t + ')'); console.log(t + ':', r.rows.map((x) => x.name).join(', ')); } const i = await c.execute(\"SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'hourly_rate%' OR name LIKE 'hour_credit%')\"); console.log('indexuri:', i.rows.map((x) => x.name).join(', '));"
```

Expected:
```
hourly_rate: id, tenant_id, slug, label, rate_eur, sort_order, is_active, created_at, updated_at
hourly_rate_mode: id, tenant_id, slug, label, suffix, description, sla, multiplier_pct, max_hours, sort_order, is_active, created_at, updated_at
hour_credit_settings: id, tenant_id, reference_rate_slug, low_credit_threshold_minutes, step_minutes, notify_email, notify_whatsapp, updated_by_user_id, created_at, updated_at
indexuri: hourly_rate_tenant_slug_uidx, hourly_rate_mode_tenant_slug_uidx, hour_credit_settings_tenant_uidx
```
Dacă lipsește ceva: rulează instrucțiunea lipsă direct cu `c.execute(...)` (vezi memoria „Migration flow — verify on Turso"), apoi repetă verificarea. NU trece mai departe fără toate cele 3 tabele și 3 indexuri.

- [ ] **Step 6: Baza curată din migrări (prinde statement-uri rupte)**

```bash
rm -f /tmp/clean.db
SQLITE_PATH=/tmp/clean.db SQLITE_URI= SQLITE_AUTH_TOKEN= bunx --bun drizzle-kit migrate 2>&1 | tail -3
bun -e "import { createClient } from '@libsql/client'; const c = createClient({ url: 'file:/tmp/clean.db' }); const r = await c.execute(\"SELECT name FROM sqlite_master WHERE name LIKE 'hourly_rate%' OR name LIKE 'hour_credit%' ORDER BY name\"); console.log(r.rows.map((x) => x.name).join(', '));"
```

Expected: fără erori; lista conține cele 3 tabele și cele 3 indexuri.

- [ ] **Step 7: Commit (doar fișierele tale)**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0537_hourly_rate.sql app/drizzle/0538_hourly_rate_tenant_slug_uidx.sql app/drizzle/0539_hourly_rate_mode.sql app/drizzle/0540_hourly_rate_mode_tenant_slug_uidx.sql app/drizzle/0541_hour_credit_settings.sql app/drizzle/0542_hour_credit_settings_tenant_uidx.sql app/drizzle/meta/_journal.json
git diff --cached --stat
git commit -m "feat(hourly-rates): tabelele hourly_rate, hourly_rate_mode, hour_credit_settings (migrări 0537–0542)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `git diff --cached --stat` arată exact 7 fișiere.

---

### Task 3: Schema Drizzle (după ce migrarea e aplicată și verificată)

**Files:**
- Modify: `src/lib/server/db/schema.ts` (imediat după `serviceHoursOrder`, înainte de comentariul „Acces cu parola pentru paginile publice")

- [ ] **Step 1: Adaugă tabelele**

```ts
// ---- Tarife orare per tenant (Settings → Tarife orare) ------------------------
//
// Sursa de adevăr pentru /servicii, comanda de ore (service_hours_order), emitentul
// Keez și creditul de ore. Constantele HOURLY_RATES / RATE_MODES din ots-catalog
// rămân doar SEED la prima citire a unui tenant (vezi $lib/server/hourly-catalog.ts).
export const hourlyRate = sqliteTable(
	'hourly_rate',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		/** Identificator stabil — ajunge în service_hours_order.rate_slug și în metadata Stripe; nu se redenumește. */
		slug: text('slug').notNull(),
		label: text('label').notNull(),
		/** EUR întregi pe oră, fără TVA. */
		rateEur: integer('rate_eur').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => [uniqueIndex('hourly_rate_tenant_slug_uidx').on(t.tenantId, t.slug)]
);

// Regimurile de lucru (standard / urgent / weekend / night). Slug-urile sunt fixe
// (RATE_MODE_SLUGS din $lib/logic/hours-pricing.ts); doar valorile se editează.
export const hourlyRateMode = sqliteTable(
	'hourly_rate_mode',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		slug: text('slug').notNull(),
		label: text('label').notNull(),
		suffix: text('suffix').notNull().default(''),
		description: text('description').notNull().default(''),
		sla: text('sla').notNull().default(''),
		multiplierPct: integer('multiplier_pct').notNull().default(100),
		maxHours: integer('max_hours').notNull().default(100),
		sortOrder: integer('sort_order').notNull().default(0),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => [uniqueIndex('hourly_rate_mode_tenant_slug_uidx').on(t.tenantId, t.slug)]
);

// Regulile creditului de ore — un rând per tenant; lipsa rândului = valorile
// implicite din DEFAULT_HOUR_CREDIT_RULES ($lib/logic/hourly-catalog.ts).
export const hourCreditSettings = sqliteTable(
	'hour_credit_settings',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		/** null = cel mai mic tarif activ. */
		referenceRateSlug: text('reference_rate_slug'),
		lowCreditThresholdMinutes: integer('low_credit_threshold_minutes').notNull().default(120),
		stepMinutes: integer('step_minutes').notNull().default(15),
		notifyEmail: boolean('notify_email').notNull().default(true),
		notifyWhatsapp: boolean('notify_whatsapp').notNull().default(true),
		updatedByUserId: text('updated_by_user_id').references(() => user.id),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => [uniqueIndex('hour_credit_settings_tenant_uidx').on(t.tenantId)]
);
```

- [ ] **Step 2: Verifică tipurile**

```bash
NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | tail -5
```

Expected: `svelte-check found 0 errors and 0 warnings` (sau același număr de warning-uri ca înainte de task — nu mai multe).

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/server/db/schema.ts
git commit -m "feat(hourly-rates): schema Drizzle pentru hourly_rate, hourly_rate_mode, hour_credit_settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Cititorul server-side cu seed lazy

**Files:**
- Create: `src/lib/server/hourly-catalog.ts`
- Test: `src/lib/server/__tests__/hourly-catalog.test.ts`

- [ ] **Step 1: Scrie testul (DB mock-uit)**

```ts
// src/lib/server/__tests__/hourly-catalog.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })
}));
mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (op: () => Promise<unknown>) => op()
}));

const schema = await import('$lib/server/db/schema');

let rateRows: any[] = [];
let modeRows: any[] = [];
let rulesRows: any[] = [];
let inserted: Array<{ table: unknown; rows: any[] }> = [];

function rowsFor(t: unknown): any[] {
	if (t === schema.hourlyRate) return rateRows;
	if (t === schema.hourlyRateMode) return modeRows;
	if (t === schema.hourCreditSettings) return rulesRows;
	throw new Error('tabel neașteptat în test');
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: (t: unknown) => ({
				where: async () => rowsFor(t)
			})
		}),
		insert: (t: unknown) => ({
			values: (rows: any[]) => ({
				onConflictDoNothing: async () => {
					inserted.push({ table: t, rows });
					rowsFor(t).push(...rows);
				}
			})
		})
	}
}));

const { getHourlyCatalog } = await import('../hourly-catalog');
const { HOURLY_RATES, RATE_MODES } = await import('$lib/constants/ots-catalog');

beforeEach(() => {
	rateRows = [];
	modeRows = [];
	rulesRows = [];
	inserted = [];
});

describe('getHourlyCatalog — seed lazy', () => {
	test('tenant fără rânduri → inserează constantele și le returnează', async () => {
		const catalog = await getHourlyCatalog('t1');
		expect(inserted).toHaveLength(2);
		expect(inserted[0].table).toBe(schema.hourlyRate);
		expect(inserted[0].rows).toHaveLength(HOURLY_RATES.length);
		expect(inserted[0].rows.every((r) => r.tenantId === 't1')).toBe(true);
		expect(inserted[1].table).toBe(schema.hourlyRateMode);
		expect(inserted[1].rows).toHaveLength(RATE_MODES.length);

		expect(catalog.rates.map((r) => [r.slug, r.rateEur])).toEqual(
			HOURLY_RATES.map((r) => [r.slug, r.rate])
		);
		expect(catalog.modes.map((m) => [m.slug, m.multiplierPct, m.maxHours])).toEqual(
			RATE_MODES.map((m) => [m.slug, m.multiplierPct, m.maxHours])
		);
		expect(catalog.rules).toEqual({
			referenceRateSlug: null,
			lowCreditThresholdMinutes: 120,
			stepMinutes: 15,
			notifyEmail: true,
			notifyWhatsapp: true
		});
	});

	test('tenant cu rânduri → nu inserează nimic, nu returnează inactive by default', async () => {
		rateRows = [
			{ id: 'a', tenantId: 't1', slug: 'development', label: 'Dev', rateEur: 70, sortOrder: 1, isActive: true },
			{ id: 'b', tenantId: 't1', slug: 'qa', label: 'QA', rateEur: 40, sortOrder: 0, isActive: false }
		];
		modeRows = [
			{ id: 'm', tenantId: 't1', slug: 'standard', label: 'Standard', suffix: '', description: '', sla: '', multiplierPct: 100, maxHours: 100, sortOrder: 0, isActive: true },
			{ id: 'n', tenantId: 't1', slug: 'night', label: 'Noapte', suffix: 'Noapte', description: '', sla: '', multiplierPct: 200, maxHours: 16, sortOrder: 3, isActive: false }
		];
		rulesRows = [
			{ id: 's', tenantId: 't1', referenceRateSlug: 'development', lowCreditThresholdMinutes: 60, stepMinutes: 30, notifyEmail: false, notifyWhatsapp: true }
		];

		const catalog = await getHourlyCatalog('t1');
		expect(inserted).toHaveLength(0);
		expect(catalog.rates.map((r) => r.slug)).toEqual(['development']);
		expect(catalog.modes.map((m) => m.slug)).toEqual(['standard']);
		expect(catalog.rules).toEqual({
			referenceRateSlug: 'development',
			lowCreditThresholdMinutes: 60,
			stepMinutes: 30,
			notifyEmail: false,
			notifyWhatsapp: true
		});

		const all = await getHourlyCatalog('t1', { includeInactive: true });
		expect(all.rates.map((r) => r.slug)).toEqual(['qa', 'development']);
		expect(all.modes.map((m) => m.slug)).toEqual(['standard', 'night']);
	});

	test('rândurile de regim cu slug necunoscut sunt ignorate', async () => {
		rateRows = [{ id: 'a', tenantId: 't1', slug: 'development', label: 'Dev', rateEur: 65, sortOrder: 0, isActive: true }];
		modeRows = [
			{ id: 'm', tenantId: 't1', slug: 'standard', label: 'Standard', suffix: '', description: '', sla: '', multiplierPct: 100, maxHours: 100, sortOrder: 0, isActive: true },
			{ id: 'x', tenantId: 't1', slug: 'holiday', label: '?', suffix: '', description: '', sla: '', multiplierPct: 300, maxHours: 8, sortOrder: 9, isActive: true }
		];
		const catalog = await getHourlyCatalog('t1');
		expect(catalog.modes.map((m) => m.slug)).toEqual(['standard']);
	});
});
```

- [ ] **Step 2: Rulează testul ca să vezi că pică**

```bash
bun run test server/__tests__/hourly-catalog
```

Expected: FAIL — `Cannot find module '../hourly-catalog'`.

- [ ] **Step 3: Scrie modulul**

```ts
// src/lib/server/hourly-catalog.ts
/**
 * Singurul cititor al catalogului de tarife orare.
 *
 * Îl folosesc /servicii (catalog.server.ts), comanda de ore (public-hours.remote),
 * emitentul Keez pentru ore, pagina Settings → Tarife orare și (din faza 2)
 * creditul de ore. Nimeni nu mai citește HOURLY_RATES / RATE_MODES direct.
 *
 * Seed lazy: un tenant fără rânduri primește constantele din ots-catalog la
 * prima citire. Inserția e idempotentă (index unic pe tenant+slug +
 * onConflictDoNothing), deci două cereri simultane nu pot dubla nimic.
 */
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { HOURLY_RATES, RATE_MODES } from '$lib/constants/ots-catalog';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo } from '$lib/server/logger';
import { isRateModeSlug } from '$lib/logic/hours-pricing';
import {
	DEFAULT_HOUR_CREDIT_RULES,
	sortModes,
	sortRates,
	type CatalogMode,
	type CatalogRate,
	type HourCreditRules,
	type HourlyCatalog
} from '$lib/logic/hourly-catalog';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

type RateRow = typeof table.hourlyRate.$inferSelect;
type ModeRow = typeof table.hourlyRateMode.$inferSelect;
type RulesRow = typeof table.hourCreditSettings.$inferSelect;

function rowToRate(r: RateRow): CatalogRate {
	return {
		id: r.id,
		slug: r.slug,
		label: r.label,
		rateEur: r.rateEur,
		sortOrder: r.sortOrder,
		isActive: !!r.isActive
	};
}

function rowToMode(r: ModeRow, tenantId: string): CatalogMode | null {
	if (!isRateModeSlug(r.slug)) {
		logError('hourly-catalog', `regim necunoscut în DB: ${r.slug} (tenant ${tenantId}) — ignorat`, {
			tenantId
		});
		return null;
	}
	return {
		id: r.id,
		slug: r.slug,
		label: r.label,
		suffix: r.suffix,
		description: r.description,
		sla: r.sla,
		multiplierPct: r.multiplierPct,
		maxHours: r.maxHours,
		sortOrder: r.sortOrder,
		isActive: !!r.isActive
	};
}

function rowToRules(r: RulesRow | undefined): HourCreditRules {
	if (!r) return { ...DEFAULT_HOUR_CREDIT_RULES };
	return {
		referenceRateSlug: r.referenceRateSlug ?? null,
		lowCreditThresholdMinutes: r.lowCreditThresholdMinutes,
		stepMinutes: r.stepMinutes,
		notifyEmail: !!r.notifyEmail,
		notifyWhatsapp: !!r.notifyWhatsapp
	};
}

async function loadRates(tenantId: string): Promise<RateRow[]> {
	return db.select().from(table.hourlyRate).where(eq(table.hourlyRate.tenantId, tenantId));
}

async function loadModes(tenantId: string): Promise<ModeRow[]> {
	return db.select().from(table.hourlyRateMode).where(eq(table.hourlyRateMode.tenantId, tenantId));
}

async function loadRules(tenantId: string): Promise<RulesRow | undefined> {
	const rows = await db
		.select()
		.from(table.hourCreditSettings)
		.where(eq(table.hourCreditSettings.tenantId, tenantId));
	return rows[0];
}

/** Rândurile de seed pentru un tenant nou — din constantele care erau până acum singura sursă. */
export function seedRateRows(tenantId: string): (typeof table.hourlyRate.$inferInsert)[] {
	return HOURLY_RATES.map((r, i) => ({
		id: generateId(),
		tenantId,
		slug: r.slug,
		label: r.label,
		rateEur: r.rate,
		sortOrder: i,
		isActive: true
	}));
}

export function seedModeRows(tenantId: string): (typeof table.hourlyRateMode.$inferInsert)[] {
	return RATE_MODES.map((m, i) => ({
		id: generateId(),
		tenantId,
		slug: m.slug,
		label: m.label,
		suffix: m.suffix,
		description: m.description,
		sla: m.sla,
		multiplierPct: m.multiplierPct,
		maxHours: m.maxHours,
		sortOrder: i,
		isActive: true
	}));
}

async function seedRates(tenantId: string): Promise<void> {
	await withTursoBusyRetry(
		() => db.insert(table.hourlyRate).values(seedRateRows(tenantId)).onConflictDoNothing(),
		{ tenantId, label: 'hourly-catalog.seedRates' }
	);
	logInfo('hourly-catalog', `seed tarife orare pentru tenant ${tenantId}`, { tenantId });
}

async function seedModes(tenantId: string): Promise<void> {
	await withTursoBusyRetry(
		() => db.insert(table.hourlyRateMode).values(seedModeRows(tenantId)).onConflictDoNothing(),
		{ tenantId, label: 'hourly-catalog.seedModes' }
	);
	logInfo('hourly-catalog', `seed regimuri de lucru pentru tenant ${tenantId}`, { tenantId });
}

export async function getHourlyCatalog(
	tenantId: string,
	opts: { includeInactive?: boolean } = {}
): Promise<HourlyCatalog> {
	let [rateRows, modeRows] = await Promise.all([loadRates(tenantId), loadModes(tenantId)]);
	if (rateRows.length === 0) {
		await seedRates(tenantId);
		rateRows = await loadRates(tenantId);
	}
	if (modeRows.length === 0) {
		await seedModes(tenantId);
		modeRows = await loadModes(tenantId);
	}
	const rules = rowToRules(await loadRules(tenantId));

	const rates = rateRows.map(rowToRate);
	const modes = modeRows
		.map((r) => rowToMode(r, tenantId))
		.filter((m): m is CatalogMode => m !== null);
	const keep = <T extends { isActive: boolean }>(x: T) => opts.includeInactive || x.isActive;

	return {
		rates: sortRates(rates.filter(keep)),
		modes: sortModes(modes.filter(keep)),
		rules
	};
}
```

- [ ] **Step 4: Rulează testele**

```bash
bun run test hourly-catalog
```

Expected: 2 fișiere, toate testele trec (`0 fail`).

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/server/hourly-catalog.ts app/src/lib/server/__tests__/hourly-catalog.test.ts
git commit -m "feat(hourly-rates): getHourlyCatalog cu seed lazy din constante

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Remote functions (citire + mutații owner/admin)

**Files:**
- Create: `src/lib/remotes/hourly-rates.remote.ts`

- [ ] **Step 1: Scrie remote-ul**

```ts
// src/lib/remotes/hourly-rates.remote.ts
/**
 * Settings → Tarife orare.
 *
 * - `getHourlyCatalogView`: forma publică (doar active) pentru dialogul de
 *   comparare pachete — accesibil staff-ului ȘI utilizatorilor de portal ai
 *   aceluiași tenant (tarifele nu sunt secrete pentru un client autentificat;
 *   pagina publică /servicii le arată după parolă).
 * - `getHourlyRatesAdmin`: tot catalogul, inclusiv inactive + reguli (staff).
 * - mutațiile: doar owner/admin.
 *
 * Regulile de blocare (ultima specializare activă, referința, regimul standard)
 * sunt în $lib/logic/hourly-catalog.ts, testate fără DB.
 */
import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { RATE_MODE_SLUGS } from '$lib/logic/hours-pricing';
import {
	MAX_HOURS_MAX,
	MAX_HOURS_MIN,
	MULTIPLIER_PCT_MAX,
	MULTIPLIER_PCT_MIN,
	RATE_EUR_MAX,
	RATE_EUR_MIN,
	STEP_MINUTES_OPTIONS,
	modeUpdateBlockReason,
	rateDeactivationBlockReason,
	referenceRateBlockReason,
	resolveReferenceRate,
	slugifyRateLabel,
	toPublicHourlyRates,
	toPublicRateModes,
	uniqueRateSlug
} from '$lib/logic/hourly-catalog';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Staff (orice rol) SAU utilizator de portal — întoarce tenant-ul de scoping. */
async function resolveTenantForRead(): Promise<string> {
	const event = getRequestEvent();
	if (!event?.locals.user) throw error(401, 'Unauthorized');
	if (event.locals.isClientUser) {
		if (!event.locals.client) throw error(401, 'Unauthorized');
		return event.locals.client.tenantId;
	}
	if (!event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	return event.locals.tenant.id;
}

async function requireStaffTenant(): Promise<{ tenantId: string; role: string | undefined }> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	return { tenantId: event.locals.tenant.id, role: event.locals.tenantUser?.role };
}

async function requireOwnerOrAdmin(): Promise<{ tenantId: string; userId: string }> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar owner-ul sau un admin pot modifica tarifele.');
	}
	return { tenantId: event.locals.tenant.id, userId: event.locals.user.id };
}

const labelSchema = v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(60));
const rateEurSchema = v.pipe(v.number(), v.integer(), v.minValue(RATE_EUR_MIN), v.maxValue(RATE_EUR_MAX));
const sortOrderSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999));

// ── Citire ───────────────────────────────────────────────────────────────────

export const getHourlyCatalogView = query(async () => {
	const tenantId = await resolveTenantForRead();
	const catalog = await getHourlyCatalog(tenantId);
	return {
		hourlyRates: toPublicHourlyRates(catalog.rates),
		rateModes: toPublicRateModes(catalog.modes)
	};
});

export const getHourlyRatesAdmin = query(async () => {
	const { tenantId, role } = await requireStaffTenant();
	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	return {
		rates: catalog.rates,
		modes: catalog.modes,
		rules: catalog.rules,
		referenceRateSlug: resolveReferenceRate(catalog.rates, catalog.rules)?.slug ?? null,
		canEdit: role === 'owner' || role === 'admin'
	};
});

// ── Specializări ─────────────────────────────────────────────────────────────

export const createHourlyRate = command(
	v.object({ label: labelSchema, rateEur: rateEurSchema }),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		const base = slugifyRateLabel(data.label);
		if (!base) throw error(400, 'Denumirea trebuie să conțină litere sau cifre.');
		const slug = uniqueRateSlug(base, catalog.rates.map((r) => r.slug));
		const sortOrder = catalog.rates.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
		const id = generateId();
		await withTursoBusyRetry(
			() =>
				db.insert(table.hourlyRate).values({
					id,
					tenantId,
					slug,
					label: data.label,
					rateEur: data.rateEur,
					sortOrder,
					isActive: true
				}),
			{ tenantId, label: 'hourly-rates.create' }
		);
		return { id, slug };
	}
);

export const updateHourlyRate = command(
	v.object({
		id: v.pipe(v.string(), v.minLength(1)),
		label: labelSchema,
		rateEur: rateEurSchema,
		sortOrder: sortOrderSchema,
		isActive: v.boolean()
	}),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		const current = catalog.rates.find((r) => r.id === data.id);
		if (!current) throw error(404, 'Specializarea nu există.');
		if (current.isActive && !data.isActive) {
			const reason = rateDeactivationBlockReason(catalog.rates, current.slug, catalog.rules);
			if (reason) throw error(400, reason);
		}
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hourlyRate)
					.set({
						label: data.label,
						rateEur: data.rateEur,
						sortOrder: data.sortOrder,
						isActive: data.isActive,
						updatedAt: new Date()
					})
					.where(and(eq(table.hourlyRate.id, data.id), eq(table.hourlyRate.tenantId, tenantId))),
			{ tenantId, label: 'hourly-rates.update' }
		);
		return { ok: true as const };
	}
);

// ── Regimuri ─────────────────────────────────────────────────────────────────

export const updateRateMode = command(
	v.object({
		slug: v.picklist(RATE_MODE_SLUGS),
		label: labelSchema,
		suffix: v.pipe(v.string(), v.trim(), v.maxLength(40)),
		description: v.pipe(v.string(), v.trim(), v.maxLength(300)),
		sla: v.pipe(v.string(), v.trim(), v.maxLength(300)),
		multiplierPct: v.pipe(v.number(), v.integer(), v.minValue(MULTIPLIER_PCT_MIN), v.maxValue(MULTIPLIER_PCT_MAX)),
		maxHours: v.pipe(v.number(), v.integer(), v.minValue(MAX_HOURS_MIN), v.maxValue(MAX_HOURS_MAX)),
		isActive: v.boolean()
	}),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		const reason = modeUpdateBlockReason(data.slug, data);
		if (reason) throw error(400, reason);
		// Asigură seed-ul înainte de update (tenant nou = rândurile pot lipsi).
		await getHourlyCatalog(tenantId, { includeInactive: true });
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hourlyRateMode)
					.set({
						label: data.label,
						suffix: data.suffix,
						description: data.description,
						sla: data.sla,
						multiplierPct: data.multiplierPct,
						maxHours: data.maxHours,
						isActive: data.isActive,
						updatedAt: new Date()
					})
					.where(
						and(eq(table.hourlyRateMode.tenantId, tenantId), eq(table.hourlyRateMode.slug, data.slug))
					),
			{ tenantId, label: 'hourly-rates.updateMode' }
		);
		return { ok: true as const };
	}
);

// ── Reguli credit ────────────────────────────────────────────────────────────

export const updateHourCreditRules = command(
	v.object({
		referenceRateSlug: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(40))),
		lowCreditThresholdMinutes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
		stepMinutes: v.picklist(STEP_MINUTES_OPTIONS),
		notifyEmail: v.boolean(),
		notifyWhatsapp: v.boolean()
	}),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		const referenceRateSlug = data.referenceRateSlug || null;
		const reason = referenceRateBlockReason(catalog.rates, referenceRateSlug);
		if (reason) throw error(400, reason);

		const [existing] = await db
			.select({ id: table.hourCreditSettings.id })
			.from(table.hourCreditSettings)
			.where(eq(table.hourCreditSettings.tenantId, tenantId))
			.limit(1);

		await withTursoBusyRetry(
			() =>
				existing
					? db
							.update(table.hourCreditSettings)
							.set({
								referenceRateSlug,
								lowCreditThresholdMinutes: data.lowCreditThresholdMinutes,
								stepMinutes: data.stepMinutes,
								notifyEmail: data.notifyEmail,
								notifyWhatsapp: data.notifyWhatsapp,
								updatedByUserId: userId,
								updatedAt: new Date()
							})
							.where(eq(table.hourCreditSettings.id, existing.id))
					: db.insert(table.hourCreditSettings).values({
							id: generateId(),
							tenantId,
							referenceRateSlug,
							lowCreditThresholdMinutes: data.lowCreditThresholdMinutes,
							stepMinutes: data.stepMinutes,
							notifyEmail: data.notifyEmail,
							notifyWhatsapp: data.notifyWhatsapp,
							updatedByUserId: userId
						}),
			{ tenantId, label: 'hourly-rates.updateRules' }
		);
		return { ok: true as const };
	}
);
```

- [ ] **Step 2: Verifică tipurile**

```bash
NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | tail -5
```

Expected: 0 erori. Dacă `event.locals.isClientUser` / `event.locals.client` nu există în `App.Locals`, verifică `src/app.d.ts` și folosește numele reale (sunt cele folosite în `client-secondary-emails.remote.ts`).

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/remotes/hourly-rates.remote.ts
git commit -m "feat(hourly-rates): remote functions pentru catalog (citire staff/portal, mutații owner/admin)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Pagina Settings → Tarife orare

**Files:**
- Create: `src/routes/[tenant]/settings/hourly-rates/+page.svelte`
- Create: `src/routes/[tenant]/settings/hourly-rates/HourlyRatesSettings.svelte`
- Create: `src/routes/[tenant]/settings/hourly-rates/RateRow.svelte`
- Create: `src/routes/[tenant]/settings/hourly-rates/ModeRow.svelte`
- Create: `src/routes/[tenant]/settings/hourly-rates/CreditRulesForm.svelte`
- Modify: `src/routes/[tenant]/settings/+layout.svelte` (tabs + activeTab)

- [ ] **Step 1: Tab-ul în layout**

În `src/routes/[tenant]/settings/+layout.svelte`:

1. la importul de icoane, adaugă `Clock`:
```ts
import { Settings, Receipt, Plug, CheckSquare, Mail, Calendar, UserCircle, Bell, Clock } from '@lucide/svelte';
```
2. în lista `tabs`, după intrarea `tasks`:
```ts
{ id: 'hourly-rates', label: 'Tarife orare', href: `/${tenantSlug}/settings/hourly-rates`, icon: Clock },
```
3. în `activeTab`, după linia cu `settings/tasks`:
```ts
if (currentPath.startsWith(`/${tenantSlug}/settings/hourly-rates`)) return 'hourly-rates';
```

- [ ] **Step 2: Shell-ul paginii (boundary + skeleton)**

```svelte
<!-- src/routes/[tenant]/settings/hourly-rates/+page.svelte -->
<script lang="ts">
	import HourlyRatesSettings from './HourlyRatesSettings.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
</script>

<p class="text-muted-foreground mb-6">
	Tarifele pe oră după specializare, regimurile de lucru (urgență, weekend, noapte) și regulile
	creditului de ore. Aceleași valori apar pe pagina publică /servicii, în comanda de ore și pe
	facturile Keez.
</p>

<svelte:boundary>
	{#snippet pending()}
		<div class="space-y-6">
			<Skeleton class="h-48 w-full" />
			<Skeleton class="h-64 w-full" />
			<Skeleton class="h-40 w-full" />
		</div>
	{/snippet}
	{#snippet failed(error, reset)}
		<div class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30">
			{error instanceof Error ? error.message : 'Nu am putut încărca tarifele.'}
			<button type="button" class="ml-2 underline" onclick={reset}>Reîncearcă</button>
		</div>
	{/snippet}

	<HourlyRatesSettings />
</svelte:boundary>
```

- [ ] **Step 3: Componenta principală**

```svelte
<!-- src/routes/[tenant]/settings/hourly-rates/HourlyRatesSettings.svelte -->
<script lang="ts">
	import { createHourlyRate, getHourlyRatesAdmin } from '$lib/remotes/hourly-rates.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Table, TableBody, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import { Clock, Gauge, Wallet } from '@lucide/svelte';
	import { RATE_EUR_MAX, RATE_EUR_MIN } from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import RateRow from './RateRow.svelte';
	import ModeRow from './ModeRow.svelte';
	import CreditRulesForm from './CreditRulesForm.svelte';

	const admin = $derived(await getHourlyRatesAdmin());
	const canEdit = $derived(admin.canEdit);

	let newLabel = $state('');
	let newRateEur = $state(60);
	let creating = $state(false);
	let createError = $state<string | null>(null);

	async function handleCreate(e: SubmitEvent) {
		e.preventDefault();
		creating = true;
		createError = null;
		try {
			await createHourlyRate({ label: newLabel.trim(), rateEur: Number(newRateEur) }).updates(
				getHourlyRatesAdmin()
			);
			newLabel = '';
		} catch (err) {
			createError = remoteErrorMessage(err, 'Nu am putut adăuga specializarea.');
		} finally {
			creating = false;
		}
	}
</script>

<div class="space-y-6">
	{#if !canEdit}
		<p class="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
			Poți vedea tarifele, dar doar owner-ul sau un admin le pot modifica.
		</p>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><Clock class="h-5 w-5" /> Specializări</CardTitle>
			<CardDescription>
				Tariful de bază pe oră, fără TVA, în EUR. Slug-ul e fix după creare (ajunge în comenzi și în
				metadata Stripe). Specializările dezactivate dispar de pe /servicii și din formularul de task.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Denumire</TableHead>
							<TableHead class="w-28">€/h</TableHead>
							<TableHead class="w-24">Ordine</TableHead>
							<TableHead class="w-44">Slug</TableHead>
							<TableHead class="w-20">Activ</TableHead>
							<TableHead class="w-28 text-right">Acțiuni</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each admin.rates as rate (rate.id)}
							<RateRow {rate} isReference={rate.slug === admin.referenceRateSlug} {canEdit} />
						{/each}
					</TableBody>
				</Table>
			</div>

			{#if canEdit}
				<form onsubmit={handleCreate} class="flex flex-wrap items-end gap-3 rounded-md border p-3">
					<div class="min-w-48 flex-1 space-y-1">
						<Label for="newRateLabel">Specializare nouă</Label>
						<Input id="newRateLabel" bind:value={newLabel} placeholder="ex. QA & Testare" required minlength={2} maxlength={60} />
					</div>
					<div class="w-28 space-y-1">
						<Label for="newRateEur">€/h</Label>
						<Input id="newRateEur" type="number" bind:value={newRateEur} min={RATE_EUR_MIN} max={RATE_EUR_MAX} step="1" required />
					</div>
					<Button type="submit" disabled={creating || newLabel.trim().length < 2}>
						{creating ? 'Se adaugă…' : 'Adaugă'}
					</Button>
					{#if createError}
						<p class="basis-full text-sm text-red-600">{createError}</p>
					{/if}
				</form>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><Gauge class="h-5 w-5" /> Regimuri de lucru</CardTitle>
			<CardDescription>
				Majorarea se aplică pe tariful de bază și se rotunjește la euro întreg. Regimurile nu se
				cumulează. Plafonul de ore limitează o singură comandă online de pe /servicii; nu se aplică
				la task-uri.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="space-y-4">
				{#each admin.modes as mode (mode.id)}
					<ModeRow {mode} {canEdit} />
				{/each}
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><Wallet class="h-5 w-5" /> Reguli credit de ore</CardTitle>
			<CardDescription>
				Tariful de referință transformă banii facturați în ore de credit și ponderează consumul
				task-urilor. Pragul declanșează alerta „credit scăzut".
			</CardDescription>
		</CardHeader>
		<CardContent>
			<CreditRulesForm rules={admin.rules} rates={admin.rates} resolvedReferenceSlug={admin.referenceRateSlug} {canEdit} />
		</CardContent>
	</Card>
</div>
```

- [ ] **Step 4: Rândul de specializare**

```svelte
<!-- src/routes/[tenant]/settings/hourly-rates/RateRow.svelte -->
<script lang="ts">
	import { getHourlyRatesAdmin, updateHourlyRate } from '$lib/remotes/hourly-rates.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { TableCell, TableRow } from '$lib/components/ui/table';
	import { RATE_EUR_MAX, RATE_EUR_MIN, type CatalogRate } from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';

	let { rate, isReference, canEdit }: { rate: CatalogRate; isReference: boolean; canEdit: boolean } =
		$props();

	let label = $state(rate.label);
	let rateEur = $state(rate.rateEur);
	let sortOrder = $state(rate.sortOrder);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const dirty = $derived(
		label.trim() !== rate.label || Number(rateEur) !== rate.rateEur || Number(sortOrder) !== rate.sortOrder
	);

	async function save(isActive: boolean = rate.isActive) {
		saving = true;
		error = null;
		try {
			await updateHourlyRate({
				id: rate.id,
				label: label.trim(),
				rateEur: Number(rateEur),
				sortOrder: Number(sortOrder),
				isActive
			}).updates(getHourlyRatesAdmin());
			label = label.trim();
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva specializarea.');
		} finally {
			saving = false;
		}
	}
</script>

<TableRow class={rate.isActive ? '' : 'opacity-60'}>
	<TableCell>
		<Input bind:value={label} disabled={!canEdit || saving} maxlength={60} aria-label="Denumire" />
	</TableCell>
	<TableCell>
		<Input type="number" bind:value={rateEur} min={RATE_EUR_MIN} max={RATE_EUR_MAX} step="1" disabled={!canEdit || saving} aria-label="Tarif €/h" />
	</TableCell>
	<TableCell>
		<Input type="number" bind:value={sortOrder} min="0" max="999" step="1" disabled={!canEdit || saving} aria-label="Ordine" />
	</TableCell>
	<TableCell>
		<code class="text-xs text-muted-foreground">{rate.slug}</code>
		{#if isReference}
			<Badge variant="outline" class="ml-2">referință</Badge>
		{/if}
	</TableCell>
	<TableCell>
		<Switch checked={rate.isActive} onCheckedChange={(v) => save(v)} disabled={!canEdit || saving} aria-label="Activ" />
	</TableCell>
	<TableCell class="text-right">
		<Button size="sm" variant="outline" onclick={() => save()} disabled={!canEdit || saving || !dirty}>
			{saving ? '…' : 'Salvează'}
		</Button>
		{#if error}
			<p class="mt-1 text-xs text-red-600">{error}</p>
		{/if}
	</TableCell>
</TableRow>
```

- [ ] **Step 5: Rândul de regim**

```svelte
<!-- src/routes/[tenant]/settings/hourly-rates/ModeRow.svelte -->
<script lang="ts">
	import { getHourlyRatesAdmin, updateRateMode } from '$lib/remotes/hourly-rates.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		MAX_HOURS_MAX,
		MAX_HOURS_MIN,
		MULTIPLIER_PCT_MAX,
		MULTIPLIER_PCT_MIN,
		type CatalogMode
	} from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';

	let { mode, canEdit }: { mode: CatalogMode; canEdit: boolean } = $props();

	const isStandard = $derived(mode.slug === 'standard');

	let label = $state(mode.label);
	let suffix = $state(mode.suffix);
	let description = $state(mode.description);
	let sla = $state(mode.sla);
	let multiplierPct = $state(mode.multiplierPct);
	let maxHours = $state(mode.maxHours);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const dirty = $derived(
		label.trim() !== mode.label ||
			suffix.trim() !== mode.suffix ||
			description.trim() !== mode.description ||
			sla.trim() !== mode.sla ||
			Number(multiplierPct) !== mode.multiplierPct ||
			Number(maxHours) !== mode.maxHours
	);

	async function save(isActive: boolean = mode.isActive) {
		saving = true;
		error = null;
		try {
			await updateRateMode({
				slug: mode.slug,
				label: label.trim(),
				suffix: suffix.trim(),
				description: description.trim(),
				sla: sla.trim(),
				multiplierPct: Number(multiplierPct),
				maxHours: Number(maxHours),
				isActive
			}).updates(getHourlyRatesAdmin());
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva regimul.');
		} finally {
			saving = false;
		}
	}

	const idBase = $derived(`mode-${mode.slug}`);
</script>

<div class="rounded-md border p-4 {mode.isActive ? '' : 'opacity-60'}">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<code class="text-xs text-muted-foreground">{mode.slug}</code>
			{#if isStandard}
				<span class="text-xs text-muted-foreground">(ancora grilei: 100%, mereu activ)</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<Label for="{idBase}-active" class="text-sm">Activ</Label>
			<Switch id="{idBase}-active" checked={mode.isActive} onCheckedChange={(v) => save(v)} disabled={!canEdit || saving || isStandard} />
		</div>
	</div>

	<div class="grid gap-3 md:grid-cols-4">
		<div class="space-y-1">
			<Label for="{idBase}-label">Denumire</Label>
			<Input id="{idBase}-label" bind:value={label} disabled={!canEdit || saving} maxlength={60} />
		</div>
		<div class="space-y-1">
			<Label for="{idBase}-suffix">Sufix pe factură</Label>
			<Input id="{idBase}-suffix" bind:value={suffix} disabled={!canEdit || saving || isStandard} maxlength={40} placeholder="ex. Urgență 48h" />
		</div>
		<div class="space-y-1">
			<Label for="{idBase}-mult">Multiplicator %</Label>
			<Input id="{idBase}-mult" type="number" bind:value={multiplierPct} min={MULTIPLIER_PCT_MIN} max={MULTIPLIER_PCT_MAX} step="1" disabled={!canEdit || saving || isStandard} />
		</div>
		<div class="space-y-1">
			<Label for="{idBase}-max">Plafon ore / comandă</Label>
			<Input id="{idBase}-max" type="number" bind:value={maxHours} min={MAX_HOURS_MIN} max={MAX_HOURS_MAX} step="1" disabled={!canEdit || saving} />
		</div>
		<div class="space-y-1 md:col-span-2">
			<Label for="{idBase}-desc">Descriere (sub selector, pe /servicii)</Label>
			<Textarea id="{idBase}-desc" bind:value={description} disabled={!canEdit || saving} maxlength={300} rows={2} />
		</div>
		<div class="space-y-1 md:col-span-2">
			<Label for="{idBase}-sla">SLA (se îngheață pe comandă la plată)</Label>
			<Textarea id="{idBase}-sla" bind:value={sla} disabled={!canEdit || saving} maxlength={300} rows={2} />
		</div>
	</div>

	<div class="mt-3 flex items-center justify-end gap-3">
		{#if error}
			<p class="text-xs text-red-600">{error}</p>
		{/if}
		<Button size="sm" variant="outline" onclick={() => save()} disabled={!canEdit || saving || !dirty}>
			{saving ? '…' : 'Salvează'}
		</Button>
	</div>
</div>
```

- [ ] **Step 6: Formularul de reguli**

```svelte
<!-- src/routes/[tenant]/settings/hourly-rates/CreditRulesForm.svelte -->
<script lang="ts">
	import { getHourlyRatesAdmin, updateHourCreditRules } from '$lib/remotes/hourly-rates.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import {
		STEP_MINUTES_OPTIONS,
		formatMinutes,
		type CatalogRate,
		type HourCreditRules
	} from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';

	let {
		rules,
		rates,
		resolvedReferenceSlug,
		canEdit
	}: {
		rules: HourCreditRules;
		rates: CatalogRate[];
		resolvedReferenceSlug: string | null;
		canEdit: boolean;
	} = $props();

	const AUTO = '__auto__';

	let referenceChoice = $state(rules.referenceRateSlug ?? AUTO);
	let thresholdHours = $state(rules.lowCreditThresholdMinutes / 60);
	let stepMinutes = $state<number>(rules.stepMinutes);
	let notifyEmail = $state(rules.notifyEmail);
	let notifyWhatsapp = $state(rules.notifyWhatsapp);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);

	const activeRates = $derived(rates.filter((r) => r.isActive));
	const resolved = $derived(rates.find((r) => r.slug === resolvedReferenceSlug) ?? null);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = null;
		saved = false;
		try {
			await updateHourCreditRules({
				referenceRateSlug: referenceChoice === AUTO ? null : referenceChoice,
				lowCreditThresholdMinutes: Math.round(Number(thresholdHours) * 60),
				stepMinutes: Number(stepMinutes) as 15 | 30 | 60,
				notifyEmail,
				notifyWhatsapp
			}).updates(getHourlyRatesAdmin());
			saved = true;
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva regulile.');
		} finally {
			saving = false;
		}
	}
</script>

<form onsubmit={save} class="space-y-5">
	<div class="grid gap-4 md:grid-cols-3">
		<div class="space-y-1">
			<Label for="referenceRate">Tarif de referință</Label>
			<select
				id="referenceRate"
				bind:value={referenceChoice}
				disabled={!canEdit || saving}
				class="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
			>
				<option value={AUTO}>Cel mai mic tarif activ</option>
				{#each activeRates as r (r.id)}
					<option value={r.slug}>{r.label} — {r.rateEur} €/h</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				Acum: {resolved ? `${resolved.label}, ${resolved.rateEur} €/h` : 'nicio specializare activă'}
			</p>
		</div>
		<div class="space-y-1">
			<Label for="thresholdHours">Prag „credit scăzut" (ore)</Label>
			<Input id="thresholdHours" type="number" bind:value={thresholdHours} min="0" max="1000" step="0.25" disabled={!canEdit || saving} />
			<p class="text-xs text-muted-foreground">= {formatMinutes(Math.round(Number(thresholdHours) * 60))}</p>
		</div>
		<div class="space-y-1">
			<Label for="stepMinutes">Pas minim la task</Label>
			<select
				id="stepMinutes"
				bind:value={stepMinutes}
				disabled={!canEdit || saving}
				class="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
			>
				{#each STEP_MINUTES_OPTIONS as s (s)}
					<option value={s}>{s} minute</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="grid gap-3 md:grid-cols-2">
		<div class="flex items-center justify-between rounded-md border p-3">
			<div>
				<Label for="notifyEmail">Notificări email către client</Label>
				<p class="text-xs text-muted-foreground">Credit scăzut, consum la finalizare, alimentări.</p>
			</div>
			<Switch id="notifyEmail" bind:checked={notifyEmail} disabled={!canEdit || saving} />
		</div>
		<div class="flex items-center justify-between rounded-md border p-3">
			<div>
				<Label for="notifyWhatsapp">Notificări WhatsApp în grupul task-ului</Label>
				<p class="text-xs text-muted-foreground">Aceleași evenimente, doar dacă există grup legat.</p>
			</div>
			<Switch id="notifyWhatsapp" bind:checked={notifyWhatsapp} disabled={!canEdit || saving} />
		</div>
	</div>

	<div class="flex items-center justify-end gap-3">
		{#if error}
			<p class="text-sm text-red-600">{error}</p>
		{:else if saved}
			<p class="text-sm text-green-600">Salvat.</p>
		{/if}
		<Button type="submit" disabled={!canEdit || saving}>{saving ? 'Se salvează…' : 'Salvează regulile'}</Button>
	</div>
</form>
```

- [ ] **Step 7: Autofixer + svelte-check**

Pentru fiecare din cele 5 componente noi și pentru `+layout.svelte`: trimite conținutul la `mcp__svelte__svelte-autofixer` cu `desired_svelte_version: 5`; repară ce raportează (nu ignora erorile; sugestiile soft doar cu motiv).

```bash
NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | tail -5
```

Expected: 0 erori. Dacă `Switch` nu acceptă `onCheckedChange` în versiunea instalată, folosește `bind:checked` pe o variabilă locală + `$effect` care apelează `save(v)` doar când valoarea diferă de `rate.isActive`.

- [ ] **Step 8: Verificare manuală în browser**

```bash
# dev server-ul rulează din main pe :5173 (vezi memoria „Local preview needs main");
# dacă nu rulează: bun run dev
```

Deschide `http://localhost:5173/ots/settings/hourly-rates` (login `office@onetopsolution.ro`, tenant `ots`). Verifică:
1. Tab-ul „Tarife orare" e activ; cele 4 specializări (65/70/55/80) și 4 regimuri apar (seed-ul lazy a rulat: `SELECT count(*) FROM hourly_rate` = 4 pe remote).
2. Schimbă tariful Development la 66, Salvează → rândul rămâne, valoarea persistă la reload.
3. Încearcă să dezactivezi toate specializările → ultima refuză cu mesajul „Nu poți dezactiva ultima specializare activă."
4. Regimul standard: multiplicatorul și switch-ul sunt blocate.
5. Reguli: alege referința „Design UI/UX", prag 3 ore → „= 3 h"; Salvează → „Salvat."; la reload, referința rămâne.
6. Pune Development înapoi la 65 și referința pe „Cel mai mic tarif activ", ca prod-ul să rămână neschimbat comercial.

- [ ] **Step 9: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/\[tenant\]/settings/hourly-rates app/src/routes/\[tenant\]/settings/+layout.svelte
git commit -m "feat(hourly-rates): pagina Settings → Tarife orare (specializări, regimuri, reguli credit)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Consumatorii citesc din DB

**Files:**
- Modify: `src/routes/servicii/catalog.server.ts`
- Modify: `src/routes/servicii/+page.server.ts`
- Modify: `src/lib/remotes/public-hours.remote.ts`
- Modify: `src/lib/remotes/__tests__/public-hours.remote.test.ts`
- Modify: `src/lib/server/stripe/post-payment/emit-keez-hours-invoice.ts`
- Modify: `src/routes/[tenant]/services/PackageComparisonDialog.svelte`
- Modify: `src/lib/constants/ots-catalog.ts`
- Modify: `src/lib/logic/__tests__/hours-pricing.test.ts`

- [ ] **Step 1: Mock-ul catalogului în testul comenzii de ore (pică întâi)**

În `src/lib/remotes/__tests__/public-hours.remote.test.ts`, după blocul `mock.module('$lib/server/plugins/stripe/customer', …)` și ÎNAINTE de `await import('../public-hours.remote')`, adaugă:

```ts
// ─── Catalogul de tarife (din DB în prod; aici seed-ul din constante) ───────
const { HOURLY_RATES, RATE_MODES } = await import('$lib/constants/ots-catalog');
mock.module('$lib/server/hourly-catalog', () => ({
	getHourlyCatalog: async () => ({
		rates: HOURLY_RATES.map((r, i) => ({
			id: `rate-${i}`,
			slug: r.slug,
			label: r.label,
			rateEur: r.rate,
			sortOrder: i,
			isActive: true
		})),
		modes: RATE_MODES.map((m, i) => ({
			id: `mode-${i}`,
			slug: m.slug,
			label: m.label,
			suffix: m.suffix,
			description: m.description,
			sla: m.sla,
			multiplierPct: m.multiplierPct,
			maxHours: m.maxHours,
			sortOrder: i,
			isActive: true
		})),
		rules: {
			referenceRateSlug: null,
			lowCreditThresholdMinutes: 120,
			stepMinutes: 15,
			notifyEmail: true,
			notifyWhatsapp: true
		}
	})
}));
```

Rulează: `bun run test public-hours` → Expected: încă PASS (remote-ul nu folosește încă mock-ul); acesta e punctul de plecare.

- [ ] **Step 2: `public-hours.remote.ts` — tarif + regim din catalog**

1. Înlocuiește importul
```ts
import { getHourlyRate, getRateMode, hourlyRateLabelFor } from '$lib/constants/ots-catalog';
```
cu
```ts
import { hourlyRateLabelFor } from '$lib/constants/ots-catalog';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
```
2. Înlocuiește blocul
```ts
	const rate = getHourlyRate(data.rateSlug);
	if (!rate) throw error(400, 'Specializarea selectată nu există.');
	const mode = getRateMode(data.modeSlug ?? DEFAULT_RATE_MODE);
	if (!mode) throw error(400, 'Regimul de lucru selectat nu există.');
```
cu
```ts
	const catalog = await getHourlyCatalog(tenantId);
	const rate = catalog.rates.find((r) => r.slug === data.rateSlug);
	if (!rate) throw error(400, 'Specializarea selectată nu există.');
	const mode = catalog.modes.find((m) => m.slug === (data.modeSlug ?? DEFAULT_RATE_MODE));
	if (!mode) throw error(400, 'Regimul de lucru selectat nu există.');
```
3. Înlocuiește `effectiveRateEur(rate.rate, mode.multiplierPct)` cu `effectiveRateEur(rate.rateEur, mode.multiplierPct)` și `baseRateEur: rate.rate,` cu `baseRateEur: rate.rateEur,`.

```bash
grep -n "rate\.rate\b\|getHourlyRate\|getRateMode" src/lib/remotes/public-hours.remote.ts
bun run test public-hours
```

Expected: `grep` nu mai găsește nimic; testele trec (inclusiv `order.rateEur` 65/98/111/130).

- [ ] **Step 3: `catalog.server.ts` — hourlyRates/rateModes din DB**

1. Scoate `HOURLY_RATES,` și `RATE_MODES,` din importul din `$lib/constants/ots-catalog`.
2. Adaugă:
```ts
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { toPublicHourlyRates, toPublicRateModes } from '$lib/logic/hourly-catalog';
```
3. În `buildPublicCatalog`, înainte de `return`, după selectul de `invoiceSettings`:
```ts
	const hourly = await getHourlyCatalog(tenantId);
```
și înlocuiește
```ts
		hourlyRates: HOURLY_RATES,
		rateModes: RATE_MODES,
```
cu
```ts
		hourlyRates: toPublicHourlyRates(hourly.rates),
		rateModes: toPublicRateModes(hourly.modes),
```

- [ ] **Step 4: `servicii/+page.server.ts` — scoate importul nefolosit**

Șterge linia `HOURLY_RATES,` din lista de import din `$lib/constants/ots-catalog` (confirmă întâi că nu mai apare nicăieri în fișier: `grep -n HOURLY_RATES src/routes/servicii/+page.server.ts` → doar linia de import).

- [ ] **Step 5: `emit-keez-hours-invoice.ts` — eticheta regimului din DB**

1. Înlocuiește `import { getRateMode } from '$lib/constants/ots-catalog';` cu `import { getHourlyCatalog } from '$lib/server/hourly-catalog';`.
2. Înlocuiește blocul `modeNote`:
```ts
	const isPremiumMode = !!order.modeSlug && order.modeSlug !== 'standard';
	const modeLabel = isPremiumMode
		? ((await getHourlyCatalog(tenantId, { includeInactive: true })).modes.find((m) => m.slug === order.modeSlug)?.label ?? order.modeSlug)
		: null;
	const modeNote = isPremiumMode
		? ` Regim ${modeLabel} (+${order.modeMultiplierPct - 100}% față de tariful standard de ${order.baseRateEur ?? order.rateEur} €/h)${order.requestedWindow ? `, interval cerut: ${order.requestedWindow}` : ''}.${order.modeSlaSnapshot ? ` ${order.modeSlaSnapshot}` : ''}`
		: '';
```
(`includeInactive`: un regim dezactivat între plată și emitere trebuie totuși să apară cu numele lui pe factură.)

- [ ] **Step 6: `PackageComparisonDialog.svelte` — tarife din remote**

Înlocuiește tot `<script>`-ul cu:
```svelte
<script lang="ts">
	import PackageComparisonView from '$lib/components/services/PackageComparisonView.svelte';
	import {
		TIERS,
		TIER_LABELS,
		TIER_COLORS,
		SETUP_DEFAULT_DESCRIPTION,
		WEB_DEV_SLUGS,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';
	import { getHourlyCatalogView } from '$lib/remotes/hourly-rates.remote';

	type Props = {
		open: boolean;
		category: Category | null;
		onRequest?: (tier: Tier) => void;
	};

	let { open = $bindable(), category, onRequest }: Props = $props();

	const isWebDev = $derived(category ? WEB_DEV_SLUGS.has(category.slug) : false);

	// Tarifele orare vin din DB (Settings → Tarife orare), nu din constante.
	// `.current` (nu `await`): dialogul e montat închis pe pagini fără boundary;
	// până sosesc datele, secțiunea de tarife e pur și simplu goală.
	const hourlyView = getHourlyCatalogView();
	const hourlyRates = $derived(hourlyView.current?.hourlyRates ?? []);
	const rateModes = $derived(hourlyView.current?.rateModes ?? []);
</script>
```
și în markup înlocuiește `hourlyRates={HOURLY_RATES}` / `rateModes={RATE_MODES}` cu `{hourlyRates}` / `{rateModes}`. Actualizează și comentariul de la începutul fișierului („injectează constantele din catalog" → „injectează constantele din catalog și tarifele orare din DB").

Rulează autofixer-ul Svelte pe componentă.

- [ ] **Step 7: `ots-catalog.ts` — constantele devin seed**

1. Deasupra `export const HOURLY_RATES`, înlocuiește comentariul de context cu unul care începe cu:
```ts
// SEED, nu sursă de adevăr: din 2026-09 tarifele trăiesc în tabelul `hourly_rate`
// (Settings → Tarife orare) și se citesc prin $lib/server/hourly-catalog.ts.
// Lista de aici se inserează o singură dată, la prima citire a unui tenant.
```
2. Șterge funcțiile `getHourlyRate` și `getRateMode` (nu mai au apelanți).
3. Deasupra `RATE_MODES` adaugă același avertisment (`SEED, nu sursă de adevăr: tabelul hourly_rate_mode`).
4. Relaxează semnătura:
```ts
/** Denumirea din `rate_label` / linia de factură: „Development (Urgență 48h)". */
export function hourlyRateLabelFor(rate: { label: string }, mode: { suffix: string }): string {
	return mode.suffix ? `${rate.label} (${mode.suffix})` : rate.label;
}
```

- [ ] **Step 8: `hours-pricing.test.ts` — fără `getRateMode`**

1. Scoate `getRateMode,` din importul din `$lib/constants/ots-catalog`.
2. Înlocuiește
```ts
		expect(getRateMode(DEFAULT_RATE_MODE)?.multiplierPct).toBe(100);
```
cu
```ts
		expect(RATE_MODES.find((m) => m.slug === DEFAULT_RATE_MODE)?.multiplierPct).toBe(100);
```

- [ ] **Step 9: Verificări**

```bash
grep -rn "getHourlyRate\b\|getRateMode\b" src; echo "exit=$?"
bun run test hours
bun run test servicii
bun run test hourly
NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | tail -5
```

Expected: `grep` gol (`exit=1`); toate fișierele de test trec (inclusiv `no-price-leak.test.ts`); svelte-check 0 erori.

- [ ] **Step 10: Verificare manuală /servicii**

Deschide `http://localhost:5173/servicii` (parola paginii, din Settings → pagina publică), tab „Tarife orare": cele 4 carduri arată 65/70/55/80 €, regimurile Urgență +50% / Weekend +70% / Noapte +100%. Schimbă în Settings tariful Development la 66 → reload /servicii → cardul arată 66 € (și 99 € la Urgență). Pune-l înapoi la 65.

- [ ] **Step 11: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/servicii/catalog.server.ts app/src/routes/servicii/+page.server.ts app/src/lib/remotes/public-hours.remote.ts app/src/lib/remotes/__tests__/public-hours.remote.test.ts app/src/lib/server/stripe/post-payment/emit-keez-hours-invoice.ts "app/src/routes/[tenant]/services/PackageComparisonDialog.svelte" app/src/lib/constants/ots-catalog.ts app/src/lib/logic/__tests__/hours-pricing.test.ts
git commit -m "feat(hourly-rates): /servicii, comanda de ore, emitentul Keez și dialogul de pachete citesc tarifele din DB

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Documentație, suită completă, build de producție

**Files:**
- Modify: `docs/ore-extra-work-regimuri.md`

- [ ] **Step 1: Documentația**

În `docs/ore-extra-work-regimuri.md`, secțiunea în care se explică unde se schimbă tarifele/multiplicatorii (caută `RATE_MODES`/`HOURLY_RATES`), înlocuiește indicația cu:

```markdown
Tarifele de bază, multiplicatorii, plafoanele și textele SLA se editează din
**Settings → Tarife orare** (tabelele `hourly_rate` și `hourly_rate_mode`, per
tenant). `HOURLY_RATES` / `RATE_MODES` din `ots-catalog.ts` sunt doar seed-ul
pentru un tenant nou. Testul golden din
`src/lib/logic/__tests__/hours-pricing.test.ts` fixează grila seed-ului, nu
valorile curente din DB.
```

- [ ] **Step 2: Suita completă + build prod**

```bash
bun run test 2>&1 | tail -3
NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | tail -3
bun run build 2>&1 | tail -5
```

Expected: `0 fail`; svelte-check 0 erori; build-ul trece (inclusiv garda `check-build-dynamic-imports.ts` — remote-ul nou nu are `await import()`).

- [ ] **Step 3: Commit + push**

```bash
cd /Users/augustin598/Projects/CRM && git add app/docs/ore-extra-work-regimuri.md
git commit -m "docs(hourly-rates): tarifele se editează din Settings → Tarife orare

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/hour-credits-f1-hourly-rates
```

- [ ] **Step 4: Handoff**

Propune merge în `main` și deploy; ÎNTREABĂ production/staging și așteaptă „go" (nu deploya singur). După deploy pe production: verifică `/_app/version.json` s-a schimbat, deschide Settings → Tarife orare pe prod (seed-ul lazy rulează la prima citire), apoi verifică `activeInThisProcess` pe `_debug-whatsapp-reload` (socketul WhatsApp se pierde la deploy).

---

## Ce NU face faza 1 (vine în F2–F4)

Ledger-ul de ore, bifa „facturile plătite alimentează creditul" pe client, hook-ul `invoice.paid`, pagina „Bugete ore", câmpurile pe task, draftul de depășire, portalul și notificările. Regulile din cardul „Reguli credit de ore" se salvează acum și sunt citite abia din F2.
