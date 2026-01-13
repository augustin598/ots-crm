import type { HookHandler, InvoiceCreatedEvent, InvoiceUpdatedEvent } from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { KeezClient } from './client';
import { decrypt } from './crypto';
import { mapInvoiceToKeez, generateNextInvoiceNumber } from './mapper';
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

	try {
		// Check if Keez integration is active for tenant
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true)))
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

		if (!settings || !settings.keezAutoSync) {
			return; // Auto-sync not enabled
		}

		if (!settings.keezSeries || !settings.keezStartNumber) {
			console.warn(`[Keez] Invoice settings not configured for tenant ${tenantId}`);
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

		// Decrypt secret
		const secret = decrypt(tenantId, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Generate external ID (use invoice ID or generate one)
		const externalId = invoice.keezExternalId || invoice.id;

		// Map invoice to Keez format
		const keezInvoice = mapInvoiceToKeez(
			{ ...invoice, lineItems },
			client,
			tenant,
			externalId
		);

		// Create invoice in Keez
		const response = await keezClient.createInvoice(keezInvoice);

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

		// Extract and update dates from Keez
		if (keezInvoiceData?.issueDate) {
			try {
				const issueDate = new Date(keezInvoiceData.issueDate);
				if (!isNaN(issueDate.getTime())) {
					updateData.issueDate = issueDate;
				}
			} catch (e) {
				console.warn(`[Keez] Invalid issue date from Keez:`, keezInvoiceData.issueDate);
			}
		}

		if (keezInvoiceData?.dueDate) {
			try {
				// Check if dueDate is a valid non-empty string
				const dueDateStr = String(keezInvoiceData.dueDate).trim();
				if (dueDateStr && dueDateStr !== 'null' && dueDateStr !== 'undefined' && dueDateStr !== '0000-00-00') {
					const dueDate = new Date(dueDateStr);
					// Check if date is valid and not epoch (1970-01-01)
					if (!isNaN(dueDate.getTime()) && dueDate.getFullYear() > 1970) {
						updateData.dueDate = dueDate;
					} else {
						console.warn(`[Keez] Invalid due date from Keez (epoch or invalid):`, keezInvoiceData.dueDate);
					}
				} else {
					console.warn(`[Keez] Invalid due date from Keez (empty or null string):`, keezInvoiceData.dueDate);
				}
			} catch (e) {
				console.warn(`[Keez] Invalid due date from Keez:`, keezInvoiceData.dueDate);
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
			.where(eq(table.invoice.id, invoice.id));

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

		console.log(`[Keez] Successfully synced invoice ${invoice.id} to Keez`);
	} catch (error) {
		console.error(`[Keez] Failed to sync invoice ${invoice.id} to Keez:`, error);

		// Store error in sync record
		try {
			const syncId = generateSyncId();
			await db.insert(table.keezInvoiceSync).values({
				id: syncId,
				invoiceId: invoice.id,
				tenantId,
				keezInvoiceId: '',
				keezExternalId: '',
				syncDirection: 'push',
				syncStatus: 'error',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		} catch (syncError) {
			console.error(`[Keez] Failed to create sync error record:`, syncError);
		}
	}
};

/**
 * Handle invoice updated event - sync updates to Keez
 */
export const onInvoiceUpdated: HookHandler<InvoiceUpdatedEvent> = async (event) => {
	// For now, we'll skip auto-updating Keez invoices on update
	// Users can manually sync if needed
	// This prevents overwriting Keez data unintentionally
	const { invoice } = event;

	// Check if invoice has Keez sync
	const [sync] = await db
		.select()
		.from(table.keezInvoiceSync)
		.where(
			and(
				eq(table.keezInvoiceSync.invoiceId, invoice.id),
				eq(table.keezInvoiceSync.syncStatus, 'synced')
			)
		)
		.limit(1);

	if (!sync) {
		return; // Not synced to Keez, skip
	}

	// TODO: Implement update sync if needed
	// For now, we'll leave it as manual sync only
};
