import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncGoogleAdsInvoicesForTenant } from '$lib/server/google-ads/sync';

/**
 * Process Google Ads invoice sync for all active integrations
 * Runs monthly (1st of each month at 6AM)
 */
export async function processGoogleAdsInvoiceSync() {
	logInfo('scheduler', 'Starting Google Ads invoice sync');

	const integrations = await db
		.select({
			tenantId: table.googleAdsIntegration.tenantId
		})
		.from(table.googleAdsIntegration)
		.where(
			and(
				eq(table.googleAdsIntegration.isActive, true),
				eq(table.googleAdsIntegration.syncEnabled, true)
			)
		);

	logInfo('scheduler', `Found ${integrations.length} active Google Ads integrations`);

	let totalImported = 0;
	let totalErrors = 0;
	let totalSkipped = 0;

	for (const integration of integrations) {
		try {
			const result = await syncGoogleAdsInvoicesForTenant(integration.tenantId);
			totalImported += result.imported;
			totalErrors += result.errors;
			totalSkipped += result.skipped;
		} catch (err) {
			logError('scheduler', `Google Ads sync failed for tenant ${integration.tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	logInfo('scheduler', `Google Ads invoice sync completed`, {
		metadata: { totalImported, totalErrors, totalSkipped, tenantCount: integrations.length }
	});

	return { totalImported, totalErrors, totalSkipped };
}
