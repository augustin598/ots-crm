import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { verifyAdminMagicLinkToken } from '$lib/server/auth';

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('token');

	if (!token) {
		throw redirect(302, '/login?error=missing-token');
	}

	// Verify magic link and create session
	const result = await verifyAdminMagicLinkToken(token, event);

	if (result.success) {
		// Redirect to dashboard on success
		throw redirect(302, '/');
	} else {
		// Redirect to login with error
		const errorMessage = encodeURIComponent(result.error || 'verification-failed');
		throw redirect(302, `/login?error=${errorMessage}`);
	}
};
