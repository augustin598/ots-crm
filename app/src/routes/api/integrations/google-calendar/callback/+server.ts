import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCodeAndSave } from '$lib/server/google-calendar/auth';
import { logError, serializeError } from '$lib/server/logger';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug"
	const errorParam = url.searchParams.get('error');

	// Parse state: "tenantId:tenantSlug"
	const [tenantId, tenantSlug] = (state || '').split(':');

	if (errorParam) {
		logError('google-calendar', 'OAuth callback error from Google', {
			tenantId: tenantId || 'unknown',
			metadata: { error: errorParam }
		});
		throw redirect(303, `/${tenantSlug || ''}/settings/google-calendar?status=error&reason=${encodeURIComponent(errorParam)}`);
	}

	if (!code || !tenantId || !tenantSlug) {
		throw redirect(303, '/');
	}

	try {
		const { email } = await exchangeCodeAndSave(tenantId, code);
		throw redirect(303, `/${tenantSlug}/settings/google-calendar?status=connected&email=${encodeURIComponent(email)}`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		logError('google-calendar', 'OAuth exchange failed', {
			tenantId: tenantId || 'unknown',
			metadata: { error: serializeError(err) }
		});
		throw redirect(303, `/${tenantSlug}/settings/google-calendar?status=error&reason=exchange_failed`);
	}
};
