import { query, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/get-actor';
import { getCalendarStatus } from '$lib/server/google-calendar/auth';

export const getGoogleCalendarStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		return { connected: false, email: null };
	}
		await requireStaff(event);
	return getCalendarStatus(event.locals.tenant.id);
});
