import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getGoogleAdsStatus, getAuthenticatedClient } from '$lib/server/google-ads/auth';
import { listMonthlySpend, formatCustomerId, listMccSubAccounts } from '$lib/server/google-ads/client';
import { saveGoogleSessionCookies, clearGoogleSession } from '$lib/server/google-ads/google-cookies';

// ---- Queries ----

export const getGoogleAdsConnectionStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	return getGoogleAdsStatus(event.locals.tenant.id);
});

export const getGoogleAdsInvoices = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	let conditions: any = eq(table.googleAdsInvoice.tenantId, event.locals.tenant.id);

	// If user is a client user, filter by their client ID
	if (event.locals.isClientUser && event.locals.client) {
		if (!event.locals.isClientUserPrimary) return [];
		conditions = and(conditions, eq(table.googleAdsInvoice.clientId, event.locals.client.id));
	}

	const invoices = await db
		.select({
			id: table.googleAdsInvoice.id,
			tenantId: table.googleAdsInvoice.tenantId,
			clientId: table.googleAdsInvoice.clientId,
			googleAdsCustomerId: table.googleAdsInvoice.googleAdsCustomerId,
			googleInvoiceId: table.googleAdsInvoice.googleInvoiceId,
			invoiceNumber: table.googleAdsInvoice.invoiceNumber,
			issueDate: table.googleAdsInvoice.issueDate,
			dueDate: table.googleAdsInvoice.dueDate,
			subtotalAmountMicros: table.googleAdsInvoice.subtotalAmountMicros,
			totalAmountMicros: table.googleAdsInvoice.totalAmountMicros,
			currencyCode: table.googleAdsInvoice.currencyCode,
			invoiceType: table.googleAdsInvoice.invoiceType,
			pdfPath: table.googleAdsInvoice.pdfPath,
			status: table.googleAdsInvoice.status,
			syncedAt: table.googleAdsInvoice.syncedAt,
			createdAt: table.googleAdsInvoice.createdAt,
			clientName: table.client.name
		})
		.from(table.googleAdsInvoice)
		.leftJoin(table.client, eq(table.googleAdsInvoice.clientId, table.client.id))
		.where(conditions)
		.orderBy(desc(table.googleAdsInvoice.issueDate))
		.limit(500);

	return invoices;
});

/** Get Google Ads sub-accounts cached in DB with their client mappings */
export const getGoogleAdsAccounts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const accounts = await db
		.select({
			id: table.googleAdsAccount.id,
			googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId,
			accountName: table.googleAdsAccount.accountName,
			clientId: table.googleAdsAccount.clientId,
			clientName: table.client.name,
			isActive: table.googleAdsAccount.isActive,
			lastFetchedAt: table.googleAdsAccount.lastFetchedAt
		})
		.from(table.googleAdsAccount)
		.leftJoin(table.client, eq(table.googleAdsAccount.clientId, table.client.id))
		.where(eq(table.googleAdsAccount.tenantId, event.locals.tenant.id))
		.orderBy(table.googleAdsAccount.accountName);

	return accounts;
});

/** Get all CRM clients (for mapping dropdown) */
export const getClientsForMapping = query(async () => {
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

/** Get monthly spend aggregates for all mapped accounts */
export const getGoogleAdsMonthlySpend = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) throw new Error('Unauthorized');

	const tenantId = event.locals.tenant.id;
	const authResult = await getAuthenticatedClient(tenantId);
	if (!authResult) return [];

	const { integration } = authResult;

	// Get mapped accounts
	const accounts = await db
		.select({
			googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId,
			accountName: table.googleAdsAccount.accountName,
			clientId: table.googleAdsAccount.clientId,
			clientName: table.client.name,
			clientEmail: table.client.email
		})
		.from(table.googleAdsAccount)
		.leftJoin(table.client, eq(table.googleAdsAccount.clientId, table.client.id))
		.where(and(
			eq(table.googleAdsAccount.tenantId, tenantId),
			eq(table.googleAdsAccount.isActive, true)
		));

	const mapped = accounts.filter(a => a.clientId);
	const results: Array<{
		googleAdsCustomerId: string;
		accountName: string;
		clientName: string | null;
		clientEmail: string | null;
		months: Awaited<ReturnType<typeof listMonthlySpend>>;
	}> = [];

	for (const acc of mapped) {
		const cleanId = formatCustomerId(acc.googleAdsCustomerId);
		const months = await listMonthlySpend(
			integration.mccAccountId, cleanId,
			integration.developerToken, integration.refreshToken
		);
		results.push({
			googleAdsCustomerId: acc.googleAdsCustomerId,
			accountName: acc.accountName,
			clientName: acc.clientName,
			clientEmail: acc.clientEmail,
			months
		});
	}

	return results;
});

