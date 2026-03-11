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

export const getMetaAdsSpendingList = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	let conditions: any = eq(table.metaAdsSpending.tenantId, event.locals.tenant.id);

	// If user is a client user, filter by their client ID
	if (event.locals.isClientUser && event.locals.client) {
		if (!event.locals.isClientUserPrimary) return [];
		conditions = and(conditions, eq(table.metaAdsSpending.clientId, event.locals.client.id));
	}

	const rows = await db
		.select({
			id: table.metaAdsSpending.id,
			tenantId: table.metaAdsSpending.tenantId,
			integrationId: table.metaAdsSpending.integrationId,
			clientId: table.metaAdsSpending.clientId,
			metaAdAccountId: table.metaAdsSpending.metaAdAccountId,
			periodStart: table.metaAdsSpending.periodStart,
			periodEnd: table.metaAdsSpending.periodEnd,
			spendAmount: table.metaAdsSpending.spendAmount,
			spendCents: table.metaAdsSpending.spendCents,
			currencyCode: table.metaAdsSpending.currencyCode,
			impressions: table.metaAdsSpending.impressions,
			clicks: table.metaAdsSpending.clicks,
			pdfPath: table.metaAdsSpending.pdfPath,
			syncedAt: table.metaAdsSpending.syncedAt,
			createdAt: table.metaAdsSpending.createdAt,
			clientName: table.client.name,
			businessName: table.metaAdsIntegration.businessName
		})
		.from(table.metaAdsSpending)
		.leftJoin(table.client, eq(table.metaAdsSpending.clientId, table.client.id))
		.leftJoin(table.metaAdsIntegration, eq(table.metaAdsSpending.integrationId, table.metaAdsIntegration.id))
		.where(conditions)
		.orderBy(desc(table.metaAdsSpending.periodStart))
		.limit(500);

	return rows;
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
			await db
				.update(table.metaAdsIntegration)
				.set({
					businessName: data.businessName.trim(),
					updatedAt: new Date()
				})
				.where(eq(table.metaAdsIntegration.id, existing.id));
			return { id: existing.id, created: false };
		}

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

		const { disconnectMetaAds } = await import('$lib/server/meta-ads/auth');
		await disconnectMetaAds(integrationId);

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

/** Regenerate spending report PDF for a specific spending row's account+client */
export const regenerateSpendingPdf = command(
	v.pipe(v.string(), v.minLength(1)),
	async (spendingId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// Get the target spending row
		const [row] = await db
			.select()
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.id, spendingId),
					eq(table.metaAdsSpending.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!row) {
			throw new Error('Raport cheltuieli negăsit');
		}

		// Get ALL spending rows for same account + client (for combined PDF)
		const allRows = await db
			.select()
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.tenantId, tenantId),
					eq(table.metaAdsSpending.metaAdAccountId, row.metaAdAccountId),
					eq(table.metaAdsSpending.clientId, row.clientId)
				)
			)
			.orderBy(table.metaAdsSpending.periodStart);

		// Get client + tenant + account info for PDF
		const [clientInfo] = await db
			.select({ name: table.client.name })
			.from(table.client)
			.where(eq(table.client.id, row.clientId))
			.limit(1);

		const [tenantInfo] = await db
			.select({ name: table.tenant.name })
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);

		const [accountInfo] = await db
			.select({ accountName: table.metaAdsAccount.accountName })
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.metaAdAccountId, row.metaAdAccountId),
					eq(table.metaAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		const { generateSpendingReportPdf } = await import('$lib/server/meta-ads/spending-report-pdf');
		const { writeFile, mkdir } = await import('fs/promises');
		const { join } = await import('path');

		const periods = allRows.map(r => ({
			periodStart: r.periodStart,
			periodEnd: r.periodEnd,
			spend: r.spendAmount,
			impressions: r.impressions ?? 0,
			clicks: r.clicks ?? 0
		}));

		const pdfBuffer = await generateSpendingReportPdf({
			tenantName: tenantInfo?.name || '',
			clientName: clientInfo?.name || '',
			adAccountId: row.metaAdAccountId,
			adAccountName: accountInfo?.accountName || row.metaAdAccountId,
			currencyCode: row.currencyCode,
			periods,
			generatedAt: new Date()
		});

		// Save to filesystem
		const firstPeriod = allRows[0]?.periodStart?.slice(0, 7) || 'unknown';
		const lastPeriod = allRows[allRows.length - 1]?.periodStart?.slice(0, 7) || 'unknown';
		const periodLabel = `${firstPeriod}_${lastPeriod}`;
		const dir = join(process.cwd(), 'uploads', 'meta-ads-reports', tenantId, row.clientId);
		await mkdir(dir, { recursive: true });

		const relativePath = join('uploads', 'meta-ads-reports', tenantId, row.clientId, `${row.metaAdAccountId}_${periodLabel}.pdf`);
		await writeFile(join(process.cwd(), relativePath), pdfBuffer);

		// Update pdfPath on ALL rows for this account+client
		for (const r of allRows) {
			await db
				.update(table.metaAdsSpending)
				.set({ pdfPath: relativePath, updatedAt: new Date() })
				.where(eq(table.metaAdsSpending.id, r.id));
		}

		return { success: true };
	}
);

export const deleteMetaAdsSpending = command(
	v.pipe(v.string(), v.minLength(1)),
	async (spendingId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const [row] = await db
			.select()
			.from(table.metaAdsSpending)
			.where(
				and(
					eq(table.metaAdsSpending.id, spendingId),
					eq(table.metaAdsSpending.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!row) {
			throw new Error('Raport cheltuieli negăsit');
		}

		// Delete PDF file if exists
		if (row.pdfPath) {
			try {
				const { unlink } = await import('fs/promises');
				const { join } = await import('path');
				await unlink(join(process.cwd(), row.pdfPath));
			} catch {
				// File might not exist
			}
		}

		await db
			.delete(table.metaAdsSpending)
			.where(eq(table.metaAdsSpending.id, row.id));

		return { success: true };
	}
);
