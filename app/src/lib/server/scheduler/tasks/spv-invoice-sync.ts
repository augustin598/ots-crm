import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { syncSpvInvoicesForTenant, syncSentInvoicesFromSpv } from '../../plugins/anaf-spv/sync';
import { logInfo, logError, serializeError } from '$lib/server/logger';

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
			logInfo('scheduler', 'SPV invoice sync: no tenants with active integrations, skipping', { metadata: { activeIntegrations: 0 } });
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
				logInfo('scheduler', `SPV invoice sync: syncing invoices for tenant`, { tenantId: integration.tenantId });

				// Sync received invoices (expenses from suppliers)
				logInfo('scheduler', `SPV invoice sync: syncing received invoices (expenses)`, { tenantId: integration.tenantId });
				const receivedResult = await syncSpvInvoicesForTenant(integration.tenantId, 'P', 2); // 'P' for received invoices, 2 days

				// Sync sent invoices (invoices you created and sent to clients)
				logInfo('scheduler', `SPV invoice sync: syncing sent invoices`, { tenantId: integration.tenantId });
				const sentResult = await syncSentInvoicesFromSpv(integration.tenantId, 2); // 2 days

				tenantsProcessed++;
				totalImported += receivedResult.imported + sentResult.imported;
				totalUpdated += receivedResult.updated + sentResult.updated;
				totalSkipped += receivedResult.skipped + sentResult.skipped;
				totalErrors += receivedResult.errors + sentResult.errors;

				logInfo('scheduler', `SPV invoice sync: tenant completed`, { tenantId: integration.tenantId, metadata: { imported: receivedResult.imported + sentResult.imported, updated: receivedResult.updated + sentResult.updated, skipped: receivedResult.skipped + sentResult.skipped, errors: receivedResult.errors + sentResult.errors } });
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `SPV invoice sync: error syncing invoices for tenant: ${message}`, { tenantId: integration.tenantId, stackTrace: stack });
				errors.push({
					tenantId: integration.tenantId,
					error: message
				});
				// Continue with other tenants
			}
		}

		logInfo('scheduler', `SPV invoice sync completed`, { metadata: { tenantsProcessed, totalImported, totalUpdated, totalSkipped, totalErrors } });

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
		logError('scheduler', `SPV invoice sync: process error: ${message}`, { stackTrace: stack });
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
