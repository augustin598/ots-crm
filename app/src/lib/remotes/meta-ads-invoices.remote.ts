import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getMetaAdsConnections } from '$lib/server/meta-ads/auth';

// ---- Queries ----

export const getMetaAdsConnectionStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	return getMetaAdsConnections(event.locals.tenant.id);
});

export const getMetaAdsInvoices = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	let conditions: any = eq(table.metaAdsInvoice.tenantId, event.locals.tenant.id);

	// If user is a client user, filter by their client ID
	if (event.locals.isClientUser && event.locals.client) {
		if (!event.locals.isClientUserPrimary) return [];
		conditions = and(conditions, eq(table.metaAdsInvoice.clientId, event.locals.client.id));
	}

	const invoices = await db
		.select({
			id: table.metaAdsInvoice.id,
			tenantId: table.metaAdsInvoice.tenantId,
			integrationId: table.metaAdsInvoice.integrationId,
			clientId: table.metaAdsInvoice.clientId,
			metaAdAccountId: table.metaAdsInvoice.metaAdAccountId,
			metaInvoiceId: table.metaAdsInvoice.metaInvoiceId,
			invoiceNumber: table.metaAdsInvoice.invoiceNumber,
			issueDate: table.metaAdsInvoice.issueDate,
			dueDate: table.metaAdsInvoice.dueDate,
			amountCents: table.metaAdsInvoice.amountCents,
			currencyCode: table.metaAdsInvoice.currencyCode,
			invoiceType: table.metaAdsInvoice.invoiceType,
			paymentStatus: table.metaAdsInvoice.paymentStatus,
			pdfPath: table.metaAdsInvoice.pdfPath,
			status: table.metaAdsInvoice.status,
			syncedAt: table.metaAdsInvoice.syncedAt,
			createdAt: table.metaAdsInvoice.createdAt,
			clientName: table.client.name,
			businessName: table.metaAdsIntegration.businessName
		})
		.from(table.metaAdsInvoice)
		.leftJoin(table.client, eq(table.metaAdsInvoice.clientId, table.client.id))
		.leftJoin(table.metaAdsIntegration, eq(table.metaAdsInvoice.integrationId, table.metaAdsIntegration.id))
		.where(conditions)
		.orderBy(desc(table.metaAdsInvoice.issueDate))
		.limit(500);

	return invoices;
});

/** Get Meta Ads ad accounts for a specific integration */
export const getMetaAdsAccounts = query(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const accounts = await db
			.select({
				id: table.metaAdsAccount.id,
				metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
				accountName: table.metaAdsAccount.accountName,
				clientId: table.metaAdsAccount.clientId,
				clientName: table.client.name,
				isActive: table.metaAdsAccount.isActive,
				lastFetchedAt: table.metaAdsAccount.lastFetchedAt
			})
			.from(table.metaAdsAccount)
			.leftJoin(table.client, eq(table.metaAdsAccount.clientId, table.client.id))
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.metaAdsAccount.integrationId, integrationId)
				)
			)
			.orderBy(table.metaAdsAccount.accountName);

		return accounts;
	}
);

/** Get all CRM clients (for mapping dropdown) */
export const getClientsForMetaMapping = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const clients = await db
		.select({
			id: table.client.id,
			name: table.client.name
		})
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant.id))
		.orderBy(table.client.name);

	return clients;
});

// ---- Commands ----

/** Add a new Meta Ads Business Manager connection (creates placeholder, OAuth completes it) */
export const addMetaAdsConnection = command(
	v.object({
		businessId: v.pipe(v.string(), v.minLength(1)),
		businessName: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		const cleanBusinessId = data.businessId.trim();

		// Check if integration already exists for this BM
		const [existing] = await db
			.select({ id: table.metaAdsIntegration.id })
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.tenantId, tenantId),
					eq(table.metaAdsIntegration.businessId, cleanBusinessId)
				)
			)
			.limit(1);

		if (existing) {
			// Update existing
			await db
				.update(table.metaAdsIntegration)
				.set({
					businessName: data.businessName.trim(),
					updatedAt: new Date()
				})
				.where(eq(table.metaAdsIntegration.id, existing.id));
			return { id: existing.id, created: false };
		}

		// Create new placeholder integration
		const id = crypto.randomUUID();
		await db.insert(table.metaAdsIntegration).values({
			id,
			tenantId,
			businessId: cleanBusinessId,
			businessName: data.businessName.trim(),
			email: '',
			accessToken: '',
			isActive: false,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		return { id, created: true };
	}
);

