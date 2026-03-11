import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/meta-ads/auth';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug:integrationId"
	const error = url.searchParams.get('error');
	console.log('[META-ADS API] /callback GET', { hasCode: !!code, state, error });

	// Parse state
	const parts = (state || '').split(':');
	const tenantId = parts[0];
	const tenantSlug = parts[1];
	const integrationId = parts[2];
	console.log('[META-ADS API] /callback — parsed state', { tenantId, tenantSlug, integrationId });

	if (error) {
		console.log('[META-ADS API] /callback — OAuth error from Meta', { error });
		throw redirect(303, `/${tenantSlug || ''}/settings/meta-ads?error=${encodeURIComponent(error)}`);
	}

	if (!code || !tenantId || !tenantSlug || !integrationId) {
		console.log('[META-ADS API] /callback — missing params');
		throw redirect(303, '/');
	}

	try {
		console.log('[META-ADS API] /callback — calling handleCallback...');
		await handleCallback(code, tenantId, integrationId);
		console.log('[META-ADS API] /callback — SUCCESS, redirecting to settings');
		throw redirect(303, `/${tenantSlug}/settings/meta-ads?success=true`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[META-ADS API] /callback — ERROR', { message, stack: err instanceof Error ? err.stack : undefined });
		throw redirect(303, `/${tenantSlug}/settings/meta-ads?error=${encodeURIComponent(message)}`);
	}
};
