import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncMetaAdsInvoicesForTenant } from '$lib/server/meta-ads/sync';
import { downloadAllReceiptsForMonth } from '$lib/server/meta-ads/invoice-downloader';
import { createNotification } from '$lib/server/notifications';

/**
 * Process Meta Ads sync: spending data + invoice PDF downloads.
 * Runs monthly (2nd of each month at 9AM).
 *
 * Step 1: Sync spending data from Insights API
 * Step 2: Download billing PDF receipts from invoices_generator
 */
export async function processMetaAdsInvoiceSync() {
	logInfo('scheduler', 'Starting Meta Ads sync (spending + invoice downloads)', { metadata: { trigger: 'scheduled' } });

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

	logInfo('scheduler', `Found ${tenantIds.length} tenants with active Meta Ads integrations`, { metadata: { tenantCount: tenantIds.length } });

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

	// Step 2: Invoice PDF downloads (previous month + catch-up for missed months)
	const now = new Date();
	const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() is 0-indexed
	const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

	// Build list of months to download: previous month + up to 11 more catch-up months (full year)
	const MAX_CATCHUP_MONTHS = 11;
	const monthsToDownload: Array<{ year: number; month: number }> = [];

	// Always include previous month
	monthsToDownload.push({ year: prevYear, month: prevMonth });

	// Add catch-up months (going further back)
	for (let i = 1; i <= MAX_CATCHUP_MONTHS; i++) {
		const d = new Date(prevYear, prevMonth - 1 - i, 1); // prevMonth is 1-indexed, Date month is 0-indexed
		monthsToDownload.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
	}

	for (const tenantId of tenantIds) {
		for (const { year, month } of monthsToDownload) {
			try {
				const result = await downloadAllReceiptsForMonth(tenantId, year, month);
				totalDownloaded += result.downloaded;
				totalSkipped += result.skipped;
				totalErrors += result.errors;
			} catch (err) {
				logError('scheduler', `Meta Ads invoice download failed for tenant ${tenantId}`, {
					metadata: { error: err instanceof Error ? err.message : String(err), year, month }
				});
				totalErrors++;
			}
		}
	}

	// Step 3: Notify admins about expired sessions
	for (const tenantId of tenantIds) {
		try {
			const expiredIntegrations = await db
				.select({ id: table.metaAdsIntegration.id, businessName: table.metaAdsIntegration.businessName })
				.from(table.metaAdsIntegration)
				.where(
					and(
						eq(table.metaAdsIntegration.tenantId, tenantId),
						eq(table.metaAdsIntegration.isActive, true),
						eq(table.metaAdsIntegration.fbSessionStatus, 'expired')
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
						title: 'Sesiune Facebook expirată',
						message: `Sesiunea Facebook (${expiredIntegrations[0].businessName || 'BM'}) a expirat. Deschide pagina Meta Ads Facturi și apasă "Scan cu Browser" pentru a reîmprospăta cookie-urile.`,
						link: `invoices/meta-ads`
					});
				}
			}
		} catch {
			// Don't fail the whole sync for notification errors
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
