/**
 * Admin-gated one-off importer for a hosting account that exists LIVE on
 * DirectAdmin but has no CRM `hosting_account` row (so it never shows on
 * /hosting/accounts). WHMCS import is retired — DirectAdmin is now the single
 * source of truth — and neither the 6h sync nor reconcile CREATE rows for
 * DA-only users, so this endpoint bridges that gap for a single account.
 *
 * It performs NO DirectAdmin write: it reads the DA user config and inserts a
 * CRM row via `createHostingAccountFromDiscovery` (clientId=null, auto-priced
 * from the package→product map, status from DA suspension only).
 *
 *   GET  /[tenant]/api/_debug-import-da-account?domain=foo.ro            → dry-run preview
 *   GET  /[tenant]/api/_debug-import-da-account?serverId=X&username=Y    → dry-run preview
 *   POST /[tenant]/api/_debug-import-da-account
 *        body { domain?: string, username?: string, serverId?: string }  → import
 *
 * When only `domain` is given we scan active servers and match the DA user whose
 * PRIMARY domain equals it (searchUsers). Pass `serverId`+`username` to target
 * exactly (e.g. a mangled username like `gradinitamaginca`).
 */

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { createHostingAccountFromDiscovery } from '$lib/server/hosting/create-account';
import { logInfo, serializeError } from '$lib/server/logger';
import type { DAUserConfig } from '$lib/server/plugins/directadmin/client';
import type { RequestHandler } from './$types';

type DaServerRow = typeof table.daServer.$inferSelect;

interface ResolvedTarget {
	server: DaServerRow;
	username: string;
	config: DAUserConfig;
}

/**
 * Locate the DA user across the tenant's active servers.
 * - If serverId+username given: fetch that user's config directly.
 * - If domain given: searchUsers() per server, match the user whose primary
 *   domain equals `domain` (case-insensitive), then fetch its config.
 * Returns null when nothing matches; throws only on total DA failure per server
 * (swallowed so one dead server doesn't mask a match on another).
 */
async function resolveTarget(
	tenantId: string,
	servers: DaServerRow[],
	opts: { serverId?: string; username?: string; domain?: string }
): Promise<ResolvedTarget | null> {
	const domainLc = opts.domain?.trim().toLowerCase();

	for (const server of servers) {
		if (opts.serverId && server.id !== opts.serverId) continue;
		const client = createDAClient(tenantId, server, { timeoutMs: 12000 });

		try {
			// Direct hit: explicit username on this server.
			if (opts.username) {
				const config = await client.getUserConfig(opts.username.trim());
				return { server, username: opts.username.trim(), config };
			}

			// Domain search: match the user whose primary domain == the requested domain.
			if (domainLc) {
				const users = await client.searchUsers();
				const hit = users.find((u) => (u.domain ?? '').trim().toLowerCase() === domainLc);
				if (hit) {
					const config = await client.getUserConfig(hit.username);
					return { server, username: hit.username, config };
				}
			}
		} catch {
			// Try the next server; a per-server hiccup must not mask a match elsewhere.
			continue;
		}
	}
	return null;
}

async function findExistingRow(
	tenantId: string,
	serverId: string,
	username: string
): Promise<{ id: string; status: string } | null> {
	const [row] = await db
		.select({ id: table.hostingAccount.id, status: table.hostingAccount.status })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.daServerId, serverId),
				sql`lower(${table.hostingAccount.daUsername}) = ${username.toLowerCase()}`
			)
		)
		.limit(1);
	return row ?? null;
}

function requireAdmin(event: RequestEvent): string {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	return event.locals.tenant.id;
}

async function activeServers(tenantId: string): Promise<DaServerRow[]> {
	return db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.tenantId, tenantId), eq(table.daServer.isActive, true)));
}

/** Dry-run preview: what the import would do, without writing anything. */
export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);
	const serverId = event.url.searchParams.get('serverId') ?? undefined;
	const username = event.url.searchParams.get('username') ?? undefined;
	const domain = event.url.searchParams.get('domain') ?? undefined;
	if (!username && !domain) throw error(400, 'Provide ?domain=... or ?serverId=...&username=...');

	const servers = await activeServers(tenantId);
	if (servers.length === 0) return json({ ok: false, reason: 'no_active_da_servers' });

	const target = await resolveTarget(tenantId, servers, { serverId, username, domain });
	if (!target) return json({ ok: false, reason: 'da_user_not_found', searched: { serverId, username, domain } });

	const existing = await findExistingRow(tenantId, target.server.id, target.username);
	const cfg = target.config;
	const primary = cfg.domain || (cfg.domains ?? [])[0] || domain || '';

	return json({
		ok: true,
		dryRun: true,
		alreadyInCrm: existing !== null,
		existing,
		wouldImport: {
			serverId: target.server.id,
			serverHostname: target.server.hostname,
			username: target.username,
			primaryDomain: primary,
			additionalDomains: (cfg.domains ?? []).filter(
				(d) => d && d.toLowerCase() !== primary.toLowerCase()
			),
			daPackageName: cfg.package ?? null,
			suspended: cfg.suspended === true,
			daEmail: cfg.email ?? null,
			statusOnImport: cfg.suspended ? 'suspended' : 'active'
		}
	});
};

/** Perform the import. Idempotent — a pre-existing row is reported, not duplicated. */
export const POST: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);

	let body: { serverId?: string; username?: string; domain?: string } = {};
	try {
		body = (await event.request.json()) as typeof body;
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { serverId, username, domain } = body;
	if (!username && !domain) throw error(400, 'Provide "domain" or "serverId"+"username" in the body');

	logInfo('directadmin', 'debug-import-da-account called', {
		tenantId,
		action: 'debug_import_da_account',
		userId: event.locals.user!.id,
		metadata: { serverId: serverId ?? null, username: username ?? null, domain: domain ?? null }
	});

	const servers = await activeServers(tenantId);
	if (servers.length === 0) return json({ ok: false, reason: 'no_active_da_servers' }, { status: 400 });

	const target = await resolveTarget(tenantId, servers, { serverId, username, domain });
	if (!target) {
		return json(
			{ ok: false, reason: 'da_user_not_found', searched: { serverId, username, domain } },
			{ status: 404 }
		);
	}

	const cfg = target.config;
	const primary = cfg.domain || (cfg.domains ?? [])[0] || domain || '';
	if (!primary) return json({ ok: false, reason: 'no_primary_domain' }, { status: 422 });

	try {
		const result = await createHostingAccountFromDiscovery(tenantId, {
			daServerId: target.server.id,
			daUsername: target.username,
			domain: primary,
			additionalDomains: cfg.domains ?? [],
			daPackageName: cfg.package ?? null,
			suspended: cfg.suspended === true,
			daEmail: cfg.email ?? null
		});
		return json({ ok: true, ...result, serverHostname: target.server.hostname, username: target.username });
	} catch (err) {
		return json({ ok: false, reason: serializeError(err).message }, { status: 500 });
	}
};
