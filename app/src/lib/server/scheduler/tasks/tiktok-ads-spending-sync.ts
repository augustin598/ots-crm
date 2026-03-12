import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncTiktokAdsSpendingForTenant } from '$lib/server/tiktok-ads/sync';
import { downloadAllInvoicesForMonth } from '$lib/server/tiktok-ads/invoice-downloader';

/**
 * Process TikTok Ads sync: spending data + invoice PDF downloads.
 * Runs monthly (2nd of each month at 8AM).
 *
 * Step 1: Sync spending data from Reporting API
 * Step 2: Download billing PDF invoices via cookie-based flow
 */
export async function processTiktokAdsSpendingSync() {
	logInfo('scheduler', 'Starting TikTok Ads sync (spending + invoice downloads)');

	const integrations = await db
		.select({
			tenantId: table.tiktokAdsIntegration.tenantId
		})
		.from(table.tiktokAdsIntegration)
		.where(
			and(
				eq(table.tiktokAdsIntegration.isActive, true),
				eq(table.tiktokAdsIntegration.syncEnabled, true)
			)
		);

	const tenantIds = [...new Set(integrations.map(i => i.tenantId))];

	logInfo('scheduler', `Found ${tenantIds.length} tenants with active TikTok Ads integrations`);

	let totalImported = 0;
	let totalUpdated = 0;
	let totalErrors = 0;
	let totalDownloaded = 0;
	let totalSkipped = 0;

	// Step 1: Spending sync (Reporting API)
	for (const tenantId of tenantIds) {
		try {
			const result = await syncTiktokAdsSpendingForTenant(tenantId);
			totalImported += result.imported;
			totalUpdated += result.updated;
			totalErrors += result.errors;
		} catch (err) {
			logError('scheduler', `TikTok Ads spending sync failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	// Step 2: Invoice PDF downloads (previous month)
	const now = new Date();
	const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
	const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

	for (const tenantId of tenantIds) {
		try {
			const result = await downloadAllInvoicesForMonth(tenantId, prevYear, prevMonth);
			totalDownloaded += result.downloaded;
			totalSkipped += result.skipped;
			totalErrors += result.errors;
		} catch (err) {
			logError('scheduler', `TikTok Ads invoice download failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	logInfo('scheduler', `TikTok Ads sync completed`, {
		metadata: {
			totalImported, totalUpdated, totalDownloaded, totalSkipped,
			totalErrors, tenantCount: tenantIds.length,
			period: `${prevYear}-${String(prevMonth).padStart(2, '0')}`
		}
	});

	return { totalImported, totalUpdated, totalDownloaded, totalSkipped, totalErrors };
}
