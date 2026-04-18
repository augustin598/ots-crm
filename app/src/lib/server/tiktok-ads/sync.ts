import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedToken } from './auth';
import { listAdvertiserInsights, getSyncDateRange } from './client';
import { generateSpendingReportPdf } from './spending-report-pdf';
import type { SpendingPeriod } from './spending-report-pdf';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';

/**
 * Parse spend amount string to cents.
 * TikTok returns spend as e.g. "2207.59" → 220759
 */
function spendToCents(amount: string): number {
	const parsed = parseFloat(amount);
	if (isNaN(parsed)) return 0;
	return Math.round(parsed * 100);
}

/**
 * Sync TikTok Ads spending data for a specific tenant.
 * Iterates over ALL active integrations for the tenant.
 */
export async function syncTiktokAdsSpendingForTenant(tenantId: string) {
	logInfo('tiktok-ads-sync', 'Starting spending sync for tenant', { tenantId });

	const integrations = await db
		.select()
		.from(table.tiktokAdsIntegration)
		.where(
			and(
				eq(table.tiktokAdsIntegration.tenantId, tenantId),
				eq(table.tiktokAdsIntegration.isActive, true),
				eq(table.tiktokAdsIntegration.syncEnabled, true)
			)
		);

	if (integrations.length === 0) {
		logInfo('tiktok-ads-sync', 'No active integrations found', { tenantId });
		return { imported: 0, updated: 0, errors: 0 };
	}

	let totalImported = 0;
	let totalUpdated = 0;
	let totalErrors = 0;

	for (const integration of integrations) {
		const result = await syncForIntegration(tenantId, integration);
		totalImported += result.imported;
		totalUpdated += result.updated;
		totalErrors += result.errors;
	}

	logInfo('tiktok-ads-sync', 'Spending sync completed', {
		tenantId,
		metadata: { totalImported, totalUpdated, totalErrors, integrationCount: integrations.length }
	});

	return { imported: totalImported, updated: totalUpdated, errors: totalErrors };
}

/**
 * Sync spending data for a single integration.
 */
