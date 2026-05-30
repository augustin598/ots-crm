import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray, isNotNull, isNull, sql, ne, or, gt } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import type { DAUserUsage } from '$lib/server/plugins/directadmin/client';
import { createHostingAccountInternal } from '$lib/server/hosting/create-account';
import { upsertRecurringInvoiceForHostingAccount } from '$lib/server/hosting/recurring-template';
import { logWarning } from '$lib/server/logger';
// Imports below sit OUTSIDE the pre-existing merge conflict block so the
// compiler can see them. Do NOT move them inside the markers.
import { logError } from '$lib/server/logger';
import {
	notifyHostingSuspended,
	notifyHostingSuspendedManual,
	notifyHostingReactivatedManual
} from '$lib/server/hosting/notifications';

/**
 * Resolves the actor's display name for audit/email purposes.
 * Falls back to email when first/last name is missing, then to a generic label.
 */
async function resolveActorName(userId: string): Promise<string | null> {
	const [u] = await db
		.select({
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName
		})
		.from(table.user)
		.where(eq(table.user.id, userId))
		.limit(1);
	if (!u) return null;
	const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
	return full || u.email || null;
}

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
	reason: v.optional(v.string()),
	/**
	 * Optional invoice id. When provided, admin is enforcing an unpaid invoice
	 * → mark autoSuspendedByInvoiceId so the invoice-driven unsuspend hook can
	 * auto-clear on payment, and fire notifyHostingSuspended (the customer
	 * email template needs invoice context to render).
	 */
	invoiceId: v.optional(v.string())
});

const UpdateClientSchema = v.object({
	accountId: v.pipe(v.string(), v.minLength(1)),
	/** null clears the assignment (back to "Neasignat"); a string is the new CRM client id. */
	clientId: v.nullable(v.pipe(v.string(), v.minLength(1)))
});

const IdSchema = v.pipe(v.string(), v.minLength(1));

// NOTE: the flat `getHostingAccounts` list query was removed 2026-05-30 (audit J1) —
// it had no callers; the page uses `getHostingAccountsGrouped`. Its RBAC pattern was
// copied to that function (audit C1).

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
				.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
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
	const { id } = await createHostingAccountInternal(tenantId, {
		clientId: data.clientId,
		daServerId: data.daServerId,
		daPackageId: data.daPackageId,
		hostingProductId: data.hostingProductId,
		daUsername: data.daUsername,
		domain: data.domain,
		password: data.password,
		recurringAmount: data.recurringAmount,
		currency: data.currency,
		nextDueDate: data.nextDueDate,
		notes: data.notes,
		auditTrigger: 'manual'
	});


	// Auto-create recurring invoice template so the daily scheduler picks this account
	// up and bills the client on the configured billing cycle. Idempotent (keyed by
	// hostingAccountId) — re-running is safe. Skips silently when amount=0 (free trial,
	// internal) or clientId missing. Best-effort: a failure here must NOT roll back the
	// hostingAccount creation since DA already provisioned the user upstream.
	try {
		// Read billing cycle from the linked hostingProduct (catalog), defaulting to
		// 'monthly' when no product is linked. The hostingAccount column itself defaults
		// to 'monthly' too, so this stays consistent.
		let billingCycle: string = 'monthly';
		if (data.hostingProductId) {
			const [product] = await db
				.select({ billingCycle: table.hostingProduct.billingCycle })
				.from(table.hostingProduct)
				.where(
					and(
						eq(table.hostingProduct.id, data.hostingProductId),
						eq(table.hostingProduct.tenantId, tenantId)
					)
				)
				.limit(1);
			if (product?.billingCycle) billingCycle = product.billingCycle;
		}

		const result = await upsertRecurringInvoiceForHostingAccount({
			tenantId,
			userId: event.locals.user.id,
			hostingAccountId: id,
			clientId: data.clientId,
			domain: data.domain,
			// Let the upsert helper resolve daPackageName from the
			// hostingAccount row it just inserted (recurring-template.ts:253-260
			// queries hostingAccount.daPackageName when this arg is null).
			daPackageName: null,
			recurringAmount: data.recurringAmount ?? 0,
			currency: data.currency ?? 'RON',
			billingCycle,
			nextDueDate: data.nextDueDate ?? null,
			status: 'active'
		});
		logWarning(
			'directadmin',
			`Recurring template ${result} for hosting account ${id}`,
			{ tenantId, metadata: { hostingAccountId: id, billingCycle, result } }
		);
	} catch (err) {
		// Non-fatal — operator can run /api/_debug-sync-hosting-recurring later to recover.
		logWarning(
			'directadmin',
			`Failed to auto-create recurring template for hosting account ${id}; account created OK, template skipped`,
			{
				tenantId,
				metadata: { hostingAccountId: id },
				stackTrace: err instanceof Error ? err.stack : undefined
			}
		);
	}

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
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
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
				suspendedAt: new Date(),
				// Clear stale reactivatedAt so the column reflects current state.
				reactivatedAt: null,
				// If linked to a specific invoice, mark it so the unsuspend hook can
				// auto-clear on payment. Otherwise null (manual = not invoice-tied).
				autoSuspendedByInvoiceId: params.invoiceId ?? null,
				updatedAt: new Date()
			})
			.where(eq(table.hostingAccount.id, params.id));
	});

	// Fire customer + admin notification emails. Two paths:
	//   - invoiceId present → rich invoice template (notifyHostingSuspended)
	//     also fires admin alert internally (auto-trigger dedupe keyed on invoice).
	//   - invoiceId absent (modal panel suspend) → generic manual template
	//     (notifyHostingSuspendedManual) + admin alert with actorName.
	// Both paths are best-effort: DA suspend has already committed; email
	// failure must not roll back or fail the admin's action.
	if (params.invoiceId) {
		const invoiceId = params.invoiceId;
		notifyHostingSuspended(tenantId, params.id, invoiceId).catch((err) => {
			logError('hosting-email', 'invoice-tied suspend notify failed', {
				tenantId,
				metadata: {
					hostingAccountId: params.id,
					invoiceId,
					error: err instanceof Error ? err.message : String(err)
				}
			});
		});
	} else {
		const actorName = await resolveActorName(event.locals.user.id);
		notifyHostingSuspendedManual(tenantId, params.id, {
			reason: params.reason ?? null,
			actorName
		}).catch((err) => {
			logError('hosting-email', 'manual suspend notify failed', {
				tenantId,
				metadata: {
					hostingAccountId: params.id,
					error: err instanceof Error ? err.message : String(err)
				}
			});
		});
	}

	return { success: true };
});

