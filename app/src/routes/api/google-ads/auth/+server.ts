import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOAuthUrl } from '$lib/server/google-ads/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const tenantSlug = url.searchParams.get('tenant');

	if (!tenantSlug) {
		throw redirect(303, '/');
	}

	// Resolve slug to tenant ID
	const [tenant] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw redirect(303, '/');
	}

	// State format: "tenantId:tenantSlug" so callback can use both
	const authUrl = getOAuthUrl(`${tenant.id}:${tenantSlug}`);
	throw redirect(303, authUrl);
};
