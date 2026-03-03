import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/gmail/auth';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug"
	const error = url.searchParams.get('error');

	console.log('[Gmail API /callback] Received callback - code:', !!code, 'state:', state, 'error:', error);

	// Parse state: "tenantId:tenantSlug"
	const [tenantId, tenantSlug] = (state || '').split(':');
	console.log('[Gmail API /callback] Parsed state - tenantId:', tenantId, 'tenantSlug:', tenantSlug);

	if (error) {
		console.error('[Gmail API /callback] Error from Google:', error);
		throw redirect(303, `/${tenantSlug || ''}/settings/gmail?error=${encodeURIComponent(error)}`);
	}

	if (!code || !tenantId || !tenantSlug) {
		console.error('[Gmail API /callback] Missing params - code:', !!code, 'tenantId:', tenantId, 'tenantSlug:', tenantSlug);
		throw redirect(303, '/');
	}

	try {
		console.log('[Gmail API /callback] Calling handleCallback...');
		await handleCallback(code, tenantId);
		console.log('[Gmail API /callback] Success! Redirecting to settings');
		throw redirect(303, `/${tenantSlug}/settings/gmail?success=true`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Gmail API /callback] Callback error:', err);
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw redirect(303, `/${tenantSlug}/settings/gmail?error=${encodeURIComponent(message)}`);
	}
};
