import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { routeRequiresAccess } from '$lib/server/portal-access';

/**
 * Server-side gate for per-user portal access. Reads `accessFlags` from the
 * parent layout (computed in /client/[tenant]/+layout.server.ts) and rejects
 * any request whose pathname maps to a category the user can't access.
 *
 * UI hiding alone is not sufficient — direct URLs and API endpoints under
 * (app)/ inherit this guard via the layout chain.
 */
export const load: LayoutServerLoad = async (event) => {
	const parent = await event.parent();
	const tenantSlug = event.params.tenant ?? '';
	const required = routeRequiresAccess(event.url.pathname, tenantSlug);
	if (required && !parent.accessFlags[required]) {
		throw error(403, 'Nu ai acces la această secțiune.');
	}
	return {};
};
