import type { PageServerLoad } from './$types';
import { ensureClientTeamAccess } from '$lib/server/team-access';

export const load: PageServerLoad = async (event) => {
	await ensureClientTeamAccess(event);
	return {
		clientId: event.locals.client!.id,
		clientName: event.locals.client!.name,
		currentEmail: event.locals.user!.email
	};
};
