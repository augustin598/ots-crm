/**
 * Construirea catalogului public, partajată de `/servicii` și
 * `/servicii/configurator`.
 *
 * Trăiește într-un modul `.server.ts` ca să fie imposibil de importat accidental
 * din cod de client: constantele din `ots-catalog` conțin prețurile, iar pagina
 * publică e protejată cu parolă. Datele pleacă spre browser doar prin `load`,
 * după deblocare.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	CATEGORIES,
	CATEGORY_GROUPS,
	CRM_FEATURES,
	TIERS,
	TIER_LABELS,
	TIER_COLORS,
	HOURLY_RATES,
	WEB_DEV_SLUGS,
	SETUP_DEFAULT_DESCRIPTION,
	BUNDLE_TIERS_RULE,
	BUNDLES
} from '$lib/constants/ots-catalog';
import type { PublicCatalog, PublicCompany } from './types';

export function buildPublicCatalog(): PublicCatalog {
	return {
		categories: CATEGORIES,
		// Doar slug-urile: categoriile se trimit o singură dată și se rezolvă în pagină.
		groups: CATEGORY_GROUPS.map((g) => ({
			id: g.id,
			label: g.label,
			description: g.description,
			slugs: g.slugs
		})),
		crmFeatures: CRM_FEATURES,
		tiers: TIERS,
		tierLabels: TIER_LABELS,
		tierColors: TIER_COLORS,
		hourlyRates: HOURLY_RATES,
		webDevSlugs: [...WEB_DEV_SLUGS],
		setupDefaultDescription: SETUP_DEFAULT_DESCRIPTION,
		discountRules: BUNDLE_TIERS_RULE,
		bundles: BUNDLES
	};
}

export async function loadPublicCompany(tenantId: string): Promise<PublicCompany> {
	const [row] = await db
		.select({
			name: table.tenant.name,
			email: table.tenant.email,
			phone: table.tenant.phone
		})
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);
	return row ?? null;
}
