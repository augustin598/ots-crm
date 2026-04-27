import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCodeForEmail, parseState } from '$lib/server/google-client-auth';
import { findOrCreateClientSession } from '$lib/server/client-auth';

export const GET: RequestHandler = async (event) => {
	const { url, cookies } = event;
	const code = url.searchParams.get('code');
	const stateParam = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	if (error || !code || !stateParam) {
		throw redirect(303, '/');
	}

	// Parse state and verify CSRF nonce
	let tenantSlug = '';
	try {
		const state = parseState(stateParam);
		tenantSlug = state.tenantSlug;

		const storedNonce = cookies.get('google-oauth-state');
		cookies.delete('google-oauth-state', { path: '/' });

		if (!storedNonce || storedNonce !== state.nonce) {
			throw new Error('State mismatch');
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw redirect(303, '/');
	}

	try {
		const { email } = await exchangeCodeForEmail(code);
		const result = await findOrCreateClientSession(tenantSlug, email, event);

		if (result.success) {
			const target = result.clientCount > 1
				? `/client/${tenantSlug}/select-company`
				: `/client/${tenantSlug}/dashboard`;
			throw redirect(302, target);
		}

		if (result.reason === 'no-match') {
			throw redirect(
				302,
				`/client/${tenantSlug}/signup?email=${encodeURIComponent(email)}`
			);
		}

		throw redirect(302, `/client/${tenantSlug}/login?error=${encodeURIComponent('Tenant not found')}`);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		// Don't leak internal error details to the URL
		console.error('[Google OAuth callback] Error:', err);
		throw redirect(302, `/client/${tenantSlug}/login?error=${encodeURIComponent('Google login failed. Please try again.')}`);
	}
};
