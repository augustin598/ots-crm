import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/meta-ads/auth';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug:integrationId"
	const error = url.searchParams.get('error');

	// Parse state
	const parts = (state || '').split(':');
	const tenantId = parts[0];
	const tenantSlug = parts[1];
	const integrationId = parts[2];

	if (error) {
		throw redirect(303, `/${tenantSlug || ''}/settings/meta-ads?error=${encodeURIComponent(error)}`);
	}

	if (!code || !tenantId || !tenantSlug || !integrationId) {
		throw redirect(303, '/');
	}

	try {
		await handleCallback(code, tenantId, integrationId);
		throw redirect(303, `/${tenantSlug}/settings/meta-ads?success=true`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw redirect(303, `/${tenantSlug}/settings/meta-ads?error=${encodeURIComponent(message)}`);
	}
};
