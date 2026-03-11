import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/google-ads/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state'); // "tenantId:tenantSlug"
	const error = url.searchParams.get('error');

	// Parse state: "tenantId:tenantSlug"
	const [tenantId, tenantSlug] = (state || '').split(':');

	if (error) {
		throw redirect(303, `/${tenantSlug || ''}/settings/google-ads?error=${encodeURIComponent(error)}`);
	}

	if (!code || !tenantId || !tenantSlug) {
		throw redirect(303, '/');
	}

	try {
		// Get the pending MCC account ID and developer token from the integration (pre-saved before OAuth)
		const [integration] = await db
			.select()
			.from(table.googleAdsIntegration)
			.where(eq(table.googleAdsIntegration.tenantId, tenantId))
			.limit(1);

		const mccAccountId = integration?.mccAccountId || '';
		const developerToken = integration?.developerToken || '';

		if (!mccAccountId || !developerToken) {
			throw redirect(303, `/${tenantSlug}/settings/google-ads?error=${encodeURIComponent('MCC Account ID and Developer Token must be configured before connecting')}`);
		}

		await handleCallback(code, tenantId, mccAccountId, developerToken);
		throw redirect(303, `/${tenantSlug}/settings/google-ads?success=true`);
	} catch (err) {
		// Don't catch redirect errors from SvelteKit
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		throw redirect(303, `/${tenantSlug}/settings/google-ads?error=${encodeURIComponent(message)}`);
	}
};
