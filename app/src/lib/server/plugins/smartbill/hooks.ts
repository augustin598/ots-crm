import type {
	HookHandler,
	InvoiceCreatedEvent,
	InvoiceUpdatedEvent,
	InvoiceDeletedEvent
} from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { SmartBillClient } from './client';
import { decrypt } from './crypto';
import {
	mapInvoiceToSmartBill,
	generateNextInvoiceNumber,
	mapSmartBillProductsToLineItems
} from './mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Handle invoice created event - auto-sync to SmartBill
 */
export const onInvoiceCreated: HookHandler<InvoiceCreatedEvent> = async (event) => {
	const { invoice, tenantId } = event;

	// Idempotency check: Skip if invoice is already successfully synced
	const [existingSync] = await db
		.select()
		.from(table.smartbillInvoiceSync)
		.where(
			and(
				eq(table.smartbillInvoiceSync.invoiceId, invoice.id),
				eq(table.smartbillInvoiceSync.syncStatus, 'synced')
			)
		)
		.limit(1);

	if (existingSync) {
		console.log(`[SmartBill] Invoice ${invoice.id} already synced, skipping duplicate sync`);
		return;
	}

	// Check if SmartBill integration is active for tenant
	const [integration] = await db
		.select()
		.from(table.smartbillIntegration)
		.where(
			and(
				eq(table.smartbillIntegration.tenantId, tenantId),
				eq(table.smartbillIntegration.isActive, true)
			)
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
	if (settings && settings.smartbillAutoSync === false) {
		// If autoSync is explicitly disabled, respect that
		return;
	}

	if (!settings || !settings.smartbillSeries || !settings.smartbillStartNumber) {
		console.warn(`[SmartBill] Invoice settings not configured for tenant ${tenantId}`);
		return;
	}

	// Get tenant and client data
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	if (!tenant) {
		console.error(`[SmartBill] Tenant not found: ${tenantId}`);
		return;
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client) {
		console.error(`[SmartBill] Client not found: ${invoice.clientId}`);
		return;
	}

	// Get line items
	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	// Decrypt token
	const token = decrypt(tenantId, integration.token);

	// Create SmartBill client
	const smartBillClient = new SmartBillClient({
		email: integration.email,
		token
	});

	// Check if invoice has invoiceSeries that matches SmartBill series
	let seriesName = settings.smartbillSeries;
	let invoiceNumber: string;

	if (
		invoice.invoiceSeries &&
		settings.smartbillSeries &&
		invoice.invoiceSeries.trim() === settings.smartbillSeries.trim()
	) {
		// Invoice series matches SmartBill series, use it
		seriesName = invoice.invoiceSeries.trim();
		// Extract number from invoiceNumber if it contains the series (e.g., "SERIA-0001" -> "0001")
		if (invoice.invoiceNumber) {
			// Remove series from invoiceNumber to get just the number
			const seriesPattern = seriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const match = invoice.invoiceNumber.match(new RegExp(`${seriesPattern}-?(\\d+)`, 'i'));
			if (match) {
				invoiceNumber = match[1];
			} else {
				// Try to extract just the numeric part
				const numMatch = invoice.invoiceNumber.match(/(\d+)$/);
				if (numMatch) {
					invoiceNumber = numMatch[1];
				} else {
					// Fallback to generating next number
					invoiceNumber = generateNextInvoiceNumber(settings.smartbillLastSyncedNumber);
				}
			}
		} else {
			// No invoice number, generate next one
			invoiceNumber = generateNextInvoiceNumber(settings.smartbillLastSyncedNumber);
		}
		console.log(
			`[SmartBill] Using invoice series ${seriesName} and number ${invoiceNumber} from invoice`
		);
	} else {
		// Generate next invoice number
		invoiceNumber = generateNextInvoiceNumber(settings.smartbillLastSyncedNumber);
	}

	// Map invoice to SmartBill format with tax name mappings from settings
	const taxNameMappings = {
		apply: settings?.smartbillTaxNameApply || null,
		none: settings?.smartbillTaxNameNone || null,
		reverse: settings?.smartbillTaxNameReverse || null
	};
	const smartBillInvoice = mapInvoiceToSmartBill(
		{ ...invoice, lineItems },
		client,
		tenant,
		seriesName,
		invoiceNumber,
		taxNameMappings
	);

	// Create invoice in SmartBill
	const response = await smartBillClient.createInvoice(smartBillInvoice);

	// Validate response has required fields
	if (!response || !response.series || !response.number) {
		throw new Error(
			`Invalid SmartBill API response: missing series or number. Response: ${JSON.stringify(response)}`
		);
	}

	// Update invoice with SmartBill series and number
	await db
		.update(table.invoice)
		.set({
			smartbillSeries: response.series,
			smartbillNumber: response.number,
			updatedAt: new Date()
		})
		.where(eq(table.invoice.id, invoice.id));

	// Create sync record only after successful API call with valid response
	const syncId = generateSyncId();
	await db.insert(table.smartbillInvoiceSync).values({
		id: syncId,
		invoiceId: invoice.id,
		tenantId,
		smartbillSeries: response.series,
		smartbillNumber: response.number,
		smartbillCif: tenant.cui || tenant.vatNumber || '',
		syncDirection: 'push',
		lastSyncedAt: new Date(),
		syncStatus: 'synced'
	});

	// Update invoice settings with last synced number
	await db
		.update(table.invoiceSettings)
		.set({
			smartbillLastSyncedNumber: response.number,
			updatedAt: new Date()
		})
		.where(eq(table.invoiceSettings.tenantId, tenantId));

	// Update integration last sync time
	await db
		.update(table.smartbillIntegration)
		.set({
			lastSyncAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.smartbillIntegration.id, integration.id));

	console.log(`[SmartBill] Successfully synced invoice ${invoice.id} to SmartBill`);
};

/**
 * Handle invoice updated event - sync updates to SmartBill
 */
export const onInvoiceUpdated: HookHandler<InvoiceUpdatedEvent> = async (event) => {
	// For now, we'll skip auto-updating SmartBill invoices on update
	// Users can manually sync if needed
	// This prevents overwriting SmartBill data unintentionally
	const { invoice } = event;

	// Check if invoice has SmartBill sync
	const [sync] = await db
		.select()
		.from(table.smartbillInvoiceSync)
		.where(
			and(
				eq(table.smartbillInvoiceSync.invoiceId, invoice.id),
				eq(table.smartbillInvoiceSync.syncStatus, 'synced')
			)
		)
		.limit(1);

	if (!sync) {
		return; // Not synced to SmartBill, skip
	}

	// TODO: Implement update sync if needed
	// For now, we'll leave it as manual sync only
};

/**
 * Handle invoice deleted event - delete from SmartBill if conditions are met
 */
export const onInvoiceDeleted: HookHandler<InvoiceDeletedEvent> = async (event) => {
	const { invoice, tenantId } = event;

	// Check if invoice has SmartBill sync data
	if (!invoice.smartbillSeries || !invoice.smartbillNumber) {
		console.log(
			`[SmartBill] Invoice ${invoice.id} does not have SmartBill sync data, skipping deletion`
		);
		return;
	}

	// Check if SmartBill integration is active for tenant
	const [integration] = await db
		.select()
		.from(table.smartbillIntegration)
		.where(
			and(
				eq(table.smartbillIntegration.tenantId, tenantId),
				eq(table.smartbillIntegration.isActive, true)
			)
		)
		.limit(1);

	if (!integration) {
		console.log(
			`[SmartBill] SmartBill integration not active for tenant ${tenantId}, skipping deletion`
		);
		return;
	}

	// Validate deletion conditions: invoice must be draft OR most recently created
	const isDraft = invoice.status === 'draft';

	// Check if it's the most recent invoice
	const [mostRecentInvoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.tenantId, tenantId))
		.orderBy(desc(table.invoice.createdAt))
		.limit(1);

	const isMostRecent = mostRecentInvoice?.id === invoice.id;

	// Only allow deletion if invoice is draft or most recent
	if (!isDraft && !isMostRecent) {
		console.log(
			`[SmartBill] Invoice ${invoice.id} cannot be deleted from SmartBill: not draft and not most recent invoice`
		);
		return;
	}

	// Get tenant data for CIF
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	if (!tenant) {
		console.error(`[SmartBill] Tenant not found: ${tenantId}`);
		return;
	}

	const cif = tenant.cui || tenant.vatNumber || '';
	if (!cif) {
		console.error(`[SmartBill] Tenant ${tenantId} does not have CUI or VAT number`);
		return;
	}

	// Decrypt token
	const token = decrypt(tenantId, integration.token);

	// Create SmartBill client
	const smartBillClient = new SmartBillClient({
		email: integration.email,
		token
	});

	// Delete invoice from SmartBill
	const response = await smartBillClient.deleteInvoice(
		cif,
		invoice.smartbillSeries,
		invoice.smartbillNumber
	);

	// Check for errors in response
	if (response.errorText) {
		throw new Error(`SmartBill deletion error: ${response.errorText}`);
	}

	// Log success message if available
	if (response.message) {
		console.log(`[SmartBill] ${response.message}`);
	}

	console.log(
		`[SmartBill] Successfully deleted invoice ${invoice.id} (${invoice.smartbillSeries}-${invoice.smartbillNumber}) from SmartBill`
	);
};
