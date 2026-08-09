import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Legacy route — kept as a redirect for any bookmarked URLs from the old structure.
// New canonical path: /[tenant]/campaigns-ads with subpages facebook|tiktok|google.
export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
	// ?status= din vechiul flux (pending_approval etc.) nu mai are corespondent —
	// pagina nouă citește doar ?account=; nu mai propagăm parametrul.
	throw redirect(302, `/${event.locals.tenant.slug}/campaigns-ads/facebook`);
};
