import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { encrypt } from '$lib/server/plugins/smartbill/crypto';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';
import type { DAUserUsage } from '$lib/server/plugins/directadmin/client';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const FiltersSchema = v.optional(
	v.object({
		clientId: v.optional(v.string()),
		status: v.optional(v.string()),
		serverId: v.optional(v.string()),
		limit: v.optional(v.pipe(v.number(), v.integer())),
		offset: v.optional(v.pipe(v.number(), v.integer()))
	})
);

const GetAccountSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	withLive: v.optional(v.boolean(), false)
});

const CreateAccountSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	daServerId: v.pipe(v.string(), v.minLength(1)),
	daPackageId: v.optional(v.string()),
	hostingProductId: v.optional(v.string()),
	daUsername: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	domain: v.pipe(v.string(), v.minLength(1)),
	password: v.pipe(v.string(), v.minLength(8)),
	recurringAmount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	currency: v.optional(v.string(), 'RON'),
	nextDueDate: v.optional(v.string()),
	notes: v.optional(v.string())
});

const SuspendSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	reason: v.optional(v.string())
});

const UpdateClientSchema = v.object({
	accountId: v.pipe(v.string(), v.minLength(1)),
	/** null clears the assignment (back to "Neasignat"); a string is the new CRM client id. */
	clientId: v.nullable(v.pipe(v.string(), v.minLength(1)))
});

const IdSchema = v.pipe(v.string(), v.minLength(1));

export const getHostingAccounts = query(FiltersSchema, async (filters) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const conditions = [eq(table.hostingAccount.tenantId, event.locals.tenant.id)];
	if (filters?.clientId) conditions.push(eq(table.hostingAccount.clientId, filters.clientId));
	if (filters?.status) conditions.push(eq(table.hostingAccount.status, filters.status));
	if (filters?.serverId) conditions.push(eq(table.hostingAccount.daServerId, filters.serverId));

	return db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			daUsername: table.hostingAccount.daUsername,
			status: table.hostingAccount.status,
			suspendReason: table.hostingAccount.suspendReason,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			diskUsage: table.hostingAccount.diskUsage,
			bandwidthUsage: table.hostingAccount.bandwidthUsage,
			emailCount: table.hostingAccount.emailCount,
			dbCount: table.hostingAccount.dbCount,
			clientId: table.hostingAccount.clientId,
			clientName: table.client.name,
			clientBusinessName: table.client.businessName,
			clientEmail: table.client.email,
			clientCui: table.client.cui,
			daServerId: table.hostingAccount.daServerId,
			serverName: table.daServer.name,
			serverHostname: table.daServer.hostname,
			daPackageName: table.hostingAccount.daPackageName,
			linkedPackageName: table.daPackage.daName,
			billingCycle: table.hostingAccount.billingCycle,
			additionalDomains: table.hostingAccount.additionalDomains,
			startDate: table.hostingAccount.startDate,
			createdAt: table.hostingAccount.createdAt,
			lastSyncedAt: table.hostingAccount.lastSyncedAt
		})
		.from(table.hostingAccount)
		.leftJoin(table.client, eq(table.hostingAccount.clientId, table.client.id))
		.leftJoin(table.daServer, eq(table.hostingAccount.daServerId, table.daServer.id))
		.leftJoin(table.daPackage, eq(table.hostingAccount.daPackageId, table.daPackage.id))
		.where(and(...conditions))
		.orderBy(desc(table.hostingAccount.createdAt))
		.limit(filters?.limit ?? 50)
		.offset(filters?.offset ?? 0);
});

export const getHostingAccount = query(GetAccountSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const tenantId = event.locals.tenant.id;
	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, params.id), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);

	if (!account) throw new Error('Account not found');

	let liveStats: DAUserUsage | null = null;
	if (params.withLive && account.daServerId) {
		try {
			const [server] = await db
				.select()
				.from(table.daServer)
				.where(eq(table.daServer.id, account.daServerId))
				.limit(1);
			if (server) {
				const daClient = createDAClient(tenantId, server);
				liveStats = await daClient.getUserUsage(account.daUsername);
			}
		} catch {
			// Ignore live-stats errors
		}
	}

	return { ...account, liveStats };
});

