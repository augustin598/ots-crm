import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncMetaAdsInvoicesForTenant } from '$lib/server/meta-ads/sync';

/**
 * Process Meta Ads spending sync for all active integrations.
 * Runs monthly (1st of each month at 7AM).
 */
export async function processMetaAdsInvoiceSync() {
	logInfo('scheduler', 'Starting Meta Ads spending sync');

	const integrations = await db
		.select({
			tenantId: table.metaAdsIntegration.tenantId
		})
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.isActive, true),
				eq(table.metaAdsIntegration.syncEnabled, true)
			)
		);

	const tenantIds = [...new Set(integrations.map(i => i.tenantId))];

	logInfo('scheduler', `Found ${tenantIds.length} tenants with active Meta Ads integrations`);

	let totalImported = 0;
	let totalUpdated = 0;
	let totalErrors = 0;

	for (const tenantId of tenantIds) {
		try {
			const result = await syncMetaAdsInvoicesForTenant(tenantId);
			totalImported += result.imported;
			totalUpdated += result.updated;
			totalErrors += result.errors;
		} catch (err) {
			logError('scheduler', `Meta Ads sync failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	logInfo('scheduler', `Meta Ads spending sync completed`, {
		metadata: { totalImported, totalUpdated, totalErrors, tenantCount: tenantIds.length }
	});

	return { totalImported, totalUpdated, totalErrors };
}