/**
 * Manual unsuspend by admin. Updates DA + DB, then fires the generic
 * reactivated-manual customer email + admin internal alert. The invoice-tied
 * unsuspend path (auto, via stripe/keez webhook → directadmin/hooks.ts) uses
 * `notifyHostingReactivated` with full invoice context — this manual path uses
 * the generic template since the admin's button-click carries no invoice tie.
 */
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
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
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
			.set({
				status: 'active',
				suspendReason: null,
				// Clear marker so the next invoice-driven suspension is correctly
				// attributed and a future automatic unsuspend hook isn't confused.
				autoSuspendedByInvoiceId: null,
				reactivatedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.hostingAccount.id, accountId));
	});

	// Fire customer + admin notification emails. Best-effort — DA unsuspend has
	// already committed; email failure must not roll back or fail the action.
	const actorName = await resolveActorName(event.locals.user.id);
	notifyHostingReactivatedManual(tenantId, accountId, { actorName }).catch((err) => {
		logError('hosting-email', 'manual reactivate notify failed', {
			tenantId,
			metadata: {
				hostingAccountId: accountId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
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
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);

	// Policy (memory: feedback_never_delete_da_accounts + audit C2, 2026-05-30):
	// NEVER call deleteUserAccount from a production code path — it irreversibly
	// wipes /home, mail, DBs and domains. "Terminate" = stop the service: mark the
	// CRM row terminated and SUSPEND the DA user (reversible). The real DA deletion
	// stays a deliberate manual action by an admin in the DA panel.
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
		.set({ status: 'terminated', suspendedAt: new Date(), updatedAt: new Date() })
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
		.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
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

	// Bulk sync runs many syncOneAccount in parallel (p-limit 5) against libSQL's
	// single writer → wrap this write in the shared busy-retry so a transient
	// "database is locked" doesn't fail the whole account's sync (audit L2).
	await withTursoBusyRetry(
		() =>
			db
				.update(table.hostingAccount)
				.set(updates)
				.where(eq(table.hostingAccount.id, accountId)),
		{ tenantId, label: `syncOneAccount:${accountId}` }
	);

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
//  Hosting invoice → account attribution helper
// =============================================================================

type AccountForAttribution = {
	id: string;
	domain: string;
	startDate: string | null;
	recurringAmount: number;
	billingCycle: string;
};

const HOSTING_KEYWORD_REGEX = /gazduire|găzduire|gasduire|gaduire|hosting|wordpress/i;

const CYCLE_MONTHS_ATTR: Record<string, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	biannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36,
	one_time: 0
};

/**
 * Attribute a hosting invoice (no FK) to one of the client's accounts.
 *
 * Strategy (in order):
 *   1. If any line item description contains an account's full domain → that account.
 *   2. Else, filter accounts to those that existed at the invoice's issueDate
 *      (`startDate <= issueDate`, accepting null startDate as "unknown, allow").
 *   3. If only one existed at the time → use it.
 *   4. Else pick the one whose monthly-normalised price is closest to the
 *      invoice's monthly-normalised amount (rough heuristic — prices change but
 *      it's better than random).
 *   5. Else (no candidates left) → null.
 *
 * Returns `{ accountId, matchedVia }` or null if no attribution possible.
 */
function attributeHostingInvoice(
	invoice: {
		issueDate: Date | string | null;
		totalAmount: number | null;
		descriptions: string[];
	},
	accounts: AccountForAttribution[]
): { accountId: string; matchedVia: 'domain' | 'fallback' } | null {
	if (accounts.length === 0) return null;

	// 1. Specific domain match in any line item description
	const lowerDescs = invoice.descriptions.map((d) => d.toLowerCase());
	for (const a of accounts) {
		const dl = a.domain.toLowerCase();
		if (dl && lowerDescs.some((desc) => desc.includes(dl))) {
			return { accountId: a.id, matchedVia: 'domain' };
		}
	}

	// 2. Filter to accounts that existed at the invoice's issueDate
	const issueISO = invoice.issueDate
		? new Date(invoice.issueDate).toISOString().slice(0, 10)
		: null;
	const existed = accounts.filter((a) => {
		if (!a.startDate) return true; // unknown, allow
		if (!issueISO) return true; // can't compare, allow
		return a.startDate <= issueISO;
	});
	if (existed.length === 0) return null;

	// 3. Single account at the time → unambiguous
	if (existed.length === 1) {
		return { accountId: existed[0].id, matchedVia: 'fallback' };
	}

	// 4. Multiple — pick by closest monthly-normalised amount
	if (invoice.totalAmount !== null && invoice.totalAmount > 0) {
		const scored = existed
			.map((a) => {
				const months = CYCLE_MONTHS_ATTR[a.billingCycle] ?? 1;
				const monthly = months > 0 ? a.recurringAmount / months : a.recurringAmount;
				// Invoice cycle is unknown; assume annual as a reasonable default.
				const invMonthly = (invoice.totalAmount ?? 0) / 12;
				return { id: a.id, diff: Math.abs(monthly - invMonthly), startDate: a.startDate ?? '' };
			})
			.sort((x, y) => x.diff - y.diff || y.startDate.localeCompare(x.startDate));
		return { accountId: scored[0].id, matchedVia: 'fallback' };
	}

	// 5. Fall back to oldest existing account
	const oldest = [...existed].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
	return { accountId: oldest[0].id, matchedVia: 'fallback' };
}

// =============================================================================
//  Generic update (CRM-side fields only) — powers the EditAccountModal save.
// =============================================================================

/**
 * Whitelist of safely-writable CRM fields. Excluded by design:
 *   - status (gestionat separat prin suspend/unsuspend/terminate; apel imediat din UI)
 *   - daUsername (rename DA = operațiune grea, separat)
 *   - daServerId (migrare DA = workflow distinct)
 *
 * Domain este editabil dar — atenție — schimbă doar metadata CRM, nu mută DA user-ul.
 */
const UpdateAccountSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	clientId: v.optional(v.nullable(v.string())),
	daPackageId: v.optional(v.nullable(v.string())),
	hostingProductId: v.optional(v.nullable(v.string())),
	domain: v.optional(v.pipe(v.string(), v.minLength(1))),
	startDate: v.optional(v.nullable(v.string())),
	nextDueDate: v.optional(v.nullable(v.string())),
	recurringAmount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	currency: v.optional(v.picklist(['RON', 'EUR', 'USD'])),
	billingCycle: v.optional(
		v.picklist([
			'monthly',
			'quarterly',
			'semiannually',
			'biannually',
			'annually',
			'biennially',
			'triennially',
			'one_time'
		])
	),
	additionalDomains: v.optional(v.nullable(v.array(v.string()))),
	autoRenew: v.optional(v.boolean()),
	paymentMethod: v.optional(v.picklist(['card', 'op', 'cash'])),
	notes: v.optional(v.nullable(v.string())),
	tags: v.optional(v.nullable(v.array(v.string())))
});

export const updateHostingAccount = command(UpdateAccountSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const tenantId = event.locals.tenant.id;

	const [account] = await db
		.select({
			id: table.hostingAccount.id,
			daServerId: table.hostingAccount.daServerId,
			clientId: table.hostingAccount.clientId,
			daPackageId: table.hostingAccount.daPackageId,
			hostingProductId: table.hostingAccount.hostingProductId,
			domain: table.hostingAccount.domain,
			startDate: table.hostingAccount.startDate,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			billingCycle: table.hostingAccount.billingCycle,
			status: table.hostingAccount.status,
			autoRenew: table.hostingAccount.autoRenew
		})
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, data.id), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Hosting account not found');

	// Validate clientId belongs to tenant when provided.
	if (data.clientId) {
		const [c] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!c) throw new Error('Client not found in this tenant');
	}

	// Validate daPackageId belongs to the account's current DA server + tenant (whitelist).
	if (data.daPackageId) {
		const [pkg] = await db
			.select({ id: table.daPackage.id })
			.from(table.daPackage)
			.where(
				and(
					eq(table.daPackage.id, data.daPackageId),
					eq(table.daPackage.daServerId, account.daServerId),
					eq(table.daPackage.tenantId, tenantId)
				)
			)
			.limit(1);
		if (!pkg)
			throw new Error('Pachetul nu există sau nu aparține serverului curent al contului');
	}

	// Validate hostingProductId scoped to tenant.
	if (data.hostingProductId) {
		const [p] = await db
			.select({ id: table.hostingProduct.id })
			.from(table.hostingProduct)
			.where(
				and(
					eq(table.hostingProduct.id, data.hostingProductId),
					eq(table.hostingProduct.tenantId, tenantId)
				)
			)
			.limit(1);
		if (!p) throw new Error('Produsul de hosting nu există în acest tenant');
	}

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.clientId !== undefined) updates.clientId = data.clientId;
	if (data.daPackageId !== undefined) updates.daPackageId = data.daPackageId;
	if (data.hostingProductId !== undefined) updates.hostingProductId = data.hostingProductId;
	if (data.domain !== undefined) updates.domain = data.domain;
	if (data.startDate !== undefined) updates.startDate = data.startDate;
	if (data.nextDueDate !== undefined) updates.nextDueDate = data.nextDueDate;
	if (data.recurringAmount !== undefined) updates.recurringAmount = data.recurringAmount;
	if (data.currency !== undefined) updates.currency = data.currency;
	if (data.billingCycle !== undefined) updates.billingCycle = data.billingCycle;
	if (data.additionalDomains !== undefined) updates.additionalDomains = data.additionalDomains;
	if (data.autoRenew !== undefined) updates.autoRenew = data.autoRenew;
	if (data.paymentMethod !== undefined) updates.paymentMethod = data.paymentMethod;
	if (data.notes !== undefined) updates.notes = data.notes;
	if (data.tags !== undefined) updates.tags = data.tags;

	await db
		.update(table.hostingAccount)
		.set(updates)
		.where(and(eq(table.hostingAccount.id, data.id), eq(table.hostingAccount.tenantId, tenantId)));

	// Best-effort audit (don't fail the save if audit insert hiccups).
	try {
		await db.insert(table.daAuditLog).values({
			id: generateId(),
			tenantId,
			hostingAccountId: data.id,
			daServerId: account.daServerId,
			action: 'package-change',
			trigger: 'manual',
			success: true,
			errorMessage: `edit form: ${Object.keys(updates).filter((k) => k !== 'updatedAt').join(', ')}`
		});
	} catch (e) {
		logWarning('directadmin', 'updateHostingAccount audit insert failed', {
			metadata: { err: e instanceof Error ? e.message : String(e), accountId: data.id }
		});
	}

	// Re-sync the recurring-invoice template from the catalog and reconcile the
	// snapshot — parity with createHostingAccount, which calls the upsert at
	// creation. Without this, changing the package/cycle/price here leaves the OLD
	// price billing at the next renewal (audit finding H2/DRIFT-1). Uses merged
	// post-update values. Best-effort: a hiccup must not fail the save.
	try {
		await upsertRecurringInvoiceForHostingAccount({
			tenantId,
			userId: event.locals.user.id,
			hostingAccountId: data.id,
			hostingProductId:
				data.hostingProductId !== undefined ? data.hostingProductId : account.hostingProductId,
			daPackageId: data.daPackageId !== undefined ? data.daPackageId : account.daPackageId,
			clientId: data.clientId !== undefined ? data.clientId : account.clientId,
			domain: data.domain ?? account.domain,
			daPackageName: null,
			recurringAmount:
				data.recurringAmount !== undefined ? data.recurringAmount : account.recurringAmount,
			currency: data.currency !== undefined ? data.currency : account.currency,
			billingCycle: data.billingCycle !== undefined ? data.billingCycle : account.billingCycle,
			startDate: account.startDate,
			nextDueDate: data.nextDueDate !== undefined ? data.nextDueDate : account.nextDueDate,
			status: account.status
		});
	} catch (e) {
		logWarning('directadmin', 'updateHostingAccount recurring re-sync failed', {
			metadata: { err: e instanceof Error ? e.message : String(e), accountId: data.id }
		});
	}

	return { success: true };
});

