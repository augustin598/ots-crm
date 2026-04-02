import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { getTiktokAdsConnections, disconnectTiktokAds, getAuthenticatedToken } from '$lib/server/tiktok-ads/auth';
import { listAdvertiserAccounts } from '$lib/server/tiktok-ads/client';
import { saveTtSessionCookies, clearTtSession } from '$lib/server/tiktok-ads/tt-cookies';
import { syncTiktokAdsSpendingForTenant } from '$lib/server/tiktok-ads/sync';
import { generateSpendingReportPdf } from '$lib/server/tiktok-ads/spending-report-pdf';
import { downloadAllInvoicesForMonth, downloadInvoice } from '$lib/server/tiktok-ads/invoice-downloader';
import { getDecryptedTtCookies } from '$lib/server/tiktok-ads/tt-cookies';
import { uploadBuffer, deleteFile } from '$lib/server/storage';
import { logWarning } from '$lib/server/logger';

// ---- Queries ----

export const getTiktokAdsConnectionStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	return await getTiktokAdsConnections(event.locals.tenant.id);
});

export const getTiktokAdsSpendingList = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	let conditions: any = eq(table.tiktokAdsSpending.tenantId, event.locals.tenant.id);

	if (event.locals.isClientUser && event.locals.client) {
		if (!event.locals.isClientUserPrimary) return [];
		conditions = and(conditions, eq(table.tiktokAdsSpending.clientId, event.locals.client.id));
	}

	const rows = await db
		.select({
			id: table.tiktokAdsSpending.id,
			tenantId: table.tiktokAdsSpending.tenantId,
			integrationId: table.tiktokAdsSpending.integrationId,
			clientId: table.tiktokAdsSpending.clientId,
			tiktokAdvertiserId: table.tiktokAdsSpending.tiktokAdvertiserId,
			periodStart: table.tiktokAdsSpending.periodStart,
			periodEnd: table.tiktokAdsSpending.periodEnd,
			spendAmount: table.tiktokAdsSpending.spendAmount,
			spendCents: table.tiktokAdsSpending.spendCents,
			currencyCode: table.tiktokAdsSpending.currencyCode,
			impressions: table.tiktokAdsSpending.impressions,
			clicks: table.tiktokAdsSpending.clicks,
			conversions: table.tiktokAdsSpending.conversions,
			pdfPath: table.tiktokAdsSpending.pdfPath,
			syncedAt: table.tiktokAdsSpending.syncedAt,
			createdAt: table.tiktokAdsSpending.createdAt,
			clientName: table.client.name
		})
		.from(table.tiktokAdsSpending)
		.leftJoin(table.client, eq(table.tiktokAdsSpending.clientId, table.client.id))
		.where(conditions)
		.orderBy(desc(table.tiktokAdsSpending.periodStart))
		.limit(500);

	return rows;
});

export const getTiktokAdsAccounts = query(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const accounts = await db
			.select({
				id: table.tiktokAdsAccount.id,
				tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
				accountName: table.tiktokAdsAccount.accountName,
				clientId: table.tiktokAdsAccount.clientId,
				clientName: table.client.name,
				isActive: table.tiktokAdsAccount.isActive,
				lastFetchedAt: table.tiktokAdsAccount.lastFetchedAt
			})
			.from(table.tiktokAdsAccount)
			.leftJoin(table.client, eq(table.tiktokAdsAccount.clientId, table.client.id))
			.where(
				and(
					eq(table.tiktokAdsAccount.tenantId, event.locals.tenant.id),
					eq(table.tiktokAdsAccount.integrationId, integrationId)
				)
			)
			.orderBy(table.tiktokAdsAccount.accountName);

		return accounts;
	}
);

export const getClientsForTiktokMapping = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw error(401, 'Unauthorized');
	}

	const clients = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			businessName: table.client.businessName
		})
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant.id))
		.orderBy(table.client.name);

	return clients;
});