export const createHostingAccount = command(CreateAccountSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, data.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server not found');

	let packageName = 'default';
	if (data.daPackageId) {
		const [pkg] = await db
			.select({ daName: table.daPackage.daName })
			.from(table.daPackage)
			.where(eq(table.daPackage.id, data.daPackageId))
			.limit(1);
		if (pkg) packageName = pkg.daName;
	}

	const [clientData] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!clientData) throw new Error('Client not found');

	const id = generateId();
	const daClient = createDAClient(tenantId, server);

	await runWithAudit(
		{ tenantId, hostingAccountId: id, daServerId: data.daServerId, action: 'create', trigger: 'manual' },
		() =>
			daClient.createUserAccount({
				username: data.daUsername,
				password: data.password,
				domain: data.domain,
				email: clientData.email ?? '',
				package: packageName
			})
	);

	const credentialsEncrypted = encrypt(
		tenantId,
		JSON.stringify({ username: data.daUsername, password: data.password })
	);

	await db.insert(table.hostingAccount).values({
		id,
		tenantId,
		clientId: data.clientId,
		daServerId: data.daServerId,
		daPackageId: data.daPackageId,
		hostingProductId: data.hostingProductId,
		daUsername: data.daUsername,
		domain: data.domain,
		status: 'active',
		daCredentialsEncrypted: credentialsEncrypted,
		recurringAmount: data.recurringAmount ?? 0,
		currency: data.currency ?? 'RON',
		nextDueDate: data.nextDueDate,
		notes: data.notes
	});

	return { id };
});

export const suspendHostingAccount = command(SuspendSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;
	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, params.id), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) throw new Error('Account not found');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(eq(table.daServer.id, account.daServerId))
		.limit(1);

	await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
		if (server) {
			const daClient = createDAClient(tenantId, server);
			await runWithAudit(
				{
					tenantId,
					hostingAccountId: account.id,
					daServerId: account.daServerId,
					action: 'suspend',
					trigger: 'manual'
				},
				() => daClient.suspendUser(account.daUsername)
			);
		}
		await db
			.update(table.hostingAccount)
			.set({
				status: 'suspended',
				suspendReason: params.reason ?? null,
				updatedAt: new Date()
			})
			.where(eq(table.hostingAccount.id, params.id));
	});

	return { success: true };
});

export const unsuspendHostingAccount = command(IdSchema, async (accountId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;
	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, accountId), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) throw new Error('Account not found');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(eq(table.daServer.id, account.daServerId))
		.limit(1);

	await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
		if (server) {
			const daClient = createDAClient(tenantId, server);
			await runWithAudit(
				{
					tenantId,
					hostingAccountId: account.id,
					daServerId: account.daServerId,
					action: 'unsuspend',
					trigger: 'manual'
				},
				() => daClient.unsuspendUser(account.daUsername)
			);
		}
		await db
			.update(table.hostingAccount)
			.set({ status: 'active', suspendReason: null, updatedAt: new Date() })
			.where(eq(table.hostingAccount.id, accountId));
	});

	return { success: true };
});

export const terminateHostingAccount = command(IdSchema, async (accountId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;
	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, accountId), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) throw new Error('Account not found');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(eq(table.daServer.id, account.daServerId))
		.limit(1);

	if (server) {
		const daClient = createDAClient(tenantId, server);
		await runWithAudit(
			{
				tenantId,
				hostingAccountId: account.id,
				daServerId: account.daServerId,
				action: 'delete',
				trigger: 'manual'
			},
			() => daClient.deleteUserAccount(account.daUsername)
		);
	}

	await db
		.update(table.hostingAccount)
		.set({ status: 'terminated', updatedAt: new Date() })
		.where(eq(table.hostingAccount.id, accountId));

	return { success: true };
});

/**
 * Reassign a hosting account to a different CRM client (or unassign).
 * Used by the "Match client" dropdown on /hosting/accounts after a WHMCS import
 * imports services with `clientId=null` (no auto-create) so admin can attach them
 * to existing CRM clients manually. Also lets admin fix mis-imports.
 *
 * If a clientId is given, we also backfill `client.whmcsClientId` from the hosting
 * account's `whmcsServiceId` ↔ WHMCS user mapping — but we don't have that mapping
 * here directly (we have whmcsServiceId, not whmcsUserId). So just update the account.
 */
export const updateHostingAccountClient = command(UpdateClientSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;

	// If a client is being set, validate it belongs to this tenant.
	if (params.clientId) {
		const [c] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!c) throw new Error('Client not found in this tenant');
	}

	const [account] = await db
		.select({ id: table.hostingAccount.id, daServerId: table.hostingAccount.daServerId })
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, params.accountId), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Hosting account not found');

	await db
		.update(table.hostingAccount)
		.set({ clientId: params.clientId, updatedAt: new Date() })
		.where(eq(table.hostingAccount.id, params.accountId));

	// Audit (manual trigger, success path)
	await db.insert(table.daAuditLog).values({
		id: generateId(),
		tenantId,
		hostingAccountId: params.accountId,
		daServerId: account.daServerId,
		action: 'package-change', // reuse existing enum value for "config change"
		trigger: 'manual',
		success: true,
		errorMessage: params.clientId
			? `client_id set to ${params.clientId}`
			: 'client_id cleared (unassigned)'
	});

	return { success: true };
});

