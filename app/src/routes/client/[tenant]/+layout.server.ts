import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const load: LayoutServerLoad = async (event) => {
	if (
		!event.locals.user &&
		event.url.pathname !== `/client/${event.params.tenant}/login` &&
		event.url.pathname !== `/client/${event.params.tenant}/signup` &&
		event.url.pathname !== `/client/${event.params.tenant}/verify`
	) {
		throw redirect(302, `/client/${event.params.tenant}/login`);
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

	// Check if user is a client user for this tenant
	if (
		(!event.locals.isClientUser || !event.locals.client) &&
		event.url.pathname !== `/client/${tenantSlug}/login` &&
		event.url.pathname !== `/client/${tenantSlug}/signup` &&
		event.url.pathname !== `/client/${tenantSlug}/verify`
	) {
		throw redirect(302, `/client/${tenantSlug}/login`);
	}

	let defaultWebsiteUrl: string | null = null;
	if (event.locals.client) {
		const [defW] = await db
			.select({ url: table.clientWebsite.url })
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.clientId, event.locals.client.id),
					eq(table.clientWebsite.isDefault, true)
				)
			)
			.limit(1);
		defaultWebsiteUrl = defW?.url ?? null;
	}

	return {
		tenant,
		client: event.locals.client,
		clientUser: event.locals.clientUser,
		user: event.locals.user
			? {
					id: event.locals.user.id,
					email: event.locals.user.email,
					firstName: event.locals.user.firstName,
					lastName: event.locals.user.lastName
				}
			: null,
		defaultWebsiteUrl
	};
};