/** Get monthly spend for client user's own accounts */
export const getMyGoogleAdsMonthlySpend = query(
	v.object({
		since: v.optional(v.string()),
		until: v.optional(v.string())
	}),
	async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.isClientUser || !event?.locals.client) {
		return [];
	}

	const tenantId = event.locals.tenant.id;
	const authResult = await getAuthenticatedClient(tenantId);
	if (!authResult) return [];

	const { integration } = authResult;

	const accounts = await db
		.select({
			googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId,
			accountName: table.googleAdsAccount.accountName
		})
		.from(table.googleAdsAccount)
		.where(and(
			eq(table.googleAdsAccount.tenantId, tenantId),
			eq(table.googleAdsAccount.clientId, event.locals.client.id),
			eq(table.googleAdsAccount.isActive, true)
		));

	// Get client's email
	const [clientInfo] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(eq(table.client.id, event.locals.client.id))
		.limit(1);
	const clientEmail = clientInfo?.email || '';

	const results: Array<{
		accountName: string;
		clientEmail: string;
		customerId: string;
		months: Awaited<ReturnType<typeof listMonthlySpend>>;
	}> = [];

	for (const acc of accounts) {
		const cleanId = formatCustomerId(acc.googleAdsCustomerId);
		const months = await listMonthlySpend(
			integration.mccAccountId, cleanId,
			integration.developerToken, integration.refreshToken,
			data.since, data.until
		);
		results.push({ accountName: acc.accountName, clientEmail, customerId: cleanId, months });
	}

	return results;
});

// ---- Commands ----

export const saveGoogleAdsConfig = command(
	v.object({
		mccAccountId: v.pipe(v.string(), v.minLength(1)),
		developerToken: v.pipe(v.string(), v.minLength(1)),
		syncEnabled: v.boolean()
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
		const cleanMcc = data.mccAccountId.trim().replace(/-/g, '');

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.googleAdsIntegration)
			.where(eq(table.googleAdsIntegration.tenantId, tenantId))
			.limit(1);

		if (existing) {
			await db
				.update(table.googleAdsIntegration)
				.set({
					mccAccountId: cleanMcc,
					developerToken: data.developerToken,
					syncEnabled: data.syncEnabled,
					updatedAt: new Date()
				})
				.where(eq(table.googleAdsIntegration.id, existing.id));
		} else {
			// Create a placeholder integration (will be completed after OAuth)
			await db.insert(table.googleAdsIntegration).values({
				id: crypto.randomUUID(),
				tenantId,
				email: '', // Will be filled during OAuth
				accessToken: '', // Will be filled during OAuth
				refreshToken: '', // Will be filled during OAuth
				tokenExpiresAt: new Date(),
				mccAccountId: cleanMcc,
				developerToken: data.developerToken,
				syncEnabled: data.syncEnabled,
				isActive: false, // Not active until OAuth completes
				createdAt: new Date(),
				updatedAt: new Date()
			});
		}

		return { success: true };
	}
);

