import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { verifyMagicLinkToken } from '$lib/server/client-auth';

export const load: PageServerLoad = async (event) => {
	const tenantSlug = event.params.tenant;
	const token = event.url.searchParams.get('token');

	if (!token) {
		throw redirect(302, `/client/${tenantSlug}/login?error=missing-token`);
	}

	try {
		// Pass the event for session creation
		await verifyMagicLinkToken(tenantSlug, token, event as unknown as RequestEvent);

		// Redirect to dashboard on success
		throw redirect(302, `/client/${tenantSlug}/dashboard`);
	} catch (error) {
		// If it's a redirect, re-throw it
		if (error && typeof error === 'object' && 'status' in error && error.status === 302) {
			throw error;
		}

		// Otherwise, redirect to login with error
		const errorMessage =
			error instanceof Error ? encodeURIComponent(error.message) : 'verification-failed';
		throw redirect(302, `/client/${tenantSlug}/login?error=${errorMessage}`);
	}
};
