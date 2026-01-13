import type { HookHandler, InvoiceCreatedEvent, InvoiceUpdatedEvent } from '../types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { AnafSpvClient } from './client';
import { decrypt } from './crypto';
import { mapCrmInvoiceToUbl } from './mapper';
import { generateUblInvoice } from './xml-parser';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Handle invoice created event - auto-upload to SPV if enabled
 */
export const onInvoiceCreated: HookHandler<InvoiceCreatedEvent> = async (event) => {
	// const { invoice, tenantId } = event;
	// try {
	// 	// Check if ANAF SPV integration is active for tenant
	// 	const [integration] = await db
	// 		.select()
	// 		.from(table.anafSpvIntegration)
	// 		.where(
	// 			and(
	// 				eq(table.anafSpvIntegration.tenantId, tenantId),
	// 				eq(table.anafSpvIntegration.isActive, true)
	// 			)
	// 		)
	// 		.limit(1);
	// 	if (!integration) {
	// 		return; // No active integration, skip
	// 	}
	// 	// TODO: Check if auto-upload is enabled in settings
	// 	// For now, we'll skip auto-upload and let users manually sync
	// 	// This prevents accidental uploads
	// 	// Get tenant and client data
	// 	const [tenant] = await db
	// 		.select()
	// 		.from(table.tenant)
	// 		.where(eq(table.tenant.id, tenantId))
	// 		.limit(1);
	// 	if (!tenant) {
	// 		console.error(`[ANAF-SPV] Tenant not found: ${tenantId}`);
	// 		return;
	// 	}
	// 	const [client] = await db
	// 		.select()
	// 		.from(table.client)
	// 		.where(eq(table.client.id, invoice.clientId))
	// 		.limit(1);
	// 	if (!client) {
	// 		console.error(`[ANAF-SPV] Client not found: ${invoice.clientId}`);
	// 		return;
	// 	}
	// 	// Get line items
	// 	const lineItems = await db
	// 		.select()
	// 		.from(table.invoiceLineItem)
	// 		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));
	// 	// Decrypt tokens and credentials
	// 	const accessToken = decrypt(tenantId, integration.accessToken);
	// 	const refreshToken = decrypt(tenantId, integration.refreshToken);
	// 	const clientId = integration.clientId ? decrypt(tenantId, integration.clientId) : undefined;
	// 	const clientSecret = integration.clientSecret
	// 		? decrypt(tenantId, integration.clientSecret)
	// 		: undefined;
	// 	if (!accessToken || !refreshToken) {
	// 		console.error(`[ANAF-SPV] Missing tokens for tenant ${tenantId}`);
	// 		return;
	// 	}
	// 	// Create ANAF SPV client
	// 	const spvClient = new AnafSpvClient({
	// 		accessToken,
	// 		refreshToken,
	// 		expiresAt: integration.expiresAt || undefined,
	// 		clientId,
	// 		clientSecret
	// 	});
	// 	// Map invoice to UBL format
	// 	const ublData = mapCrmInvoiceToUbl({ ...invoice, lineItems }, tenant, client);
	// 	// Generate UBL XML
	// 	const xmlData = generateUblInvoice(
	// 		ublData.invoice,
	// 		ublData.supplier,
	// 		ublData.customer,
	// 		ublData.lineItems
	// 	);
	// 	// Determine if external (client is external company)
	// 	const isExternal = false; // TODO: Determine based on client type or settings
	// 	// Get tenant VAT ID
	// 	const tenantVatId = tenant.cui || tenant.vatNumber || '';
	// 	if (!tenantVatId) {
	// 		console.warn(`[ANAF-SPV] Tenant VAT ID not found for tenant ${tenantId}`);
	// 		return;
	// 	}
	// 	// Upload invoice to SPV
	// 	const response = await spvClient.uploadInvoiceToSpv(xmlData, tenantVatId, isExternal);
	// 	// Update invoice with SPV ID
	// 	await db
	// 		.update(table.invoice)
	// 		.set({
	// 			spvId: response.index_incarcare,
	// 			updatedAt: new Date()
	// 		})
	// 		.where(eq(table.invoice.id, invoice.id));
	// 	// Create sync record
	// 	const syncId = generateSyncId();
	// 	await db.insert(table.anafSpvInvoiceSync).values({
	// 		id: syncId,
	// 		invoiceId: invoice.id,
	// 		tenantId,
	// 		spvId: response.index_incarcare,
	// 		syncDirection: 'push',
	// 		lastSyncedAt: new Date(),
	// 		syncStatus: 'synced'
	// 	});
	// 	// Update integration last sync time
	// 	await db
	// 		.update(table.anafSpvIntegration)
	// 		.set({
	// 			lastSyncAt: new Date(),
	// 			updatedAt: new Date()
	// 		})
	// 		.where(eq(table.anafSpvIntegration.id, integration.id));
	// 	console.log(`[ANAF-SPV] Successfully uploaded invoice ${invoice.id} to SPV`);
	// } catch (error) {
	// 	console.error(`[ANAF-SPV] Failed to upload invoice ${invoice.id} to SPV:`, error);
	// 	// Store error in sync record
	// 	try {
	// 		const syncId = generateSyncId();
	// 		await db.insert(table.anafSpvInvoiceSync).values({
	// 			id: syncId,
	// 			invoiceId: invoice.id,
	// 			tenantId,
	// 			spvId: '',
	// 			syncDirection: 'push',
	// 			syncStatus: 'error',
	// 			errorMessage: error instanceof Error ? error.message : String(error)
	// 		});
	// 	} catch (syncError) {
	// 		console.error(`[ANAF-SPV] Failed to create sync error record:`, syncError);
	// 	}
	// }
};

/**
 * Handle invoice updated event
 * For now, we'll skip auto-updating SPV invoices on update
 * Users can manually sync if needed
 */
export const onInvoiceUpdated: HookHandler<InvoiceUpdatedEvent> = async (event) => {
	// For now, we'll skip auto-updating SPV invoices on update
	// This prevents overwriting SPV data unintentionally
	const { invoice } = event;

	// Check if invoice has SPV sync
	const [sync] = await db
		.select()
		.from(table.anafSpvInvoiceSync)
		.where(
			and(
				eq(table.anafSpvInvoiceSync.invoiceId, invoice.id),
				eq(table.anafSpvInvoiceSync.syncStatus, 'synced')
			)
		)
		.limit(1);

	if (!sync) {
		return; // Not synced to SPV, skip
	}

	// TODO: Implement update sync if needed
	// For now, we'll leave it as manual sync only
};
