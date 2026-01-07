import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import * as tenantUtils from '$lib/server/tenant';

const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get(auth.sessionCookieName);

	if (!sessionToken) {
		event.locals.user = null;
		event.locals.session = null;
		event.locals.tenant = null;
		event.locals.tenantUser = null;
		return resolve(event);
	}

	const { session, user } = await auth.validateSessionToken(sessionToken);

	if (session) {
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
	} else {
		auth.deleteSessionTokenCookie(event);
	}

	event.locals.user = user;
	event.locals.session = session;

	// Handle tenant context for [tenant] routes
	if (event.params.tenant && user) {
		const tenantAccess = await tenantUtils.getTenantById(event.params.tenant, user.id);
		if (tenantAccess) {
			event.locals.tenant = tenantAccess.tenant;
			event.locals.tenantUser = tenantAccess.tenantUser;
		} else {
			// User doesn't have access to this tenant
			event.locals.tenant = null;
			event.locals.tenantUser = null;
			// Don't redirect here - let the layout handle it
		}
	} else {
		event.locals.tenant = null;
		event.locals.tenantUser = null;
	}

	return resolve(event);
};

export const handle: Handle = handleAuth;
