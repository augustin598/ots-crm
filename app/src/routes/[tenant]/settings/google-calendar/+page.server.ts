import type { PageServerLoad, Actions } from './$types';
import { redirect } from '@sveltejs/kit';
import { getCalendarStatus, disconnectCalendar } from '$lib/server/google-calendar/auth';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw redirect(303, `/${event.params.tenant}`);
	}

	const status = await getCalendarStatus(event.locals.tenant.id);
	return { status };
};

export const actions: Actions = {
	disconnect: async (event) => {
		if (!event.locals.user || !event.locals.tenant) {
			throw redirect(303, `/${event.params.tenant}`);
		}
		await disconnectCalendar(event.locals.tenant.id);
		throw redirect(303, `/${event.params.tenant}/settings/google-calendar?status=disconnected`);
	}
};
