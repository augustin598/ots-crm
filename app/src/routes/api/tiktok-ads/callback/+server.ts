import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/tiktok-ads/auth';

export const GET: RequestHandler = async ({ url }) => {
	// TikTok uses "auth_code" instead of "code"
	const authCode = url.searchParams.get('auth_code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug:integrationId"

	const parts = (state || '').split(':');
	const tenantId = parts[0];
	const tenantSlug = parts[1];
	const integrationId = parts[2];

	if (!authCode || !tenantId || !tenantSlug || !integrationId) {
		throw redirect(303, `/${tenantSlug || ''}/settings/tiktok-ads?error=${encodeURIComponent('Parametri lipsă')}`);
	}

	try {
		await handleCallback(authCode, tenantId, integrationId);
		throw redirect(303, `/${tenantSlug}/settings/tiktok-ads?success=true`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const message = err instanceof Error ? err.message : 'Eroare necunoscută';
		throw redirect(303, `/${tenantSlug}/settings/tiktok-ads?error=${encodeURIComponent(message)}`);
	}
};
