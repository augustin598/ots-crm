import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActor } from '$lib/server/get-actor';
import { can } from '$lib/server/access';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw redirect(302, '/login');
	}
	const actor = await getActor(event);
	if (!can(actor, 'admin.hosting.view')) {
		throw redirect(302, `/${event.params.tenant}`);
	}
	return {};
};
