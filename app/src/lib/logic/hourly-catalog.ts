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
		const stem = base.slice(0, RATE_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '');
		const candidate = `${stem}${suffix}`;
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
	if (input.multiplierPct !== 100)
		return 'Regimul standard rămâne la 100% — majorările se setează pe celelalte regimuri.';
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
