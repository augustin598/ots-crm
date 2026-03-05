import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateGoogleLoginUrl } from '$lib/server/google-client-auth';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const tenantSlug = url.searchParams.get('tenant');
	if (!tenantSlug) {
		throw redirect(303, '/');
	}

	const { url: authUrl, nonce } = generateGoogleLoginUrl(tenantSlug);

	cookies.set('google-oauth-state', nonce, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 300 // 5 minutes
	});

	throw redirect(303, authUrl);
};
