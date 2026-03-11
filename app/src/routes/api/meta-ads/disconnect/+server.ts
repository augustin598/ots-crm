import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { disconnectMetaAds } from '$lib/server/meta-ads/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { integrationId } = await request.json();

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
		return json({ error: 'Integration not found' }, { status: 404 });
	}

	try {
		await disconnectMetaAds(integrationId);
		return json({ success: true });
	} catch (err) {
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