export const getTiktokInvoiceDownloads = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	let conditions: any = eq(table.tiktokInvoiceDownload.tenantId, event.locals.tenant.id);

	if (event.locals.isClientUser && event.locals.client) {
		if (!event.locals.isClientUserPrimary) return [];
		conditions = and(conditions, eq(table.tiktokInvoiceDownload.clientId, event.locals.client.id));
	}

	const rows = await db
		.select({
			id: table.tiktokInvoiceDownload.id,
			tenantId: table.tiktokInvoiceDownload.tenantId,
			integrationId: table.tiktokInvoiceDownload.integrationId,
			clientId: table.tiktokInvoiceDownload.clientId,
			tiktokAdvertiserId: table.tiktokInvoiceDownload.tiktokAdvertiserId,
			adAccountName: table.tiktokInvoiceDownload.adAccountName,
			tiktokInvoiceId: table.tiktokInvoiceDownload.tiktokInvoiceId,
			invoiceNumber: table.tiktokInvoiceDownload.invoiceNumber,
			amountCents: table.tiktokInvoiceDownload.amountCents,
			currencyCode: table.tiktokInvoiceDownload.currencyCode,
			periodStart: table.tiktokInvoiceDownload.periodStart,
			periodEnd: table.tiktokInvoiceDownload.periodEnd,
			pdfPath: table.tiktokInvoiceDownload.pdfPath,
			status: table.tiktokInvoiceDownload.status,
			downloadedAt: table.tiktokInvoiceDownload.downloadedAt,
			errorMessage: table.tiktokInvoiceDownload.errorMessage,
			clientName: table.client.name
		})
		.from(table.tiktokInvoiceDownload)
		.leftJoin(table.client, eq(table.tiktokInvoiceDownload.clientId, table.client.id))
		.where(conditions)
		.orderBy(desc(table.tiktokInvoiceDownload.periodStart))
		.limit(500);

	return rows;
});

// ---- Commands ----

