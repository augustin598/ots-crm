import type { HookHandler, InvoiceCreatedEvent, InvoiceUpdatedEvent } from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { createKeezClientForTenant } from './factory';
import { mapInvoiceToKeez, generateNextInvoiceNumber, mapKeezDetailsToLineItems } from './mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Handle invoice created event - auto-sync to Keez
 */
export const onInvoiceCreated: HookHandler<InvoiceCreatedEvent> = async (event) => {
	const { invoice, tenantId } = event;
	console.log(`[Keez] Invoice created event:`, invoice);

	// Check if Keez integration is active for tenant
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);

	if (!integration) {
		return; // No active integration, skip
	}

	// Get invoice settings
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	// Sync when plugin is active (autoSync check is optional - if plugin is active, sync)
	// Only check autoSync if settings exist, otherwise proceed with sync
	if (settings && settings.keezAutoSync === false) {
		// If autoSync is explicitly disabled, respect that
		return;
	}

	// Allow proceeding if the invoice itself has a series (even if keezSeries/keezStartNumber not set in settings)
	const effectiveSeries = settings?.keezSeries || invoice.invoiceSeries;
	if (!effectiveSeries) {
		console.warn(`[Keez] Invoice settings not configured for tenant ${tenantId}: no keezSeries in settings and invoice has no invoiceSeries`);
		return;
	}

	// Get tenant and client data
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	if (!tenant) {
		console.error(`[Keez] Tenant not found: ${tenantId}`);
		return;
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client) {
		console.error(`[Keez] Client not found: ${invoice.clientId}`);
		return;
	}

	// Get line items
	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	// Create Keez client with DB token cache
	const keezClient = await createKeezClientForTenant(tenantId, integration);

	console.log(
		`[Keez] Starting invoice sync for invoice ${invoice.id} with ${lineItems.length} line items`
	);

	// Ensure all items exist in Keez before creating invoice
	const itemExternalIds = new Map<string, string>();
	// Use invoiceCurrency if available, otherwise fall back to currency
	const currency =
		invoice.invoiceCurrency || invoice.currency || settings?.defaultCurrency || 'RON';
	// Default VAT rate for items without specific tax rate
	const defaultVatPercent = invoice.taxRate ? invoice.taxRate / 100 : 19;

	for (const lineItem of lineItems) {
		// If line item already has a Keez external ID (set on recurring invoice template items,
		// copied to generated invoice line items), use it directly — no API call needed.
		if (lineItem.keezItemExternalId) {
			console.log(
				`[Keez] Line item ${lineItem.id} has pre-configured keezItemExternalId: ${lineItem.keezItemExternalId}, using it directly`
			);
			itemExternalIds.set(lineItem.id, lineItem.keezItemExternalId);
			continue;
		}

		// Generate code for item (similar to WHMCS implementation)
		const itemCode = `CRM_${lineItem.id}`;

		console.log(`[Keez] Checking item ${itemCode} for line item ${lineItem.id}`);

		// Use per-item tax rate if available, otherwise use invoice tax rate
		const itemVatPercent = lineItem.taxRate ? lineItem.taxRate / 100 : defaultVatPercent;
		// Use per-item currency if available, otherwise use invoice currency
		const itemCurrency = lineItem.currency || currency;
		// Map unit of measure - Keez uses measureUnitId as number (1 = "Buc")
		let measureUnitId = 1; // Default to "Buc"
		if (lineItem.unitOfMeasure) {
			const unitMap: Record<string, number> = {
				Pcs: 1,
				Buc: 1,
				Hours: 2,
				Days: 3
			};
			measureUnitId = unitMap[lineItem.unitOfMeasure] || 1;
		}

		// Check if item exists in Keez by code
		let keezItem = await keezClient.getItemByCode(itemCode);

		if (!keezItem) {
			// Item doesn't exist, create it
			console.log(`[Keez] Item ${itemCode} not found, creating new item in Keez`);

			try {
				const newItem = await keezClient.createItem({
					code: itemCode,
					name: lineItem.description || 'Item',
					currencyCode: itemCurrency,
					measureUnitId,
					vatRate: itemVatPercent,
					isActive: true,
					categoryExternalId: 'MISCSRV', // Required category (Misc Services)
					categoryName: 'Misc Services',
					isStockable: false
				});

				console.log(`[Keez] Created item ${itemCode} with externalId: ${newItem.externalId}`);
				itemExternalIds.set(lineItem.id, newItem.externalId);
			} catch (itemError) {
				console.error(`[Keez] Failed to create item ${itemCode}:`, itemError);
				// Try to continue with item ID as fallback
				itemExternalIds.set(lineItem.id, lineItem.id);
			}
		} else {
			// Item exists, use its externalId
			console.log(`[Keez] Found existing item ${itemCode} with externalId: ${keezItem.externalId}`);
			itemExternalIds.set(lineItem.id, keezItem.externalId || lineItem.id);
		}
	}

	// If no line items, we'll create a generic item in the mapper
	if (lineItems.length === 0) {
		console.log(
			`[Keez] Invoice ${invoice.id} has no line items, will create generic item in mapper`
		);
	}

	// Generate external ID (use invoice ID or generate one)
	const externalId = invoice.keezExternalId || invoice.id;

	// Get the latest invoice number from Keez for this series to ensure we use the correct next number
	// This is important because other invoices might have been created in Keez since we generated the number
	let invoiceSeries: string | undefined;
	let invoiceNumber: string | undefined;

	// Check if invoice has invoiceSeries that matches (or can substitute for) Keez series
	if (
		invoice.invoiceSeries &&
		(!settings?.keezSeries || invoice.invoiceSeries.trim() === settings.keezSeries.trim())
	) {
		// Invoice series matches Keez series, use it
		invoiceSeries = invoice.invoiceSeries.trim();
		// Extract number from invoiceNumber if it contains the series
		if (invoice.invoiceNumber) {
			// Remove series from invoiceNumber to get just the number (e.g., "OTS 520" -> "520")
			const seriesPattern = invoiceSeries.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const match = invoice.invoiceNumber.match(new RegExp(`${seriesPattern}\\s*(\\d+)`, 'i'));
			if (match) {
				invoiceNumber = match[1];
			} else {
				// Try to extract just the numeric part
				const numMatch = invoice.invoiceNumber.match(/(\d+)$/);
				if (numMatch) {
					invoiceNumber = numMatch[1];
				}
			}
		}
		console.log(
			`[Keez] Using invoice series ${invoiceSeries} and number ${invoiceNumber} from invoice`
		);
	} else if (settings?.keezSeries) {
		// Use Keez series from settings
		invoiceSeries = settings.keezSeries.trim();
		console.log(`[Keez] Checking latest invoice number in Keez for series: ${invoiceSeries}`);

		try {
			const nextNumber = await keezClient.getNextInvoiceNumber(invoiceSeries);
			if (nextNumber !== null) {
				invoiceNumber = String(nextNumber);
				console.log(
					`[Keez] Next invoice number from Keez for series ${invoiceSeries}: ${invoiceNumber}`
				);
			} else {
				// Fallback: use the number from invoice or start number
				if (invoice.invoiceNumber) {
					const match = invoice.invoiceNumber.match(/(\d+)$/);
					if (match) {
						invoiceNumber = match[1];
					}
				}
				if (!invoiceNumber && settings.keezStartNumber) {
					invoiceNumber = settings.keezStartNumber;
				}
				console.log(`[Keez] Using fallback number: ${invoiceNumber}`);
			}
		} catch (error) {
			console.warn(
				`[Keez] Failed to get next invoice number from Keez, using invoice number:`,
				error
			);
			// Fallback: extract number from invoice number
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

	// Map invoice to Keez format with updated mapper
	// Pass the series and number we got from Keez to ensure correct numbering
	const keezInvoice = mapInvoiceToKeez(
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
		console.log(
			`[Keez] Using series: ${invoiceSeries}, number: ${invoiceNumber} for invoice ${invoice.id}`
		);
	}

	console.log(
		`[Keez] Mapped invoice to Keez format with ${keezInvoice.invoiceDetails.length} details`
	);

	// Create invoice in Keez
	console.log(`[Keez] Creating invoice in Keez with externalId: ${externalId}`);
	console.log(`[Keez] Full invoice JSON:`, JSON.stringify(keezInvoice, null, 2));

	let response;
	try {
		response = await keezClient.createInvoice(keezInvoice);
		console.log(
			`[Keez] Invoice created successfully in Keez with externalId: ${response.externalId}`
		);
	} catch (createError) {
		console.error(`[Keez] Failed to create invoice in Keez:`, createError);
		// Do NOT re-throw — the CRM invoice must be preserved even if Keez sync fails.
		// Record the failure so it can be retried manually.
		const syncId = generateSyncId();
		try {
			await db.insert(table.keezInvoiceSync).values({
				id: syncId,
				invoiceId: invoice.id,
				tenantId,
				keezInvoiceId: 'error',
				keezExternalId: null,
				syncDirection: 'push',
				lastSyncedAt: new Date(),
				syncStatus: 'error',
				errorMessage: createError instanceof Error ? createError.message : 'Failed to create invoice in Keez'
			});
		} catch (dbError) {
			console.error(`[Keez] Failed to record sync error:`, dbError);
		}
		return; // Exit hook gracefully
	}

	// Fetch the created invoice from Keez to get all actual data (number, series, VAT, currency, dates, etc.)
	let keezInvoiceData: any = null;
	let keezInvoiceHeader: any = null;
	try {
		// Get full invoice data from Keez
		keezInvoiceData = await keezClient.getInvoice(response.externalId);

		// Also try to get invoice from list to get header with series/number
		// Keez API might return invoice with series and number in the full invoice response
		// or we might need to search for it in the list
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
	// Try from header first, then from full invoice data
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
		if (settings.keezSeries) {
			const keezInvoiceNumber = `${settings.keezSeries} ${keezNumber}`;
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

	// Helper function to parse YYYYMMDD format dates from Keez
	const parseKeezDate = (dateValue: string | number | undefined): Date | null => {
		if (!dateValue) return null;

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

			// Handle string format (YYYYMMDD or YYYY-MM-DD)
			const dateStrTrimmed = String(dateValue).trim();
			if (
				!dateStrTrimmed ||
				dateStrTrimmed === 'null' ||
				dateStrTrimmed === 'undefined' ||
				dateStrTrimmed === '0000-00-00'
			) {
				return null;
			}

			// Try YYYYMMDD format first
			if (/^\d{8}$/.test(dateStrTrimmed)) {
				const year = parseInt(dateStrTrimmed.substring(0, 4), 10);
				const month = parseInt(dateStrTrimmed.substring(4, 6), 10) - 1;
				const day = parseInt(dateStrTrimmed.substring(6, 8), 10);
				const date = new Date(year, month, day);
				if (!isNaN(date.getTime()) && date.getFullYear() === year) {
					return date;
				}
			}

			// Try standard date format
			const date = new Date(dateStrTrimmed);
			if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
				return date;
			}

			return null;
		} catch (error) {
			console.warn(`[Keez] Error parsing date:`, dateValue, error);
			return null;
		}
	};

	// Extract and update dates from Keez
	if (
		keezInvoiceData?.issueDate ||
		keezInvoiceHeader?.documentDate ||
		keezInvoiceHeader?.issueDate
	) {
		const issueDateSource =
			keezInvoiceData?.issueDate || keezInvoiceHeader?.documentDate || keezInvoiceHeader?.issueDate;
		const issueDate = parseKeezDate(issueDateSource);
		if (issueDate) {
			updateData.issueDate = issueDate;
		} else {
			console.warn(`[Keez] Could not parse issue date from Keez:`, issueDateSource);
		}
	}

	if (keezInvoiceData?.dueDate || keezInvoiceHeader?.dueDate) {
		const dueDateSource = keezInvoiceData?.dueDate || keezInvoiceHeader?.dueDate;
		const dueDate = parseKeezDate(dueDateSource);
		if (dueDate) {
			updateData.dueDate = dueDate;
		} else {
			console.warn(`[Keez] Could not parse due date from Keez:`, dueDateSource);
		}
	}

	// Extract and update VAT rate and amounts from Keez invoice details
	if (
		keezInvoiceData?.invoiceDetails &&
		Array.isArray(keezInvoiceData.invoiceDetails) &&
		keezInvoiceData.invoiceDetails.length > 0
	) {
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
	await db.update(table.invoice).set(updateData).where(eq(table.invoice.id, invoice.id));

	// Extract and save invoice line items from Keez
	if (
		keezInvoiceData?.invoiceDetails &&
		Array.isArray(keezInvoiceData.invoiceDetails) &&
		keezInvoiceData.invoiceDetails.length > 0
	) {
		try {
			// Delete existing line items for this invoice (to avoid duplicates)
			await db.delete(table.invoiceLineItem).where(eq(table.invoiceLineItem.invoiceId, invoice.id));

			// Convert Keez invoice details to line items
			const lineItemsData = mapKeezDetailsToLineItems(keezInvoiceData.invoiceDetails, invoice.id);

			// Insert new line items with generated IDs
			if (lineItemsData.length > 0) {
				const lineItemsToInsert = lineItemsData.map((item) => ({
					...item,
					id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))
				}));
				await db.insert(table.invoiceLineItem).values(lineItemsToInsert);
				console.log(
					`[Keez] Added ${lineItemsToInsert.length} line items from Keez for invoice ${invoice.id}`
				);
			}
		} catch (error) {
			console.error(`[Keez] Failed to save line items for invoice ${invoice.id}:`, error);
			// Don't fail the entire sync if line items fail
		}
	}

	// Get updated invoice for sync record
	const [updatedInvoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoice.id))
		.limit(1);

	// Create sync record
	const syncId = generateSyncId();
	await db.insert(table.keezInvoiceSync).values({
		id: syncId,
		invoiceId: invoice.id,
		tenantId,
		keezInvoiceId: response.externalId,
		keezExternalId: response.externalId,
		syncDirection: 'push',
		lastSyncedAt: new Date(),
		syncStatus: 'synced'
	});

	// Update invoice settings with last synced number
	// Use the invoice number (not externalId) as the last synced number
	const lastSyncedNumber = updatedInvoice?.invoiceNumber || invoice.invoiceNumber;
	await db
		.update(table.invoiceSettings)
		.set({
			keezLastSyncedNumber: lastSyncedNumber,
			updatedAt: new Date()
		})
		.where(eq(table.invoiceSettings.tenantId, tenantId));

	// Update integration last sync time
	await db
		.update(table.keezIntegration)
		.set({
			lastSyncAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.id, integration.id));

	console.log(
		`[Keez] Successfully synced invoice ${invoice.id} to Keez with externalId: ${response.externalId}`
	);
};

