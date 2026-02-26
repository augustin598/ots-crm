import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';

/**
 * Process Keez invoice sync - finds all tenants with active Keez integrations
 * and syncs invoices for each tenant.
 */
export async function processKeezInvoiceSync(params: Record<string, any> = {}) {
	try {
		// Get all tenants with active Keez integrations
		const integrations = await db
			.select({ tenantId: table.keezIntegration.tenantId })
			.from(table.keezIntegration)
			.where(eq(table.keezIntegration.isActive, true));

		if (integrations.length === 0) {
			console.log('[Keez-Sync] No tenants with active Keez integrations. Skipping sync.');
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

		for (const integration of integrations) {
			try {
				console.log(`[Keez-Sync] Syncing invoices for tenant ${integration.tenantId}...`);

				const result = await syncKeezInvoicesForTenant(integration.tenantId);

				tenantsProcessed++;
				totalImported += result.imported;
				totalUpdated += result.updated;
				totalSkipped += result.skipped;
				totalErrors += result.errors;

				console.log(
					`[Keez-Sync] Tenant ${integration.tenantId}: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(
					`[Keez-Sync] Error syncing invoices for tenant ${integration.tenantId}:`,
					errorMessage
				);
				errors.push({ tenantId: integration.tenantId, error: errorMessage });
			}
		}

		console.log(
			`[Keez-Sync] Completed: ${tenantsProcessed} tenants processed, ${totalImported} imported, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`
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
		console.error('[Keez-Sync] Process error:', error);
		return {
			success: false,
			tenantsProcessed: 0,
			totalImported: 0,
			totalUpdated: 0,
			totalSkipped: 0,
			totalErrors: 0,
			error: 'Failed to process Keez invoice sync'
		};
	}
}
