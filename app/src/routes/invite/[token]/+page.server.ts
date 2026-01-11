import type { PageServerLoad } from './$types';
import { getInvitationByToken } from '$lib/remotes/invitations.remote';

export const load: PageServerLoad = async ({ params, locals }) => {
	const token = params.token;

	if (!token) {
		return {
			invitation: null,
			error: 'Invalid invitation link',
			isLoggedIn: !!locals.user
		};
	}

	try {
		const invitation = await getInvitationByToken(token);
		return {
			invitation,
			error: null,
			isLoggedIn: !!locals.user
		};
	} catch (error) {
		return {
			invitation: null,
			error: error instanceof Error ? error.message : 'Invalid or expired invitation',
			isLoggedIn: !!locals.user
		};
	}
};
