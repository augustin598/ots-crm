import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	exchangeCodeForEmail,
	decodeState,
	safePortalReturnTo,
	type GoogleLoginMode
} from '$lib/server/google-client-auth';
import { findOrCreateClientSession } from '$lib/server/client-auth';
import { findOrCreateHostingSignupClient } from '$lib/server/portal-signup';

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
	let mode: GoogleLoginMode = 'login';
	let returnTo: string | null = null;
	try {
		const state = decodeState(stateParam);
		tenantSlug = state.tenantSlug;
		mode = state.mode;
		// State-ul nu e semnat: re-validăm returnTo și aici, nu doar la generare.
		returnTo = safePortalReturnTo(tenantSlug, state.returnTo);

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
		const { email, name } = await exchangeCodeForEmail(code);
		let result = await findOrCreateClientSession(tenantSlug, email, event);

		// Cont nou de hosting: emailul nu e al niciunui client → îl creăm noi (nume
		// din profilul Google, email deja verificat de Google), apoi deschidem
		// sesiunea pe el. Datele de facturare vin la prima comandă.
		if (!result.success && result.reason === 'no-match' && mode === 'signup') {
			const [tenant] = await db
				.select({ id: table.tenant.id })
				.from(table.tenant)
				.where(eq(table.tenant.slug, tenantSlug))
				.limit(1);
			if (tenant) {
				await findOrCreateHostingSignupClient({
					tenantId: tenant.id,
					name: name?.trim() || email.split('@')[0],
					email,
					phone: null,
					emailVerified: true
				});
				result = await findOrCreateClientSession(tenantSlug, email, event);
			}
		}

		if (result.success) {
			if (result.clientCount > 1) {
				throw redirect(302, `/client/${tenantSlug}/select-company`);
			}
			throw redirect(302, returnTo ?? `/client/${tenantSlug}/dashboard`);
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