/**
 * Handle invoice updated event - push updates to Keez
 */
export const onInvoiceUpdated: HookHandler<InvoiceUpdatedEvent> = async (event) => {
	const { invoice, tenantId } = event;

	// Only push updates if the invoice was previously synced to Keez
	if (!invoice.keezExternalId) {
		return;
	}

	// Check if Keez integration is active
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);

	if (!integration) {
		return;
	}

	// Respect autoSync setting
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	if (settings && settings.keezAutoSync === false) {
		return;
	}

	// Get tenant, client and line items
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	if (!tenant) {
		console.error(`[Keez] Tenant not found: ${tenantId}`);
		return;
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client) {
		console.error(`[Keez] Client not found for invoice update: ${invoice.clientId}`);
		return;
	}

	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	try {
		const keezClient = await createKeezClientForTenant(tenantId, integration);

		// Map updated invoice to Keez format, preserving existing Keez external ID
		const keezInvoice = mapInvoiceToKeez(
			{ ...invoice, lineItems },
			client,
			tenant,
			invoice.keezExternalId,
			settings,
			undefined // No item external ID mapping needed for updates
		);

		await keezClient.updateInvoice(invoice.keezExternalId, keezInvoice);

		// Update sync record
		const [existingSync] = await db
			.select()
			.from(table.keezInvoiceSync)
			.where(eq(table.keezInvoiceSync.invoiceId, invoice.id))
			.limit(1);

		if (existingSync) {
			await db
				.update(table.keezInvoiceSync)
				.set({ syncStatus: 'synced', lastSyncedAt: new Date() })
				.where(eq(table.keezInvoiceSync.id, existingSync.id));
		}

		console.log(
			`[Keez] Invoice ${invoice.id} updated in Keez (externalId: ${invoice.keezExternalId})`
		);
	} catch (error) {
		console.error(`[Keez] Failed to update invoice ${invoice.id} in Keez:`, error);

		// Mark sync as error
		const [existingSync] = await db
			.select()
			.from(table.keezInvoiceSync)
			.where(eq(table.keezInvoiceSync.invoiceId, invoice.id))
			.limit(1);

		if (existingSync) {
			await db
				.update(table.keezInvoiceSync)
				.set({
					syncStatus: 'error',
					errorMessage: error instanceof Error ? error.message : 'Unknown error'
				})
				.where(eq(table.keezInvoiceSync.id, existingSync.id));
		}
	}
};