// =============================================================================
//  Payment history for the "Plată & Factură" tab (read-only).
// =============================================================================

export type AccountPaymentHistoryRow = {
	id: string;
	invoiceNumber: string;
	status: string;
	totalAmount: number | null;
	currency: string;
	issueDate: string | null;
	paidDate: string | null;
	paymentMethod: string | null;
	stripePaymentIntentId: string | null;
	externalTransactionId: string | null;
};

export const getAccountPaymentHistory = query(IdSchema, async (accountId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const tenantId = event.locals.tenant.id;

	// Confirm account belongs to this tenant. We need every sibling-account for
	// this client so the attribution heuristic can disambiguate when the line
	// item description is generic ("Web Hosting -" without a domain).
	const [account] = await db
		.select({
			id: table.hostingAccount.id,
			clientId: table.hostingAccount.clientId,
			domain: table.hostingAccount.domain
		})
		.from(table.hostingAccount)
		.where(
			and(eq(table.hostingAccount.id, accountId), eq(table.hostingAccount.tenantId, tenantId))
		)
		.limit(1);
	if (!account) throw new Error('Hosting account not found');

	// --- Pass A: invoices with FK directly set to this account ---
	const fkRows = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			status: table.invoice.status,
			totalAmount: table.invoice.totalAmount,
			currency: table.invoice.currency,
			issueDate: sql<string | null>`${table.invoice.issueDate}`,
			paidDate: sql<string | null>`${table.invoice.paidDate}`,
			paymentMethod: table.invoice.paymentMethod,
			stripePaymentIntentId: table.invoice.stripePaymentIntentId,
			externalTransactionId: table.invoice.externalTransactionId
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.hostingAccountId, accountId)
			)
		)
		.orderBy(desc(table.invoice.issueDate))
		.limit(20);

	// --- Pass B: candidates for the same client without FK, with hosting keyword ---
	type RawRow = (typeof fkRows)[number] & {
		clientId: string | null;
		lineDescription: string | null;
	};
	let candidateRows: RawRow[] = [];
	let siblings: AccountForAttribution[] = [];
	if (account.clientId) {
		candidateRows = (await db
			.select({
				id: table.invoice.id,
				invoiceNumber: table.invoice.invoiceNumber,
				status: table.invoice.status,
				totalAmount: table.invoice.totalAmount,
				currency: table.invoice.currency,
				issueDate: sql<string | null>`${table.invoice.issueDate}`,
				paidDate: sql<string | null>`${table.invoice.paidDate}`,
				paymentMethod: table.invoice.paymentMethod,
				stripePaymentIntentId: table.invoice.stripePaymentIntentId,
				externalTransactionId: table.invoice.externalTransactionId,
				clientId: table.invoice.clientId,
				lineDescription: table.invoiceLineItem.description
			})
			.from(table.invoice)
			.innerJoin(
				table.invoiceLineItem,
				eq(table.invoiceLineItem.invoiceId, table.invoice.id)
			)
			.where(
				and(
					eq(table.invoice.tenantId, tenantId),
					eq(table.invoice.clientId, account.clientId),
					isNull(table.invoice.hostingAccountId),
					or(
						sql`LOWER(${table.invoiceLineItem.description}) LIKE '%gazduire%'`,
						sql`LOWER(${table.invoiceLineItem.description}) LIKE '%găzduire%'`,
						sql`LOWER(${table.invoiceLineItem.description}) LIKE '%gasduire%'`,
						sql`LOWER(${table.invoiceLineItem.description}) LIKE '%gaduire%'`,
						sql`LOWER(${table.invoiceLineItem.description}) LIKE '%hosting%'`,
						sql`LOWER(${table.invoiceLineItem.description}) LIKE '%wordpress%'`
					)
				)
			)
			.orderBy(desc(table.invoice.issueDate))) as RawRow[];

		const siblingRows = await db
			.select({
				id: table.hostingAccount.id,
				domain: table.hostingAccount.domain,
				startDate: table.hostingAccount.startDate,
				recurringAmount: table.hostingAccount.recurringAmount,
				billingCycle: table.hostingAccount.billingCycle
			})
			.from(table.hostingAccount)
			.where(
				and(
					eq(table.hostingAccount.tenantId, tenantId),
					eq(table.hostingAccount.clientId, account.clientId)
				)
			);
		siblings = siblingRows;
	}

	// Group candidate rows by invoice id, collecting all line item descriptions.
	type CandidateInv = Omit<RawRow, 'clientId' | 'lineDescription'> & { descriptions: string[] };
	const byId = new Map<string, CandidateInv>();
	const order: string[] = [];
	for (const row of candidateRows) {
		let entry = byId.get(row.id);
		if (!entry) {
			const { clientId: _cid, lineDescription: _ld, ...invFields } = row;
			void _cid;
			void _ld;
			entry = { ...invFields, descriptions: [] };
			byId.set(row.id, entry);
			order.push(row.id);
		}
		if (row.lineDescription) entry.descriptions.push(row.lineDescription);
	}

	// Attribute each candidate; keep only the ones attributed to this account.
	const attributedRows: AccountPaymentHistoryRow[] = [];
	for (const id of order) {
		const inv = byId.get(id);
		if (!inv) continue;
		const attribution = attributeHostingInvoice(
			{ issueDate: inv.issueDate, totalAmount: inv.totalAmount, descriptions: inv.descriptions },
			siblings
		);
		if (attribution?.accountId === accountId) {
			const { descriptions: _d, ...rest } = inv;
			void _d;
			attributedRows.push(rest);
		}
	}

	// Merge FK rows + attributed rows, dedupe by id, sort by issueDate desc.
	const merged = [...fkRows, ...attributedRows];
	const seen = new Set<string>();
	const unique = merged.filter((r) => {
		if (seen.has(r.id)) return false;
		seen.add(r.id);
		return true;
	});
	unique.sort((a, b) => {
		const da = a.issueDate ? new Date(a.issueDate).getTime() : 0;
		const db_ = b.issueDate ? new Date(b.issueDate).getTime() : 0;
		return db_ - da;
	});

	return unique.slice(0, 10) satisfies AccountPaymentHistoryRow[];
});

