import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import * as tenantUtils from '$lib/server/tenant';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		return {
			user: null,
			tenants: []
		};
	}

	const tenants = await tenantUtils.getUserTenants(event.locals.user.id);

	// If user has one tenant, redirect to it
	if (tenants.length === 1) {
		const redirectUrl = event.url.searchParams.get('redirect');
		if (redirectUrl) {
			throw redirect(302, decodeURIComponent(redirectUrl));
		}
		throw redirect(302, `/${tenants[0].slug}`);
	}

	return {
		user: event.locals.user,
		tenants
	};
};
