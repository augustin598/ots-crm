import type { HookHandler, InvoiceCreatedEvent, InvoiceUpdatedEvent } from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { SmartBillClient } from './client';
import { decrypt } from './crypto';
import { mapInvoiceToSmartBill, generateNextInvoiceNumber, mapSmartBillProductsToLineItems } from './mapper';
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

	try {
		// Check if SmartBill integration is active for tenant
		const [integration] = await db
			.select()
			.from(table.smartbillIntegration)
			.where(and(eq(table.smartbillIntegration.tenantId, tenantId), eq(table.smartbillIntegration.isActive, true)))
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

		if (!settings || !settings.smartbillAutoSync) {
			return; // Auto-sync not enabled
		}

		if (!settings.smartbillSeries || !settings.smartbillStartNumber) {
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

		// Generate next invoice number
		const invoiceNumber = generateNextInvoiceNumber(settings.smartbillLastSyncedNumber);

		// Map invoice to SmartBill format
		const smartBillInvoice = mapInvoiceToSmartBill(
			{ ...invoice, lineItems },
			client,
			tenant,
			settings.smartbillSeries,
			invoiceNumber
		);

		// Create invoice in SmartBill
		const response = await smartBillClient.createInvoice(smartBillInvoice);

		// Update invoice with SmartBill series and number
		await db
			.update(table.invoice)
			.set({
				smartbillSeries: response.series,
				smartbillNumber: response.number,
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoice.id));

		// Create sync record
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
	} catch (error) {
		console.error(`[SmartBill] Failed to sync invoice ${invoice.id} to SmartBill:`, error);

		// Store error in sync record
		try {
			const syncId = generateSyncId();
			await db.insert(table.smartbillInvoiceSync).values({
				id: syncId,
				invoiceId: invoice.id,
				tenantId,
				smartbillSeries: '',
				smartbillNumber: '',
				smartbillCif: '',
				syncDirection: 'push',
				syncStatus: 'error',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		} catch (syncError) {
			console.error(`[SmartBill] Failed to create sync error record:`, syncError);
		}
	}
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