export const addTiktokAdsConnection = command(
	v.object({
		orgId: v.optional(v.string()),
		paymentAccountId: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		const orgId = (data.orgId || '').trim();

		// Check if integration already exists for this org
		if (orgId) {
			const [existing] = await db
				.select({ id: table.tiktokAdsIntegration.id })
				.from(table.tiktokAdsIntegration)
				.where(
					and(
						eq(table.tiktokAdsIntegration.tenantId, tenantId),
						eq(table.tiktokAdsIntegration.orgId, orgId)
					)
				)
				.limit(1);

			if (existing) {
				await db
					.update(table.tiktokAdsIntegration)
					.set({
						paymentAccountId: (data.paymentAccountId || '').trim(),
						updatedAt: new Date()
					})
					.where(eq(table.tiktokAdsIntegration.id, existing.id));
				return { id: existing.id, created: false };
			}
		}

		const id = crypto.randomUUID();
		await db.insert(table.tiktokAdsIntegration).values({
			id,
			tenantId,
			appId: '',
			orgId,
			paymentAccountId: (data.paymentAccountId || '').trim(),
			email: '',
			accessToken: '',
			refreshToken: '',
			isActive: false,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		return { id, created: true };
	}
);

export const removeTiktokAdsConnection = command(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [integration] = await db
			.select({ id: table.tiktokAdsIntegration.id })
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.id, integrationId),
					eq(table.tiktokAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			throw error(404, 'Integrare TikTok Ads negăsită');
		}

		await disconnectTiktokAds(integrationId);

		await db
			.delete(table.tiktokAdsIntegration)
			.where(eq(table.tiktokAdsIntegration.id, integrationId));

		return { success: true };
	}
);

export const fetchTiktokAdsAccounts = command(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [integration] = await db
			.select()
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.id, integrationId),
					eq(table.tiktokAdsIntegration.tenantId, tenantId),
					eq(table.tiktokAdsIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw error(404, 'TikTok Ads nu este conectat');
		}

		const authResult = await getAuthenticatedToken(integrationId);
		if (!authResult) {
			throw error(500, 'Nu s-a putut obține token-ul TikTok Ads');
		}

		const adAccounts = await listAdvertiserAccounts(authResult.accessToken);

		const now = new Date();

		for (const account of adAccounts) {
			const [existing] = await db
				.select({ id: table.tiktokAdsAccount.id })
				.from(table.tiktokAdsAccount)
				.where(
					and(
						eq(table.tiktokAdsAccount.tenantId, tenantId),
						eq(table.tiktokAdsAccount.tiktokAdvertiserId, account.advertiserId)
					)
				)
				.limit(1);

			if (existing) {
				await db
					.update(table.tiktokAdsAccount)
					.set({
						accountName: account.accountName,
						isActive: account.isActive,
						lastFetchedAt: now,
						updatedAt: now
					})
					.where(eq(table.tiktokAdsAccount.id, existing.id));
			} else {
				await db.insert(table.tiktokAdsAccount).values({
					id: crypto.randomUUID(),
					tenantId,
					integrationId,
					tiktokAdvertiserId: account.advertiserId,
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

export const assignTiktokAdsAccountToClient = command(
	v.object({
		accountId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.union([v.pipe(v.string(), v.minLength(1)), v.literal(''), v.null()])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [account] = await db
			.select({ id: table.tiktokAdsAccount.id })
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.id, data.accountId),
					eq(table.tiktokAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!account) {
			throw error(404, 'Cont TikTok Ads negăsit');
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
				throw error(404, 'Client negăsit');
			}
		}

		await db
			.update(table.tiktokAdsAccount)
			.set({
				clientId: data.clientId || null,
				updatedAt: new Date()
			})
			.where(eq(table.tiktokAdsAccount.id, data.accountId));

		return { success: true };
	}
);

export const triggerTiktokAdsSync = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw error(401, 'Unauthorized');
	}

	const result = await syncTiktokAdsSpendingForTenant(event.locals.tenant.id);
	return result;
});

export const regenerateTiktokSpendingPdf = command(
	v.pipe(v.string(), v.minLength(1)),
	async (spendingId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [row] = await db
			.select()
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.id, spendingId),
					eq(table.tiktokAdsSpending.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!row) {
			throw error(404, 'Raport cheltuieli negăsit');
		}

		const allRows = await db
			.select()
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.tenantId, tenantId),
					eq(table.tiktokAdsSpending.tiktokAdvertiserId, row.tiktokAdvertiserId),
					eq(table.tiktokAdsSpending.clientId, row.clientId)
				)
			)
			.orderBy(table.tiktokAdsSpending.periodStart);

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
			.select({ accountName: table.tiktokAdsAccount.accountName })
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.tiktokAdvertiserId, row.tiktokAdvertiserId),
					eq(table.tiktokAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		const periods = allRows.map(r => ({
			periodStart: r.periodStart,
			periodEnd: r.periodEnd,
			spend: r.spendAmount,
			impressions: r.impressions ?? 0,
			clicks: r.clicks ?? 0,
			conversions: r.conversions ?? 0
		}));

		const pdfBuffer = await generateSpendingReportPdf({
			tenantName: tenantInfo?.name || '',
			clientName: clientInfo?.name || '',
			adAccountId: row.tiktokAdvertiserId,
			adAccountName: accountInfo?.accountName || row.tiktokAdvertiserId,
			currencyCode: row.currencyCode,
			periods,
			generatedAt: new Date()
		});

		const firstPeriod = allRows[0]?.periodStart?.slice(0, 7) || 'unknown';
		const lastPeriod = allRows[allRows.length - 1]?.periodStart?.slice(0, 7) || 'unknown';
		const periodLabel = `${firstPeriod}_${lastPeriod}`;
		const upload = await uploadBuffer(
			tenantId,
			Buffer.from(pdfBuffer),
			`tiktok-spending-${row.tiktokAdvertiserId}_${periodLabel}.pdf`,
			'application/pdf',
			{ type: 'tiktok-spending', advertiserId: row.tiktokAdvertiserId, clientId: row.clientId }
		);

		for (const r of allRows) {
			await db
				.update(table.tiktokAdsSpending)
				.set({ pdfPath: upload.path, updatedAt: new Date() })
				.where(eq(table.tiktokAdsSpending.id, r.id));
		}

		return { success: true };
	}
);

