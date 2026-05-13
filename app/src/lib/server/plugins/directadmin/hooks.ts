import type { HookHandler, InvoiceStatusChangedEvent, InvoicePaidEvent } from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getPluginRegistry } from '../registry';
import { createDAClient } from './factory';
import { runWithAudit, withAccountLock } from './audit';
import { DBSyncFailedError } from './errors';
import { logInfo, logError, serializeError } from '$lib/server/logger';

const PLUGIN_NAME = 'directadmin';

async function isPluginActive(tenantId: string): Promise<boolean> {
	try {
		const registry = getPluginRegistry();
		return await registry.isPluginActiveForTenant(tenantId, PLUGIN_NAME);
	} catch {
		return false;
	}
}

interface AccountWithServer {
	id: string;
	tenantId: string;
	daUsername: string;
	daServerId: string;
	status: string;
	suspendReason: string | null;
	autoSuspendedByInvoiceId: string | null;
	server: {
		hostname: string;
		port: number | null;
		usernameEncrypted: string;
		passwordEncrypted: string;
	} | null;
}

/**
 * Load a single hosting account by id (within tenant).
 * Used for the granular path when `invoice.hostingAccountId` is set.
 *
 * Note: the previous client-wide fallback (`loadActiveHostingAccountsForClient`)
 * was removed in H5 — invoices without an explicit `hostingAccountId` no longer
 * trigger DA actions, to prevent non-hosting invoices (marketing, SEO) from
 * suspending unrelated hosting accounts.
 */
async function loadHostingAccountById(
	tenantId: string,
	hostingAccountId: string,
	requiredStatus: 'active' | 'suspended'
): Promise<AccountWithServer[]> {
	const rows = await db
		.select({
			id: table.hostingAccount.id,
			tenantId: table.hostingAccount.tenantId,
			daUsername: table.hostingAccount.daUsername,
			daServerId: table.hostingAccount.daServerId,
			status: table.hostingAccount.status,
			suspendReason: table.hostingAccount.suspendReason,
			autoSuspendedByInvoiceId: table.hostingAccount.autoSuspendedByInvoiceId,
			serverHostname: table.daServer.hostname,
			serverPort: table.daServer.port,
			serverUsernameEncrypted: table.daServer.usernameEncrypted,
			serverPasswordEncrypted: table.daServer.passwordEncrypted
		})
		.from(table.hostingAccount)
		.leftJoin(table.daServer, eq(table.hostingAccount.daServerId, table.daServer.id))
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.id, hostingAccountId),
				eq(table.hostingAccount.status, requiredStatus)
			)
		);
	return rows.map((r) => ({
		id: r.id,
		tenantId: r.tenantId,
		daUsername: r.daUsername,
		daServerId: r.daServerId,
		status: r.status,
		suspendReason: r.suspendReason,
		autoSuspendedByInvoiceId: r.autoSuspendedByInvoiceId,
		server: r.serverHostname
			? {
					hostname: r.serverHostname,
					port: r.serverPort,
					usernameEncrypted: r.serverUsernameEncrypted!,
					passwordEncrypted: r.serverPasswordEncrypted!
				}
			: null
	}));
}

/**
 * Suspend the hosting account linked to an invoice when that invoice goes overdue.
 *
 * Requires `invoice.hostingAccountId` to be set (the recurring scheduler sets it
 * when generating hosting invoices). Invoices without this link are ignored —
 * the previous client-wide fallback was removed in H5 to prevent unrelated
 * invoices (marketing, SEO, contract work) from suspending hosting accounts.
 *
 * Idempotent: re-emitting the hook on an already-suspended account is a no-op
 * (the WHERE filter requires status='active').
 */
