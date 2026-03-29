import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncTiktokAdsSpendingForTenant } from '$lib/server/tiktok-ads/sync';
import { downloadAllInvoicesForMonth } from '$lib/server/tiktok-ads/invoice-downloader';
import { createNotification } from '$lib/server/notifications';

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

	// Step 3: Notify admins about expired sessions
	for (const tenantId of tenantIds) {
		try {
			const expiredIntegrations = await db
				.select({ id: table.tiktokAdsIntegration.id })
				.from(table.tiktokAdsIntegration)
				.where(
					and(
						eq(table.tiktokAdsIntegration.tenantId, tenantId),
						eq(table.tiktokAdsIntegration.isActive, true),
						eq(table.tiktokAdsIntegration.ttSessionStatus, 'expired')
					)
				);

			if (expiredIntegrations.length > 0) {
				const admins = await db
					.select({ userId: table.tenantUser.userId })
					.from(table.tenantUser)
					.where(
						and(
							eq(table.tenantUser.tenantId, tenantId),
							or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
						)
					);

				for (const admin of admins) {
					await createNotification({
						tenantId,
						userId: admin.userId,
						type: 'sync.error',
						title: 'Sesiune TikTok expirată',
						message: 'Sesiunea TikTok a expirat. Deschide pagina TikTok Ads Facturi și apasă "Scan cu Browser" pentru a reîmprospăta cookie-urile.',
						link: 'invoices/tiktok-ads'
					});
				}
			}
		} catch {
			// Don't fail sync for notification errors
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
