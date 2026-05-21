/**
 * Snapshot of all domains visible across the tenant's active DirectAdmin
 * servers (primary + addon + parked). Used to verify the public domain
 * availability check is querying the right thing. Admin-only.
 *
 *   GET /[tenant]/api/_debug-da-domains
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	const tenantId = event.locals.tenant.id;
	logInfo('directadmin', 'debug-da-domains called', {
		tenantId,
		action: 'debug_da_domains',
		userId: event.locals.user.id,
		metadata: { ip: event.getClientAddress?.() ?? null }
	});

	const servers = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.tenantId, tenantId), eq(table.daServer.isActive, true)));

	const perServer: Array<{
		hostname: string;
		ok: boolean;
		userCount?: number;
		users?: Array<{ username: string; primary: string; allDomains: string[] }>;
		error?: string;
	}> = [];
	const allDomains = new Set<string>();

	for (const srv of servers) {
		try {
			const client = createDAClient(tenantId, srv, { timeoutMs: 10000 });
			const users = await client.searchUsers();
			const userRows: Array<{ username: string; primary: string; allDomains: string[] }> = [];
			for (const u of users) {
				if (u.domain) allDomains.add(u.domain.toLowerCase());
				let userDomains: string[] = [];
				try {
					const cfg = await client.getUserConfig(u.username);
					userDomains = cfg.domains ?? [];
					for (const d of userDomains) if (d) allDomains.add(d.toLowerCase());
				} catch (e) {
					userDomains = [`<error: ${serializeError(e).message}>`];
				}
				userRows.push({
					username: u.username,
					primary: u.domain,
					allDomains: userDomains
				});
			}
			perServer.push({
				hostname: srv.hostname,
				ok: true,
				userCount: users.length,
				users: userRows
			});
		} catch (err) {
			perServer.push({
				hostname: srv.hostname,
				ok: false,
				error: serializeError(err).message
			});
		}
	}

	return json({
		tenantId,
		serverCount: servers.length,
		totalDomainCount: allDomains.size,
		perServer,
		allDomainsSample: Array.from(allDomains).slice(0, 50)
	});
};
