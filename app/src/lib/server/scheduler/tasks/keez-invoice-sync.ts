import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { KeezCredentialsCorruptError } from '../../plugins/keez/factory';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

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
				// Credentials corrupt — could be transient Turso read failure.
				// Retry once with fresh DB read before deactivating.
				if (error instanceof KeezCredentialsCorruptError) {
					logWarning('scheduler', `Keez invoice sync: credentials decrypt failed — retrying with fresh DB read`, {
						tenantId: integration.tenantId,
						metadata: { action: 'decrypt_retry', attempt: 1 }
					});

					// Wait briefly then retry (fresh DB read inside syncKeezInvoicesForTenant)
					await new Promise(r => setTimeout(r, 2000));

					try {
						const retryResult = await syncKeezInvoicesForTenant(integration.tenantId);
						tenantsProcessed++;
						totalImported += retryResult.imported;
						totalUpdated += retryResult.updated;
						totalSkipped += retryResult.skipped;
						totalErrors += retryResult.errors;
						logInfo('scheduler', `Keez invoice sync: retry succeeded after transient decrypt failure`, {
							tenantId: integration.tenantId,
							metadata: { imported: retryResult.imported, updated: retryResult.updated }
						});
						continue;
					} catch (retryError) {
						if (retryError instanceof KeezCredentialsCorruptError) {
							logWarning('scheduler', `Keez invoice sync: credentials corrupt after retry — deactivating integration until user re-saves`, {
								tenantId: integration.tenantId,
								metadata: { action: 'auto_deactivate_corrupt_credentials', retriesExhausted: true }
							});
							await db
								.update(table.keezIntegration)
								.set({ isActive: false, updatedAt: new Date() })
								.where(eq(table.keezIntegration.tenantId, integration.tenantId));
							continue;
						}
						// Non-credential retry error — fall through to normal error handling
						const { message, stack } = serializeError(retryError);
						logError('scheduler', `Keez invoice sync: retry error: ${message}`, { tenantId: integration.tenantId, stackTrace: stack });
						errors.push({ tenantId: integration.tenantId, error: message });
						continue;
					}
				}

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
