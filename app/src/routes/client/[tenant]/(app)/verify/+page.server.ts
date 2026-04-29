import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { verifyMagicLinkToken } from '$lib/server/client-auth';

export const load: PageServerLoad = async (event) => {
	const tenantSlug = event.params.tenant;
	const token = event.url.searchParams.get('token');

	if (!token) {
		throw redirect(302, `/client/${tenantSlug}/login?error=missing-token`);
	}

	try {
		const result = await verifyMagicLinkToken(
			tenantSlug,
			token,
			event as unknown as RequestEvent
		);

		// If the user has more than one company linked, send them to the
		// selector page so they pick which one to enter. Single-company users
		// land directly on the dashboard.
		const target =
			result.clientCount > 1
				? `/client/${tenantSlug}/select-company`
				: `/client/${tenantSlug}/dashboard`;
		throw redirect(302, target);
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
