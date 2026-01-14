import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { syncSpvInvoicesForTenant } from '../../plugins/anaf-spv/sync';

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
				totalSkipped: 0,
				totalErrors: 0
			};
		}

		let tenantsProcessed = 0;
		let totalImported = 0;
		let totalSkipped = 0;
		let totalErrors = 0;
		const errors: Array<{ tenantId: string; error: string }> = [];

		// Process each tenant
		for (const integration of integrations) {
			try {
				console.log(`[SPV-Sync] Syncing invoices for tenant ${integration.tenantId}...`);

				const result = await syncSpvInvoicesForTenant(integration.tenantId, 'P', 2); // 'P' for received invoices, 2 days

				tenantsProcessed++;
				totalImported += result.imported;
				totalSkipped += result.skipped;
				totalErrors += result.errors;

				console.log(
					`[SPV-Sync] Tenant ${integration.tenantId}: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`
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
			`[SPV-Sync] Completed: ${tenantsProcessed} tenants processed, ${totalImported} invoices imported, ${totalSkipped} skipped, ${totalErrors} errors`
		);

		return {
			success: true,
			tenantsProcessed,
			totalImported,
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
			totalSkipped: 0,
			totalErrors: 0,
			error: 'Failed to process SPV invoice sync'
		};
	}
}
