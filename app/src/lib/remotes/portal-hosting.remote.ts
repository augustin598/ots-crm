import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';

/**
 * Portal hosting remotes — read-only views for client portal users.
 *
 * Critical guarantees:
 *  - Every query filters BOTH `tenantId` AND `clientId === event.locals.clientUser.clientId`.
 *    Without this, a tampered accountId could expose another customer's account.
 *  - Response shape EXCLUDES sensitive fields: daUsername, daServerId,
 *    daCredentialsEncrypted, server hostname/port. Clients only see their own
 *    business-relevant data (domain, status, package, usage).
 *  - Capability gate `portal.hosting.view` mirrors the sidebar / route check.
 */

function requireClientUser() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.isClientUser || !event?.locals.clientUser || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	return {
		event,
		tenantId: event.locals.tenant.id,
		clientId: event.locals.clientUser.clientId
	};
}

export const getMyHostingAccounts = query(async () => {
	const { event, tenantId, clientId } = requireClientUser();
	const actor = await getActor(event);
	assertCan(actor, 'portal.hosting.view');

	const rows = await db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			status: table.hostingAccount.status,
			daPackageName: table.hostingAccount.daPackageName,
			diskUsage: table.hostingAccount.diskUsage,
			bandwidthUsage: table.hostingAccount.bandwidthUsage,
			emailCount: table.hostingAccount.emailCount,
			dbCount: table.hostingAccount.dbCount,
			startDate: table.hostingAccount.startDate,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			billingCycle: table.hostingAccount.billingCycle,
			lastSyncedAt: table.hostingAccount.lastSyncedAt,
			createdAt: table.hostingAccount.createdAt
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.clientId, clientId)
			)
		)
		.orderBy(desc(table.hostingAccount.createdAt));

	return rows;
});

export const getMyHostingAccount = query(v.pipe(v.string(), v.minLength(1)), async (accountId) => {
	const { event, tenantId, clientId } = requireClientUser();
	const actor = await getActor(event);
	assertCan(actor, 'portal.hosting.view');

	const [row] = await db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			status: table.hostingAccount.status,
			suspendReason: table.hostingAccount.suspendReason,
			daPackageName: table.hostingAccount.daPackageName,
			additionalDomains: table.hostingAccount.additionalDomains,
			diskUsage: table.hostingAccount.diskUsage,
			bandwidthUsage: table.hostingAccount.bandwidthUsage,
			emailCount: table.hostingAccount.emailCount,
			dbCount: table.hostingAccount.dbCount,
			inodeCount: table.hostingAccount.inodeCount,
			startDate: table.hostingAccount.startDate,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			billingCycle: table.hostingAccount.billingCycle,
			lastSyncedAt: table.hostingAccount.lastSyncedAt,
			createdAt: table.hostingAccount.createdAt
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.id, accountId),
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.clientId, clientId)
			)
		)
		.limit(1);

	if (!row) throw new Error('Hosting account not found');
	return row;
});

export const getAvailableHostingPackages = query(async () => {
	const { event, tenantId } = requireClientUser();
	const actor = await getActor(event);
	assertCan(actor, 'portal.hosting.view');

	// Read tenant's VAT rate from invoice_settings (set per-tenant, e.g. 21% in RO 2025+).
	// Never hardcode — the rate may change by law and per tenant.
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatRate = settings?.defaultTaxRate ?? 19; // fallback dacă tenantul n-are settings

	const rows = await db
		.select({
			id: table.hostingProduct.id,
			name: table.hostingProduct.name,
			description: table.hostingProduct.description,
			features: table.hostingProduct.features,
			highlightBadge: table.hostingProduct.highlightBadge,
			price: table.hostingProduct.price,
			currency: table.hostingProduct.currency,
			billingCycle: table.hostingProduct.billingCycle,
			setupFee: table.hostingProduct.setupFee,
			// Resource limits from linked daPackage (single source of truth).
			// Null when product isn't linked to a DA package.
			bandwidth: table.daPackage.bandwidth,
			quota: table.daPackage.quota,
			maxEmailAccounts: table.daPackage.maxEmailAccounts,
			maxEmailForwarders: table.daPackage.maxEmailForwarders,
			maxMailingLists: table.daPackage.maxMailingLists,
			maxAutoresponders: table.daPackage.maxAutoresponders,
			maxDatabases: table.daPackage.maxDatabases,
			maxFtpAccounts: table.daPackage.maxFtpAccounts,
			maxDomains: table.daPackage.maxDomains,
			maxSubdomains: table.daPackage.maxSubdomains,
			maxDomainPointers: table.daPackage.maxDomainPointers,
			maxInodes: table.daPackage.maxInodes,
			// Boolean access flags
			cgi: table.daPackage.cgi,
			php: table.daPackage.php,
			ssl: table.daPackage.ssl,
			ssh: table.daPackage.ssh,
			cron: table.daPackage.cron,
			dnsControl: table.daPackage.dnsControl,
			spam: table.daPackage.spam,
			clamav: table.daPackage.clamav,
			wordpress: table.daPackage.wordpress,
			git: table.daPackage.git,
			redis: table.daPackage.redis
		})
		.from(table.hostingProduct)
		.leftJoin(table.daPackage, eq(table.hostingProduct.daPackageId, table.daPackage.id))
		.where(
			and(
				eq(table.hostingProduct.tenantId, tenantId),
				eq(table.hostingProduct.isActive, true)
			)
		)
		.orderBy(table.hostingProduct.sortOrder, table.hostingProduct.price);

	return { packages: rows, vatRate };
});
