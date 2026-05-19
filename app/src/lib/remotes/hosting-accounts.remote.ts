import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray, isNotNull, sql } from 'drizzle-orm';
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

	// Sync active AND pending accounts (pending = just-provisioned, sync confirms real DA state).
	// Skip terminated/cancelled — no point hitting DA for accounts that shouldn't exist there.
	// Require daUsername to be non-null otherwise the DA API call has nothing to look up.
	const conditions = [
		eq(table.hostingAccount.tenantId, tenantId),
		inArray(table.hostingAccount.status, ['active', 'pending']),
		isNotNull(table.hostingAccount.daUsername)
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

// =============================================================================
//  Grouped-by-client query (HOST design pack — /[tenant]/hosting/accounts)
// =============================================================================

export type LastInvoiceLite = {
	id: string;
	status:
		| 'paid'
		| 'pending'
		| 'overdue'
		| 'sent'
		| 'draft'
		| 'cancelled'
		| 'partially_paid'
		| 'n/a';
	date: string | null;
	amountCents: number;
	daysOverdue?: number;
};

export type AccountInGroup = {
	id: string;
	daUsername: string;
	domain: string;
	additionalDomains: string[] | null;
	daPackageName: string | null;
	linkedPackageName: string | null;
	serverName: string | null;
	status: string;
	billingCycle: string;
	autoRenew: boolean;
	startDate: string | null;
	nextDueDate: string | null;
	/** Days until next due date (positive = future, negative = past). */
	expiresInDays: number | null;
	recurringAmount: number;
	currency: string;
	lastInvoice: LastInvoiceLite;
};

export type ClientGroup = {
	clientId: string | null;
	client: {
		id: string | null;
		name: string;
		businessName: string | null;
		cui: string | null;
		email: string | null;
		phone: string | null;
		tier: 'vip' | 'standard' | 'watch';
		clientSince: string | null;
		ltvCents: number;
	};
	accounts: AccountInGroup[];
	totals: {
		count: number;
		addonCount: number;
		mrrCents: number;
		arrCents: number;
		byStatus: Record<string, number>;
		overdueCount: number;
		nextExpiry: { date: string; days: number } | null;
		oldestOverdue: { date: string; daysOverdue: number } | null;
	};
};

const CYCLE_MONTHS_GROUPED: Record<string, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	biannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36,
	one_time: 0
};

function toMonthlyCentsGrouped(amount: number | null, cycle: string | null): number {
	const months = CYCLE_MONTHS_GROUPED[cycle ?? 'monthly'] ?? 1;
	if (months === 0 || !amount) return 0;
	return Math.round(amount / months);
}

/**
 * Days between two ISO dates (toDate - fromDate). Returns null if either is invalid.
 * NOTE: This returns the difference in days from `fromISO` to `toISO`.
 */
