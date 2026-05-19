import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { syncDAPackagesForServer } from '$lib/server/plugins/directadmin/sync-packages';
import { getPluginRegistry } from '$lib/server/plugins/registry';

/**
 * Scheduled task: refresh `daPackage` rows from each active DirectAdmin server.
 * Runs daily at 03:00 RO time. Captures package additions, renames (via deactivation
 * of old name), and changes in limits/flags.
 *
 * This is independent from the accounts sync (every 6h). The accounts sync resolves
 * `hostingAccount.daPackageId` by joining `daPackage.daName` — keeping the package
 * catalog current means the FK lookup keeps working even when admins add new packages.
 */

const PLUGIN_NAME = 'directadmin';

interface ServerResult {
	tenantId: string;
	serverId: string;
	hostname: string;
	synced?: number;
	updated?: number;
	deactivated?: number;
	total?: number;
	error?: string;
}

export async function processDirectAdminSyncPackages(): Promise<{
	success: boolean;
	tenantsProcessed: number;
	serversProcessed: number;
	results: ServerResult[];
}> {
	logInfo('scheduler', 'DirectAdmin packages sync starting');

	const registry = getPluginRegistry();
	const results: ServerResult[] = [];
	let tenantsProcessed = 0;
	let serversProcessed = 0;

	const tenants = await db.select({ id: table.tenant.id }).from(table.tenant);
	for (const tenant of tenants) {
		const isActive = await registry.isPluginActiveForTenant(tenant.id, PLUGIN_NAME).catch(() => false);
		if (!isActive) continue;
		tenantsProcessed++;

		const servers = await db
			.select()
			.from(table.daServer)
			.where(and(eq(table.daServer.tenantId, tenant.id), eq(table.daServer.isActive, true)));

		for (const server of servers) {
			serversProcessed++;
			try {
				const r = await syncDAPackagesForServer(tenant.id, server.id, 'cron');
				results.push({
					tenantId: tenant.id,
					serverId: server.id,
					hostname: server.hostname,
					synced: r.synced,
					updated: r.updated,
					deactivated: r.deactivated,
					total: r.packageCount
				});
			} catch (e) {
				const { message } = serializeError(e);
				results.push({
					tenantId: tenant.id,
					serverId: server.id,
					hostname: server.hostname,
					error: message
				});
				logError('scheduler', `DA package sync failed for ${server.hostname}: ${message}`, {
					tenantId: tenant.id,
					metadata: { serverId: server.id }
				});
			}
		}
	}

	logInfo(
		'scheduler',
		`DirectAdmin packages sync completed: ${tenantsProcessed} tenant(s), ${serversProcessed} server(s)`,
		{ metadata: { results } }
	);

	return { success: true, tenantsProcessed, serversProcessed, results };
}
