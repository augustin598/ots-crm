import { error } from '@sveltejs/kit';
import { buildRankProjects } from '$lib/server/rank-tracker/projects-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const tenant = event.locals.tenant;
	const client = event.locals.client;
	if (!tenant || !event.locals.isClientUser || !client) {
		throw error(403, 'Acces doar din portalul clientului.');
	}
	return buildRankProjects(tenant.id, { clientId: client.id });
};
