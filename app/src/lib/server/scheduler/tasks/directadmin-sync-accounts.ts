import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit } from '$lib/server/plugins/directadmin/audit';
import { getPluginRegistry } from '$lib/server/plugins/registry';
import pLimit from 'p-limit';

/**
 * Scheduled task: refresh each hosting account's package name, additional domains and
 * usage stats from the DA server. Runs every 6h. Mirrors the manual "Sync toate" button
 * but scoped per tenant + per server, skipping servers that errored recently to avoid
 * hammering broken endpoints.
 *
 * Why this exists: WHMCS import seeded `daPackageName` from the import-time value, which
 * stales when admins change packages on DA. Without periodic refresh the CRM UI shows
 * outdated badges and (more importantly) the recurring invoice line items render with
 * stale package names because `generateInvoiceFromRecurringTemplate` reads
 * `hostingAccount.daPackageName` on every generation.
 */

interface SyncResult {
	tenantId: string;
	serverId: string;
	synced: number;
	failed: number;
	skipped: number;
}

const PLUGIN_NAME = 'directadmin';
// If a server's lastError was set within this window we skip it — gives operator time
// to fix without us beating on a dead host every 6h.
const SKIP_RECENT_ERROR_MS = 60 * 60 * 1000; // 1 hour
const PER_SERVER_CONCURRENCY = 5;