export const onInvoiceStatusChanged: HookHandler<InvoiceStatusChangedEvent> = async (event) => {
	if (event.newStatus !== 'overdue') return;

	const tenantId = event.tenantId;
	const clientId = event.invoice.clientId;
	const invoiceId = event.invoice.id;
	const invoiceNumber = event.invoice.invoiceNumber ?? invoiceId;
	const linkedHostingAccountId: string | null = event.invoice.hostingAccountId ?? null;

	if (!(await isPluginActive(tenantId))) return;

	// SAFETY: if invoice is NOT linked to a hosting account, take NO action.
	// Previously this fell back to suspending ALL active client hosting accounts,
	// which is dangerous: a marketing/SEO invoice going overdue would suspend
	// unrelated hosting. Recurring scheduler must explicitly set hostingAccountId
	// when generating hosting invoices; if missing, the link is broken and we
	// require manual intervention rather than silent over-suspension.
	if (!linkedHostingAccountId) {
		logInfo(
			'directadmin',
			`invoice overdue but no hostingAccountId link — skipping DA action`,
			{ tenantId, metadata: { invoiceId, invoiceNumber, clientId } }
		);
		return;
	}

	let accounts: AccountWithServer[];
	try {
		accounts = await loadHostingAccountById(tenantId, linkedHostingAccountId, 'active');
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('directadmin', `failed to load accounts for overdue invoice: ${message}`, {
			tenantId,
			stackTrace: stack
		});
		return;
	}

	if (accounts.length === 0) return;

	logInfo(
		'directadmin',
		`suspending ${accounts.length} account(s) for overdue invoice`,
		{ tenantId, metadata: { invoiceId, invoiceNumber, clientId, linkedHostingAccountId } }
	);

	const suspendReason = `Overdue invoice ${invoiceNumber}`;

	await Promise.all(
		accounts.map((account) =>
			withAccountLock(`${account.tenantId}:${account.daUsername}`, async () => {
				try {
					if (!account.server) {
						logError('directadmin', `cannot suspend ${account.daUsername}: server row missing`, {
							tenantId,
							metadata: { accountId: account.id }
						});
						return;
					}

					await runWithAudit(
						{
							tenantId,
							hostingAccountId: account.id,
							daServerId: account.daServerId,
							invoiceId,
							action: 'suspend',
							trigger: 'hook:invoice.status.changed'
						},
						async () => {
							const daClient = createDAClient(tenantId, account.server!);
							// Step 1: external DA call (no rollback possible after this point)
							await daClient.suspendUser(account.daUsername);
							// Step 2: DB write — if this fails, DA state has already changed.
							// Wrap in try/catch to throw DBSyncFailedError so the audit log
							// captures the divergence with daActionApplied marker.
							try {
								await db
									.update(table.hostingAccount)
									.set({
										status: 'suspended',
										suspendReason,
										autoSuspendedByInvoiceId: invoiceId,
										updatedAt: new Date()
									})
									.where(eq(table.hostingAccount.id, account.id));
							} catch (dbErr) {
								throw new DBSyncFailedError(
									`DA suspended ${account.daUsername} but DB update failed`,
									'suspend',
									account.daUsername,
									dbErr
								);
							}
						}
					);
				} catch (e) {
					// runWithAudit already logged + persisted the failure; swallow to keep other accounts processing
					const { message } = serializeError(e);
					if (e instanceof DBSyncFailedError) {
						logError(
							'directadmin',
							`RECONCILIATION REQUIRED: ${message} (cause: ${serializeError(e.cause).message})`,
							{
								tenantId,
								metadata: {
									accountId: account.id,
									daUsername: e.daUsername,
									daActionApplied: e.daActionApplied
								}
							}
						);
					} else {
						logError('directadmin', `suspend continued past error: ${message}`, {
							tenantId,
							metadata: { accountId: account.id }
						});
					}
				}
			})
		)
	);
};

/**
 * Unsuspend hosting accounts when an invoice is paid — but only if NO OTHER overdue
 * invoices remain for the same client. Critical guard to prevent prematurely
 * reactivating accounts when multiple invoices are overdue.
 */
