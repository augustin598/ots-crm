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

		// Update invoice with Keez external ID
		await db
			.update(table.invoice)
			.set({
				keezInvoiceId: response.externalId,
				keezExternalId: response.externalId,
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoice.id));

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

		// Update invoice settings with last synced number (if applicable)
		if (settings.keezLastSyncedNumber) {
			await db
				.update(table.invoiceSettings)
				.set({
					keezLastSyncedNumber: response.externalId, // Use externalId as reference
					updatedAt: new Date()
				})
				.where(eq(table.invoiceSettings.tenantId, tenantId));
		}

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
