import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getMetaAdsConnections } from '$lib/server/meta-ads/auth';
import { logWarning } from '$lib/server/logger';

// ---- Queries ----

export const getMetaAdsConnectionStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	const connections = await getMetaAdsConnections(event.locals.tenant.id);

	// Enrich with FB session status
	const enriched = await Promise.all(
		connections.map(async (conn: any) => {
			const [integration] = await db
				.select({ fbSessionStatus: table.metaAdsIntegration.fbSessionStatus })
				.from(table.metaAdsIntegration)
				.where(eq(table.metaAdsIntegration.id, conn.id))
				.limit(1);
			return {
				...conn,
				fbSessionStatus: integration?.fbSessionStatus || 'none'
			};
		})
	);

	return enriched;
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
		const { uploadBuffer } = await import('$lib/server/storage');

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

		// Upload to MinIO
		const firstPeriod = allRows[0]?.periodStart?.slice(0, 7) || 'unknown';
		const lastPeriod = allRows[allRows.length - 1]?.periodStart?.slice(0, 7) || 'unknown';
		const periodLabel = `${firstPeriod}_${lastPeriod}`;
		const upload = await uploadBuffer(
			tenantId,
			Buffer.from(pdfBuffer),
			`meta-spending-${row.metaAdAccountId}_${periodLabel}.pdf`,
			'application/pdf',
			{ type: 'meta-spending', adAccountId: row.metaAdAccountId, clientId: row.clientId }
		);

		// Update pdfPath on ALL rows for this account+client
		for (const r of allRows) {
			await db
				.update(table.metaAdsSpending)
				.set({ pdfPath: upload.path, updatedAt: new Date() })
				.where(eq(table.metaAdsSpending.id, r.id));
		}

		return { success: true };
	}
);

// ---- Invoice Download Commands ----

/** Save Facebook session cookies (from Cookie-Editor export) for invoice downloading */
export const setMetaAdsCookies = command(
	v.object({
		integrationId: v.pipe(v.string(), v.minLength(1)),
		cookiesJson: v.pipe(v.string(), v.minLength(2))
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
		console.log('[Meta Ads] setMetaAdsCookies called', { integrationId: data.integrationId, tenantId, jsonLength: data.cookiesJson.length });

		// Verify integration belongs to tenant
		const [integration] = await db
			.select({ id: table.metaAdsIntegration.id })
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.id, data.integrationId),
					eq(table.metaAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			console.error('[Meta Ads] Integration not found for tenant', { integrationId: data.integrationId, tenantId });
			throw new Error('Integrare Meta Ads negăsită');
		}

		try {
			const { saveFbSessionCookies } = await import('$lib/server/meta-ads/fb-cookies');
			await saveFbSessionCookies(data.integrationId, tenantId, data.cookiesJson);
			console.log('[Meta Ads] Cookies saved successfully', { integrationId: data.integrationId });
			return { success: true };
		} catch (err) {
			console.error('[Meta Ads] saveFbSessionCookies failed:', err);
			throw err;
		}
	}
);

/** Clear Facebook session cookies for an integration */
export const clearMetaAdsCookies = command(
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

		const { clearFbSession } = await import('$lib/server/meta-ads/fb-cookies');
		await clearFbSession(integrationId, tenantId);

		return { success: true };
	}
);

/** Get all invoice downloads for the tenant (or filtered by client for client users) */
export const getMetaInvoiceDownloads = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	let conditions: any = eq(table.metaInvoiceDownload.tenantId, event.locals.tenant.id);

	// Client users: only primary client user sees their own downloads
	if (event.locals.isClientUser && event.locals.client) {
		if (!event.locals.isClientUserPrimary) return [];
		conditions = and(conditions, eq(table.metaInvoiceDownload.clientId, event.locals.client.id));
	}

	const rows = await db
		.select({
			id: table.metaInvoiceDownload.id,
			tenantId: table.metaInvoiceDownload.tenantId,
			integrationId: table.metaInvoiceDownload.integrationId,
			clientId: table.metaInvoiceDownload.clientId,
			metaAdAccountId: table.metaInvoiceDownload.metaAdAccountId,
			adAccountName: table.metaInvoiceDownload.adAccountName,
			bmName: table.metaInvoiceDownload.bmName,
			periodStart: table.metaInvoiceDownload.periodStart,
			periodEnd: table.metaInvoiceDownload.periodEnd,
			pdfPath: table.metaInvoiceDownload.pdfPath,
			status: table.metaInvoiceDownload.status,
			downloadedAt: table.metaInvoiceDownload.downloadedAt,
			errorMessage: table.metaInvoiceDownload.errorMessage,
			clientName: table.client.name
		})
		.from(table.metaInvoiceDownload)
		.leftJoin(table.client, eq(table.metaInvoiceDownload.clientId, table.client.id))
		.where(conditions)
		.orderBy(desc(table.metaInvoiceDownload.periodStart))
		.limit(500);

	return rows;
});