async function syncForIntegration(
	tenantId: string,
	integration: table.TiktokAdsIntegration
) {
	logInfo('tiktok-ads-sync', `Syncing integration ${integration.id}`, { tenantId });

	const authResult = await getAuthenticatedToken(integration.id);
	if (!authResult) {
		logWarning('tiktok-ads-sync', 'Could not get authenticated token', { tenantId, metadata: { integrationId: integration.id } });
		return { imported: 0, updated: 0, errors: 1 };
	}

	const { accessToken } = authResult;

	// Get ad accounts mapped to CRM clients
	const mappedAccounts = await db
		.select({
			tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
			clientId: table.tiktokAdsAccount.clientId,
			accountName: table.tiktokAdsAccount.accountName
		})
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.integrationId, integration.id),
				eq(table.tiktokAdsAccount.isActive, true)
			)
		);

	const accountsWithClient = mappedAccounts.filter(a => a.clientId);

	if (accountsWithClient.length === 0) {
		logInfo('tiktok-ads-sync', 'No ad accounts mapped to CRM clients', { tenantId });
		return { imported: 0, updated: 0, errors: 0 };
	}

	// Get tenant info for PDF
	const [tenantInfo] = await db
		.select({ name: table.tenant.name })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	const { startDate, endDate } = getSyncDateRange();
	let imported = 0;
	let updated = 0;
	let errors = 0;

	for (const account of accountsWithClient) {
		try {
			const insights = await listAdvertiserInsights(
				account.tiktokAdvertiserId,
				accessToken,
				startDate,
				endDate
			);

			if (insights.length === 0) {
				logInfo('tiktok-ads-sync', `No insights for ${account.tiktokAdvertiserId}`, { tenantId });
				continue;
			}

			// Get client name for PDF
			const [clientInfo] = await db
				.select({ name: table.client.name })
				.from(table.client)
				.where(eq(table.client.id, account.clientId!))
				.limit(1);

			// Collect periods for PDF generation
			const pdfPeriods: SpendingPeriod[] = [];

			for (const insight of insights) {
				const spendCents = spendToCents(insight.spend);

				// Dedup: check if this period already exists
				const [existing] = await db
					.select({
						id: table.tiktokAdsSpending.id,
						spendCents: table.tiktokAdsSpending.spendCents,
						impressions: table.tiktokAdsSpending.impressions,
						clicks: table.tiktokAdsSpending.clicks,
						conversions: table.tiktokAdsSpending.conversions
					})
					.from(table.tiktokAdsSpending)
					.where(
						and(
							eq(table.tiktokAdsSpending.tenantId, tenantId),
							eq(table.tiktokAdsSpending.tiktokAdvertiserId, account.tiktokAdvertiserId),
							eq(table.tiktokAdsSpending.periodStart, insight.dateStart),
							eq(table.tiktokAdsSpending.clientId, account.clientId!)
						)
					)
					.limit(1);

				const newImpressions = parseInt(insight.impressions) || 0;
				const newClicks = parseInt(insight.clicks) || 0;
				const newConversions = parseInt(insight.conversions) || 0;

				if (existing) {
					const metricsChanged =
						existing.spendCents !== spendCents ||
						existing.impressions !== newImpressions ||
						existing.clicks !== newClicks ||
						existing.conversions !== newConversions;

					if (metricsChanged) {
						await db
							.update(table.tiktokAdsSpending)
							.set({
								spendAmount: insight.spend,
								spendCents,
								impressions: newImpressions,
								clicks: newClicks,
								conversions: newConversions,
								syncedAt: new Date(),
								updatedAt: new Date()
							})
							.where(eq(table.tiktokAdsSpending.id, existing.id));
						updated++;
					}
				} else {
					await db.insert(table.tiktokAdsSpending).values({
						id: crypto.randomUUID(),
						tenantId,
						integrationId: integration.id,
						clientId: account.clientId!,
						tiktokAdvertiserId: account.tiktokAdvertiserId,
						periodStart: insight.dateStart,
						periodEnd: insight.dateStop,
						spendAmount: insight.spend,
						spendCents,
						currencyCode: 'RON',
						impressions: parseInt(insight.impressions) || 0,
						clicks: parseInt(insight.clicks) || 0,
						conversions: parseInt(insight.conversions) || 0,
						syncedAt: new Date(),
						createdAt: new Date(),
						updatedAt: new Date()
					});
					imported++;
				}

				pdfPeriods.push({
					periodStart: insight.dateStart,
					periodEnd: insight.dateStop,
					spend: insight.spend,
					impressions: parseInt(insight.impressions) || 0,
					clicks: parseInt(insight.clicks) || 0,
					conversions: parseInt(insight.conversions) || 0
				});
			}

			// Generate combined PDF for all periods of this account
			if (pdfPeriods.length > 0) {
				try {
					const pdfBuffer = await generateSpendingReportPdf({
						tenantName: tenantInfo?.name || '',
						clientName: clientInfo?.name || '',
						adAccountId: account.tiktokAdvertiserId,
						adAccountName: account.accountName,
						currencyCode: 'RON',
						periods: pdfPeriods,
						generatedAt: new Date()
					});

					const periodLabel = `${startDate.slice(0, 7)}_${endDate.slice(0, 7)}`;
					const fileName = `tiktok-spending-${account.tiktokAdvertiserId}_${periodLabel}.pdf`;

					const upload = await uploadBuffer(
						tenantId,
						pdfBuffer,
						fileName,
						'application/pdf',
						{ type: 'tiktok-spending-report', advertiserId: account.tiktokAdvertiserId, period: startDate }
					);

					// Update PDF path on all spending rows for this account+client
					for (const insight of insights) {
						await db
							.update(table.tiktokAdsSpending)
							.set({ pdfPath: upload.path, updatedAt: new Date() })
							.where(
								and(
									eq(table.tiktokAdsSpending.tenantId, tenantId),
									eq(table.tiktokAdsSpending.tiktokAdvertiserId, account.tiktokAdvertiserId),
									eq(table.tiktokAdsSpending.periodStart, insight.dateStart),
									eq(table.tiktokAdsSpending.clientId, account.clientId!)
								)
							);
					}

					logInfo('tiktok-ads-sync', `PDF generated for ${account.accountName}`, {
						tenantId,
						metadata: { path: upload.path, periods: pdfPeriods.length }
					});
				} catch (pdfErr) {
					logError('tiktok-ads-sync', `PDF generation failed for ${account.tiktokAdvertiserId}`, {
						tenantId,
						metadata: { error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr) }
					});
				}
			}
		} catch (err) {
			logError('tiktok-ads-sync', `Failed to sync ${account.tiktokAdvertiserId}`, {
				tenantId,
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			errors++;
		}
	}

	// Update integration status
	const syncResults = JSON.stringify({ imported, updated, errors, timestamp: new Date().toISOString() });
	await db
		.update(table.tiktokAdsIntegration)
		.set({ lastSyncAt: new Date(), lastSyncResults: syncResults, updatedAt: new Date() })
		.where(eq(table.tiktokAdsIntegration.id, integration.id));

	return { imported, updated, errors };
}
