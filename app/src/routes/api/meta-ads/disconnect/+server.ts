import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { disconnectMetaAds } from '$lib/server/meta-ads/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	console.log('[META-ADS API] /disconnect POST', { hasUser: !!locals.user, hasTenant: !!locals.tenant });

	if (!locals.user || !locals.tenant) {
		console.log('[META-ADS API] /disconnect — Unauthorized');
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { integrationId } = await request.json();
	console.log('[META-ADS API] /disconnect — params', { integrationId, tenantId: locals.tenant.id });

	if (!integrationId) {
		return json({ error: 'Integration ID is required' }, { status: 400 });
	}

	// Verify integration belongs to this tenant
	const [integration] = await db
		.select({ id: table.metaAdsIntegration.id })
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.id, integrationId),
				eq(table.metaAdsIntegration.tenantId, locals.tenant.id)
			)
		)
		.limit(1);

	if (!integration) {
		console.log('[META-ADS API] /disconnect — integration not found or wrong tenant');
		return json({ error: 'Integration not found' }, { status: 404 });
	}

	try {
		console.log('[META-ADS API] /disconnect — calling disconnectMetaAds...');
		await disconnectMetaAds(integrationId);
		console.log('[META-ADS API] /disconnect — SUCCESS');
		return json({ success: true });
	} catch (err) {
		console.error('[META-ADS API] /disconnect — ERROR', { error: err instanceof Error ? err.message : String(err) });
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
