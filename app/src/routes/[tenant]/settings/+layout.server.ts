import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	// Tenant validation is already done in parent layout
	return {
		tenant: event.locals.tenant,
		tenantUser: event.locals.tenantUser
	};
};
