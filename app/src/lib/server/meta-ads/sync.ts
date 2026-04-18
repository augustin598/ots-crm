import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedToken } from './auth';
import { listAdAccountInsights, getSyncDateRange } from './client';
import { generateSpendingReportPdf } from './spending-report-pdf';
import type { SpendingPeriod } from './spending-report-pdf';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';

/**
 * Parse spend amount string to cents.
 * Meta returns spend as e.g. "2207.59" → 220759
 */
function spendToCents(amount: string): number {
	const parsed = parseFloat(amount);
	if (isNaN(parsed)) return 0;
	return Math.round(parsed * 100);
}

/**
 * Sync Meta Ads spending data for a specific tenant.
 * Iterates over ALL active integrations (Business Managers) for the tenant.
 */
export async function syncMetaAdsInvoicesForTenant(tenantId: string) {
	logInfo('meta-ads-sync', `Starting spending sync for tenant`, { tenantId });

	const integrations = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.tenantId, tenantId),
				eq(table.metaAdsIntegration.isActive, true),
				eq(table.metaAdsIntegration.syncEnabled, true)
			)
		);

	if (integrations.length === 0) {
		logInfo('meta-ads-sync', 'No active integrations found', { tenantId });
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

	logInfo('meta-ads-sync', `Spending sync completed`, {
		tenantId,
		metadata: { totalImported, totalUpdated, totalErrors, integrationCount: integrations.length }
	});

	return { imported: totalImported, updated: totalUpdated, errors: totalErrors };
}

/**
 * Sync spending data for a single integration (Business Manager).
 * Fetches /insights per mapped ad account instead of business_invoices.
 */