export const onInvoicePaid: HookHandler<InvoicePaidEvent> = async (event) => {
	const tenantId = event.tenantId;
	const clientId = event.invoice.clientId;
	const invoiceId = event.invoice.id;
	const linkedHostingAccountId: string | null = event.invoice.hostingAccountId ?? null;

	if (!(await isPluginActive(tenantId))) return;

	// SAFETY: only act on invoices explicitly linked to a hosting account.
	// Without a link, we cannot know which account to unsuspend — skip rather
	// than guess (parallel to the symmetric guard in onInvoiceStatusChanged).
	if (!linkedHostingAccountId) {
		logInfo(
			'directadmin',
			`invoice paid but no hostingAccountId link — skipping DA action`,
			{ tenantId, metadata: { invoiceId, clientId } }
		);
		return;
	}

	// CRITICAL: check if any OTHER overdue invoice remains for THIS hosting account.
	// Only this scope matters — unrelated overdue invoices on other accounts (or
	// non-hosting services) don't block reactivation of this one.
	const otherOverdueCountRows = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.hostingAccountId, linkedHostingAccountId),
				eq(table.invoice.status, 'overdue'),
				ne(table.invoice.id, invoiceId)
			)
		);
	const otherOverdueCount = Number(otherOverdueCountRows[0]?.count ?? 0);
	if (otherOverdueCount > 0) {
		logInfo(
			'directadmin',
			`skip unsuspend: ${otherOverdueCount} other overdue invoice(s) remain for account`,
			{ tenantId, metadata: { invoiceId, clientId, linkedHostingAccountId, otherOverdueCount } }
		);
		return;
	}

	let accounts: AccountWithServer[];
	try {
		accounts = await loadHostingAccountById(tenantId, linkedHostingAccountId, 'suspended');
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('directadmin', `failed to load suspended accounts for paid invoice: ${message}`, {
			tenantId,
			stackTrace: stack
		});
		return;
	}

	// Only unsuspend accounts that THIS plugin auto-suspended (FK marker).
	// Replaces the fragile suspendReason string match — staff-edited reasons
	// or non-English text would silently break the previous prefix check.
	const autoSuspended = accounts.filter((a) => a.autoSuspendedByInvoiceId !== null);
	if (autoSuspended.length === 0) return;

	logInfo('directadmin', `unsuspending ${autoSuspended.length} auto-suspended account(s)`, {
		tenantId,
		metadata: { invoiceId, clientId }
	});

	await Promise.all(
		autoSuspended.map((account) =>
			withAccountLock(`${account.tenantId}:${account.daUsername}`, async () => {
				try {
					if (!account.server) {
						logError('directadmin', `cannot unsuspend ${account.daUsername}: server row missing`, {
							tenantId,
							metadata: { accountId: account.id }
						});
						return;
					}

					await runWithAudit(
						{
							tenantId,
							hostingAccountId: account.id,
							daServerId: account.daServerId,
							invoiceId,
							action: 'unsuspend',
							trigger: 'hook:invoice.paid'
						},
						async () => {
							const daClient = createDAClient(tenantId, account.server!);
							// Step 1: external DA call (no rollback possible after this point)
							await daClient.unsuspendUser(account.daUsername);
							// Step 2: DB write — if this fails, DA state has already changed.
							try {
								await db
									.update(table.hostingAccount)
									.set({
										status: 'active',
										suspendReason: null,
										autoSuspendedByInvoiceId: null,
										updatedAt: new Date()
									})
									.where(eq(table.hostingAccount.id, account.id));
							} catch (dbErr) {
								throw new DBSyncFailedError(
									`DA unsuspended ${account.daUsername} but DB update failed`,
									'unsuspend',
									account.daUsername,
									dbErr
								);
							}
						}
					);
				} catch (e) {
					const { message } = serializeError(e);
					if (e instanceof DBSyncFailedError) {
						logError(
							'directadmin',
							`RECONCILIATION REQUIRED: ${message} (cause: ${serializeError(e.cause).message})`,
							{
								tenantId,
								metadata: {
									accountId: account.id,
									daUsername: e.daUsername,
									daActionApplied: e.daActionApplied
								}
							}
						);
					} else {
						logError('directadmin', `unsuspend continued past error: ${message}`, {
							tenantId,
							metadata: { accountId: account.id }
						});
					}
				}
			})
		)
	);
};
