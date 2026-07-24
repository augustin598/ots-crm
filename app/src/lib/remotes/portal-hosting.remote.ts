import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { resolveVatPercent } from '$lib/server/vat/rate';
import {
	getStripeForTenant,
	getPublishableKeyForTenant,
	isStripeConfiguredForTenant
} from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { logInfo, logError, serializeError } from '$lib/server/logger';

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
	const vatRate = resolveVatPercent(settings?.defaultTaxRate);

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

/**
 * Portal: summary of the open (payable) invoice for one of the client's hosting
 * accounts — powers the `/hosting/accounts/[id]/renew` page. Read-only; does NOT
 * touch Stripe. Ownership enforced tenant + client scoped.
 *
 * Returns a discriminated shape:
 *   { status: 'payable', invoiceId, total, ... }  — there is an unpaid invoice
 *   { status: 'none', domain, nextDueDate }        — nothing to pay right now
 */
export const getMyRenewInvoice = query(v.pipe(v.string(), v.minLength(1)), async (accountId) => {
	const { event, tenantId, clientId } = requireClientUser();
	const actor = await getActor(event);
	assertCan(actor, 'portal.hosting.view');

	const [acc] = await db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			nextDueDate: table.hostingAccount.nextDueDate,
			status: table.hostingAccount.status
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
	if (!acc) throw new Error('Hosting account not found');

	const [inv] = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			amount: table.invoice.amount,
			taxAmount: table.invoice.taxAmount,
			totalAmount: table.invoice.totalAmount,
			currency: table.invoice.currency,
			dueDate: table.invoice.dueDate
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.hostingAccountId, accountId),
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.clientId, clientId),
				inArray(table.invoice.status, ['draft', 'sent', 'overdue'])
			)
		)
		.orderBy(desc(table.invoice.issueDate))
		.limit(1);

	if (!inv) {
		return {
			status: 'none' as const,
			domain: acc.domain,
			accountStatus: acc.status,
			nextDueDate: acc.nextDueDate
		};
	}

	return {
		status: 'payable' as const,
		domain: acc.domain,
		accountStatus: acc.status,
		nextDueDate: acc.nextDueDate,
		invoiceId: inv.id,
		invoiceLabel: `${inv.invoiceSeries ?? ''}${inv.invoiceNumber}`.trim(),
		net: inv.amount ?? 0,
		vat: inv.taxAmount ?? 0,
		total: inv.totalAmount ?? 0,
		currency: inv.currency,
		dueDate: inv.dueDate
	};
});

/**
 * Portal: create a Stripe PaymentIntent so the logged-in client can pay the open
 * invoice for one of THEIR hosting accounts by card (embedded PaymentElement).
 *
 * The invoice already exists (renewal/overdue) WITH its Keez fiscal invoice — the
 * webhook branch (metadata.crmPurpose='invoice_payment') only marks it paid; it
 * does NOT re-emit Keez or provision DirectAdmin. Ownership is enforced
 * tenant + client scoped, so a tampered accountId can't reach another customer.
 */
export const createInvoicePaymentIntent = command(
	v.pipe(v.string(), v.minLength(1)),
	async (accountId) => {
		const { event, tenantId, clientId } = requireClientUser();
		const actor = await getActor(event);
		assertCan(actor, 'portal.hosting.view');

		if (!(await isStripeConfiguredForTenant(tenantId))) {
			throw new Error('Plata cu cardul nu este disponibilă momentan.');
		}

		const [acc] = await db
			.select({ id: table.hostingAccount.id, domain: table.hostingAccount.domain })
			.from(table.hostingAccount)
			.where(
				and(
					eq(table.hostingAccount.id, accountId),
					eq(table.hostingAccount.tenantId, tenantId),
					eq(table.hostingAccount.clientId, clientId)
				)
			)
			.limit(1);
		if (!acc) throw new Error('Hosting account not found');

		const [inv] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.hostingAccountId, accountId),
					eq(table.invoice.tenantId, tenantId),
					eq(table.invoice.clientId, clientId),
					inArray(table.invoice.status, ['draft', 'sent', 'overdue'])
				)
			)
			.orderBy(desc(table.invoice.issueDate))
			.limit(1);
		if (!inv) return { alreadyPaid: true as const };

		const totalCents = inv.totalAmount;
		if (!totalCents || totalCents <= 0) throw new Error('Factura nu are un total valid de plată.');

		const [clientRow] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!clientRow?.email) throw new Error('Contul tău nu are un email asociat.');

		try {
			const stripe = await getStripeForTenant(tenantId);
			const publishableKey = await getPublishableKeyForTenant(tenantId);
			if (!publishableKey) throw new Error('Configurare Stripe incompletă.');
			const customerId = await getOrCreateStripeCustomer(clientRow);

			const invoiceLabel = `${inv.invoiceSeries ?? ''}${inv.invoiceNumber}`.trim();
			// `totalAmount` is already gross (net + TVA) → charge it directly. One-time
			// PaymentIntents can't carry a Stripe Tax Rate, and the Keez fiscal invoice
			// already exists, so the amount == the invoice total the customer was billed.
			const intent = await stripe.paymentIntents.create({
				amount: totalCents,
				currency: (inv.currency ?? 'RON').toLowerCase(),
				customer: customerId,
				automatic_payment_methods: { enabled: true },
				metadata: {
					crmPurpose: 'invoice_payment',
					crmTenantId: tenantId,
					crmInvoiceId: inv.id
				},
				description: `Hosting ${acc.domain} — factura ${invoiceLabel}`
			});

			await db
				.update(table.invoice)
				.set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
				.where(and(eq(table.invoice.id, inv.id), eq(table.invoice.tenantId, tenantId)));

			if (!intent.client_secret) throw new Error('Stripe nu a returnat clientSecret.');

			logInfo('directadmin', `portal PaymentIntent creat pentru factura ${invoiceLabel}`, {
				tenantId,
				metadata: { invoiceId: inv.id, accountId, paymentIntentId: intent.id, clientId }
			});

			return {
				alreadyPaid: false as const,
				clientSecret: intent.client_secret,
				publishableKey,
				total: totalCents,
				currency: inv.currency ?? 'RON',
				invoiceLabel
			};
		} catch (err) {
			const { message } = serializeError(err);
			logError('directadmin', `portal PaymentIntent failed for account ${accountId}: ${message}`, {
				tenantId,
				metadata: { accountId, clientId }
			});
			throw new Error(message);
		}
	}
);
