import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/gsc/auth';
import { logError, serializeError } from '$lib/server/logger';

// Casa integrării e în Setări, lângă Gmail/Google Calendar/Google Ads.
const DEST = 'settings/search-console';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // „tenantId:tenantSlug"
	const oauthError = url.searchParams.get('error');
	const [tenantId, tenantSlug] = (state || '').split(':');

	if (oauthError) {
		throw redirect(303, `/${tenantSlug || ''}/${DEST}?gsc_error=${encodeURIComponent(oauthError)}`);
	}
	if (!code || !tenantId || !tenantSlug) throw redirect(303, '/');

	try {
		await handleCallback(code, tenantId, url.origin);
	} catch (err) {
		const { message } = serializeError(err);
		logError('gsc', `OAuth callback eșuat: ${message}`, { tenantId });
		throw redirect(303, `/${tenantSlug}/${DEST}?gsc_error=${encodeURIComponent(message)}`);
	}
	throw redirect(303, `/${tenantSlug}/${DEST}?gsc=connected`);
};
