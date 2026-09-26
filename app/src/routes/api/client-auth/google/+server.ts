import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateGoogleLoginUrl, type GoogleLoginMode } from '$lib/server/google-client-auth';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const tenantSlug = url.searchParams.get('tenant');
	if (!tenantSlug) {
		throw redirect(303, '/');
	}

	// mode=signup (butonul „Continuă cu Google" de pe /pachete-hosting și /signup):
	// la „no-match" callback-ul creează contul de hosting în loc să ceară CUI.
	// returnTo e validat în generateGoogleLoginUrl (doar căi din portalul tenantului).
	const mode: GoogleLoginMode = url.searchParams.get('mode') === 'signup' ? 'signup' : 'login';
	const { url: authUrl, nonce } = generateGoogleLoginUrl(tenantSlug, {
		mode,
		returnTo: url.searchParams.get('returnTo')
	});

	cookies.set('google-oauth-state', nonce, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 300 // 5 minutes
	});

	throw redirect(303, authUrl);
};