async function syncForIntegration(
	tenantId: string,
	integration: table.MetaAdsIntegration
) {
	logInfo('meta-ads-sync', `Syncing BM ${integration.businessId} (${integration.businessName})`, { tenantId });

	/** Helper to persist sync results before returning */
	async function saveSyncResults(result: { imported: number; updated: number; errors: number; accountsTotal: number; accountsWithClient: number }) {
		const syncResults = JSON.stringify({ ...result, timestamp: new Date().toISOString() });
		await db
			.update(table.metaAdsIntegration)
			.set({ lastSyncAt: new Date(), lastSyncResults: syncResults, updatedAt: new Date() })
			.where(eq(table.metaAdsIntegration.id, integration.id));
	}

	const authResult = await getAuthenticatedToken(integration.id);
	if (!authResult) {
		logWarning('meta-ads-sync', `Could not get authenticated token for ${integration.businessName}`, { tenantId, metadata: { integrationId: integration.id } });
		await saveSyncResults({ imported: 0, updated: 0, errors: 1, accountsTotal: 0, accountsWithClient: 0 });
		return { imported: 0, updated: 0, errors: 1 };
	}

	const { accessToken } = authResult;
	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		logError('meta-ads-sync', 'META_APP_SECRET not configured', { tenantId });
		await saveSyncResults({ imported: 0, updated: 0, errors: 1, accountsTotal: 0, accountsWithClient: 0 });
		return { imported: 0, updated: 0, errors: 1 };
	}

	// Get ad accounts mapped to CRM clients
	const mappedAccounts = await db
		.select({
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
			clientId: table.metaAdsAccount.clientId,
			accountName: table.metaAdsAccount.accountName
		})
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.integrationId, integration.id),
				eq(table.metaAdsAccount.isActive, true)
			)
		);

	// Filter to only accounts with a client assigned
	const accountsWithClient = mappedAccounts.filter(a => a.clientId);

	logInfo('meta-ads-sync', `BM ${integration.businessName}: ${mappedAccounts.length} conturi total, ${accountsWithClient.length} cu client asignat`, {
		tenantId,
		metadata: { accounts: accountsWithClient.map(a => `${a.accountName} (${a.metaAdAccountId})`) }
	});

	if (accountsWithClient.length === 0) {
		logInfo('meta-ads-sync', `No ad accounts mapped to CRM clients for ${integration.businessName}`, { tenantId });
		await saveSyncResults({ imported: 0, updated: 0, errors: 0, accountsTotal: mappedAccounts.length, accountsWithClient: 0 });
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
			const insights = await listAdAccountInsights(
				account.metaAdAccountId,
				accessToken,
				appSecret,
				startDate,
				endDate
			);

			if (insights.length === 0) {
				logInfo('meta-ads-sync', `No insights for ${account.metaAdAccountId}`, { tenantId });
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
						id: table.metaAdsSpending.id,
						spendCents: table.metaAdsSpending.spendCents,
						impressions: table.metaAdsSpending.impressions,
						clicks: table.metaAdsSpending.clicks
					})
					.from(table.metaAdsSpending)
					.where(
						and(
							eq(table.metaAdsSpending.tenantId, tenantId),
							eq(table.metaAdsSpending.metaAdAccountId, account.metaAdAccountId),
							eq(table.metaAdsSpending.periodStart, insight.dateStart),
							eq(table.metaAdsSpending.clientId, account.clientId!)
						)
					)
					.limit(1);

				const newImpressions = parseInt(insight.impressions) || 0;
				const newClicks = parseInt(insight.clicks) || 0;

				if (existing) {
					// Update if any metric changed (Meta/TikTok sometimes backfill
					// impressions/clicks after the spend is already final — checking
					// only spend misses those late updates).
					const metricsChanged =
						existing.spendCents !== spendCents ||
						existing.impressions !== newImpressions ||
						existing.clicks !== newClicks;

					if (metricsChanged) {
						await db
							.update(table.metaAdsSpending)
							.set({
								spendAmount: insight.spend,
								spendCents,
								impressions: newImpressions,
								clicks: newClicks,
								syncedAt: new Date(),
								updatedAt: new Date()
							})
							.where(eq(table.metaAdsSpending.id, existing.id));
						updated++;
					}
				} else {
					// Insert new
					await db.insert(table.metaAdsSpending).values({
						id: crypto.randomUUID(),
						tenantId,
						integrationId: integration.id,
						clientId: account.clientId!,
						metaAdAccountId: account.metaAdAccountId,
						periodStart: insight.dateStart,
						periodEnd: insight.dateStop,
						spendAmount: insight.spend,
						spendCents,
						currencyCode: 'RON', // Meta Ads in Romania bills in RON
						impressions: parseInt(insight.impressions) || 0,
						clicks: parseInt(insight.clicks) || 0,
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
					clicks: parseInt(insight.clicks) || 0
				});
			}

			// Generate combined PDF for all periods of this account
			if (pdfPeriods.length > 0) {
				try {
					const pdfBuffer = await generateSpendingReportPdf({
						tenantName: tenantInfo?.name || '',
						clientName: clientInfo?.name || '',
						adAccountId: account.metaAdAccountId,
						adAccountName: account.accountName,
						currencyCode: 'RON',
						periods: pdfPeriods,
						generatedAt: new Date()
					});

					const periodLabel = `${startDate.slice(0, 7)}_${endDate.slice(0, 7)}`;
					const upload = await uploadBuffer(
						tenantId,
						Buffer.from(pdfBuffer),
						`meta-spending-${account.metaAdAccountId}_${periodLabel}.pdf`,
						'application/pdf',
						{ type: 'meta-spending', adAccountId: account.metaAdAccountId, clientId: account.clientId! }
					);

					// Update PDF path on all spending rows for this account+client
					for (const insight of insights) {
						await db
							.update(table.metaAdsSpending)
							.set({ pdfPath: upload.path, updatedAt: new Date() })
							.where(
								and(
									eq(table.metaAdsSpending.tenantId, tenantId),
									eq(table.metaAdsSpending.metaAdAccountId, account.metaAdAccountId),
									eq(table.metaAdsSpending.periodStart, insight.dateStart),
									eq(table.metaAdsSpending.clientId, account.clientId!)
								)
							);
					}

					logInfo('meta-ads-sync', `PDF generated for ${account.accountName}`, {
						tenantId,
						metadata: { path: upload.path, periods: pdfPeriods.length }
					});
				} catch (pdfErr) {
					logError('meta-ads-sync', `PDF generation failed for ${account.metaAdAccountId}`, {
						tenantId,
						metadata: { error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr) }
					});
				}
			}
		} catch (err) {
			logError('meta-ads-sync', `Failed to sync ${account.metaAdAccountId}`, {
				tenantId,
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			errors++;
		}
	}

	// Update integration status
	await saveSyncResults({ imported, updated, errors, accountsTotal: mappedAccounts.length, accountsWithClient: accountsWithClient.length });

	return { imported, updated, errors };
}
