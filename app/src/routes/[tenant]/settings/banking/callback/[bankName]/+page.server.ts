import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { connectBankAccount } from '$lib/remotes/banking.remote';

export const load: PageServerLoad = async (event) => {
	// Validate user is authenticated
	if (!event.locals.user || !event.locals.tenant) {
		throw redirect(302, '/login');
	}

	// Extract OAuth callback parameters
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');
	const error = event.url.searchParams.get('error');
	const errorDescription = event.url.searchParams.get('error_description');
	const bankName = event.params.bankName;

	// Handle OAuth errors from bank
	if (error) {
		const errorMsg = errorDescription || error;
		throw redirect(
			302,
			`/${event.locals.tenant.slug}/settings/banking?error=${encodeURIComponent(errorMsg)}`
		);
	}

	// Validate required parameters
	if (!code || !bankName) {
		throw redirect(
			302,
			`/${event.locals.tenant.slug}/settings/banking?error=${encodeURIComponent('Missing required parameters from bank authorization')}`
		);
	}

	// Note: State validation should ideally be done here by comparing with stored state
	// For now, we'll pass it through to connectBankAccount for validation if needed
	// In production, store state in session/database when generating auth URL and validate here

	try {
		// Exchange code for tokens and connect bank account on server side
		await connectBankAccount({
			bankName,
			authorizationCode: code,
			state: state || undefined // Pass state for validation if needed
		});

		// Redirect to settings page with success message
		throw redirect(302, `/${event.locals.tenant.slug}/settings/banking?success=connected`);
	} catch (e) {
		// Handle errors from connectBankAccount
		const errorMessage =
			e instanceof Error ? e.message : 'Failed to connect bank account';
		throw redirect(
			302,
			`/${event.locals.tenant.slug}/settings/banking?error=${encodeURIComponent(errorMessage)}`
		);
	}
};