/** Fetch sub-accounts from MCC via Google Ads API and cache them in DB */
export const fetchGoogleAdsAccounts = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	const authResult = await getAuthenticatedClient(tenantId);
	if (!authResult) {
		throw new Error('Google Ads nu este conectat');
	}

	const { integration } = authResult;
	const subAccounts = await listMccSubAccounts(integration.mccAccountId, integration.developerToken, integration.refreshToken);

	const now = new Date();

	for (const account of subAccounts) {
		const cleanId = formatCustomerId(account.customerId);

		// Upsert: update if exists, insert if not
		const [existing] = await db
			.select({ id: table.googleAdsAccount.id })
			.from(table.googleAdsAccount)
			.where(
				and(
					eq(table.googleAdsAccount.tenantId, tenantId),
					eq(table.googleAdsAccount.googleAdsCustomerId, cleanId)
				)
			)
			.limit(1);

		if (existing) {
			await db
				.update(table.googleAdsAccount)
				.set({
					accountName: account.descriptiveName,
					currencyCode: account.currencyCode,
					isActive: account.status === 'ENABLED',
					lastFetchedAt: now,
					updatedAt: now
				})
				.where(eq(table.googleAdsAccount.id, existing.id));
		} else {
			await db.insert(table.googleAdsAccount).values({
				id: crypto.randomUUID(),
				tenantId,
				googleAdsCustomerId: cleanId,
				accountName: account.descriptiveName,
				currencyCode: account.currencyCode,
				clientId: null,
				isActive: account.status === 'ENABLED',
				lastFetchedAt: now,
				createdAt: now,
				updatedAt: now
			});
		}
	}

	return { fetched: subAccounts.length };
});

/** Assign a Google Ads account to a CRM client */
export const assignGoogleAdsAccountToClient = command(
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
			.select({ id: table.googleAdsAccount.id })
			.from(table.googleAdsAccount)
			.where(
				and(
					eq(table.googleAdsAccount.id, data.accountId),
					eq(table.googleAdsAccount.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!account) {
			throw new Error('Cont Google Ads negăsit');
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
			.update(table.googleAdsAccount)
			.set({
				clientId: data.clientId || null,
				updatedAt: new Date()
			})
			.where(eq(table.googleAdsAccount.id, data.accountId));

		return { success: true };
	}
);

export const triggerGoogleAdsSync = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	// Dynamic import to avoid circular dependencies
	const { syncGoogleAdsInvoicesForTenant } = await import('$lib/server/google-ads/sync');
	const result = await syncGoogleAdsInvoicesForTenant(event.locals.tenant.id);
	return result;
});

export const deleteGoogleAdsInvoice = command(
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
			.from(table.googleAdsInvoice)
			.where(
				and(
					eq(table.googleAdsInvoice.id, invoiceId),
					eq(table.googleAdsInvoice.tenantId, event.locals.tenant.id)
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
			.delete(table.googleAdsInvoice)
			.where(eq(table.googleAdsInvoice.id, invoice.id));

		return { success: true };
	}
);

/** Download a Google Ads invoice PDF from a direct URL (pasted by user) */
export const downloadGoogleInvoiceFromUrl = command(
	v.object({
		pdfUrl: v.pipe(v.string(), v.minLength(1)),
		customerId: v.pipe(v.string(), v.minLength(1)),
		invoiceId: v.optional(v.string())
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

		// Get integration and cookies
		const [integration] = await db
			.select()
			.from(table.googleAdsIntegration)
			.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)))
			.limit(1);

		if (!integration) throw new Error('Integrarea Google Ads nu este configurată');

		const { getDecryptedGoogleCookies } = await import('$lib/server/google-ads/google-cookies');
		const cookies = await getDecryptedGoogleCookies(integration.id, tenantId);
		if (!cookies) throw new Error('Cookies Google nu sunt configurate');

		const { downloadInvoicePdfViaCookies } = await import('$lib/server/google-ads/invoice-downloader');
		const { uploadBuffer } = await import('$lib/server/storage');

		const result = await downloadInvoicePdfViaCookies(data.pdfUrl, cookies);

		if (!result.success || !result.pdfBuffer) {
			throw new Error(`Download eșuat: ${result.error}`);
		}

		// Extract invoice ID from URL or use provided one
		const invoiceId = data.invoiceId || data.pdfUrl.match(/(\d{8,})/)?.[1] || crypto.randomUUID();
		const cleanCustomerId = formatCustomerId(data.customerId);

		// Upload to MinIO
		const upload = await uploadBuffer(
			tenantId,
			result.pdfBuffer,
			`google-ads-invoice-${cleanCustomerId}_${invoiceId}.pdf`,
			'application/pdf',
			{ type: 'google-ads-invoice', customerId: cleanCustomerId, invoiceId }
		);

		// Find the client for this Google Ads account
		const [account] = await db
			.select({ clientId: table.googleAdsAccount.clientId })
			.from(table.googleAdsAccount)
			.where(and(
				eq(table.googleAdsAccount.tenantId, tenantId),
				eq(table.googleAdsAccount.googleAdsCustomerId, data.customerId)
			))
			.limit(1);

		if (!account?.clientId) throw new Error('Contul Google Ads nu este mapat la un client');

		// Check dedup
		const [existing] = await db
			.select({ id: table.googleAdsInvoice.id })
			.from(table.googleAdsInvoice)
			.where(and(
				eq(table.googleAdsInvoice.tenantId, tenantId),
				eq(table.googleAdsInvoice.googleInvoiceId, invoiceId)
			))
			.limit(1);

		if (existing) {
			await db.update(table.googleAdsInvoice)
				.set({ pdfPath: upload.path, status: 'synced', syncedAt: new Date(), updatedAt: new Date() })
				.where(eq(table.googleAdsInvoice.id, existing.id));
		} else {
			await db.insert(table.googleAdsInvoice).values({
				id: crypto.randomUUID(),
				tenantId,
				clientId: account.clientId,
				googleAdsCustomerId: data.customerId,
				googleInvoiceId: invoiceId,
				invoiceNumber: invoiceId,
				issueDate: new Date(),
				currencyCode: 'USD',
				invoiceType: 'INVOICE',
				pdfPath: upload.path,
				status: 'synced',
				syncedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date()
			});
		}

		return { success: true, invoiceId };
	}
);

