import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import * as tenantUtils from '$lib/server/tenant';
import { initializePlugins } from '$lib/server/plugins';
import { startScheduler } from '$lib/server/scheduler';
import { registerEmailNotificationHooks } from '$lib/server/hooks/email-notifications';
import { runMigrations } from '$lib/server/db/migrate';
import { dev } from '$app/environment';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

// Initialize plugins once
let pluginsInitialized = false;
async function ensurePluginsInitialized() {
	if (!pluginsInitialized) {
		await initializePlugins();
		pluginsInitialized = true;
	}
}

// Initialize scheduler once
let schedulerInitialized = false;
function ensureSchedulerInitialized() {
	if (!schedulerInitialized) {
		startScheduler();
		schedulerInitialized = true;
	}
}

const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get(auth.sessionCookieName);

	if (!sessionToken) {
		event.locals.user = null;
		event.locals.session = null;
		event.locals.tenant = null;
		event.locals.tenantUser = null;
		event.locals.clientUser = null;
		event.locals.client = null;
		event.locals.isClientUser = false;
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

	// Check if this is a client route
	const isClientRoute = event.url.pathname.startsWith('/client/');
	event.locals.isClientUser = false;
	event.locals.clientUser = null;
	event.locals.client = null;

	// Handle tenant context for [tenant] routes
	if (event.params.tenant && user) {
		// For client routes, check clientUser relationship
		if (isClientRoute) {
			// Get tenant by slug first
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.slug, event.params.tenant))
				.limit(1);

			if (tenant) {
				// Check if user has clientUser relationship for this tenant
				const [clientUserRecord] = await db
					.select({
						clientUser: table.clientUser,
						client: table.client
					})
					.from(table.clientUser)
					.innerJoin(table.client, eq(table.clientUser.clientId, table.client.id))
					.where(
						and(
							eq(table.clientUser.userId, user.id),
							eq(table.clientUser.tenantId, tenant.id)
						)
					)
					.limit(1);

				if (clientUserRecord) {
					event.locals.isClientUser = true;
					event.locals.clientUser = clientUserRecord.clientUser;
					event.locals.client = clientUserRecord.client;
					event.locals.tenant = tenant;
					event.locals.tenantUser = null; // Client users don't have tenantUser
				} else {
					// User is authenticated but not a client user for this tenant
					event.locals.tenant = tenant;
					event.locals.tenantUser = null;
				}
			} else {
				event.locals.tenant = null;
				event.locals.tenantUser = null;
			}
		} else {
			// Regular tenant route - check tenantUser relationship
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
		}
	} else {
		event.locals.tenant = null;
		event.locals.tenantUser = null;
	}

	return resolve(event);
};

export const init = async () => {
	// Run migrations in production (when dev is false)
	if (!dev) {
		await runMigrations();
	}
	await ensurePluginsInitialized();
	registerEmailNotificationHooks();
	await ensureSchedulerInitialized();
};

export const handle: Handle = handleAuth;

export const handleError = ({ error, event, status }) => {
	console.error(`[${status}]`, event.url.pathname, error);
};
