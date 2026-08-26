/**
 * Forma datelor trimise de server către pagina publică `/servicii`.
 *
 * Tipurile sunt importate `import type` din catalog → se șterg la compilare,
 * deci componentele publice NU trag constantele cu prețuri în bundle-ul de
 * client. Valorile vin exclusiv din `+page.server.ts`, după deblocare.
 */

import type { Bundle, Category, Feature, Tier, TierColors } from '$lib/constants/ots-catalog';

export type PublicCatalogGroup = {
	id: string;
	label: string;
	description: string;
	slugs: string[];
};

export type PublicCatalog = {
	categories: Category[];
	groups: PublicCatalogGroup[];
	crmFeatures: Feature[];
	tiers: Tier[];
	tierLabels: Record<Tier, string>;
	tierColors: Record<Tier, TierColors>;
	hourlyRates: { slug: string; label: string; rate: number }[];
	/** Cota TVA a tenantului (%, întreg) — pentru totalul afișat la cumpărarea orelor. */
	vatPercent: number;
	webDevSlugs: string[];
	setupDefaultDescription: string;
	discountRules: { minServices: number; discountPct: number; label: string }[];
	/** Necesare wizardului de la /servicii/configurator. */
	bundles: Bundle[];
};

export type PublicCompany = {
	name: string;
	email: string | null;
	phone: string | null;
} | null;
