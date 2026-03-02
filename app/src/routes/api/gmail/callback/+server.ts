import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/gmail/auth';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug"
	const error = url.searchParams.get('error');

	// Parse state: "tenantId:tenantSlug"
	const [tenantId, tenantSlug] = (state || '').split(':');

	if (error) {
		console.error('[Gmail OAuth] Error from Google:', error);
		throw redirect(303, `/${tenantSlug || ''}/settings/gmail?error=${encodeURIComponent(error)}`);
	}

	if (!code || !tenantId || !tenantSlug) {
		throw redirect(303, '/');
	}

	try {
		await handleCallback(code, tenantId);
		throw redirect(303, `/${tenantSlug}/settings/gmail?success=true`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Gmail OAuth] Callback error:', err);
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw redirect(303, `/${tenantSlug}/settings/gmail?error=${encodeURIComponent(message)}`);
	}
};