// =============================================================================
//  Grouped-by-client query (HOST design pack — /[tenant]/hosting/accounts)
// =============================================================================

export type LastInvoiceLite = {
	id: string;
	/** Invoice number string (e.g. "OTS 545", "OTSH 1") — empty when status === 'n/a'. */
	invoiceNumber: string;
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
	/** 'fk' = invoice.hosting_account_id matches; 'domain' = matched via line item description containing the account's domain. */
	matchedVia?: 'fk' | 'domain' | 'fallback';
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
	/**
	 * True when the account is active + billable + assigned to a client but has NO
	 * active recurring-invoice template → it will silently never be auto-billed
	 * (audit M2, 2026-05-30). Detected at read-time; no schema column.
	 */
	billingRisk: boolean;
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
		/** Count of accounts in this group flagged billingRisk (audit M2). */
		billingRiskCount: number;
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

/**
 * Run an `inArray(col, ids)` query in batches of ≤900 ids and concat the rows.
 * libSQL/SQLite caps host parameters at 999 per statement (audit M3, 2026-05-30) —
 * without batching, a tenant with >~999 hosting accounts would crash the grouped
 * query. The caller re-sorts the merged result because per-chunk ordering is not
 * globally consistent.
 */
async function runInIdChunks<T>(
	ids: string[],
	run: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
	const CHUNK = 900;
	const out: T[] = [];
	for (let i = 0; i < ids.length; i += CHUNK) {
		const part = await run(ids.slice(i, i + CHUNK));
		for (const row of part) out.push(row);
	}
	return out;
}

export const getHostingAccountsGrouped = query(FiltersSchema, async (filters) => {
	const event = getRequestEvent();
	// RBAC parity with every other export in this file (audit C1, 2026-05-30):
	// without this, the page's primary data source was callable by any
	// authenticated tenant session regardless of the hosting capability.
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');
	const tenantId = event.locals.tenant.id;

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
			paymentMethod: table.hostingAccount.paymentMethod,
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
				filters?.status
					? eq(table.hostingAccount.status, filters.status)
					: // Forensic-preserve from DA-user-create audit (2026-05-22): on
					  // failed provisioning we keep the hosting_account row as
					  // `status='failed'` so the audit log FK + per-inquiry history
					  // stay intact. Those rows are NOT live accounts though —
					  // exclude them from the default grouped list so they don't
					  // clutter the "Conturi hosting" view. Surfaceable explicitly
					  // via `?status=failed` when staff is investigating.
					  ne(table.hostingAccount.status, 'failed'),
				filters?.clientId ? eq(table.hostingAccount.clientId, filters.clientId) : undefined,
				filters?.serverId ? eq(table.hostingAccount.daServerId, filters.serverId) : undefined
			)
		)
		.limit((filters?.limit ?? 5000) + 1);

	// No silent truncation (audit M3 + review nit): we fetch cap+1 so we can tell
	// GENUINE truncation (more than cap exist) from "exactly cap rows exist" — only
	// the former warns + drops the probe row before aggregation. With a bare LIMIT N
	// you can't distinguish those two cases, so `>=` would false-positive at N==cap.
	const cap = filters?.limit ?? 5000;
	if (rows.length > cap) {
		logWarning(
			'directadmin',
			`getHostingAccountsGrouped hit the ${cap}-row cap; KPI totals may undercount`,
			{ tenantId, metadata: { rows: rows.length } }
		);
		rows.length = cap; // drop the +1 probe row(s) so aggregation matches the cap
	}

	const accountIds = rows.map((r) => r.id);

	// Build per-client account index so we can attribute keyword-only invoices
	// (no `hosting_account_id` FK) to a specific account. Many legacy / pre-FK
	// invoices reference the domain only inside the line item description (e.g.
	// "Wordpress Standard - forumvideochat.ro (...)"), and some are even more
	// generic ("Web Hosting -") so we also need a temporal + amount fallback.
	const accountsByClient = new Map<string, AccountForAttribution[]>();
	for (const r of rows) {
		if (!r.clientId) continue;
		const arr = accountsByClient.get(r.clientId) ?? [];
		arr.push({
			id: r.id,
			domain: r.domain,
			startDate: r.startDate,
			recurringAmount: r.recurringAmount,
			billingCycle: r.billingCycle
		});
		accountsByClient.set(r.clientId, arr);
	}
	const clientIdsWithAccounts = Array.from(accountsByClient.keys());

	const todayISO = new Date().toISOString().slice(0, 10);
	const lastInvoiceByAccount = new Map<string, LastInvoiceLite>();

	function applyCandidate(
		accountId: string,
		inv: {
			id: string;
			invoiceNumber: string;
			status: string;
			dueDate: Date | string | null;
			issueDate: Date | string | null;
			totalAmount: number | null;
		},
		matchedVia: LastInvoiceLite['matchedVia']
	): void {
		if (lastInvoiceByAccount.has(accountId)) return; // earlier insertion wins (we sort by date desc)
		const dateISO = inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : null;
		const dueISO = inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : null;
		let mapped: LastInvoiceLite['status'] = inv.status as LastInvoiceLite['status'];
		if (inv.status !== 'paid' && inv.status !== 'cancelled' && dueISO && dueISO < todayISO) {
			mapped = 'overdue';
		}
		const daysOverdue =
			mapped === 'overdue' && dueISO ? Math.max(0, daysDiff(dueISO, todayISO) ?? 0) : undefined;
		lastInvoiceByAccount.set(accountId, {
			id: inv.id,
			invoiceNumber: inv.invoiceNumber,
			status: mapped,
			date: dateISO,
			amountCents: Number(inv.totalAmount ?? 0),
			daysOverdue,
			matchedVia
		});
	}

	// === Pass A: invoices with the hosting_account_id FK directly set. ===
	const fkInvoices = accountIds.length
		? await runInIdChunks(accountIds, (chunk) =>
				db
					.select({
						id: table.invoice.id,
						invoiceNumber: table.invoice.invoiceNumber,
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
							inArray(table.invoice.hostingAccountId, chunk)
						)
					)
			)
		: [];
	// Global issueDate-desc sort across chunks so applyCandidate's "first wins"
	// picks the genuinely most-recent invoice per account.
	fkInvoices.sort(
		(a, b) =>
			(b.issueDate ? new Date(b.issueDate).getTime() : 0) -
			(a.issueDate ? new Date(a.issueDate).getTime() : 0)
	);

	for (const inv of fkInvoices) {
		if (!inv.hostingAccountId) continue;
		applyCandidate(inv.hostingAccountId, inv, 'fk');
	}

	// === Pass B: invoices for the clients of these accounts, without FK, but
	// whose line items mention "gazduire"/"hosting"/"wordpress" (the same
	// classifier used by `scripts/backfill-hosting-ltv-and-since.ts`). The JS
	// pass then attributes each candidate to a specific account by matching the
	// account's domain inside any of its line item descriptions. If we still
	// can't disambiguate and the client has exactly one hosting account, we
	// fall back to that single account. ===
	const candidateRows = clientIdsWithAccounts.length
		? await runInIdChunks(clientIdsWithAccounts, (chunk) =>
				db
					.select({
						id: table.invoice.id,
						invoiceNumber: table.invoice.invoiceNumber,
						clientId: table.invoice.clientId,
						status: table.invoice.status,
						dueDate: table.invoice.dueDate,
						issueDate: table.invoice.issueDate,
						totalAmount: table.invoice.totalAmount,
						lineDescription: table.invoiceLineItem.description
					})
					.from(table.invoice)
					.innerJoin(
						table.invoiceLineItem,
						eq(table.invoiceLineItem.invoiceId, table.invoice.id)
					)
					.where(
						and(
							eq(table.invoice.tenantId, tenantId),
							inArray(table.invoice.clientId, chunk),
							isNull(table.invoice.hostingAccountId),
							or(
								sql`LOWER(${table.invoiceLineItem.description}) LIKE '%gazduire%'`,
								sql`LOWER(${table.invoiceLineItem.description}) LIKE '%găzduire%'`,
								sql`LOWER(${table.invoiceLineItem.description}) LIKE '%gasduire%'`,
								sql`LOWER(${table.invoiceLineItem.description}) LIKE '%gaduire%'`,
								sql`LOWER(${table.invoiceLineItem.description}) LIKE '%hosting%'`,
								sql`LOWER(${table.invoiceLineItem.description}) LIKE '%wordpress%'`
							)
						)
					)
			)
		: [];
	// Global issueDate-desc sort across chunks (candidateOrder relies on it).
	candidateRows.sort(
		(a, b) =>
			(b.issueDate ? new Date(b.issueDate).getTime() : 0) -
			(a.issueDate ? new Date(a.issueDate).getTime() : 0)
	);

	// Group candidate rows by invoice id (an invoice can have multiple line items
	// that all matched the keyword filter).
	type CandidateInvoice = {
		id: string;
		invoiceNumber: string;
		clientId: string;
		status: string;
		dueDate: Date | string | null;
		issueDate: Date | string | null;
		totalAmount: number | null;
		descriptions: string[];
	};
	const candidatesById = new Map<string, CandidateInvoice>();
	const candidateOrder: string[] = []; // preserve insertion order = issueDate desc
	for (const row of candidateRows) {
		if (!row.clientId) continue;
		let entry = candidatesById.get(row.id);
		if (!entry) {
			entry = {
				id: row.id,
				invoiceNumber: row.invoiceNumber,
				clientId: row.clientId,
				status: row.status,
				dueDate: row.dueDate,
				issueDate: row.issueDate,
				totalAmount: row.totalAmount,
				descriptions: []
			};
			candidatesById.set(row.id, entry);
			candidateOrder.push(row.id);
		}
		if (row.lineDescription) entry.descriptions.push(row.lineDescription);
	}

	for (const invoiceId of candidateOrder) {
		const inv = candidatesById.get(invoiceId);
		if (!inv) continue;
		const candidates = accountsByClient.get(inv.clientId);
		if (!candidates) continue;
		const attribution = attributeHostingInvoice(
			{ issueDate: inv.issueDate, totalAmount: inv.totalAmount, descriptions: inv.descriptions },
			candidates
		);
		if (attribution) applyCandidate(attribution.accountId, inv, attribution.matchedVia);
	}

	// === M2 (audit, read-time, no schema change): billing-risk detection. ===
	// An account that is active + billable (amount>0, recurring cycle) + assigned to
	// a client but has NO active recurring-invoice template will silently never be
	// auto-billed — a cash-flow leak. Build the set of accountIds that DO have an
	// active recurring_invoice row; anything billable missing from it is at risk.
	const accountsWithActiveTemplate = new Set<string>();
	if (accountIds.length) {
		const templateRows = await runInIdChunks(accountIds, (chunk) =>
			db
				.select({ hostingAccountId: table.recurringInvoice.hostingAccountId })
				.from(table.recurringInvoice)
				.where(
					and(
						eq(table.recurringInvoice.tenantId, tenantId),
						eq(table.recurringInvoice.isActive, true),
						// Only count templates that would ACTUALLY bill (review M2 false-negative):
						// a stale `amount=0` template is a no-op at renewal, so it must NOT
						// suppress the billing-risk flag. (one_time never produces a template —
						// the upsert skips it — so amount>0 is the meaningful guard here.)
						gt(table.recurringInvoice.amount, 0),
						inArray(table.recurringInvoice.hostingAccountId, chunk)
					)
				)
		);
		for (const t of templateRows) {
			if (t.hostingAccountId) accountsWithActiveTemplate.add(t.hostingAccountId);
		}
	}

	function isBillingAtRisk(r: {
		id: string;
		status: string;
		clientId: string | null;
		recurringAmount: number;
		billingCycle: string;
	}): boolean {
		return (
			r.status === 'active' &&
			!!r.clientId &&
			r.recurringAmount > 0 &&
			r.billingCycle !== 'one_time' &&
			!accountsWithActiveTemplate.has(r.id)
		);
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
					billingRiskCount: 0,
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
				invoiceNumber: '',
				status: 'n/a',
				date: null,
				amountCents: 0
			};

		// Filter out the primary domain in case sync stored it inside additional_domains too.
		const filteredAddons = (r.additionalDomains ?? []).filter(
			(d) => d && d.toLowerCase() !== r.domain.toLowerCase()
		);

		const acc: AccountInGroup = {
			id: r.id,
			daUsername: r.daUsername,
			domain: r.domain,
			additionalDomains: filteredAddons.length > 0 ? filteredAddons : null,
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
			lastInvoice: lastInv,
			billingRisk: isBillingAtRisk(r)
		};
		g.accounts.push(acc);
		g.totals.count++;
		g.totals.addonCount += filteredAddons.length;
		g.totals.byStatus[r.status] = (g.totals.byStatus[r.status] ?? 0) + 1;
		if (r.status === 'active' || r.status === 'pending') {
			g.totals.mrrCents += toMonthlyCentsGrouped(r.recurringAmount, r.billingCycle);
		}
		if (acc.billingRisk) g.totals.billingRiskCount++;
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
