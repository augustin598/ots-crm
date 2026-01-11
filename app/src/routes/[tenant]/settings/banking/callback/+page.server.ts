import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { connectBankAccount } from '$lib/remotes/banking.remote';

export const load: PageServerLoad = async (event) => {
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	const bankName = event.url.searchParams.get('bank');

	if (!code || !bankName) {
		throw redirect(302, `/${event.locals.tenant.slug}/settings/banking?error=missing_parameters`);
	}

	if (!event.locals.user || !event.locals.tenant) {
		throw redirect(302, '/login');
	}

	try {
		// Note: connectBankAccount is a command, so we need to call it differently
		// For now, we'll handle the OAuth callback logic here directly
		// In a real implementation, you might want to store the state in session/database
		// and validate it here before proceeding

		// For now, redirect to settings page - the actual connection will be handled client-side
		throw redirect(302, `/${event.locals.tenant.slug}/settings/banking?code=${code}&bank=${bankName}`);
	} catch (error) {
		console.error('[Banking Callback] Error:', error);
		throw redirect(302, `/${event.locals.tenant.slug}/settings/banking?error=connection_failed`);
	}
};