export const deleteTiktokAdsSpending = command(
	v.pipe(v.string(), v.minLength(1)),
	async (spendingId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const [row] = await db
			.select()
			.from(table.tiktokAdsSpending)
			.where(
				and(
					eq(table.tiktokAdsSpending.id, spendingId),
					eq(table.tiktokAdsSpending.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!row) {
			throw error(404, 'Raport cheltuieli negăsit');
		}

		if (row.pdfPath) {
			try {
				await deleteFile(row.pdfPath);
			} catch {
				logWarning('tiktok-ads', `Failed to delete spending PDF: ${row.pdfPath}`, { tenantId: event.locals.tenant.id });
			}
		}

		await db
			.delete(table.tiktokAdsSpending)
			.where(eq(table.tiktokAdsSpending.id, row.id));

		return { success: true };
	}
);

// ---- Cookie & Invoice Commands ----

export const setTiktokAdsCookies = command(
	v.object({
		integrationId: v.pipe(v.string(), v.minLength(1)),
		cookiesJson: v.pipe(v.string(), v.minLength(2))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [integration] = await db
			.select({ id: table.tiktokAdsIntegration.id })
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.id, data.integrationId),
					eq(table.tiktokAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			throw error(404, 'Integrare TikTok Ads negăsită');
		}

		try {
			await saveTtSessionCookies(data.integrationId, tenantId, data.cookiesJson);
			return { success: true };
		} catch (err) {
			throw error(400, err instanceof Error ? err.message : 'Eroare la salvare cookies');
		}
	}
);

export const clearTiktokAdsCookies = command(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [integration] = await db
			.select({ id: table.tiktokAdsIntegration.id })
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.id, integrationId),
					eq(table.tiktokAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			throw error(404, 'Integrare TikTok Ads negăsită');
		}

		await clearTtSession(integrationId, tenantId);
		return { success: true };
	}
);

