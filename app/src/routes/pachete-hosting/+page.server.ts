import type { PageServerLoad } from './$types';
import { PUBLIC_TENANT_SLUG, resolvePublicTenantId } from '$lib/server/public-page-access';
import { resolvePortalClientForUser } from '$lib/server/portal-signup';
import type { PortalClientSummary } from '$lib/components/checkout/portal-client';

/**
 * Cine e logat (dacă e cineva): pe rutele publice hooks nu populează
 * `locals.client`, deci îl citim din sesiune. Pagina arată „Contul meu" în loc
 * de Autentificare / Cont nou, iar checkout-ul sare peste pasul de cont și
 * precompletează facturarea din datele contului.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { tenantSlug: PUBLIC_TENANT_SLUG, portalClient: null as PortalClientSummary | null };
	const tenantId = await resolvePublicTenantId();
	const c = await resolvePortalClientForUser(tenantId, locals.user.id);
	const portalClient: PortalClientSummary | null = c
		? {
				id: c.id,
				name: c.name,
				email: c.email,
				billing: {
					businessName: c.businessName,
					legalType: c.legalType,
					cui: c.cui,
					vatNumber: c.vatNumber,
					registrationNumber: c.registrationNumber,
					phone: c.phone,
					address: c.address,
					city: c.city,
					county: c.county,
					postalCode: c.postalCode
				}
			}
		: null;
	return { tenantSlug: PUBLIC_TENANT_SLUG, portalClient };
};
