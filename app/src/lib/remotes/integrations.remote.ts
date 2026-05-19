import { query, getRequestEvent } from '$app/server';
import { getCalendarStatus } from '$lib/server/google-calendar/auth';

export const getGoogleCalendarStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		return { connected: false, email: null };
	}
	return getCalendarStatus(event.locals.tenant.id);
});