export const triggerTiktokInvoiceDownload = command(
	v.object({
		year: v.pipe(v.number(), v.minValue(2020), v.maxValue(2030)),
		month: v.pipe(v.number(), v.minValue(1), v.maxValue(12))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const result = await downloadAllInvoicesForMonth(event.locals.tenant.id, data.year, data.month);
		return result;
	}
);

export const redownloadTiktokInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (downloadId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const [dl] = await db
			.select()
			.from(table.tiktokInvoiceDownload)
			.where(
				and(
					eq(table.tiktokInvoiceDownload.id, downloadId),
					eq(table.tiktokInvoiceDownload.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!dl) {
			throw error(404, 'Download negăsit');
		}

		const [integration] = await db
			.select()
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.id, dl.integrationId),
					eq(table.tiktokAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			throw error(404, 'Integrare negăsită');
		}

		if (integration.ttSessionStatus !== 'active') {
			throw error(400, 'Sesiune TikTok expirată — actualizează cookies din Settings');
		}

		if (!integration.orgId || !integration.paymentAccountId) {
			throw error(400, 'Integrarea nu are org_id sau payment_account_id configurate');
		}

		const cookies = await getDecryptedTtCookies(integration.id, tenantId);
		if (!cookies) {
			throw error(400, 'Sesiune TikTok lipsă — setează cookies din Settings');
		}

		const result = await downloadInvoice(
			dl.tiktokInvoiceId,
			cookies,
			{ bc_id: integration.orgId, pa_id: integration.paymentAccountId, platform: 2 }
		);

		if (!result.success || !result.pdfBuffer) {
			await db
				.update(table.tiktokInvoiceDownload)
				.set({
					status: 'error',
					errorMessage: result.error || 'Download eșuat',
					updatedAt: new Date()
				})
				.where(eq(table.tiktokInvoiceDownload.id, dl.id));
			throw error(500, result.error || 'Download eșuat');
		}

		const [year, month] = dl.periodStart.split('-').map(Number);
		const monthStr = String(month).padStart(2, '0');
		const upload = await uploadBuffer(
			tenantId,
			result.pdfBuffer,
			`tiktok-invoice-${dl.tiktokInvoiceId}_${year}-${monthStr}.pdf`,
			'application/pdf',
			{ type: 'tiktok-invoice', invoiceId: dl.tiktokInvoiceId, period: dl.periodStart }
		);

		await db
			.update(table.tiktokInvoiceDownload)
			.set({
				pdfPath: upload.path,
				status: 'downloaded',
				downloadedAt: new Date(),
				errorMessage: null,
				updatedAt: new Date()
			})
			.where(eq(table.tiktokInvoiceDownload.id, dl.id));

		return { success: true };
	}
);

export const deleteTiktokInvoiceDownload = command(
	v.pipe(v.string(), v.minLength(1)),
	async (downloadId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const [dl] = await db
			.select()
			.from(table.tiktokInvoiceDownload)
			.where(
				and(
					eq(table.tiktokInvoiceDownload.id, downloadId),
					eq(table.tiktokInvoiceDownload.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!dl) {
			throw error(404, 'Download negăsit');
		}

		if (dl.pdfPath) {
			try {
				await deleteFile(dl.pdfPath);
			} catch {
				logWarning('tiktok-ads', `Failed to delete PDF: ${dl.pdfPath}`, { tenantId: event.locals.tenant.id });
			}
		}

		await db
			.delete(table.tiktokInvoiceDownload)
			.where(eq(table.tiktokInvoiceDownload.id, dl.id));

		return { success: true };
	}
);

/** Assign/reassign a TikTok invoice to a client */
export const assignTiktokInvoiceToClient = command(
	v.object({
		downloadId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.union([v.pipe(v.string(), v.minLength(1)), v.null()])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [dl] = await db
			.select({ id: table.tiktokInvoiceDownload.id })
			.from(table.tiktokInvoiceDownload)
			.where(
				and(
					eq(table.tiktokInvoiceDownload.id, data.downloadId),
					eq(table.tiktokInvoiceDownload.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!dl) throw error(404, 'Invoice not found');

		await db
			.update(table.tiktokInvoiceDownload)
			.set({ clientId: data.clientId, updatedAt: new Date() })
			.where(eq(table.tiktokInvoiceDownload.id, data.downloadId));

		return { success: true };
	}
);

/** Auto-assign unassigned invoices to clients based on advertiser ID → account mapping */
export const autoAssignTiktokInvoices = command(
	v.undefined(),
	async () => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;

		// Get all unassigned invoices
		const unassigned = await db
			.select({
				id: table.tiktokInvoiceDownload.id,
				tiktokAdvertiserId: table.tiktokInvoiceDownload.tiktokAdvertiserId
			})
			.from(table.tiktokInvoiceDownload)
			.where(
				and(
					eq(table.tiktokInvoiceDownload.tenantId, tenantId),
					isNull(table.tiktokInvoiceDownload.clientId)
				)
			);

		if (unassigned.length === 0) return { assigned: 0, total: 0 };

		// Build advertiser → client mapping from all active accounts
		const accounts = await db
			.select({
				tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
				clientId: table.tiktokAdsAccount.clientId
			})
			.from(table.tiktokAdsAccount)
			.where(eq(table.tiktokAdsAccount.isActive, true));

		const advToClient = new Map<string, string>();
		for (const acc of accounts) {
			if (acc.clientId && acc.tiktokAdvertiserId) {
				advToClient.set(acc.tiktokAdvertiserId, acc.clientId);
			}
		}

		let assigned = 0;
		for (const inv of unassigned) {
			const clientId = inv.tiktokAdvertiserId ? advToClient.get(inv.tiktokAdvertiserId) : null;
			if (clientId) {
				await db
					.update(table.tiktokInvoiceDownload)
					.set({ clientId, updatedAt: new Date() })
					.where(eq(table.tiktokInvoiceDownload.id, inv.id));
				assigned++;
			}
		}

		return { assigned, total: unassigned.length };
	}
);

// ---- Bulk Import (JSON) ----

export const bulkDownloadTiktokInvoices = command(
	v.object({
		links: v.array(
			v.object({
				invoiceId: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
				invoiceSerial: v.optional(v.pipe(v.union([v.string(), v.number()]), v.transform(String))),
				advId: v.optional(v.pipe(v.union([v.string(), v.number()]), v.transform(String))),
				accountName: v.optional(v.string()),
				amount: v.optional(v.pipe(v.union([v.string(), v.number()]), v.transform(String))),
				currency: v.optional(v.string()),
				period: v.optional(v.string())
			})
		)
	}),
	async ({ links }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// Find active integration with TikTok session
		const [integration] = await db
			.select()
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.tenantId, tenantId),
					eq(table.tiktokAdsIntegration.isActive, true),
					eq(table.tiktokAdsIntegration.ttSessionStatus, 'active')
				)
			)
			.limit(1);

		if (!integration) {
			throw error(400, 'Nu există integrare TikTok cu sesiune activă');
		}
		if (!integration.orgId || !integration.paymentAccountId) {
			throw error(400, 'Integrarea nu are org_id sau payment_account_id configurate');
		}

		const cookies = await getDecryptedTtCookies(integration.id, tenantId);
		if (!cookies) {
			throw error(400, 'Sesiune TikTok lipsă — setează cookies din Settings');
		}

		const context = {
			bc_id: integration.orgId,
			pa_id: integration.paymentAccountId,
			platform: 2
		};

		// Build advertiser → client mapping
		const accounts = await db
			.select({
				tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
				accountName: table.tiktokAdsAccount.accountName,
				clientId: table.tiktokAdsAccount.clientId
			})
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.integrationId, integration.id),
					eq(table.tiktokAdsAccount.isActive, true)
				)
			);

		const advToClient = new Map<string, { clientId: string | null; accountName: string | null }>();
		for (const acc of accounts) {
			advToClient.set(acc.tiktokAdvertiserId, { clientId: acc.clientId, accountName: acc.accountName });
		}

		let downloaded = 0;
		let skipped = 0;
		let errors = 0;
		const errorDetails: string[] = [];

		for (const link of links) {
			// Check if already exists
			const [existing] = await db
				.select({ id: table.tiktokInvoiceDownload.id, status: table.tiktokInvoiceDownload.status })
				.from(table.tiktokInvoiceDownload)
				.where(
					and(
						eq(table.tiktokInvoiceDownload.tenantId, tenantId),
						eq(table.tiktokInvoiceDownload.tiktokInvoiceId, link.invoiceId)
					)
				)
				.limit(1);

			if (existing && existing.status === 'downloaded') {
				skipped++;
				continue;
			}

			// Parse period from link or default to current month
			let periodStart = '';
			let periodEnd = '';
			if (link.period) {
				const [y, m] = link.period.split('-').map(Number);
				const monthStr = String(m).padStart(2, '0');
				periodStart = `${y}-${monthStr}-01`;
				const lastDay = new Date(y, m, 0).getDate();
				periodEnd = `${y}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
			} else {
				const now = new Date();
				const y = now.getFullYear();
				const m = now.getMonth() + 1;
				const monthStr = String(m).padStart(2, '0');
				periodStart = `${y}-${monthStr}-01`;
				const lastDay = new Date(y, m, 0).getDate();
				periodEnd = `${y}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
			}

			// Resolve client mapping
			let clientId: string | null = null;
			let accountName = link.accountName || null;
			const advId = link.advId || '';
			if (advId && advToClient.has(advId)) {
				const mapping = advToClient.get(advId)!;
				clientId = mapping.clientId;
				if (mapping.accountName) accountName = mapping.accountName;
			}

			const parsedAmount = link.amount ? parseFloat(String(link.amount)) : NaN;
			const amountCents = isNaN(parsedAmount) ? null : Math.round(parsedAmount * 100);

			// Create or reuse DB record
			let recordId: string;
			if (existing) {
				recordId = existing.id;
				await db
					.update(table.tiktokInvoiceDownload)
					.set({
						status: 'pending',
						errorMessage: null,
						// Update fields that may have been missing on first import
						...(link.invoiceSerial ? { invoiceNumber: link.invoiceSerial } : {}),
						...(amountCents != null ? { amountCents } : {}),
						...(clientId ? { clientId } : {}),
						...(accountName ? { adAccountName: accountName } : {}),
						...(advId ? { tiktokAdvertiserId: advId } : {}),
						...(link.currency ? { currencyCode: link.currency } : {}),
						updatedAt: new Date()
					})
					.where(eq(table.tiktokInvoiceDownload.id, existing.id));
			} else {
				const { encodeBase32LowerCase } = await import('@oslojs/encoding');
				recordId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				await db.insert(table.tiktokInvoiceDownload).values({
					id: recordId,
					tenantId,
					integrationId: integration.id,
					clientId,
					tiktokAdvertiserId: advId,
					adAccountName: accountName,
					tiktokInvoiceId: link.invoiceId,
					invoiceNumber: link.invoiceSerial || null,
					amountCents,
					currencyCode: link.currency || 'RON',
					periodStart,
					periodEnd,
					status: 'pending',
					createdAt: new Date(),
					updatedAt: new Date()
				});
			}

			// Download via 3-step async
			try {
				const result = await downloadInvoice(link.invoiceId, cookies, context);
				if (result.success && result.pdfBuffer) {
					const [year, month] = periodStart.split('-').map(Number);
					const monthStr = String(month).padStart(2, '0');
					const upload = await uploadBuffer(
						tenantId,
						result.pdfBuffer,
						`tiktok-invoice-${link.invoiceId}_${year}-${monthStr}.pdf`,
						'application/pdf',
						{ type: 'tiktok-invoice', invoiceId: link.invoiceId, period: periodStart }
					);

					await db
						.update(table.tiktokInvoiceDownload)
						.set({
							pdfPath: upload.path,
							status: 'downloaded',
							downloadedAt: new Date(),
							errorMessage: null,
							updatedAt: new Date()
						})
						.where(eq(table.tiktokInvoiceDownload.id, recordId));
					downloaded++;
				} else {
					await db
						.update(table.tiktokInvoiceDownload)
						.set({ status: 'error', errorMessage: result.error || 'Download eșuat', updatedAt: new Date() })
						.where(eq(table.tiktokInvoiceDownload.id, recordId));
					errors++;
					errorDetails.push(`${link.invoiceId}: ${result.error}`);
				}
			} catch (e) {
				const errMsg = e instanceof Error ? e.message : String(e);
				await db
					.update(table.tiktokInvoiceDownload)
					.set({ status: 'error', errorMessage: errMsg, updatedAt: new Date() })
					.where(eq(table.tiktokInvoiceDownload.id, recordId));
				errors++;
				errorDetails.push(`${link.invoiceId}: ${errMsg}`);
			}

			// Rate limiting
			await new Promise(resolve => setTimeout(resolve, 2000));
		}

		return { downloaded, skipped, errors, errorDetails };
	}
);