/**
 * Internal sync helper — used by both the per-account command and the bulk-sync command.
 * Fetches usage + config from DA, updates daPackageName, additionalDomains, and stats.
 * Throws on failure; callers (esp. bulk) decide whether to swallow or surface errors.
 */
async function syncOneAccount(
	tenantId: string,
	accountId: string,
	trigger: 'manual' | 'cron' = 'manual'
): Promise<{ daPackageName: string | null; additionalDomainsCount: number }> {
	const [account] = await db
		.select()
		.from(table.hostingAccount)
		.where(and(eq(table.hostingAccount.id, accountId), eq(table.hostingAccount.tenantId, tenantId)))
		.limit(1);
	if (!account) throw new Error('Account not found');

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(eq(table.daServer.id, account.daServerId))
		.limit(1);
	if (!server) throw new Error('Server not found');

	const daClient = createDAClient(tenantId, server);

	const [usage, config] = await Promise.all([
		runWithAudit(
			{ tenantId, hostingAccountId: account.id, daServerId: account.daServerId, action: 'sync', trigger },
			() => daClient.getUserUsage(account.daUsername)
		),
		runWithAudit(
			{ tenantId, hostingAccountId: account.id, daServerId: account.daServerId, action: 'sync', trigger },
			() => daClient.getUserConfig(account.daUsername).catch(() => null)
		)
	]);

	const daPackageName = config?.package ?? null;
	let daPackageId: string | null = null;
	if (daPackageName) {
		const [pkg] = await db
			.select({ id: table.daPackage.id })
			.from(table.daPackage)
			.where(
				and(
					eq(table.daPackage.daServerId, account.daServerId),
					eq(table.daPackage.daName, daPackageName),
					eq(table.daPackage.tenantId, tenantId)
				)
			)
			.limit(1);
		if (pkg) daPackageId = pkg.id;
	}

	let additionalDomains: string[] | null = null;
	if (config && Array.isArray(config.domains)) {
		const primary = (account.domain ?? '').toLowerCase().trim();
		additionalDomains = config.domains
			.map((d: unknown) => (typeof d === 'string' ? d.trim() : ''))
			.filter((d: string) => d && d.toLowerCase() !== primary);
	}

	const updates: Record<string, unknown> = {
		diskUsage: usage.quota,
		bandwidthUsage: usage.bandwidth,
		emailCount: usage.emailAccountCount,
		dbCount: usage.dbCount,
		inodeCount: usage.inodeCount,
		lastSyncedAt: new Date().toISOString(),
		updatedAt: new Date()
	};
	if (daPackageName !== null) updates.daPackageName = daPackageName;
	if (daPackageId !== null) updates.daPackageId = daPackageId;
	if (additionalDomains !== null) updates.additionalDomains = additionalDomains;

	await db
		.update(table.hostingAccount)
		.set(updates)
		.where(eq(table.hostingAccount.id, accountId));

	return {
		daPackageName,
		additionalDomainsCount: additionalDomains?.length ?? 0
	};
}

export const syncAccountStats = command(IdSchema, async (accountId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;
	const result = await syncOneAccount(tenantId, accountId, 'manual');
	return { success: true, ...result };
});

/**
 * Bulk-sync all active hosting accounts in this tenant (optionally filtered by server).
 * Calls DA in parallel with p-limit(5). Returns aggregate counts plus per-error details
 * so the UI can surface anything that went wrong.
 */
const BulkSyncSchema = v.object({
	serverId: v.optional(v.pipe(v.string(), v.minLength(1)))
});

export const syncAllHostingAccounts = command(BulkSyncSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;

	const conditions = [
		eq(table.hostingAccount.tenantId, tenantId),
		eq(table.hostingAccount.status, 'active') // only sync active accounts
	];
	if (params.serverId) {
		conditions.push(eq(table.hostingAccount.daServerId, params.serverId));
	}

	const accounts = await db
		.select({ id: table.hostingAccount.id, domain: table.hostingAccount.domain })
		.from(table.hostingAccount)
		.where(and(...conditions));

	const pLimit = (await import('p-limit')).default;
	const limit = pLimit(5);

	const errors: Array<{ accountId: string; domain: string; message: string }> = [];
	let synced = 0;

	await Promise.all(
		accounts.map((acc) =>
			limit(async () => {
				try {
					await syncOneAccount(tenantId, acc.id, 'manual');
					synced++;
				} catch (e) {
					errors.push({
						accountId: acc.id,
						domain: acc.domain,
						message: e instanceof Error ? e.message : String(e)
					});
				}
			})
		)
	);

	return {
		success: true,
		total: accounts.length,
		synced,
		failed: errors.length,
		errors
	};
});
