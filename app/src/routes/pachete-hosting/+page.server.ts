import type { PageServerLoad } from './$types';
import { PUBLIC_TENANT_SLUG, resolvePublicTenantId } from '$lib/server/public-page-access';
import { resolvePortalClientForUser } from '$lib/server/portal-signup';

/**
 * Cine e logat (dacă e cineva): pe rutele publice hooks nu populează
 * `locals.client`, deci îl citim din sesiune. Pagina arată „Contul meu" în loc
 * de Autentificare / Cont nou, iar checkout-ul leagă comanda de contul lui.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { tenantSlug: PUBLIC_TENANT_SLUG, portalClient: null };
	const tenantId = await resolvePublicTenantId();
	const client = await resolvePortalClientForUser(tenantId, locals.user.id);
	return {
		tenantSlug: PUBLIC_TENANT_SLUG,
		portalClient: client ? { id: client.id, name: client.name, email: client.email } : null
	};
};
