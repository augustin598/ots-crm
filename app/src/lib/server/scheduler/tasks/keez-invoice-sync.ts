import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { logInfo, logError, serializeError } from '$lib/server/logger';

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
			logInfo('scheduler', 'Keez invoice sync: no tenants with active integrations, skipping', { metadata: { activeIntegrations: 0 } });
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
				logInfo('scheduler', `Keez invoice sync: syncing invoices`, { tenantId: integration.tenantId });

				const result = await syncKeezInvoicesForTenant(integration.tenantId);

				tenantsProcessed++;
				totalImported += result.imported;
				totalUpdated += result.updated;
				totalSkipped += result.skipped;
				totalErrors += result.errors;

				logInfo('scheduler', `Keez invoice sync: tenant completed`, { tenantId: integration.tenantId, metadata: { imported: result.imported, updated: result.updated, skipped: result.skipped, errors: result.errors } });
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Keez invoice sync: error syncing invoices: ${message}`, { tenantId: integration.tenantId, stackTrace: stack });
				errors.push({ tenantId: integration.tenantId, error: message });
			}
		}

		logInfo('scheduler', `Keez invoice sync completed`, { metadata: { tenantsProcessed, totalImported, totalUpdated, totalSkipped, totalErrors } });

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
		const { message, stack } = serializeError(error);
		logError('scheduler', `Keez invoice sync: process error: ${message}`, { stackTrace: stack });
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
