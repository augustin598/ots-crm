import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { syncSpvInvoicesForTenant, syncSentInvoicesFromSpv } from '../../plugins/anaf-spv/sync';

/**
 * Process SPV invoice sync - finds all tenants with active SPV integrations
 * and syncs invoices for the last 2 days
 */
export async function processSpvInvoiceSync(params: Record<string, any> = {}) {
	try {
		// Get all tenants with active SPV integrations
		const integrations = await db
			.select({
				tenantId: table.anafSpvIntegration.tenantId
			})
			.from(table.anafSpvIntegration)
			.where(eq(table.anafSpvIntegration.isActive, true));

		if (integrations.length === 0) {
			console.log('[SPV-Sync] No tenants with active SPV integrations. Skipping sync.');
			return {
				success: true,
				tenantsProcessed: 0,
				totalImported: 0,
				totalUpdated: 0,
				totalSkipped: 0,
				totalErrors: 0
			};
		}

		let tenantsProcessed = 0;
		let totalImported = 0;
		let totalUpdated = 0;
		let totalSkipped = 0;
		let totalErrors = 0;
		const errors: Array<{ tenantId: string; error: string }> = [];

		// Process each tenant
		for (const integration of integrations) {
			try {
				console.log(`[SPV-Sync] Syncing invoices for tenant ${integration.tenantId}...`);

				// Sync received invoices (expenses from suppliers)
				console.log(`[SPV-Sync] Syncing received invoices (expenses) for tenant ${integration.tenantId}...`);
				const receivedResult = await syncSpvInvoicesForTenant(integration.tenantId, 'P', 2); // 'P' for received invoices, 2 days

				// Sync sent invoices (invoices you created and sent to clients)
				console.log(`[SPV-Sync] Syncing sent invoices for tenant ${integration.tenantId}...`);
				const sentResult = await syncSentInvoicesFromSpv(integration.tenantId, 2); // 2 days

				tenantsProcessed++;
				totalImported += receivedResult.imported + sentResult.imported;
				totalUpdated += receivedResult.updated + sentResult.updated;
				totalSkipped += receivedResult.skipped + sentResult.skipped;
				totalErrors += receivedResult.errors + sentResult.errors;

				console.log(
					`[SPV-Sync] Tenant ${integration.tenantId}: ${receivedResult.imported + sentResult.imported} imported, ${receivedResult.updated + sentResult.updated} updated (${receivedResult.imported} received, ${sentResult.imported} sent), ${receivedResult.skipped + sentResult.skipped} skipped, ${receivedResult.errors + sentResult.errors} errors`
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(
					`[SPV-Sync] Error syncing invoices for tenant ${integration.tenantId}:`,
					errorMessage
				);
				errors.push({
					tenantId: integration.tenantId,
					error: errorMessage
				});
				// Continue with other tenants
			}
		}

		console.log(
			`[SPV-Sync] Completed: ${tenantsProcessed} tenants processed, ${totalImported} invoices imported, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`
		);

		return {
			success: true,
			tenantsProcessed,
			totalImported,
			totalUpdated,
			totalSkipped,
			totalErrors,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		console.error('[SPV-Sync] Process error:', error);
		return {
			success: false,
			tenantsProcessed: 0,
			totalImported: 0,
			totalUpdated: 0,
			totalSkipped: 0,
			totalErrors: 0,
			error: 'Failed to process SPV invoice sync'
		};
	}
}