/** Remove a Meta Ads connection and all its accounts */
export const removeMetaAdsConnection = command(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// Verify belongs to tenant
		const [integration] = await db
			.select({ id: table.metaAdsIntegration.id })
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.id, integrationId),
					eq(table.metaAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Integrare Meta Ads negăsită');
		}

		// Disconnect first (revoke token)
		const { disconnectMetaAds } = await import('$lib/server/meta-ads/auth');
		await disconnectMetaAds(integrationId);

		// Delete integration (cascade deletes accounts)
		await db
			.delete(table.metaAdsIntegration)
			.where(eq(table.metaAdsIntegration.id, integrationId));

		return { success: true };
	}
);

/** Fetch ad accounts from Business Manager via Meta API and cache them in DB */
export const fetchMetaAdsAccounts = command(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// Verify integration belongs to tenant and is active
		const [integration] = await db
			.select()
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.id, integrationId),
					eq(table.metaAdsIntegration.tenantId, tenantId),
					eq(table.metaAdsIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Meta Ads nu este conectat');
		}

		const { getAuthenticatedToken } = await import('$lib/server/meta-ads/auth');
		const authResult = await getAuthenticatedToken(integrationId);
		if (!authResult) {
			throw new Error('Nu s-a putut obține token-ul Meta Ads');
		}

		const { listBusinessAdAccounts } = await import('$lib/server/meta-ads/client');
		const adAccounts = await listBusinessAdAccounts(integration.businessId, authResult.accessToken);

		const now = new Date();

		for (const account of adAccounts) {
			// Upsert: update if exists, insert if not
			const [existing] = await db
				.select({ id: table.metaAdsAccount.id })
				.from(table.metaAdsAccount)
				.where(
					and(
						eq(table.metaAdsAccount.tenantId, tenantId),
						eq(table.metaAdsAccount.metaAdAccountId, account.adAccountId)
					)
				)
				.limit(1);

			if (existing) {
				await db
					.update(table.metaAdsAccount)
					.set({
						accountName: account.accountName,
						isActive: account.isActive,
						lastFetchedAt: now,
						updatedAt: now
					})
					.where(eq(table.metaAdsAccount.id, existing.id));
			} else {
				await db.insert(table.metaAdsAccount).values({
					id: crypto.randomUUID(),
					tenantId,
					integrationId,
					metaAdAccountId: account.adAccountId,
					accountName: account.accountName,
					clientId: null,
					isActive: account.isActive,
					lastFetchedAt: now,
					createdAt: now,
					updatedAt: now
				});
			}
		}

		return { fetched: adAccounts.length };
	}
);

/** Assign a Meta Ads account to a CRM client */
export const assignMetaAdsAccountToClient = command(
	v.object({
		accountId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.union([v.pipe(v.string(), v.minLength(1)), v.literal(''), v.null()])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// Verify account belongs to this tenant
		const [account] = await db
			.select({ id: table.metaAdsAccount.id })
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.id, data.accountId),
					eq(table.metaAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!account) {
			throw new Error('Cont Meta Ads negăsit');
		}

		// If clientId provided, verify it belongs to this tenant
		if (data.clientId) {
			const [clientRow] = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(
					and(
						eq(table.client.id, data.clientId),
						eq(table.client.tenantId, tenantId)
					)
				)
				.limit(1);

			if (!clientRow) {
				throw new Error('Client negăsit');
			}
		}

		await db
			.update(table.metaAdsAccount)
			.set({
				clientId: data.clientId || null,
				updatedAt: new Date()
			})
			.where(eq(table.metaAdsAccount.id, data.accountId));

		return { success: true };
	}
);

export const triggerMetaAdsSync = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const { syncMetaAdsInvoicesForTenant } = await import('$lib/server/meta-ads/sync');
	const result = await syncMetaAdsInvoicesForTenant(event.locals.tenant.id);
	return result;
});

export const deleteMetaAdsInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const [invoice] = await db
			.select()
			.from(table.metaAdsInvoice)
			.where(
				and(
					eq(table.metaAdsInvoice.id, invoiceId),
					eq(table.metaAdsInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) {
			throw new Error('Invoice not found');
		}

		// Delete PDF file if exists
		if (invoice.pdfPath) {
			try {
				const { unlink } = await import('fs/promises');
				await unlink(invoice.pdfPath);
			} catch {
				// File might not exist, that's ok
			}
		}

		await db
			.delete(table.metaAdsInvoice)
			.where(eq(table.metaAdsInvoice.id, invoice.id));

		return { success: true };
	}
);
