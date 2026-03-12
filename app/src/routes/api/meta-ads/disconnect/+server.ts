import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { disconnectMetaAds } from '$lib/server/meta-ads/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
	console.log('[META-ADS API] /disconnect POST', { hasUser: !!locals.user });

	if (!locals.user) {
		console.log('[META-ADS API] /disconnect — Unauthorized (no user)');
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { integrationId } = await request.json();

	if (!integrationId) {
		return json({ error: 'Integration ID is required' }, { status: 400 });
	}

	// Get integration and its tenantId
	const [integration] = await db
		.select({ id: table.metaAdsIntegration.id, tenantId: table.metaAdsIntegration.tenantId })
		.from(table.metaAdsIntegration)
		.where(eq(table.metaAdsIntegration.id, integrationId))
		.limit(1);

	if (!integration) {
		console.log('[META-ADS API] /disconnect — integration not found');
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
		console.log('[META-ADS API] /disconnect — user has no access to tenant');
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	try {
		console.log('[META-ADS API] /disconnect — calling disconnectMetaAds...');
		await disconnectMetaAds(integrationId);
		console.log('[META-ADS API] /disconnect — SUCCESS');
		return json({ success: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[META-ADS API] /disconnect — ERROR', { error: msg });
		return json({ error: msg || 'Eroare la deconectare' }, { status: 500 });
	}
};
