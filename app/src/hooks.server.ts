import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import * as tenantUtils from '$lib/server/tenant';
import { initializePlugins } from '$lib/server/plugins';
import { startScheduler } from '$lib/server/scheduler';
import { ensureBnrRatesSynced } from '$lib/server/bnr/client';
import { registerEmailNotificationHooks } from '$lib/server/hooks/email-notifications';
import { registerNotificationHooks } from '$lib/server/hooks/notification-hooks';
import { runMigrations } from '$lib/server/db/migrate';
import { seedAccessCatalog } from '$lib/server/access-seed';
import { shutdownBrowser } from '$lib/server/scraper/cloudflare-bypass';
import { flushLogBuffer } from '$lib/server/logger';
import { restoreAllSessions as restoreWhatsappSessions, shutdownAllSessions as shutdownWhatsappSessions } from '$lib/server/whatsapp/session-manager';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

// Initialize plugins once — flag stored on globalThis so HMR in dev mode
// doesn't reset it (module reload wipes module-level `let`, but not globalThis).
// Without this guard, every code change re-runs `init()` and re-registers
// plugins/hooks, which in turn duplicates hook listeners (Set keyed by
// reference; inline arrow handlers always produce new refs).
const PLUGINS_INIT_SYMBOL = Symbol.for('ots_crm_plugins_initialized');
const SCHEDULER_INIT_SYMBOL = Symbol.for('ots_crm_scheduler_initialized');
const HOOKS_INIT_SYMBOL = Symbol.for('ots_crm_app_hooks_registered');
const WHATSAPP_INIT_SYMBOL = Symbol.for('ots_crm_whatsapp_initialized');
const gt = globalThis as unknown as Record<symbol, boolean>;

async function ensurePluginsInitialized() {
	if (!gt[PLUGINS_INIT_SYMBOL]) {
		await initializePlugins();
		gt[PLUGINS_INIT_SYMBOL] = true;
	}
}

async function ensureSchedulerInitialized() {
	if (!gt[SCHEDULER_INIT_SYMBOL]) {
		gt[SCHEDULER_INIT_SYMBOL] = true;
		try {
			await startScheduler();
		} catch (e) {
			gt[SCHEDULER_INIT_SYMBOL] = false;
			console.error('[scheduler] Failed to initialize:', e);
		}
	}
}

function ensureAppHooksRegistered() {
	if (!gt[HOOKS_INIT_SYMBOL]) {
		registerEmailNotificationHooks();
		registerNotificationHooks();
		gt[HOOKS_INIT_SYMBOL] = true;
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
		event.locals.isClientUserPrimary = false;
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
	event.locals.isClientUserPrimary = false;
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
				// Pick the user's most recently selected client for this tenant.
				// Multi-company users have multiple clientUser rows; the active one
				// is whichever they switched to last (lastSelectedAt). Single-company
				// users have exactly one row, ordering is irrelevant.
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
					.orderBy(sql`${table.clientUser.lastSelectedAt} DESC NULLS LAST`)
					.limit(1);

				if (clientUserRecord) {
					event.locals.isClientUser = true;
					event.locals.isClientUserPrimary = clientUserRecord.clientUser.isPrimary;
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
	// Run migrations on every startup (dev + production) — don't block if Turso times out
	try {
		await runMigrations();
	} catch (e) {
		console.error('[INIT] Migrations failed, continuing startup:', e instanceof Error ? e.message : e);
	}
	// Mirror capability catalog into DB (idempotent, non-fatal on failure)
	try {
		await seedAccessCatalog();
	} catch (e) {
		console.error('[INIT] Access catalog seed failed:', e instanceof Error ? e.message : e);
	}
	await ensurePluginsInitialized();
	ensureAppHooksRegistered();
	await ensureSchedulerInitialized();
	// Sync BNR rates if not already synced today (works even without Redis scheduler)
	await ensureBnrRatesSynced();
	// Restore WhatsApp sessions (Baileys) — guarded against HMR re-runs
	if (!gt[WHATSAPP_INIT_SYMBOL]) {
		gt[WHATSAPP_INIT_SYMBOL] = true;
		restoreWhatsappSessions().catch((e) => {
			gt[WHATSAPP_INIT_SYMBOL] = false;
			console.error('[INIT] WhatsApp session restore failed:', e instanceof Error ? e.message : e);
		});
	}
};

export const handle: Handle = handleAuth;

// Graceful shutdown: flush logs + close Puppeteer browser + WhatsApp sockets
process.on('SIGTERM', async () => {
	await shutdownWhatsappSessions();
	await flushLogBuffer();
	await shutdownBrowser();
});
process.on('SIGINT', async () => {
	await shutdownWhatsappSessions();
	await flushLogBuffer();
	await shutdownBrowser();
});

export const handleError: import('@sveltejs/kit').HandleServerError = async ({ error, event, status }) => {
	const { logError, serializeError } = await import('$lib/server/logger');
	const serialized = serializeError(error);
	const requestId = crypto.randomUUID();

	await logError('server', serialized.message, {
		tenantId: event.locals.tenant?.id,
		url: event.url.pathname,
		stackTrace: serialized.stack,
		metadata: {
			status,
			method: event.request.method,
			searchParams: Object.fromEntries(event.url.searchParams)
		},
		userId: event.locals.user?.id,
		action: 'server_error',
		errorCode: 'SYSTEM_UNEXPECTED',
		requestId,
		ipAddress: event.getClientAddress?.() ?? undefined,
		userAgent: event.request.headers.get('user-agent') ?? undefined
	});

	return {
		message: 'A aparut o eroare interna.',
		requestId
	};
};
