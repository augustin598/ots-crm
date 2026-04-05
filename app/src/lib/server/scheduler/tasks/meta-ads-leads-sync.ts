import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncMetaAdsLeadsForTenant } from '$lib/server/meta-ads/leads-sync';

/**
 * Process Meta Ads lead sync for all tenants with active integrations.
 * Runs every 4 hours via scheduler.
 */
export async function processMetaAdsLeadsSync() {
	logInfo('scheduler', 'Starting Meta Ads lead sync (scheduled)', { metadata: { trigger: 'scheduled' } });

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

	const tenantIds = [...new Set(integrations.map((i) => i.tenantId))];

	logInfo('scheduler', `Found ${tenantIds.length} tenants with active Meta Ads integrations for lead sync`, { metadata: { tenantCount: tenantIds.length } });

	let totalImported = 0;
	let totalSkipped = 0;
	let totalErrors = 0;

	for (const tenantId of tenantIds) {
		try {
			const result = await syncMetaAdsLeadsForTenant(tenantId, 'scheduled');
			totalImported += result.imported;
			totalSkipped += result.skipped;
			totalErrors += result.errors;

			// Hook emission (leads.imported) is handled inside syncMetaAdsLeadsForTenant
		} catch (err) {
			logError('scheduler', `Meta Ads lead sync failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	logInfo('scheduler', 'Meta Ads lead sync completed', {
		metadata: { totalImported, totalSkipped, totalErrors, tenantCount: tenantIds.length }
	});

	return { totalImported, totalSkipped, totalErrors };
}
