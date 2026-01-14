import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	const error = event.url.searchParams.get('error');
	const errorDescription = event.url.searchParams.get('error_description');

	if (!event.locals.user || !event.locals.tenant) {
		redirect(302, '/login');
		return;
	}

	// Handle OAuth errors
	if (error) {
		const errorMsg = errorDescription || error;
		redirect(
			302,
			`/${event.locals.tenant.slug}/settings/anaf-spv?error=${encodeURIComponent(errorMsg)}`
		);
	}

	// Check for required parameters
	if (!code || !state) {
		redirect(
			302,
			`/${event.locals.tenant.slug}/settings/anaf-spv?error=${encodeURIComponent('Missing required parameters from ANAF authorization')}`
		);
	}

	// Redirect to settings page with code and state for processing
	redirect(
		302,
		`/${event.locals.tenant.slug}/settings/anaf-spv?code=${code}&state=${encodeURIComponent(state)}`
	);
};
