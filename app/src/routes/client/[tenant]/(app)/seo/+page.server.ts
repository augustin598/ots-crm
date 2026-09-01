// Hub „SEO & GEO & AEO" în portalul clientului — STRICT datele clientului din
// sesiune (website-uri, linkuri, PageSpeed), filtrate în SQL prin clientId.
// Gate-ul pe categoria de acces 'seo' rulează în (app)/+layout.server.ts.
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildSeoHubData } from '$lib/server/seo-hub';

export const load: PageServerLoad = async (event) => {
	const tenant = event.locals.tenant;
	const client = event.locals.client;
	if (!tenant || !event.locals.isClientUser || !client) {
		throw error(403, 'Acces doar din portalul clientului.');
	}
	return buildSeoHubData(tenant.id, { clientId: client.id });
};
