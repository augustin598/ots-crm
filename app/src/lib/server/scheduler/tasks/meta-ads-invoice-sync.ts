import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncMetaAdsInvoicesForTenant } from '$lib/server/meta-ads/sync';
import { downloadAllReceiptsForMonth } from '$lib/server/meta-ads/invoice-downloader';

/**
 * Process Meta Ads sync: spending data + invoice PDF downloads.
 * Runs monthly (2nd of each month at 9AM).
 *
 * Step 1: Sync spending data from Insights API
 * Step 2: Download billing PDF receipts from invoices_generator
 */
export async function processMetaAdsInvoiceSync() {
	logInfo('scheduler', 'Starting Meta Ads sync (spending + invoice downloads)');

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
	let totalDownloaded = 0;
	let totalSkipped = 0;

	// Step 1: Spending sync (Insights API)
	for (const tenantId of tenantIds) {
		try {
			const result = await syncMetaAdsInvoicesForTenant(tenantId);
			totalImported += result.imported;
			totalUpdated += result.updated;
			totalErrors += result.errors;
		} catch (err) {
			logError('scheduler', `Meta Ads spending sync failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	// Step 2: Invoice PDF downloads (previous month)
	const now = new Date();
	const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() is 0-indexed
	const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

	for (const tenantId of tenantIds) {
		try {
			const result = await downloadAllReceiptsForMonth(tenantId, prevYear, prevMonth);
			totalDownloaded += result.downloaded;
			totalSkipped += result.skipped;
			totalErrors += result.errors;
		} catch (err) {
			logError('scheduler', `Meta Ads invoice download failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	logInfo('scheduler', `Meta Ads sync completed`, {
		metadata: {
			totalImported, totalUpdated, totalDownloaded, totalSkipped,
			totalErrors, tenantCount: tenantIds.length,
			period: `${prevYear}-${String(prevMonth).padStart(2, '0')}`
		}
	});

	return { totalImported, totalUpdated, totalDownloaded, totalSkipped, totalErrors };
}
