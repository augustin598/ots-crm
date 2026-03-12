import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { disconnectTiktokAds } from '$lib/server/tiktok-ads/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { integrationId } = await request.json();

	if (!integrationId) {
		return json({ error: 'Integration ID is required' }, { status: 400 });
	}

	const [integration] = await db
		.select({ id: table.tiktokAdsIntegration.id, tenantId: table.tiktokAdsIntegration.tenantId })
		.from(table.tiktokAdsIntegration)
		.where(eq(table.tiktokAdsIntegration.id, integrationId))
		.limit(1);

	if (!integration) {
		return json({ error: 'Integration not found' }, { status: 404 });
	}

	// Verify user has access to this tenant
	const [tenantUser] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.userId, locals.user.id),
				eq(table.tenantUser.tenantId, integration.tenantId)
			)
		)
		.limit(1);

	if (!tenantUser) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	try {
		await disconnectTiktokAds(integrationId);
		return json({ success: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return json({ error: msg || 'Eroare la deconectare' }, { status: 500 });
	}
};
