import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
	throw redirect(302, `/${event.locals.tenant.slug}/campaigns-ads/facebook`);
};