/** Trigger invoice download for a specific month */
export const triggerInvoiceDownload = command(
	v.object({
		year: v.pipe(v.number(), v.minValue(2020), v.maxValue(2030)),
		month: v.pipe(v.number(), v.minValue(1), v.maxValue(12))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const { downloadAllReceiptsForMonth } = await import('$lib/server/meta-ads/invoice-downloader');
		const result = await downloadAllReceiptsForMonth(event.locals.tenant.id, data.year, data.month);
		return result;
	}
);

/** Re-download a single invoice PDF */
export const redownloadInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (downloadId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [dl] = await db
			.select()
			.from(table.metaInvoiceDownload)
			.where(
				and(
					eq(table.metaInvoiceDownload.id, downloadId),
					eq(table.metaInvoiceDownload.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!dl) {
			throw new Error('Download negăsit');
		}

		// Parse period to get year/month
		const [year, month] = dl.periodStart.split('-').map(Number);
		if (!year || !month || month < 1 || month > 12) {
			throw new Error('Format perioadă invalid');
		}

		// Get integration info (scoped to tenant for defense-in-depth)
		const [integration] = await db
			.select()
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.id, dl.integrationId),
					eq(table.metaAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Integrare negăsită');
		}

		if (integration.fbSessionStatus !== 'active') {
			throw new Error('Sesiune Facebook expirată — actualizează cookies din Settings');
		}

		const { downloadReceipt } = await import('$lib/server/meta-ads/invoice-downloader');
		const { getDecryptedFbCookies } = await import('$lib/server/meta-ads/fb-cookies');

		const cookies = await getDecryptedFbCookies(integration.id, tenantId);
		if (!cookies) {
			throw new Error('Sesiune Facebook lipsă — setează cookies din Settings');
		}

		const result = await downloadReceipt({
			adAccountId: dl.metaAdAccountId,
			year,
			month,
			cookies
		});

		if (!result.success || !result.pdfBuffer) {
			await db
				.update(table.metaInvoiceDownload)
				.set({
					status: 'error',
					errorMessage: result.error || 'Download eșuat',
					updatedAt: new Date()
				})
				.where(eq(table.metaInvoiceDownload.id, dl.id));
			throw new Error(result.error || 'Download eșuat');
		}

		// Upload PDF to MinIO
		const monthStr = String(month).padStart(2, '0');
		const { uploadBuffer } = await import('$lib/server/storage');
		const upload = await uploadBuffer(
			tenantId,
			result.pdfBuffer,
			`meta-invoice-${dl.metaAdAccountId}_${year}-${monthStr}.pdf`,
			'application/pdf',
			{ type: 'meta-invoice', adAccountId: dl.metaAdAccountId, period: dl.periodStart }
		);

		await db
			.update(table.metaInvoiceDownload)
			.set({
				pdfPath: upload.path,
				status: 'downloaded',
				downloadedAt: new Date(),
				errorMessage: null,
				updatedAt: new Date()
			})
			.where(eq(table.metaInvoiceDownload.id, dl.id));

		return { success: true };
	}
);

/** Delete an invoice download record */
export const deleteInvoiceDownload = command(
	v.pipe(v.string(), v.minLength(1)),
	async (downloadId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const [dl] = await db
			.select()
			.from(table.metaInvoiceDownload)
			.where(
				and(
					eq(table.metaInvoiceDownload.id, downloadId),
					eq(table.metaInvoiceDownload.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!dl) {
			throw new Error('Download negăsit');
		}

		// Delete PDF from MinIO if exists
		if (dl.pdfPath) {
			try {
				const { deleteFile } = await import('$lib/server/storage');
				await deleteFile(dl.pdfPath);
			} catch {
				logWarning('meta-ads', `Failed to delete PDF file: ${dl.pdfPath}`, { tenantId: event.locals.tenant.id });
			}
		}

		await db
			.delete(table.metaInvoiceDownload)
			.where(eq(table.metaInvoiceDownload.id, dl.id));

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

		// Delete PDF from MinIO if exists
		if (row.pdfPath) {
			try {
				const { deleteFile } = await import('$lib/server/storage');
				await deleteFile(row.pdfPath);
			} catch {
				logWarning('meta-ads', `Failed to delete spending PDF: ${row.pdfPath}`, { tenantId: event.locals.tenant.id });
			}
		}

		await db
			.delete(table.metaAdsSpending)
			.where(eq(table.metaAdsSpending.id, row.id));

		return { success: true };
	}
);
