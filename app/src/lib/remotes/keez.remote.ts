import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, desc } from 'drizzle-orm';
import { KeezClient, type KeezPartner } from '$lib/server/plugins/keez/client';
import { encrypt, decrypt, encryptVerified, DecryptionError } from '$lib/server/plugins/keez/crypto';
import { createKeezClientForTenant, KeezCredentialsCorruptError } from '$lib/server/plugins/keez/factory';
import { syncKeezInvoicesForTenant } from '$lib/server/plugins/keez/sync';
import { cancelPendingKeezRetry } from '$lib/server/scheduler/tasks/keez-invoice-sync-retry';
import {
	mapInvoiceToKeez,
	mapKeezInvoiceToCRM,
	mapKeezPartnerToClient,
	mapKeezDetailsToLineItems,
	findOrCreateClientForKeezPartner
} from '$lib/server/plugins/keez/mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logWarning } from '$lib/server/logger';
import { env } from '$env/dynamic/private';

function generateIntegrationId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const connectKeez = command(
	v.object({
		clientEid: v.pipe(v.string(), v.minLength(1)),
		applicationId: v.pipe(v.string(), v.minLength(1)),
		secret: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can connect Keez
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Test connection
		const client = new KeezClient({
			clientEid: data.clientEid,
			applicationId: data.applicationId,
			secret: data.secret
		});

		// Test API call by getting access token
		try {
			await client.getAccessToken();
		} catch (error) {
			console.error('Failed to connect to Keez:', error);
			throw new Error(
				`Failed to connect to Keez: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		// Encrypt secret with round-trip verification
		const encryptedSecret = encryptVerified(event.locals.tenant.id, data.secret);

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.keezIntegration)
			.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing integration
			await db
				.update(table.keezIntegration)
				.set({
					clientEid: data.clientEid,
					applicationId: data.applicationId,
					secret: encryptedSecret,
					isActive: true,
					accessToken: null,
					tokenExpiresAt: null,
					updatedAt: new Date()
				})
				.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));
		} else {
			// Create new integration
			const integrationId = generateIntegrationId();
			await db.insert(table.keezIntegration).values({
				id: integrationId,
				tenantId: event.locals.tenant.id,
				clientEid: data.clientEid,
				applicationId: data.applicationId,
				secret: encryptedSecret,
				isActive: true
			});
		}

		return { success: true };
	}
);

export const disconnectKeez = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can disconnect Keez
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	await db
		.update(table.keezIntegration)
		.set({
			isActive: false,
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));

	return { success: true };
});

export const getKeezStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [integration] = await db
		.select({
			clientEid: table.keezIntegration.clientEid,
			applicationId: table.keezIntegration.applicationId,
			isActive: table.keezIntegration.isActive,
			lastSyncAt: table.keezIntegration.lastSyncAt,
			isDegraded: table.keezIntegration.isDegraded,
			lastFailureReason: table.keezIntegration.lastFailureReason,
			secret: table.keezIntegration.secret
		})
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!integration) {
		return {
			connected: false,
			isActive: false
		};
	}

	// Check if stored credentials can be decrypted
	let credentialsValid = true;
	try {
		decrypt(event.locals.tenant.id, integration.secret);
	} catch (error) {
		credentialsValid = false;
		logWarning('keez', 'Credential decryption failed — user will see reconnect prompt', {
			tenantId: event.locals.tenant.id,
			metadata: {
				errorMessage: error instanceof Error ? error.message : String(error),
				secretFormat: integration.secret?.split(':').length ?? 0,
				hasEncryptionSecret: !!env.ENCRYPTION_SECRET,
				encryptionSecretLength: env.ENCRYPTION_SECRET?.length ?? 0
			}
		});
	}

	return {
		connected: true,
		isActive: integration.isActive,
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		lastSyncAt: integration.lastSyncAt,
		isDegraded: integration.isDegraded,
		lastFailureReason: integration.lastFailureReason,
		credentialsValid
	};
});

export const getKeezSyncHistory = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const syncRecords = await db
		.select({
			id: table.keezInvoiceSync.id,
			invoiceId: table.keezInvoiceSync.invoiceId,
			invoiceNumber: table.invoice.invoiceNumber,
			keezExternalId: table.keezInvoiceSync.keezExternalId,
			syncDirection: table.keezInvoiceSync.syncDirection,
			syncStatus: table.keezInvoiceSync.syncStatus,
			lastSyncedAt: table.keezInvoiceSync.lastSyncedAt,
			errorMessage: table.keezInvoiceSync.errorMessage
		})
		.from(table.keezInvoiceSync)
		.leftJoin(table.invoice, eq(table.invoice.id, table.keezInvoiceSync.invoiceId))
		.where(eq(table.keezInvoiceSync.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.keezInvoiceSync.lastSyncedAt))
		.limit(20);

	return syncRecords;
});

export const getKeezNextInvoiceNumber = query(
	v.object({
		series: v.string()
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		if (!filters.series) {
			return { nextNumber: null };
		}

		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			return { nextNumber: null };
		}

		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);
		const nextNumber = await keezClient.getNextInvoiceNumber(filters.series);

		return { nextNumber };
	}
);

export const getKeezItems = query(
	v.object({
		offset: v.optional(v.number()),
		count: v.optional(v.number()),
		filter: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			return {
				data: [],
				total: 0,
				recordsCount: 0
			};
		}

		// Create Keez client with DB token cache
		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);

		// Get items from Keez
		const response = await keezClient.getItems({
			offset: filters.offset,
			count: filters.count || 100,
			filter: filters.filter
		});

		// Normalize and filter items: exclude inactive, missing name, or missing externalId
		const rawCount = (response || []).length;
		const items = (response || [])
			.filter((item) => item.isActive && item.name && item.externalId)
			.map((item) => ({
				...item,
				lastPrice: item.lastPrice ?? 0,
				vatRate: item.vatRate ?? 0
			}));

		return {
			data: items,
			total: rawCount,
			recordsCount: items.length
		};
	}
);

export const createKeezItem = command(
	v.object({
		name: v.pipe(v.string(), v.minLength(1)),
		code: v.optional(v.string()),
		description: v.optional(v.string()),
		currencyCode: v.optional(v.string()),
		measureUnitId: v.optional(v.number()),
		vatRate: v.optional(v.number()),
		isActive: v.optional(v.boolean()),
		categoryExternalId: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Create Keez client with DB token cache
		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);

		// Create item in Keez
		const response = await keezClient.createItem({
			name: data.name,
			code: data.code || data.name,
			description: data.description,
			currencyCode: data.currencyCode || 'RON',
			measureUnitId: data.measureUnitId ?? 1,
			vatRate: data.vatRate,
			isActive: data.isActive !== undefined ? data.isActive : true,
			categoryExternalId: data.categoryExternalId || 'MISCSRV'
		});

		return {
			success: true,
			externalId: response.externalId
		};
	}
);

export const syncInvoiceToKeez = command(v.object({ invoiceId: v.pipe(v.string(), v.minLength(1)) }), async (data) => {
	const invoiceId = data.invoiceId;
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role === 'viewer') {
		throw new Error('Insufficient permissions');
	}

	// Get invoice
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get integration
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(
				eq(table.keezIntegration.tenantId, event.locals.tenant.id),
				eq(table.keezIntegration.isActive, true)
			)
		)
		.limit(1);

	if (!integration) {
		throw new Error('Keez integration not connected');
	}

	// Get invoice settings
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	// Get tenant and client
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, event.locals.tenant.id))
		.limit(1);
	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!tenant || !client) {
		throw new Error('Tenant or client not found');
	}

	// Get line items
	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

	// Create Keez client with DB token cache
	const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);

	// Use existing external ID or generate one
	const externalId = invoice.keezExternalId || invoice.id;

	// Ensure all items exist in Keez before creating invoice
	const itemExternalIds = new Map<string, string>();
	const vatPercent = invoice.taxRate ? invoice.taxRate / 100 : 19;
	const currency = invoice.currency || settings?.defaultCurrency || 'RON';

	for (const lineItem of lineItems) {
		const itemCode = `CRM_${lineItem.id}`;
		let keezItem = await keezClient.getItemByCode(itemCode);

		if (!keezItem) {
			try {
				const newItem = await keezClient.createItem({
					code: itemCode,
					name: lineItem.description || 'Item',
					description: lineItem.description || undefined,
					currencyCode: currency,
					measureUnitId: 1,
					vatRate: vatPercent,
					isActive: true,
					categoryExternalId: 'MISCSRV'
				});
				itemExternalIds.set(lineItem.id, newItem.externalId);
			} catch (itemError) {
				console.error(`[Keez] Failed to create item ${itemCode}:`, itemError);
				itemExternalIds.set(lineItem.id, lineItem.id);
			}
		} else {
			itemExternalIds.set(lineItem.id, keezItem.externalId || lineItem.id);
		}
	}

	// Get the latest invoice number from Keez for this series
	let invoiceSeries: string | undefined;
	let invoiceNumber: string | undefined;
	
	if (settings?.keezSeries) {
		invoiceSeries = settings.keezSeries.trim();
		try {
			const nextNumber = await keezClient.getNextInvoiceNumber(invoiceSeries);
			if (nextNumber !== null) {
				invoiceNumber = String(nextNumber);
			} else if (invoice.invoiceNumber) {
				const match = invoice.invoiceNumber.match(/(\d+)$/);
				if (match) {
					invoiceNumber = match[1];
				}
			}
			if (!invoiceNumber && settings.keezStartNumber) {
				invoiceNumber = settings.keezStartNumber;
			}
		} catch (error) {
			console.warn(`[Keez] Failed to get next invoice number from Keez:`, error);
			if (invoice.invoiceNumber) {
				const match = invoice.invoiceNumber.match(/(\d+)$/);
				if (match) {
					invoiceNumber = match[1];
				}
			}
			if (!invoiceNumber && settings.keezStartNumber) {
				invoiceNumber = settings.keezStartNumber;
			}
		}
	}

	// Map and create invoice
	const keezInvoice = await mapInvoiceToKeez(
		{ ...invoice, lineItems },
		client,
		tenant,
		externalId,
		settings,
		itemExternalIds
	);

	// Override series and number with the ones we got from Keez
	if (invoiceSeries && invoiceNumber) {
		keezInvoice.series = invoiceSeries;
		keezInvoice.number = parseInt(invoiceNumber, 10);
	}

	const response = await keezClient.createInvoice(keezInvoice);

	// Fetch the created invoice from Keez to get all actual data (number, series, VAT, currency, dates, etc.)
	let keezInvoiceData: any = null;
	let keezInvoiceHeader: any = null;
	try {
		// Get full invoice data from Keez
		keezInvoiceData = await keezClient.getInvoice(response.externalId);
		
		// Also try to get invoice from list to get header with series/number
		try {
			const invoicesList = await keezClient.getInvoices({
				count: 100,
				filter: `externalId eq '${response.externalId}'`
			});
			
			if (invoicesList.data && invoicesList.data.length > 0) {
				keezInvoiceHeader = invoicesList.data[0];
			}
		} catch (listError) {
			console.warn(`[Keez] Could not fetch invoice from list:`, listError);
		}
	} catch (error) {
		console.warn(`[Keez] Could not fetch invoice ${response.externalId} from Keez:`, error);
	}

	// Calculate totals and extract data from Keez response
	let updateData: any = {
		keezInvoiceId: response.externalId,
		keezExternalId: response.externalId,
		updatedAt: new Date()
	};

	// Extract and update invoice number from Keez (series + number)
	const keezSeries = keezInvoiceHeader?.series || keezInvoiceData?.series;
	const keezNumber = keezInvoiceHeader?.number || keezInvoiceData?.number;
	
	if (keezSeries && keezNumber) {
		// Format: "SERIES NUMBER" (e.g., "OTS 520")
		const keezInvoiceNumber = `${keezSeries} ${keezNumber}`;
		if (keezInvoiceNumber !== invoice.invoiceNumber) {
			updateData.invoiceNumber = keezInvoiceNumber;
		}
	} else if (keezNumber) {
		// If only number is available, use it with series from settings
		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);
		
		if (invoiceSettings?.keezSeries) {
			const keezInvoiceNumber = `${invoiceSettings.keezSeries} ${keezNumber}`;
			if (keezInvoiceNumber !== invoice.invoiceNumber) {
				updateData.invoiceNumber = keezInvoiceNumber;
			}
		}
	}

	// Currency logic for push-pull-back
	const keezOriginalCurrency = keezInvoiceData?.currencyCode || keezInvoiceData?.currency || keezInvoiceHeader?.currencyCode || keezInvoiceHeader?.currency;
	const pushHasRealExchangeRate = keezInvoiceData?.exchangeRate && keezInvoiceData.exchangeRate > 1;
	const pushIsNonRon = keezOriginalCurrency && keezOriginalCurrency !== 'RON';
	const pushDetailHasRonBreakdown = !!keezInvoiceData?.invoiceDetails?.[0]?.netAmountCurrency;

	if (pushIsNonRon) {
		if (pushHasRealExchangeRate || pushDetailHasRonBreakdown) {
			updateData.currency = 'RON';
			updateData.invoiceCurrency = keezOriginalCurrency;
			if (keezInvoiceData?.exchangeRate) {
				updateData.exchangeRate = String(keezInvoiceData.exchangeRate);
			}
		} else {
			updateData.currency = keezOriginalCurrency;
			updateData.invoiceCurrency = null;
			updateData.exchangeRate = null;
		}
	} else if (invoice.currency !== 'RON') {
		updateData.currency = 'RON';
	}

	// Helper function to parse Keez date format (YYYYMMDD as number or string)
	const parseKeezDate = (dateValue: string | number | undefined): Date | null => {
		if (dateValue === null || dateValue === undefined) {
			return null;
		}
		
		try {
			// Handle numeric format (YYYYMMDD) from Keez API
			if (typeof dateValue === 'number') {
				const dateNum = dateValue;
				// Check if it's a valid YYYYMMDD format (8 digits)
				if (dateNum >= 10000101 && dateNum <= 99991231) {
					const dateStr = String(dateNum);
					const year = parseInt(dateStr.substring(0, 4), 10);
					const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-indexed
					const day = parseInt(dateStr.substring(6, 8), 10);
					
					const date = new Date(year, month, day);
					if (!isNaN(date.getTime()) && date.getFullYear() === year) {
						return date;
					}
				}
				return null;
			}
			
			// Handle string format
			const dateStrTrimmed = String(dateValue).trim();
			if (!dateStrTrimmed || dateStrTrimmed === 'null' || dateStrTrimmed === 'undefined' || dateStrTrimmed === '0000-00-00') {
				return null;
			}
			
			const date = new Date(dateStrTrimmed);
			if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
				return date;
			}
			return null;
		} catch (e) {
			return null;
		}
	};

	// Extract and update dates from Keez
	// Use documentDate from header (invoice list) if available, otherwise use issueDate from invoice details
	const issueDateSource = keezInvoiceHeader?.documentDate || keezInvoiceHeader?.issueDate || keezInvoiceData?.issueDate;
	const parsedIssueDate = parseKeezDate(issueDateSource);
	if (parsedIssueDate) {
		updateData.issueDate = parsedIssueDate;
	} else if (issueDateSource) {
		console.warn(`[Keez] Invalid issue date from Keez:`, issueDateSource);
	}

	// Use dueDate from header if available, otherwise from invoice details
	const dueDateSource = keezInvoiceHeader?.dueDate || keezInvoiceData?.dueDate;
	const parsedDueDate = parseKeezDate(dueDateSource);
	if (parsedDueDate) {
		updateData.dueDate = parsedDueDate;
	} else if (dueDateSource) {
		console.warn(`[Keez] Invalid due date from Keez:`, dueDateSource);
	}

	// Update status based on Keez status + remainingAmount
	const keezStatus = keezInvoiceHeader?.status || keezInvoiceData?.status;
	if (keezStatus) {
		updateData.keezStatus = keezStatus;
	}

	if (keezStatus === 'Cancelled') {
		updateData.status = 'cancelled';
	} else if (keezStatus === 'Draft') {
		// Proforma — keep as draft, do NOT mark as paid even if remainingAmount is 0
		updateData.status = 'draft';
	} else if (keezStatus === 'Valid') {
		// Validated fiscal invoice — check remainingAmount for payment status
		if (keezInvoiceHeader?.remainingAmount !== undefined) {
			const remainingAmountCents = Math.round(keezInvoiceHeader.remainingAmount * 100);
			updateData.remainingAmount = remainingAmountCents;
			const invoiceTotal = invoice.totalAmount || 0;
			if (remainingAmountCents === 0) {
				updateData.status = 'paid';
				if (!invoice.paidDate) {
					updateData.paidDate = new Date();
				}
			} else if (remainingAmountCents > 0 && remainingAmountCents < invoiceTotal) {
				updateData.status = 'partially_paid';
			} else if (remainingAmountCents > 0) {
				const dueDate = parsedDueDate || invoice.dueDate;
				if (dueDate && dueDate < new Date()) {
					updateData.status = 'overdue';
				} else {
					updateData.status = 'sent';
				}
			}
		} else {
			updateData.status = 'sent';
		}
	}

	// Extract and update VAT rate and amounts from Keez invoice details
	if (keezInvoiceData?.invoiceDetails && Array.isArray(keezInvoiceData.invoiceDetails) && keezInvoiceData.invoiceDetails.length > 0) {
		// Calculate totals from Keez details
		let keezNetAmount = 0;
		let keezVatAmount = 0;
		let keezGrossAmount = 0;
		let keezTaxRate: number | null = null;

		for (const detail of keezInvoiceData.invoiceDetails) {
			// Always use RON amounts (netAmount is always RON per Keez API)
			const netAmount = detail.netAmount ?? 0;
			const vatAmount = detail.vatAmount ?? 0;
			const grossAmount = detail.grossAmount ?? 0;

			keezNetAmount += netAmount;
			keezVatAmount += vatAmount;
			keezGrossAmount += grossAmount;

			// Get VAT rate from first detail (assuming all details have same VAT rate)
			if (keezTaxRate === null && detail.vatPercent !== undefined && detail.vatPercent !== null) {
				keezTaxRate = detail.vatPercent;
			}
		}

		// Convert to cents and update
		updateData.amount = Math.round(keezNetAmount * 100);
		updateData.taxAmount = Math.round(keezVatAmount * 100);
		updateData.totalAmount = Math.round(keezGrossAmount * 100);

		// Update tax rate (convert from percentage to cents: 19% -> 1900)
		if (keezTaxRate !== null) {
			updateData.taxRate = Math.round(keezTaxRate * 100);
		}
	}

	// Update invoice with all Keez data
	await db
		.update(table.invoice)
		.set(updateData)
		.where(eq(table.invoice.id, invoiceId));

	// Create/update sync record
	const [existingSync] = await db
		.select()
		.from(table.keezInvoiceSync)
		.where(eq(table.keezInvoiceSync.invoiceId, invoiceId))
		.limit(1);

	if (existingSync) {
		await db
			.update(table.keezInvoiceSync)
			.set({
				keezInvoiceId: response.externalId,
				keezExternalId: response.externalId,
				syncStatus: 'synced',
				lastSyncedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.keezInvoiceSync.id, existingSync.id));
	} else {
		const syncId = generateSyncId();
		await db.insert(table.keezInvoiceSync).values({
			id: syncId,
			invoiceId,
			tenantId: event.locals.tenant.id,
			keezInvoiceId: response.externalId,
			keezExternalId: response.externalId,
			syncDirection: 'push',
			syncStatus: 'synced',
			lastSyncedAt: new Date()
		});
	}

	// Update integration last sync time
	await db
		.update(table.keezIntegration)
		.set({
			lastSyncAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));

	return { success: true, externalId: response.externalId };
});

export const syncInvoicesFromKeez = command(
	v.object({
		offset: v.optional(v.number()),
		count: v.optional(v.number()),
		filter: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		// Cancel any pending scheduler retry so we don't do the work twice.
		await cancelPendingKeezRetry(event.locals.tenant.id);

		const result = await syncKeezInvoicesForTenant(event.locals.tenant.id, {
			offset: filters.offset,
			count: filters.count ?? 500, // matches scheduler — pagination loop fetches all pages anyway; this is just the per-page size
			filter: filters.filter
		});

		return {
			success: true,
			imported: result.imported,
			updated: result.updated,
			skipped: result.skipped,
			errors: result.errors
		};
	}
);


export const importClientsFromKeez = command(
	v.object({
		offset: v.optional(v.number()),
		count: v.optional(v.number()),
		filter: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Create Keez client with DB token cache
		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);

		let imported = 0;
		let skipped = 0;

		// Collect unique partners to import.
		// Try the dedicated partners endpoint first; if it returns 404 (endpoint may not exist in some
		// Keez API versions), fall back to extracting unique partners from invoice data.
		let partnersToImport: KeezPartner[] = [];

		try {
			const partnersResponse = await keezClient.getPartners({
				offset: filters.offset,
				count: filters.count || 100,
				filter: filters.filter
			});
			partnersToImport = partnersResponse.partners || [];
		} catch (e) {
			if (e instanceof Error && e.message === 'Not found') {
				// Partners endpoint not available — extract unique partners from invoice full data
				console.log('[Keez] Partners endpoint not available, extracting clients from invoice data');
				const invoiceList = await keezClient.getInvoices({
					count: filters.count || 100,
					offset: filters.offset
				});
				const seenPartnerNames = new Set<string>();
				for (const header of invoiceList.data || []) {
					const headerPartnerName = header.partner?.name;
					if (headerPartnerName && !seenPartnerNames.has(headerPartnerName)) {
						seenPartnerNames.add(headerPartnerName);
						try {
							const fullInvoice = await keezClient.getInvoice(header.externalId);
							if (fullInvoice.partner?.partnerName) {
								partnersToImport.push(fullInvoice.partner);
							}
						} catch {
							// Skip invoices where full details can't be fetched
						}
					}
				}
			} else {
				throw e;
			}
		}

		// Import each partner
		for (const partner of partnersToImport) {
			try {
				// Check if client already exists — match on CUI first, then on name
				if (partner.identificationNumber || partner.partnerName) {
					const conditions = [eq(table.client.tenantId, event.locals.tenant.id)];
					if (partner.identificationNumber) {
						conditions.push(eq(table.client.cui, partner.identificationNumber));
					} else {
						conditions.push(
							or(
								eq(table.client.name, partner.partnerName!),
								eq(table.client.businessName, partner.partnerName!)
							)!
						);
					}
					const [existing] = await db
						.select()
						.from(table.client)
						.where(and(...conditions))
						.limit(1);

					if (existing) {
						skipped++;
						continue;
					}
				}

				// Create new client
				const clientId = generateClientId();
				const clientData = mapKeezPartnerToClient(partner, event.locals.tenant.id);
				await db.insert(table.client).values({
					id: clientId,
					...clientData
				});

				// Create sync record (use partnerName as externalId if no externalId field exists)
				// Note: KeezPartner doesn't have externalId, we use partnerName as identifier
				if (partner.partnerName) {
					const syncId = generateSyncId();
					await db.insert(table.keezClientSync).values({
						id: syncId,
						clientId,
						tenantId: event.locals.tenant.id,
						keezPartnerId: partner.partnerName,
						keezExternalId: partner.partnerName,
						syncStatus: 'synced',
						lastSyncedAt: new Date()
					});
				}

				imported++;
			} catch (error) {
				console.error(
					`[Keez] Failed to import partner ${partner.partnerName || 'unknown'}:`,
					error
				);
				skipped++;
			}
		}

		return { success: true, imported, skipped };
	}
);

export const getInvoicePDFFromKeez = query(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) throw new Error('Invoice not found');
		if (!invoice.keezExternalId) throw new Error('Invoice is not synced with Keez');

		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) throw new Error('Keez integration not connected');

		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);
		const pdfBuffer = await keezClient.downloadInvoicePDF(invoice.keezExternalId);
		const base64 = Buffer.from(pdfBuffer).toString('base64');

		return { pdf: base64 };
	}
);

export const sendInvoiceEmailFromKeez = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1)),
		to: v.pipe(v.string(), v.minLength(1)),
		cc: v.optional(v.string()),
		bcc: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) throw new Error('Invoice not found');
		if (!invoice.keezExternalId) throw new Error('Invoice is not synced with Keez');

		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) throw new Error('Keez integration not connected');

		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);
		await keezClient.sendInvoiceEmail(invoice.keezExternalId, {
			to: data.to,
			cc: data.cc,
			bcc: data.bcc
		});

		return { success: true };
	}
);

export const sendInvoiceToEFactura = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) throw new Error('Invoice not found');
		if (!invoice.keezExternalId) throw new Error('Invoice is not synced with Keez');

		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) throw new Error('Keez integration not connected');

		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);
		await keezClient.sendToEFactura(invoice.keezExternalId);

		return { success: true };
	}
);

/**
 * Cancel an invoice. Two paths depending on Keez sync state:
 *   - Synced (keezExternalId set + active integration) → POST /invoices/canceled
 *     on Keez first, then UPDATE local status='cancelled', keezStatus='Cancelled'
 *   - Local-only (no keezExternalId, or no active integration) → UPDATE local
 *     status='cancelled' only
 *
 * Used by the unified "Anulează" UI action for any non-draft invoice. Drafts
 * still go through deleteInvoice; that's enforced in the UI but not here, so
 * cancelling a draft is allowed if called directly.
 */
export const cancelInvoiceInKeez = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) throw new Error('Invoice not found');
		if (invoice.status === 'cancelled') {
			return { success: true, alreadyCancelled: true };
		}

		if (invoice.keezExternalId) {
			const [integration] = await db
				.select()
				.from(table.keezIntegration)
				.where(
					and(
						eq(table.keezIntegration.tenantId, event.locals.tenant.id),
						eq(table.keezIntegration.isActive, true)
					)
				)
				.limit(1);

			if (integration) {
				// Synced + active integration → cancel upstream first, then locally.
				const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);
				await keezClient.cancelInvoice(invoice.keezExternalId);

				await db
					.update(table.invoice)
					.set({
						keezStatus: 'Cancelled',
						status: 'cancelled',
						updatedAt: new Date()
					})
					.where(eq(table.invoice.id, data.invoiceId));

				return { success: true, cancelledOn: 'keez' as const };
			}
			// keezExternalId set but no active integration: fall through to local-only
			// cancel. The next time Keez reconnects + syncs, status will reconcile if
			// the upstream invoice still exists.
		}

		// Local-only path: invoice never synced or integration disconnected.
		await db
			.update(table.invoice)
			.set({
				status: 'cancelled',
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, data.invoiceId));

		return { success: true, cancelledOn: 'local' as const };
	}
);

export const createStornoInKeez = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		// Get invoice and verify it has Keez external ID
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) {
			throw new Error('Invoice not found');
		}

		if (!invoice.keezExternalId) {
			throw new Error('Invoice is not synced with Keez');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Create Keez client with DB token cache
		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);

		const response = await keezClient.createStorno(invoice.keezExternalId);

		return { success: true, stornoExternalId: response.externalId };
	}
);

export const validateInvoiceInKeez = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role === 'viewer') {
			throw new Error('Insufficient permissions');
		}

		// Get invoice and verify it has Keez external ID
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) {
			throw new Error('Invoice not found');
		}

		if (!invoice.keezExternalId) {
			throw new Error('Invoice is not synced with Keez');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Create Keez client with DB token cache
		const keezClient = await createKeezClientForTenant(event.locals.tenant.id, integration);

		await keezClient.validateInvoice(invoice.keezExternalId);

		// Update local invoice: proforma → validated fiscal invoice
		await db
			.update(table.invoice)
			.set({
				keezStatus: 'Valid',
				status: 'sent',
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, data.invoiceId));

		// Auto-propagate number back to WHMCS if the invoice originated there.
		// Fire-and-forget — failure is logged inside pushInvoiceNumberToWhmcs,
		// doesn't abort the Keez-validation success path. Admin can retry
		// manually via pushWhmcsInvoiceNumber from the settings page.
		if (invoice.externalSource === 'whmcs' && invoice.externalInvoiceId) {
			void import('$lib/server/whmcs/push-number-to-whmcs').then(
				({ pushInvoiceNumberToWhmcs }) =>
					pushInvoiceNumberToWhmcs(event.locals.tenant!.id, data.invoiceId)
			);
		}

		return { success: true };
	}
);
