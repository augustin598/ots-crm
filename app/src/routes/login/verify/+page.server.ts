import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { verifyMagicLink } from '$lib/remotes/auth.remote';

export const load: PageServerLoad = async (event) => {
	const token = event.url.searchParams.get('token');

	if (!token) {
		throw redirect(302, '/login?error=missing-token');
	}

	try {
		// Verify magic link and create session
		const result = await verifyMagicLink({ token });

		if (result.success) {
			// Redirect to dashboard on success
			throw redirect(302, '/');
		} else {
			// Redirect to login with error
			const errorMessage = encodeURIComponent(result.error || 'verification-failed');
			throw redirect(302, `/login?error=${errorMessage}`);
		}
	} catch (error) {
		// If it's a redirect, re-throw it
		if (error && typeof error === 'object' && 'status' in error && error.status === 302) {
			throw error;
		}

		// Otherwise, redirect to login with error
		const errorMessage =
			error instanceof Error ? encodeURIComponent(error.message) : 'verification-failed';
		throw redirect(302, `/login?error=${errorMessage}`);
	}
};
