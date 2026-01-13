import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { KeezClient } from '$lib/server/plugins/keez/client';
import { encrypt, decrypt } from '$lib/server/plugins/keez/crypto';
import {
	mapInvoiceToKeez,
	mapKeezInvoiceToCRM,
	mapKeezPartnerToClient,
	mapKeezDetailsToLineItems
} from '$lib/server/plugins/keez/mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';

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

		// Encrypt secret
		const encryptedSecret = encrypt(event.locals.tenant.id, data.secret);

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
			lastSyncAt: table.keezIntegration.lastSyncAt
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

	return {
		connected: true,
		isActive: integration.isActive,
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		lastSyncAt: integration.lastSyncAt
	};
});

export const syncInvoiceToKeez = command(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
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

	// Decrypt secret
	const secret = decrypt(event.locals.tenant.id, integration.secret);

	// Create Keez client
	const keezClient = new KeezClient({
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		secret
	});

	// Use existing external ID or generate one
	const externalId = invoice.keezExternalId || invoice.id;

	// Map and create invoice
	const keezInvoice = mapInvoiceToKeez({ ...invoice, lineItems }, client, tenant, externalId);

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

	// Extract and update currency from Keez
	if (keezInvoiceData?.currency || keezInvoiceHeader?.currency) {
		const keezCurrency = keezInvoiceData?.currency || keezInvoiceHeader?.currency;
		if (keezCurrency && keezCurrency !== invoice.currency) {
			updateData.currency = keezCurrency;
		}
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

	// Update status based on remainingAmount
	if (keezInvoiceHeader?.remainingAmount !== undefined) {
		const remainingAmountCents = Math.round(keezInvoiceHeader.remainingAmount * 100);
		
		if (remainingAmountCents === 0) {
			// Invoice is fully paid
			updateData.status = 'paid';
			// Set paidDate if not already set
			if (!invoice.paidDate) {
				updateData.paidDate = new Date();
			}
		} else if (remainingAmountCents > 0) {
			// Invoice has remaining amount - check if overdue
			const dueDate = parsedDueDate || invoice.dueDate;
			if (dueDate && dueDate < new Date()) {
				updateData.status = 'overdue';
			} else {
				updateData.status = 'sent';
			}
		}
	} else if (keezInvoiceHeader?.status) {
		// Fallback to Keez status if remainingAmount is not available
		if (keezInvoiceHeader.status === 'Cancelled') {
			updateData.status = 'cancelled';
		} else if (keezInvoiceHeader.status === 'Valid') {
			const dueDate = parsedDueDate || invoice.dueDate;
			if (dueDate && dueDate < new Date()) {
				updateData.status = 'overdue';
			} else {
				updateData.status = 'sent';
			}
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
			// Use currency amounts if available, otherwise use RON amounts
			const netAmount = detail.netAmountCurrency ?? detail.netAmount ?? 0;
			const vatAmount = detail.vatAmountCurrency ?? detail.vatAmount ?? 0;
			const grossAmount = detail.grossAmountCurrency ?? detail.grossAmount ?? 0;

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

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Get invoices from Keez
		const response = await keezClient.getInvoices({
			offset: filters.offset,
			count: filters.count || 100,
			filter: filters.filter
		});

		// Debug: Log first invoice header structure for debugging
		if (response.data && response.data.length > 0) {
			console.log(`[Keez] First invoice header structure:`, JSON.stringify(response.data[0], null, 2));
		}

		let imported = 0;
		let skipped = 0;

		// Import each invoice
		for (const invoiceHeader of response.data || []) {
			try {
				// Check if invoice already exists
				const [existing] = await db
					.select()
					.from(table.invoice)
					.where(eq(table.invoice.keezExternalId, invoiceHeader.externalId))
					.limit(1);

				// Get full invoice details
				const keezInvoice = await keezClient.getInvoice(invoiceHeader.externalId);

				// If invoice exists, update it with latest data from Keez
				if (existing) {
					// Helper function to parse Keez date format (YYYYMMDD as number or string)
					const parseKeezDate = (dateValue: string | number | undefined): Date | null => {
						if (dateValue === null || dateValue === undefined) {
							return null;
						}
						
						try {
							// Handle numeric format (YYYYMMDD) from Keez API
							if (typeof dateValue === 'number') {
								const dateNum = dateValue;
								if (dateNum >= 10000101 && dateNum <= 99991231) {
									const dateStr = String(dateNum);
									const year = parseInt(dateStr.substring(0, 4), 10);
									const month = parseInt(dateStr.substring(4, 6), 10) - 1;
									const day = parseInt(dateStr.substring(6, 8), 10);
									
									const date = new Date(year, month, day);
									if (!isNaN(date.getTime()) && date.getFullYear() === year) {
										return date;
									}
								}
								return null;
							}
							
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

					// Parse dates from header
					const issueDateSource = invoiceHeader.documentDate || invoiceHeader.issueDate || keezInvoice.issueDate;
					const parsedIssueDate = parseKeezDate(issueDateSource);
					const dueDateSource = invoiceHeader.dueDate || keezInvoice.dueDate;
					const parsedDueDate = parseKeezDate(dueDateSource);

					// Determine status based on remainingAmount
					let invoiceStatus: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' = existing.status as any;
					
					if (invoiceHeader.remainingAmount !== undefined) {
						const remainingAmountCents = Math.round(invoiceHeader.remainingAmount * 100);
						
						if (remainingAmountCents === 0) {
							invoiceStatus = 'paid';
						} else if (remainingAmountCents > 0) {
							const dueDate = parsedDueDate || existing.dueDate;
							if (dueDate && dueDate < new Date()) {
								invoiceStatus = 'overdue';
							} else {
								invoiceStatus = 'sent';
							}
						}
					}

					// Update existing invoice with dates and status
					const updateData: any = {
						updatedAt: new Date()
					};

					if (parsedIssueDate) {
						updateData.issueDate = parsedIssueDate;
					}
					if (parsedDueDate) {
						updateData.dueDate = parsedDueDate;
					}
					if (invoiceStatus !== existing.status) {
						updateData.status = invoiceStatus;
					}
					if (invoiceStatus === 'paid' && !existing.paidDate) {
						updateData.paidDate = new Date();
					}

					// Update invoice number if changed
					if (invoiceHeader.series && invoiceHeader.number) {
						const newInvoiceNumber = `${invoiceHeader.series} ${invoiceHeader.number}`;
						if (newInvoiceNumber !== existing.invoiceNumber) {
							updateData.invoiceNumber = newInvoiceNumber;
						}
					}

					// Update currency if changed
					if (invoiceHeader.currency && invoiceHeader.currency !== existing.currency) {
						updateData.currency = invoiceHeader.currency;
					}

					await db
						.update(table.invoice)
						.set(updateData)
						.where(eq(table.invoice.id, existing.id));

					skipped++;
					continue;
				}

				// Find or create client
				let clientId: string | null = null;
				if (keezInvoice.partner?.partnerName) {
					const [existingClient] = await db
						.select()
						.from(table.client)
						.where(
							and(
								eq(table.client.name, keezInvoice.partner.partnerName),
								eq(table.client.tenantId, event.locals.tenant.id)
							)
						)
						.limit(1);

					if (existingClient) {
						clientId = existingClient.id;
					} else if (keezInvoice.partner) {
						// Create new client
						const newClientId = generateClientId();
						const clientData = mapKeezPartnerToClient(keezInvoice.partner, event.locals.tenant.id);
						await db.insert(table.client).values({
							id: newClientId,
							...clientData
						});
						clientId = newClientId;
					}
				}

				if (!clientId) {
					skipped++;
					continue; // Skip if no client
				}

				// Map invoice to CRM format
				const invoiceData = mapKeezInvoiceToCRM(
					keezInvoice,
					invoiceHeader,
					event.locals.tenant.id,
					clientId,
					event.locals.user.id
				);

				// Extract lineItems before inserting invoice
				const { lineItems, ...invoiceInsertData } = invoiceData;

				// Ensure required fields are set
				if (!invoiceInsertData.tenantId) {
					invoiceInsertData.tenantId = event.locals.tenant.id;
				}
				if (!invoiceInsertData.clientId) {
					invoiceInsertData.clientId = clientId || '';
				}

				// Create invoice
				const invoiceId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				
				await db.insert(table.invoice).values({
					id: invoiceId,
					tenantId: invoiceInsertData.tenantId,
					clientId: invoiceInsertData.clientId,
					invoiceNumber: invoiceInsertData.invoiceNumber || invoiceHeader.externalId,
					status: invoiceInsertData.status || 'sent',
					amount: invoiceInsertData.amount || 0,
					taxRate: invoiceInsertData.taxRate || 1900,
					taxAmount: invoiceInsertData.taxAmount || 0,
					totalAmount: invoiceInsertData.totalAmount || 0,
					currency: invoiceInsertData.currency || 'RON',
					// Only use fallback if issueDate is explicitly null/undefined, not if it's a valid date
					issueDate: invoiceInsertData.issueDate ?? new Date(),
					dueDate: invoiceInsertData.dueDate ?? null,
					notes: invoiceInsertData.notes || null,
					keezInvoiceId: invoiceInsertData.keezInvoiceId || null,
					keezExternalId: invoiceInsertData.keezExternalId || null,
					createdByUserId: invoiceInsertData.createdByUserId || event.locals.user.id
				});

				// Create line items
				if (lineItems && lineItems.length > 0) {
					const lineItemsToInsert = lineItems.map((item) => ({
						...item,
						invoiceId,
						id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))
					}));
					await db.insert(table.invoiceLineItem).values(lineItemsToInsert);
				}

				// Create sync record
				const syncId = generateSyncId();
				await db.insert(table.keezInvoiceSync).values({
					id: syncId,
					invoiceId,
					tenantId: event.locals.tenant.id,
					keezInvoiceId: invoiceHeader.externalId,
					keezExternalId: invoiceHeader.externalId,
					syncDirection: 'pull',
					syncStatus: 'synced',
					lastSyncedAt: new Date()
				});

				imported++;
			} catch (error) {
				console.error(`[Keez] Failed to import invoice ${invoiceHeader.externalId}:`, error);
				skipped++;
			}
		}

		// Update integration last sync time
		await db
			.update(table.keezIntegration)
			.set({
				lastSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));

		return { success: true, imported, skipped };
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

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Get partners from Keez
		const response = await keezClient.getPartners({
			offset: filters.offset,
			count: filters.count || 100,
			filter: filters.filter
		});

		let imported = 0;
		let skipped = 0;

		// Import each partner
		for (const partner of response.partners || []) {
			try {
				// Check if client already exists by partnerName (KeezPartner uses partnerName, not externalId)
				if (partner.partnerName) {
					const [existing] = await db
						.select()
						.from(table.client)
						.where(
							and(
								eq(table.client.name, partner.partnerName),
								eq(table.client.tenantId, event.locals.tenant.id)
							)
						)
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
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
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

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Get PDF
		const pdfBuffer = await keezClient.downloadInvoicePDF(data.keezInvoiceId);

		// Convert to base64 for transmission
		const base64 = Buffer.from(pdfBuffer).toString('base64');

		return { pdf: base64 };
	}
);

export const validateInvoiceInKeez = command(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
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

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		await keezClient.validateInvoice(data.keezInvoiceId);

		return { success: true };
	}
);

export const sendInvoiceToEFactura = command(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
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

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		await keezClient.sendToEFactura(data.keezInvoiceId);

		return { success: true };
	}
);

export const cancelInvoiceInKeez = command(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
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

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		await keezClient.cancelInvoice(data.keezInvoiceId);

		return { success: true };
	}
);