function daysDiff(
	fromISO: string | null | undefined,
	toISO: string | null | undefined
): number | null {
	if (!fromISO || !toISO) return null;
	const a = new Date(fromISO);
	const b = new Date(toISO);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
	return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export const getHostingAccountsGrouped = query(FiltersSchema, async (filters) => {
	const event = getRequestEvent();
	const tenantId = event.locals.tenant?.id;
	if (!tenantId) throw new Error('Tenant context required');

	const rows = await db
		.select({
			id: table.hostingAccount.id,
			clientId: table.hostingAccount.clientId,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain,
			additionalDomains: table.hostingAccount.additionalDomains,
			daPackageName: table.hostingAccount.daPackageName,
			linkedPackageName: table.hostingProduct.name,
			serverName: table.daServer.name,
			status: table.hostingAccount.status,
			billingCycle: table.hostingAccount.billingCycle,
			autoRenew: table.hostingAccount.autoRenew,
			startDate: table.hostingAccount.startDate,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			client_id: table.client.id,
			client_name: table.client.name,
			client_businessName: table.client.businessName,
			client_cui: table.client.cui,
			client_email: table.client.email,
			client_phone: table.client.phone,
			client_tier: table.client.tier,
			client_clientSince: table.client.clientSince,
			client_ltvCents: table.client.ltvCents
		})
		.from(table.hostingAccount)
		.leftJoin(
			table.client,
			and(
				eq(table.client.id, table.hostingAccount.clientId),
				eq(table.client.tenantId, tenantId)
			)
		)
		.leftJoin(
			table.daServer,
			and(
				eq(table.daServer.id, table.hostingAccount.daServerId),
				eq(table.daServer.tenantId, tenantId)
			)
		)
		.leftJoin(
			table.hostingProduct,
			and(
				eq(table.hostingProduct.id, table.hostingAccount.hostingProductId),
				eq(table.hostingProduct.tenantId, tenantId)
			)
		)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				filters?.status ? eq(table.hostingAccount.status, filters.status) : undefined,
				filters?.clientId ? eq(table.hostingAccount.clientId, filters.clientId) : undefined,
				filters?.serverId ? eq(table.hostingAccount.daServerId, filters.serverId) : undefined
			)
		)
		.limit(filters?.limit ?? 500);

	const accountIds = rows.map((r) => r.id);

	const invRows = accountIds.length
		? await db
				.select({
					id: table.invoice.id,
					hostingAccountId: table.invoice.hostingAccountId,
					status: table.invoice.status,
					dueDate: table.invoice.dueDate,
					issueDate: table.invoice.issueDate,
					totalAmount: table.invoice.totalAmount
				})
				.from(table.invoice)
				.where(
					and(
						eq(table.invoice.tenantId, tenantId),
						inArray(table.invoice.hostingAccountId, accountIds)
					)
				)
				.orderBy(desc(table.invoice.issueDate))
		: [];

	const todayISO = new Date().toISOString().slice(0, 10);
	const lastInvoiceByAccount = new Map<string, LastInvoiceLite>();
	for (const inv of invRows) {
		if (!inv.hostingAccountId) continue;
		if (lastInvoiceByAccount.has(inv.hostingAccountId)) continue;
		const dateISO = inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : null;
		const dueISO = inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : null;
		let mapped: LastInvoiceLite['status'] = inv.status as LastInvoiceLite['status'];
		if (inv.status !== 'paid' && inv.status !== 'cancelled' && dueISO && dueISO < todayISO) {
			mapped = 'overdue';
		}
		const daysOverdue =
			mapped === 'overdue' && dueISO ? Math.max(0, daysDiff(dueISO, todayISO) ?? 0) : undefined;
		lastInvoiceByAccount.set(inv.hostingAccountId, {
			id: inv.id,
			status: mapped,
			date: dateISO,
			amountCents: Number(inv.totalAmount ?? 0),
			daysOverdue
		});
	}

	const groups = new Map<string, ClientGroup>();
	for (const r of rows) {
		const key = r.clientId ?? '__unassigned__';
		if (!groups.has(key)) {
			groups.set(key, {
				clientId: r.clientId,
				client: {
					id: r.client_id,
					name:
						r.client_name ?? (r.clientId ? `Client #${r.clientId.slice(0, 6)}` : 'Neasignat'),
					businessName: r.client_businessName,
					cui: r.client_cui,
					email: r.client_email,
					phone: r.client_phone,
					tier: (r.client_tier as ClientGroup['client']['tier']) ?? 'standard',
					clientSince: r.client_clientSince,
					ltvCents: Number(r.client_ltvCents ?? 0)
				},
				accounts: [],
				totals: {
					count: 0,
					addonCount: 0,
					mrrCents: 0,
					arrCents: 0,
					byStatus: {},
					overdueCount: 0,
					nextExpiry: null,
					oldestOverdue: null
				}
			});
		}
		const g = groups.get(key)!;
		const expiresInDays = daysDiff(todayISO, r.nextDueDate);

		const lastInv: LastInvoiceLite =
			lastInvoiceByAccount.get(r.id) ?? {
				id: '',
				status: 'n/a',
				date: null,
				amountCents: 0
			};

		const acc: AccountInGroup = {
			id: r.id,
			daUsername: r.daUsername,
			domain: r.domain,
			additionalDomains: r.additionalDomains,
			daPackageName: r.daPackageName,
			linkedPackageName: r.linkedPackageName,
			serverName: r.serverName,
			status: r.status,
			billingCycle: r.billingCycle,
			autoRenew: r.autoRenew === true,
			startDate: r.startDate,
			nextDueDate: r.nextDueDate,
			expiresInDays,
			recurringAmount: r.recurringAmount,
			currency: r.currency,
			lastInvoice: lastInv
		};
		g.accounts.push(acc);
		g.totals.count++;
		g.totals.addonCount += acc.additionalDomains?.length ?? 0;
		g.totals.byStatus[r.status] = (g.totals.byStatus[r.status] ?? 0) + 1;
		if (r.status === 'active' || r.status === 'pending') {
			g.totals.mrrCents += toMonthlyCentsGrouped(r.recurringAmount, r.billingCycle);
		}
		if (lastInv.status === 'overdue') g.totals.overdueCount++;
		if (
			(r.status === 'active' || r.status === 'pending') &&
			expiresInDays !== null &&
			expiresInDays >= 0 &&
			(g.totals.nextExpiry === null || expiresInDays < g.totals.nextExpiry.days)
		) {
			g.totals.nextExpiry = { date: r.nextDueDate ?? '', days: expiresInDays };
		}
		if (
			lastInv.status === 'overdue' &&
			lastInv.daysOverdue !== undefined &&
			(g.totals.oldestOverdue === null || lastInv.daysOverdue > g.totals.oldestOverdue.daysOverdue)
		) {
			g.totals.oldestOverdue = {
				date: lastInv.date ?? '',
				daysOverdue: lastInv.daysOverdue
			};
		}
	}

	for (const g of groups.values()) {
		g.totals.arrCents = g.totals.mrrCents * 12;
	}

	return Array.from(groups.values()).sort((a, b) => {
		if (!a.clientId && b.clientId) return -1;
		if (a.clientId && !b.clientId) return 1;
		if (b.totals.mrrCents !== a.totals.mrrCents) return b.totals.mrrCents - a.totals.mrrCents;
		return b.totals.count - a.totals.count;
	});
});
