// Hub „SEO & GEO & AEO" (admin) — UN singur load per tenant, agregări în SQL.
// Logica de agregare e partajată cu portalul clientului: $lib/server/seo-hub.ts.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireStaff } from '$lib/server/get-actor';
import { buildSeoHubData } from '$lib/server/seo-hub';
import type { SeoHubData } from '$lib/components/seo-hub/types';

export const load: PageServerLoad = async (event): Promise<SeoHubData> => {
	if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
	await requireStaff(event);
	return buildSeoHubData(event.locals.tenant.id);
};
