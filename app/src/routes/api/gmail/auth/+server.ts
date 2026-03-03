import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOAuthUrl } from '$lib/server/gmail/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const tenantSlug = url.searchParams.get('tenant');
	console.log('[Gmail API /auth] Auth request, tenant slug:', tenantSlug);

	if (!tenantSlug) {
		console.error('[Gmail API /auth] No tenant slug provided');
		throw redirect(303, '/');
	}

	// Resolve slug to tenant ID
	const [tenant] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		console.error('[Gmail API /auth] Tenant not found for slug:', tenantSlug);
		throw redirect(303, '/');
	}

	console.log('[Gmail API /auth] Resolved tenant id:', tenant.id, '- generating OAuth URL');

	// State format: "tenantId:tenantSlug" so callback can use both
	const authUrl = getOAuthUrl(`${tenant.id}:${tenantSlug}`);
	console.log('[Gmail API /auth] Redirecting to Google OAuth');
	throw redirect(303, authUrl);
};
