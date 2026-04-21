import { db } from '../../db';
import * as table from '../../db/schema';
import { eq } from 'drizzle-orm';
import { syncKeezInvoicesForTenant } from '../../plugins/keez/sync';
import { KeezCredentialsCorruptError } from '../../plugins/keez/errors';
import { handleKeezSyncFailure } from '../../plugins/keez/failure-handler';
import { enqueueKeezRetry } from './keez-invoice-sync-retry';
import { logInfo, logWarning } from '$lib/server/logger';

/**
 * Daily Keez invoice sync. Finds every tenant with an active integration
 * and calls the shared sync for each. On per-tenant failure, delegates to
 * handleKeezSyncFailure, which decides between retry and degraded.
 */
export async function processKeezInvoiceSync(_params: Record<string, any> = {}) {
	const integrations = await db
		.select({ tenantId: table.keezIntegration.tenantId })
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.isActive, true));

	if (integrations.length === 0) {
		logInfo('scheduler', 'Keez invoice sync: no active integrations, skipping', { metadata: { activeIntegrations: 0 } });
		return { success: true, tenantsProcessed: 0, totalImported: 0, totalUpdated: 0, totalSkipped: 0, totalErrors: 0 };
	}

	let tenantsProcessed = 0;
	let totalImported = 0;
	let totalUpdated = 0;
	let totalSkipped = 0;
	let totalErrors = 0;

	for (const integration of integrations) {
		try {
			logInfo('scheduler', `Keez invoice sync: starting`, { tenantId: integration.tenantId });
			const result = await syncKeezInvoicesForTenant(integration.tenantId);
			tenantsProcessed++;
			totalImported += result.imported;
			totalUpdated += result.updated;
			totalSkipped += result.skipped;
			totalErrors += result.errors;
			logInfo('scheduler', `Keez invoice sync: tenant completed`, {
				tenantId: integration.tenantId,
				metadata: { imported: result.imported, updated: result.updated, skipped: result.skipped, errors: result.errors }
			});
		} catch (error) {
			// Transient decrypt failure — retry once with fresh DB read before classifying.
			if (error instanceof KeezCredentialsCorruptError) {
				logWarning('scheduler', `Keez sync: decrypt failed, retrying once with fresh DB read`, {
					tenantId: integration.tenantId,
					metadata: { action: 'decrypt_retry' }
				});
				await new Promise(r => setTimeout(r, 2000));
				try {
					const retryResult = await syncKeezInvoicesForTenant(integration.tenantId);
					tenantsProcessed++;
					totalImported += retryResult.imported;
					totalUpdated += retryResult.updated;
					totalSkipped += retryResult.skipped;
					totalErrors += retryResult.errors;
					continue;
				} catch (retryError) {
					await handleKeezSyncFailure(integration.tenantId, retryError, { enqueueRetry: enqueueKeezRetry });
					continue;
				}
			}

			await handleKeezSyncFailure(integration.tenantId, error, { enqueueRetry: enqueueKeezRetry });
		}
	}

	logInfo('scheduler', `Keez invoice sync completed`, {
		metadata: { tenantsProcessed, totalImported, totalUpdated, totalSkipped, totalErrors }
	});

	return { success: true, tenantsProcessed, totalImported, totalUpdated, totalSkipped, totalErrors };
}
