import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import * as tenantUtils from '$lib/server/tenant';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: LayoutServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const tenantSlug = event.params.tenant;
	if (!tenantSlug) {
		throw redirect(302, '/');
	}

	// Find tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw redirect(302, '/');
	}

	// Validate user access
	const access = await tenantUtils.getTenantById(tenant.id, event.locals.user.id);
	if (!access) {
		throw redirect(302, '/');
	}

	// Get all tenants for the user (for switcher)
	const allTenants = await tenantUtils.getUserTenants(event.locals.user.id);

	return {
		tenant: access.tenant,
		tenantUser: access.tenantUser,
		allTenants
	};
};
