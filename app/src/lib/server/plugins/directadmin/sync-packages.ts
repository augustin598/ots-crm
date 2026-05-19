/**
 * Internal DA package sync helper (no auth, no RBAC).
 *
 * The remote command `syncDAPackages` in da-servers.remote.ts handles auth then
 * calls this. Cron tasks call it directly. Keep the two callers in sync — any
 * change here is visible to both.
 *
 * Soft-deletes packages that disappeared from DA (isActive=false) so we don't
 * break FKs on hostingProduct.daPackageId / hostingAccount.daPackageId.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { createDAClient } from './factory';
import { runWithAudit } from './audit';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface DAPackageSyncResult {
	ranAt: string;
	packageCount: number;
	synced: number;
	updated: number;
	deactivated: number;
	failures: { pkg: string; error: string }[];
}

export async function syncDAPackagesForServer(
	tenantId: string,
	serverId: string,
	trigger: 'manual' | 'cron' = 'manual'
): Promise<DAPackageSyncResult> {
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, serverId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server not found');

	logInfo('directadmin', 'sync.start', {
		tenantId,
		metadata: { serverId, serverName: server.name, hostname: server.hostname, trigger }
	});

	const daClient = createDAClient(tenantId, server);

	let packageNames: string[];
	try {
		packageNames = await runWithAudit(
			{ tenantId, daServerId: serverId, action: 'sync', trigger },
			() => daClient.listUserPackages()
		);
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `sync.list_failed: ${message}`, {
			tenantId,
			metadata: { serverId }
		});
		throw new Error(`Nu am putut lista pachetele de pe DA: ${message}`);
	}

	logInfo('directadmin', 'sync.list_ok', {
		tenantId,
		metadata: { serverId, packageCount: packageNames.length, packages: packageNames }
	});

	const now = new Date().toISOString();
	let synced = 0;
	let updated = 0;
	const failures: { pkg: string; error: string }[] = [];
	const seenPackages = new Set(packageNames);

	for (const pkgName of packageNames) {
		let details;
		try {
			details = await daClient.getPackageDetails(pkgName);
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			failures.push({ pkg: pkgName, error: errMsg });
			logError('directadmin', `sync.detail_failed: ${errMsg}`, {
				tenantId,
				metadata: { serverId, pkg: pkgName }
			});
			continue;
		}

		const limitFields = {
			bandwidth: details.bandwidth,
			quota: details.quota,
			maxEmailAccounts: details.maxEmailAccounts,
			maxEmailForwarders: details.maxEmailForwarders,
			maxMailingLists: details.maxMailingLists,
			maxAutoresponders: details.maxAutoresponders,
			maxDatabases: details.maxDatabases,
			maxFtpAccounts: details.maxFtpAccounts,
			maxDomains: details.maxDomains,
			maxSubdomains: details.maxSubdomains,
			maxDomainPointers: details.maxDomainPointers,
			maxInodes: details.maxInodes,
			emailDailyLimit: details.emailDailyLimit,
			anonymousFtp: details.anonymousFtp,
			cgi: details.cgi,
			php: details.php,
			ssl: details.ssl,
			ssh: details.ssh,
			dnsControl: details.dnsControl,
			cron: details.cron,
			spam: details.spam,
			clamav: details.clamav,
			wordpress: details.wordpress,
			git: details.git,
			redis: details.redis,
			suspendAtLimit: details.suspendAtLimit,
			oversold: details.oversold,
			skin: details.skin,
			language: details.language,
			rawData: details.raw as unknown as Record<string, unknown>,
			isActive: true,
			lastSyncedAt: now
		};

		const existing = await db
			.select({ id: table.daPackage.id })
			.from(table.daPackage)
			.where(
				and(
					eq(table.daPackage.daServerId, serverId),
					eq(table.daPackage.daName, pkgName),
					eq(table.daPackage.tenantId, tenantId)
				)
			)
			.limit(1);

		if (existing.length === 0) {
			await db.insert(table.daPackage).values({
				id: generateId(),
				tenantId,
				daServerId: serverId,
				daName: pkgName,
				type: 'user',
				...limitFields
			});
			synced++;
			logInfo('directadmin', 'sync.detail_inserted', {
				tenantId,
				metadata: { serverId, pkg: pkgName }
			});
		} else {
			await db
				.update(table.daPackage)
				.set({ ...limitFields, updatedAt: new Date() })
				.where(eq(table.daPackage.id, existing[0].id));
			updated++;
		}
	}

	// Soft-delete stale packages: present in DB but absent from DA.
	// Hard delete would break hostingProduct.daPackageId / hostingAccount.daPackageId FKs.
	const allDbPackages = await db
		.select({ id: table.daPackage.id, daName: table.daPackage.daName })
		.from(table.daPackage)
		.where(and(eq(table.daPackage.daServerId, serverId), eq(table.daPackage.tenantId, tenantId)));
	let deactivated = 0;
	for (const dbPkg of allDbPackages) {
		if (!seenPackages.has(dbPkg.daName)) {
			await db
				.update(table.daPackage)
				.set({ isActive: false, updatedAt: new Date() })
				.where(eq(table.daPackage.id, dbPkg.id));
			deactivated++;
		}
	}

	const result: DAPackageSyncResult = {
		ranAt: now,
		packageCount: packageNames.length,
		synced,
		updated,
		deactivated,
		failures
	};

	await db
		.update(table.daServer)
		.set({ lastSyncResult: result, updatedAt: new Date() })
		.where(eq(table.daServer.id, serverId));

	logInfo('directadmin', 'sync.complete', { tenantId, metadata: { serverId, ...result } });

	return result;
}
