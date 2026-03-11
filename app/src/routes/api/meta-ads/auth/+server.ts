import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOAuthUrl } from '$lib/server/meta-ads/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const tenantSlug = url.searchParams.get('tenant');
	const integrationId = url.searchParams.get('integration');
	console.log('[META-ADS API] /auth GET', { tenantSlug, integrationId });

	if (!tenantSlug || !integrationId) {
		console.log('[META-ADS API] /auth — missing params, redirecting to /');
		throw redirect(303, '/');
	}

	// Resolve slug to tenant ID
	const [tenant] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		console.log('[META-ADS API] /auth — tenant not found', { tenantSlug });
		throw redirect(303, '/');
	}

	// State format: "tenantId:tenantSlug:integrationId"
	const state = `${tenant.id}:${tenantSlug}:${integrationId}`;
	console.log('[META-ADS API] /auth — generating OAuth URL', { state });
	const authUrl = getOAuthUrl(state);
	console.log('[META-ADS API] /auth — redirecting to OAuth');
	throw redirect(303, authUrl);
};
