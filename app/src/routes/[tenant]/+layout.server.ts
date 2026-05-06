import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import * as tenantUtils from '$lib/server/tenant';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';

export const load: LayoutServerLoad = async (event) => {
	if (!event.locals.user) {
		const redirectUrl = event.url.pathname + event.url.search;
		throw redirect(302, '/login?redirect=' + encodeURIComponent(redirectUrl));
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

	// Load sidebar pins (best-effort — empty list if anything fails)
	let sidebarPins: string[] = [];
	try {
		const rows = await db
			.select({ itemId: table.userSidebarPin.itemId })
			.from(table.userSidebarPin)
			.where(
				and(
					eq(table.userSidebarPin.userId, event.locals.user.id),
					eq(table.userSidebarPin.tenantId, access.tenant.id)
				)
			)
			.orderBy(asc(table.userSidebarPin.position), asc(table.userSidebarPin.createdAt));
		sidebarPins = rows.map((r) => r.itemId);
	} catch {
		// Migration may not have run yet — graceful degradation.
		sidebarPins = [];
	}

	return {
		tenant: access.tenant,
		tenantUser: access.tenantUser,
		allTenants,
		sidebarPins,
		user: {
			id: event.locals.user.id,
			email: event.locals.user.email,
			firstName: event.locals.user.firstName,
			lastName: event.locals.user.lastName
		}
	};
};
