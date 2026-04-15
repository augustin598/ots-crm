import type { HookHandler, InvoiceCreatedEvent, InvoiceUpdatedEvent, InvoiceDeletedEvent } from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { createKeezClientForTenant, KeezCredentialsCorruptError } from './factory';
import { mapInvoiceToKeez, generateNextInvoiceNumber, mapKeezDetailsToLineItems } from './mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Handle invoice created event - auto-sync to Keez
 */
export const onInvoiceCreated: HookHandler<InvoiceCreatedEvent> = async (event) => {
	const { invoice, tenantId } = event;
	logInfo('keez', `Invoice created event for invoice ${invoice.id}`, { tenantId, metadata: { invoiceId: invoice.id, clientId: invoice.clientId } });

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
		logWarning('keez', 'Invoice settings not configured: no keezSeries in settings and invoice has no invoiceSeries', { tenantId });
		return;
	}

	// Get tenant and client data
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	if (!tenant) {
		logError('keez', `Tenant not found: ${tenantId}`, { tenantId });
		return;
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client) {
		logError('keez', `Client not found: ${invoice.clientId}`, { tenantId });
		return;
	}

	// Get line items
	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	// Create Keez client with DB token cache
	let keezClient;
	try {
		keezClient = await createKeezClientForTenant(tenantId, integration);
	} catch (error) {
		if (error instanceof KeezCredentialsCorruptError) {
			logWarning('keez', `Skipping invoice sync - credentials corrupted. Re-save Keez integration in Settings.`, {
				tenantId,
				metadata: {
					invoiceId: invoice.id,
					cause: error.cause instanceof Error ? error.cause.message : String(error.cause ?? ''),
					secretLength: integration.secret?.length ?? 0,
					secretParts: integration.secret?.split(':').length ?? 0
				}
			});
			// Record sync error instead of crashing invoice creation
			await db.insert(table.keezInvoiceSync).values({
				id: generateSyncId(),
				invoiceId: invoice.id,
				tenantId,
				keezInvoiceId: '',
				syncStatus: 'error',
				syncDirection: 'push',
				errorMessage: 'Keez credentials are corrupted. Please re-save your Keez integration in Settings.',
				lastSyncedAt: new Date()
			});
			return;
		}
		throw error;
	}

	logInfo('keez', `Starting invoice sync for invoice ${invoice.id} with ${lineItems.length} line items`, { tenantId, metadata: { invoiceId: invoice.id, lineItemCount: lineItems.length } });

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
			logInfo('keez', `Line item ${lineItem.id} has pre-configured keezItemExternalId, using it directly`, { tenantId, metadata: { lineItemId: lineItem.id, keezItemExternalId: lineItem.keezItemExternalId } });
			itemExternalIds.set(lineItem.id, lineItem.keezItemExternalId);
			continue;
		}

		// Generate code for item (similar to WHMCS implementation)
		const itemCode = `CRM_${lineItem.id}`;

		logInfo('keez', `Checking item ${itemCode} for line item ${lineItem.id}`, { tenantId });

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
			logInfo('keez', `Item ${itemCode} not found, creating new item in Keez`, { tenantId });

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

				logInfo('keez', `Created item ${itemCode} with externalId: ${newItem.externalId}`, { tenantId });
				itemExternalIds.set(lineItem.id, newItem.externalId);
			} catch (itemError) {
				const err = serializeError(itemError);
				logError('keez', `Failed to create item ${itemCode}: ${err.message}`, { tenantId, stackTrace: err.stack });
				// Try to continue with item ID as fallback
				itemExternalIds.set(lineItem.id, lineItem.id);
			}
		} else {
			// Item exists, use its externalId
			logInfo('keez', `Found existing item ${itemCode} with externalId: ${keezItem.externalId}`, { tenantId });
			itemExternalIds.set(lineItem.id, keezItem.externalId || lineItem.id);
		}
	}

	// If no line items, we'll create a generic item in the mapper
	if (lineItems.length === 0) {
		logInfo('keez', `Invoice ${invoice.id} has no line items, will create generic item in mapper`, { tenantId, metadata: { invoiceId: invoice.id } });
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
		logInfo('keez', `Using invoice series ${invoiceSeries} and number ${invoiceNumber} from invoice`, { tenantId });
	} else if (settings?.keezSeries) {
		// Use Keez series from settings
		invoiceSeries = settings.keezSeries.trim();
		logInfo('keez', `Checking latest invoice number in Keez for series: ${invoiceSeries}`, { tenantId });

		try {
			const nextNumber = await keezClient.getNextInvoiceNumber(invoiceSeries);
			if (nextNumber !== null) {
				invoiceNumber = String(nextNumber);
				logInfo('keez', `Next invoice number from Keez for series ${invoiceSeries}: ${invoiceNumber}`, { tenantId });
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
				logInfo('keez', `Using fallback number: ${invoiceNumber}`, { tenantId });
			}
		} catch (error) {
			const err = serializeError(error);
			logWarning('keez', `Failed to get next invoice number from Keez, using invoice number: ${err.message}`, { tenantId, stackTrace: err.stack });
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
		logInfo('keez', `Using series: ${invoiceSeries}, number: ${invoiceNumber} for invoice ${invoice.id}`, { tenantId });
	}

	logInfo('keez', `Mapped invoice to Keez format with ${keezInvoice.invoiceDetails.length} details`, { tenantId, metadata: { invoiceId: invoice.id, detailCount: keezInvoice.invoiceDetails.length } });

	// Create invoice in Keez with retry on duplicate number
	logInfo('keez', `Creating invoice in Keez with externalId: ${externalId}, series=${keezInvoice.series}, number=${keezInvoice.number}`, { tenantId, metadata: { externalId, invoiceId: invoice.id } });

	let response;
	const MAX_RETRY_ATTEMPTS = 3;
	let lastError: unknown = null;

	for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
		try {
			response = await keezClient.createInvoice(keezInvoice);
			logInfo('keez', `Invoice created successfully in Keez (attempt ${attempt}): externalId=${response.externalId}, series=${keezInvoice.series}, number=${keezInvoice.number}`, { tenantId, metadata: { invoiceId: invoice.id, keezExternalId: response.externalId, attempt } });
			lastError = null;
			break;
		} catch (createError) {
			lastError = createError;
			const errMsg = createError instanceof Error ? createError.message : String(createError);
			const errLower = errMsg.toLowerCase();
			const isDuplicateNumber = (errLower.includes('duplicate') && errLower.includes('number'))
				|| (errLower.includes('already') && errLower.includes('exists') && errLower.includes('number'))
				|| errLower.includes('number is already in use')
				|| errLower.includes('numar deja existent');

			if (isDuplicateNumber && attempt < MAX_RETRY_ATTEMPTS && keezInvoice.number) {
				// Increment number and retry — likely a race condition with concurrent invoice creation
				const oldNumber = keezInvoice.number;
				keezInvoice.number = oldNumber + 1;
				logWarning('keez', `Keez create failed (attempt ${attempt}), possible duplicate number ${oldNumber}. Retrying with ${keezInvoice.number}: ${errMsg}`, { tenantId, action: 'keez_number_retry', metadata: { invoiceId: invoice.id, oldNumber, newNumber: keezInvoice.number, attempt } });
			} else {
				// Non-duplicate error or max retries reached
				const createErr = serializeError(createError);
				logError('keez', `Failed to create invoice in Keez (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}): ${createErr.message}`, { tenantId, stackTrace: createErr.stack });
				break;
			}
		}
	}

	if (lastError) {
		// All attempts failed — record the failure and throw so caller can rollback
		const syncId = generateSyncId();
		const errorMessage = lastError instanceof Error ? lastError.message : 'Failed to create invoice in Keez after retries';
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
				errorMessage
			});
		} catch (dbError) {
			const dbErr = serializeError(dbError);
			logError('keez', `Failed to record sync error: ${dbErr.message}`, { tenantId, stackTrace: dbErr.stack });
		}
		throw new Error(`Keez invoice sync failed after ${MAX_RETRY_ATTEMPTS} attempts: ${errorMessage}`);
	}

	// At this point response is guaranteed to be defined (lastError would have caused a throw above)
	const keezResponse = response!;

	// Fetch the created invoice from Keez to get all actual data (number, series, VAT, currency, dates, etc.)
	let keezInvoiceData: any = null;
	let keezInvoiceHeader: any = null;
	try {
		// Get full invoice data from Keez
		keezInvoiceData = await keezClient.getInvoice(keezResponse.externalId);

		// Also try to get invoice from list to get header with series/number
		try {
			const invoicesList = await keezClient.getInvoices({
				count: 100,
				filter: `externalId eq '${keezResponse.externalId}'`
			});

			if (invoicesList.data && invoicesList.data.length > 0) {
				keezInvoiceHeader = invoicesList.data[0];
			}
		} catch (listError) {
			const listErr = serializeError(listError);
			logWarning('keez', `Could not fetch invoice from list: ${listErr.message}`, { tenantId, stackTrace: listErr.stack });
		}
	} catch (error) {
		const fetchErr = serializeError(error);
		logWarning('keez', `Could not fetch invoice ${keezResponse.externalId} from Keez: ${fetchErr.message}`, { tenantId, stackTrace: fetchErr.stack });
	}

	// Auto-validate invoice in Keez ONLY for recurring invoices (fully automated flow)
	// Manual invoices always stay as Proforma (Draft) in Keez — user validates manually
	const isRecurring = (event as any).isRecurring === true;
	if (isRecurring) {
		try {
			await keezClient.validateInvoice(keezResponse.externalId);
			logInfo('keez', `Invoice validated in Keez (Draft → Valid): ${keezResponse.externalId}`, { tenantId, action: 'keez_invoice_validated', metadata: { invoiceId: invoice.id, keezExternalId: keezResponse.externalId } });

			// Re-fetch invoice data after validation to get updated status
			try {
				keezInvoiceData = await keezClient.getInvoice(keezResponse.externalId);
				const invoicesList = await keezClient.getInvoices({ count: 10, filter: `externalId eq '${keezResponse.externalId}'` });
				if (invoicesList.data && invoicesList.data.length > 0) {
					keezInvoiceHeader = invoicesList.data[0];
				}
			} catch (refetchErr) {
				logWarning('keez', `Could not re-fetch invoice after validation: ${refetchErr instanceof Error ? refetchErr.message : refetchErr}`, { tenantId });
			}
		} catch (validateErr) {
			const valErr = serializeError(validateErr);
			logWarning('keez', `Failed to validate invoice in Keez (will remain as Proforma): ${valErr.message}`, { tenantId, action: 'keez_invoice_validate_failed', stackTrace: valErr.stack, metadata: { invoiceId: invoice.id, keezExternalId: keezResponse.externalId } });
		}
	}

	// Calculate totals and extract data from Keez response
	let updateData: any = {
		keezInvoiceId: keezResponse.externalId,
		keezExternalId: keezResponse.externalId,
		keezStatus: keezInvoiceData?.status || keezInvoiceHeader?.status || 'Draft',
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
		if (settings?.keezSeries) {
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
			const parseErr = serializeError(error);
			logWarning('keez', `Error parsing date: ${parseErr.message}`, { tenantId, metadata: { dateValue } });
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
			logWarning('keez', `Could not parse issue date from Keez`, { tenantId, metadata: { issueDateSource } });
		}
	}

	if (keezInvoiceData?.dueDate || keezInvoiceHeader?.dueDate) {
		const dueDateSource = keezInvoiceData?.dueDate || keezInvoiceHeader?.dueDate;
		const dueDate = parseKeezDate(dueDateSource);
		if (dueDate) {
			updateData.dueDate = dueDate;
		} else {
			logWarning('keez', `Could not parse due date from Keez`, { tenantId, metadata: { dueDateSource } });
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
			// Always use RON amounts (non-suffixed) — CRM stores in RON cents
			const netAmount = detail.netAmount ?? detail.netAmountCurrency ?? 0;
			const vatAmount = detail.vatAmount ?? detail.vatAmountCurrency ?? 0;
			const grossAmount = detail.grossAmount ?? detail.grossAmountCurrency ?? 0;

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

	// Extract and save invoice line items from Keez (atomic delete+insert)
	if (
		keezInvoiceData?.invoiceDetails &&
		Array.isArray(keezInvoiceData.invoiceDetails) &&
		keezInvoiceData.invoiceDetails.length > 0
	) {
		try {
			const lineItemsData = mapKeezDetailsToLineItems(keezInvoiceData.invoiceDetails, invoice.id);

			if (lineItemsData.length > 0) {
				const lineItemsToInsert = lineItemsData.map((item) => ({
					...item,
					id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))
				}));

				// Delete + insert in transaction to avoid leaving invoice without items
				await db.transaction(async (tx) => {
					await tx.delete(table.invoiceLineItem).where(eq(table.invoiceLineItem.invoiceId, invoice.id));
					await tx.insert(table.invoiceLineItem).values(lineItemsToInsert);
				});
				logInfo('keez', `Added ${lineItemsToInsert.length} line items from Keez for invoice ${invoice.id}`, { tenantId });
			}
		} catch (error) {
			const lineErr = serializeError(error);
			logError('keez', `Failed to save line items for invoice ${invoice.id}: ${lineErr.message}`, { tenantId, stackTrace: lineErr.stack });
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
		keezInvoiceId: keezResponse.externalId,
		keezExternalId: keezResponse.externalId,
		syncDirection: 'push',
		lastSyncedAt: new Date(),
		syncStatus: 'synced'
	});

	// Update invoice settings with last synced number
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

	logInfo('keez', `Successfully synced invoice ${invoice.id} to Keez with externalId: ${keezResponse.externalId}`, { tenantId, metadata: { invoiceId: invoice.id, keezExternalId: keezResponse.externalId } });
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
		logError('keez', `Tenant not found: ${tenantId}`, { tenantId });
		return;
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client) {
		logError('keez', `Client not found for invoice update: ${invoice.clientId}`, { tenantId });
		return;
	}

	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	try {
		let keezClient;
		try {
			keezClient = await createKeezClientForTenant(tenantId, integration);
		} catch (error) {
			if (error instanceof KeezCredentialsCorruptError) {
				logWarning('keez', `Skipping invoice update sync - credentials corrupted. Re-save Keez integration in Settings.`, {
					tenantId,
					metadata: {
						invoiceId: invoice.id,
						cause: error.cause instanceof Error ? error.cause.message : String(error.cause ?? '')
					}
				});
				return;
			}
			throw error;
		}

		// Map updated invoice to Keez format, preserving existing Keez external ID
		const keezInvoice = await mapInvoiceToKeez(
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

		logInfo('keez', `Invoice ${invoice.id} updated in Keez (externalId: ${invoice.keezExternalId})`, { tenantId, metadata: { invoiceId: invoice.id, keezExternalId: invoice.keezExternalId } });
	} catch (error) {
		const updateErr = serializeError(error);
		logError('keez', `Failed to update invoice ${invoice.id} in Keez: ${updateErr.message}`, { tenantId, stackTrace: updateErr.stack });

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

/**
 * Handle invoice deleted event - delete from Keez if it's a draft/proforma
 */
export const onInvoiceDeleted: HookHandler<InvoiceDeletedEvent> = async (event) => {
	const { invoice, tenantId } = event;
	logInfo('keez', `onInvoiceDeleted hook fired for invoice ${invoice.id}`, { tenantId, metadata: { invoiceId: invoice.id, keezExternalId: invoice.keezExternalId, keezStatus: invoice.keezStatus } });

	// Check if invoice has Keez sync data
	if (!invoice.keezExternalId) {
		logInfo('keez', `Invoice ${invoice.id} not synced with Keez, skipping deletion`, { tenantId });
		return;
	}

	// Check if Keez integration is active for tenant
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(
				eq(table.keezIntegration.tenantId, tenantId),
				eq(table.keezIntegration.isActive, true)
			)
		)
		.limit(1);

	if (!integration) {
		logInfo('keez', `Keez integration not active for tenant ${tenantId}, skipping deletion`, { tenantId });
		return;
	}

	try {
		let keezClient;
		try {
			keezClient = await createKeezClientForTenant(tenantId, integration);
		} catch (error) {
			if (error instanceof KeezCredentialsCorruptError) {
				logWarning('keez', `Skipping invoice delete sync - credentials corrupted. Re-save Keez integration in Settings.`, {
					tenantId,
					metadata: {
						invoiceId: invoice.id,
						cause: error.cause instanceof Error ? error.cause.message : String(error.cause ?? '')
					}
				});
				return;
			}
			throw error;
		}

		// Only draft/proforma invoices can be deleted in Keez
		// Validated fiscal invoices cannot be deleted (must be storno'd)
		if (invoice.keezStatus === 'Valid' || invoice.keezStatus === 'Cancelled') {
			logInfo('keez', `Invoice ${invoice.id} is ${invoice.keezStatus} in Keez — cannot delete validated/cancelled invoices, skipping`, { tenantId });
			return;
		}

		await keezClient.deleteInvoice(invoice.keezExternalId);
		logInfo('keez', `Successfully deleted invoice ${invoice.id} from Keez`, { tenantId });

		// Clean up sync records
		const [syncRecord] = await db
			.select()
			.from(table.keezInvoiceSync)
			.where(eq(table.keezInvoiceSync.invoiceId, invoice.id))
			.limit(1);

		if (syncRecord) {
			await db.delete(table.keezInvoiceSync).where(eq(table.keezInvoiceSync.id, syncRecord.id));
		}
	} catch (error) {
		// Don't fail the CRM deletion if Keez deletion fails
		const delErr = serializeError(error);
		logError('keez', `Failed to delete invoice ${invoice.id} from Keez: ${delErr.message}`, { tenantId, stackTrace: delErr.stack });
	}
};
