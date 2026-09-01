// PageSpeed Insights în portalul clientului — READ-ONLY, doar site-urile
// clientului din sesiune (clientId filtrat în SQL prin buildPagespeedSites).
// Gate-ul pe categoria de acces 'seo' rulează în (app)/+layout.server.ts.
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildPagespeedSites } from '$lib/server/pagespeed/sites-data';

export const load: PageServerLoad = async (event) => {
	const tenant = event.locals.tenant;
	const client = event.locals.client;
	if (!tenant || !event.locals.isClientUser || !client) {
		throw error(403, 'Acces doar din portalul clientului.');
	}
	return buildPagespeedSites(tenant.id, { clientId: client.id });
};