export async function processDirectAdminSyncAccounts(): Promise<{
	success: boolean;
	tenantsProcessed: number;
	totalSynced: number;
	totalFailed: number;
	results: SyncResult[];
}> {
	logInfo('scheduler', 'DirectAdmin accounts sync starting');

	const registry = getPluginRegistry();
	const results: SyncResult[] = [];
	let tenantsProcessed = 0;
	let totalSynced = 0;
	let totalFailed = 0;

	// 1) Find all tenants where the DA plugin is active.
	const tenants = await db
		.select({ id: table.tenant.id, slug: table.tenant.slug })
		.from(table.tenant);

	for (const tenant of tenants) {
		const isActive = await registry.isPluginActiveForTenant(tenant.id, PLUGIN_NAME).catch(() => false);
		if (!isActive) continue;
		tenantsProcessed++;

		// 2) Find active DA servers for this tenant.
		const servers = await db
			.select()
			.from(table.daServer)
			.where(and(eq(table.daServer.tenantId, tenant.id), eq(table.daServer.isActive, true)));

		for (const server of servers) {
			// Skip servers with recent errors (cooldown).
			if (server.lastError && server.lastCheckedAt) {
				const lastCheckedMs = new Date(server.lastCheckedAt).getTime();
				if (Date.now() - lastCheckedMs < SKIP_RECENT_ERROR_MS) {
					logInfo('scheduler', `Skipping DA server ${server.hostname} (recent error within 1h)`, {
						tenantId: tenant.id,
						metadata: { serverId: server.id, lastError: server.lastError }
					});
					results.push({ tenantId: tenant.id, serverId: server.id, synced: 0, failed: 0, skipped: 1 });
					continue;
				}
			}

			// 3) Find accounts on this server. Sync active + pending (per user decision):
			//    pending accounts may have just been provisioned and need state confirmation.
			//    Skip terminated/cancelled — no point hitting DA for accounts that shouldn't exist.
			const accounts = await db
				.select({
					id: table.hostingAccount.id,
					daUsername: table.hostingAccount.daUsername,
					domain: table.hostingAccount.domain
				})
				.from(table.hostingAccount)
				.where(
					and(
						eq(table.hostingAccount.tenantId, tenant.id),
						eq(table.hostingAccount.daServerId, server.id),
						inArray(table.hostingAccount.status, ['active', 'pending']),
						isNotNull(table.hostingAccount.daUsername)
					)
				);

			if (accounts.length === 0) {
				results.push({ tenantId: tenant.id, serverId: server.id, synced: 0, failed: 0, skipped: 0 });
				continue;
			}

			// 4) Sync each account with a per-server concurrency limit.
			const daClient = createDAClient(tenant.id, {
				hostname: server.hostname,
				port: server.port,
				usernameEncrypted: server.usernameEncrypted,
				passwordEncrypted: server.passwordEncrypted,
				useHttps: server.useHttps ?? false
			} as Parameters<typeof createDAClient>[1]);

			const limit = pLimit(PER_SERVER_CONCURRENCY);
			let synced = 0;
			let failed = 0;

			await Promise.all(
				accounts.map((acc) =>
					limit(async () => {
						try {
							await runWithAudit(
								{
									tenantId: tenant.id,
									hostingAccountId: acc.id,
									daServerId: server.id,
									action: 'sync',
									trigger: 'cron'
								},
								async () => {
									// Mirror the steps from syncOneAccount but using a single shared DA client
									// per server (small efficiency win — we avoid decrypting credentials per account).
									const [config, usage] = await Promise.all([
										daClient.getUserConfig(acc.daUsername).catch(() => null),
										daClient.getUserUsage(acc.daUsername).catch(() => null)
									]);

									if (!config && !usage) {
										// Both calls failed. This is AMBIGUOUS: the account may have been
										// deleted on DA, OR the DA box had a transient hiccup / brief outage.
										// INVARIANT (user rule): the CRM must NEVER auto-`terminate` — only an
										// admin manually terminating on the DA panel is `terminated`. Auto-marking
										// terminated here previously hid still-live accounts from the default
										// Active view and broke renewal visibility (nevadasuceava.ro, 2026-06-03).
										// We DON'T mutate status or daSyncStatus here: a real deletion is confirmed
										// manually, not inferred from one failed poll, and the richer daSyncStatus
										// signals (orphan/zombie_on_da/suspended_on_da) belong to reconcileHostingWithDA.
										// Just warn so staff can investigate a genuinely missing account.
										logWarning(
											'scheduler',
											`DA sync: both getUserConfig + getUserUsage failed for ${acc.daUsername}@${server.hostname} — account may be deleted on DA or DA had a transient outage; status left unchanged`,
											{ tenantId: tenant.id, metadata: { hostingAccountId: acc.id } }
										);
										return;
									}

									const updates: Partial<typeof table.hostingAccount.$inferInsert> = {
										updatedAt: new Date(),
										lastSyncedAt: new Date().toISOString() // column is text(ISO), not timestamp
										// NOTE: we deliberately do NOT write daSyncStatus here — that field carries
										// reconcileHostingWithDA's richer signals (orphan/zombie_on_da/suspended_on_da)
										// and a blanket 'ok' on every poll would clobber them.
									};
									if (config?.package) {
										updates.daPackageName = config.package;
										// Link FK to daPackage by name (don't create — package sync handles that).
										const [pkgRow] = await db
											.select({ id: table.daPackage.id })
											.from(table.daPackage)
											.where(
												and(
													eq(table.daPackage.daServerId, server.id),
													eq(table.daPackage.daName, config.package)
												)
											)
											.limit(1);
										if (pkgRow) updates.daPackageId = pkgRow.id;
									}
									if (config?.domains) {
										updates.additionalDomains = config.domains;
									}
									if (usage) {
										if (usage.bandwidth !== undefined) updates.bandwidthUsage = usage.bandwidth;
										if (usage.quota !== undefined) updates.diskUsage = usage.quota;
										if (usage.emailAccountCount !== undefined)
											updates.emailCount = usage.emailAccountCount;
										if (usage.dbCount !== undefined) updates.dbCount = usage.dbCount;
										if (usage.inodeCount !== undefined) updates.inodeCount = usage.inodeCount;
									}

									await db
										.update(table.hostingAccount)
										.set(updates)
										.where(eq(table.hostingAccount.id, acc.id));
								}
							);
							synced++;
						} catch (e) {
							failed++;
							const { message } = serializeError(e);
							logWarning('scheduler', `DA sync failed for ${acc.daUsername}@${server.hostname}: ${message}`, {
								tenantId: tenant.id,
								metadata: { accountId: acc.id, domain: acc.domain }
							});
						}
					})
				)
			);

			// Stamp the server as checked (clears lastError if no failures).
			await db
				.update(table.daServer)
				.set({
					lastCheckedAt: new Date().toISOString(), // column is text(ISO)
					lastError: failed === accounts.length ? `cron sync: all ${failed} accounts failed` : null
				})
				.where(eq(table.daServer.id, server.id));

			results.push({ tenantId: tenant.id, serverId: server.id, synced, failed, skipped: 0 });
			totalSynced += synced;
			totalFailed += failed;
		}
	}

	logInfo(
		'scheduler',
		`DirectAdmin accounts sync completed: ${tenantsProcessed} tenant(s), ${totalSynced} synced, ${totalFailed} failed`,
		{ metadata: { results } }
	);

	if (totalFailed > 0) {
		logError('scheduler', `DA accounts sync had ${totalFailed} failure(s) — see warnings for per-account detail`);
	}

	return { success: true, tenantsProcessed, totalSynced, totalFailed, results };
}