/** Bulk download Google Ads invoices from links extracted via browser console script */
export const bulkDownloadGoogleInvoices = command(
	v.object({
		customerId: v.pipe(v.string(), v.minLength(1)),
		links: v.array(v.object({
			url: v.pipe(v.string(), v.minLength(1)),
			invoiceId: v.optional(v.string()),
			date: v.optional(v.string()),
			amount: v.optional(v.string())
		}))
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

		const [integration] = await db
			.select()
			.from(table.googleAdsIntegration)
			.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)))
			.limit(1);

		if (!integration) throw new Error('Integrarea Google Ads nu este configurată');

		const { getDecryptedGoogleCookies } = await import('$lib/server/google-ads/google-cookies');
		const cookies = await getDecryptedGoogleCookies(integration.id, tenantId);
		if (!cookies) throw new Error('Cookies Google nu sunt configurate');

		// Try to get OAuth access token for Bearer auth (primary method)
		let accessToken: string | null = null;
		try {
			const { getAuthenticatedClient } = await import('$lib/server/google-ads/auth');
			const authResult = await getAuthenticatedClient(tenantId);
			if (authResult) {
				accessToken = (await authResult.oauth2Client.getAccessToken()).token || null;
			}
		} catch { /* proceed without Bearer token */ }

		const { downloadGoogleInvoicesFromLinks } = await import('$lib/server/google-ads/invoice-downloader');
		return await downloadGoogleInvoicesFromLinks(tenantId, data.customerId, data.links, cookies, accessToken);
	}
);

/** Save Google session cookies for cookie-based PDF downloading */
export const setGoogleAdsCookies = command(
	v.object({
		cookiesJson: v.pipe(v.string(), v.minLength(1))
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

		// Find the integration for this tenant
		const [integration] = await db
			.select({ id: table.googleAdsIntegration.id })
			.from(table.googleAdsIntegration)
			.where(eq(table.googleAdsIntegration.tenantId, tenantId))
			.limit(1);

		if (!integration) {
			throw new Error('Integrarea Google Ads nu este configurată');
		}

		await saveGoogleSessionCookies(integration.id, tenantId, data.cookiesJson);
		return { success: true };
	}
);

/** Clear Google session cookies */
export const clearGoogleAdsCookies = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const tenantId = event.locals.tenant.id;

	const [integration] = await db
		.select({ id: table.googleAdsIntegration.id })
		.from(table.googleAdsIntegration)
		.where(eq(table.googleAdsIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		throw new Error('Integrarea Google Ads nu este configurată');
	}

	await clearGoogleSession(integration.id, tenantId);
	return { success: true };
});
