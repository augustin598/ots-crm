import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedToken } from './auth';
import { listBusinessInvoices, downloadInvoicePdf, getSyncDateRange } from './client';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * Parse Meta API amount to cents.
 * Meta returns amount as a string — could be dollars ("123.45") or cents ("12345").
 * We detect based on whether it contains a decimal point.
 */
function parseAmountToCents(amount: string | undefined | null): number {
	if (!amount) return 0;
	const str = String(amount).trim();
	if (!str || str === '0') return 0;

	const parsed = parseFloat(str);
	if (isNaN(parsed)) return 0;

	// If the string contains a decimal point, treat as dollars → convert to cents
	// Otherwise treat as already in cents
	if (str.includes('.')) {
		return Math.round(parsed * 100);
	}
	return Math.round(parsed);
}

/**
 * Sync Meta Ads invoices for a specific tenant.
 * Iterates over ALL active integrations (Business Managers) for the tenant.
 */
export async function syncMetaAdsInvoicesForTenant(tenantId: string) {
	console.log('[META-ADS SYNC] ========== SYNC STARTED ==========', { tenantId });
	logInfo('meta-ads-sync', `Starting sync for tenant`, { tenantId });

	// Get all active integrations for this tenant
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

	console.log('[META-ADS SYNC] Found integrations', { count: integrations.length, ids: integrations.map(i => i.businessId) });

	if (integrations.length === 0) {
		console.log('[META-ADS SYNC] No active integrations found, aborting');
		logInfo('meta-ads-sync', 'No active integrations found', { tenantId });
		return { imported: 0, errors: 0, skipped: 0 };
	}

	let totalImported = 0;
	let totalErrors = 0;
	let totalSkipped = 0;

	for (const integration of integrations) {
		const result = await syncForIntegration(tenantId, integration);
		totalImported += result.imported;
		totalErrors += result.errors;
		totalSkipped += result.skipped;
	}

	logInfo('meta-ads-sync', `Sync completed for tenant`, {
		tenantId,
		metadata: { totalImported, totalErrors, totalSkipped, integrationCount: integrations.length }
	});

	return { imported: totalImported, errors: totalErrors, skipped: totalSkipped };
}

/**
 * Sync invoices for a single integration (Business Manager)
 */
async function syncForIntegration(
	tenantId: string,
	integration: table.MetaAdsIntegration
) {
	console.log('[META-ADS SYNC] syncForIntegration started', { businessId: integration.businessId, integrationId: integration.id });
	logInfo('meta-ads-sync', `Syncing BM ${integration.businessId}`, { tenantId });

	const authResult = await getAuthenticatedToken(integration.id);
	if (!authResult) {
		console.log('[META-ADS SYNC] AUTH FAILED — no token');
		logWarning('meta-ads-sync', 'Could not get authenticated token', { tenantId, metadata: { integrationId: integration.id } });
		return { imported: 0, errors: 1, skipped: 0 };
	}

	const { accessToken } = authResult;

	// Get account mappings for this integration
	const accountMappings = await db
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

	console.log('[META-ADS SYNC] Account mappings from DB', { total: accountMappings.length, accounts: accountMappings.map(a => ({ id: a.metaAdAccountId, name: a.accountName, clientId: a.clientId })) });

	// Filter to only accounts that have a client assigned
	const mappedAccounts = accountMappings.filter(a => a.clientId);
	console.log('[META-ADS SYNC] Mapped accounts (with client)', { count: mappedAccounts.length });

	if (mappedAccounts.length === 0) {
		logInfo('meta-ads-sync', 'No ad accounts mapped to CRM clients', { tenantId, metadata: { businessId: integration.businessId } });
		return { imported: 0, errors: 0, skipped: 0 };
	}

	logInfo('meta-ads-sync', `Found ${mappedAccounts.length} mapped accounts`, {
		tenantId,
		metadata: { accounts: mappedAccounts.map(a => ({ id: a.metaAdAccountId, client: a.clientId })) }
	});

	// Map: ad account ID → CRM client info
	const adAccountToClient = new Map<string, { clientId: string; accountName: string; metaAdAccountId: string }>();
	for (const mapping of mappedAccounts) {
		adAccountToClient.set(mapping.metaAdAccountId, {
			clientId: mapping.clientId!,
			accountName: mapping.accountName,
			metaAdAccountId: mapping.metaAdAccountId
		});
	}

	const { startDate, endDate } = getSyncDateRange();
	let imported = 0;
	let errors = 0;
	let skipped = 0;

	try {
		console.log('[META-ADS SYNC] Fetching invoices from API...', { businessId: integration.businessId, startDate, endDate });
		const invoices = await listBusinessInvoices(integration.businessId, accessToken, startDate, endDate);

		console.log('[META-ADS SYNC] API returned invoices', { count: invoices.length });
		logInfo('meta-ads-sync', `API returned ${invoices.length} invoices`, {
			tenantId,
			metadata: { businessId: integration.businessId, startDate, endDate }
		});

		// Log first invoice raw data for debugging
		if (invoices.length > 0) {
			const sample = invoices[0];
			console.log('[META-ADS SYNC] Sample invoice', {
				invoiceId: sample.invoiceId,
				invoiceNumber: sample.invoiceNumber,
				amount: sample.amount,
				currencyCode: sample.currencyCode,
				adAccountIds: sample.adAccountIds,
				invoiceDate: sample.invoiceDate,
				paymentStatus: sample.paymentStatus,
				downloadUri: sample.downloadUri ? 'YES' : 'NO',
				cdnDownloadUri: sample.cdnDownloadUri ? 'YES' : 'NO'
			});
			logInfo('meta-ads-sync', `Sample invoice raw data`, {
				tenantId,
				metadata: {
					invoiceId: sample.invoiceId,
					invoiceNumber: sample.invoiceNumber,
					amount: sample.amount,
					currencyCode: sample.currencyCode,
					adAccountIds: sample.adAccountIds,
					invoiceDate: sample.invoiceDate,
					paymentStatus: sample.paymentStatus
				}
			});
		}

		for (const inv of invoices) {
			try {
				console.log('[META-ADS SYNC] Processing invoice', { invoiceId: inv.invoiceId, adAccountIds: inv.adAccountIds });

				// Match invoice to CRM clients via ad account IDs
				const matchedMappings = inv.adAccountIds
					.map(accId => adAccountToClient.get(accId))
					.filter(Boolean) as { clientId: string; accountName: string; metaAdAccountId: string }[];

				console.log('[META-ADS SYNC] Invoice matching result', { invoiceId: inv.invoiceId, matchedCount: matchedMappings.length, adAccountIds: inv.adAccountIds });

				if (matchedMappings.length === 0) {
					console.log('[META-ADS SYNC] SKIPPED — no matching CRM client', { invoiceId: inv.invoiceId, adAccountIds: inv.adAccountIds });
					logWarning('meta-ads-sync', `Invoice ${inv.invoiceId} has no matching CRM client`, {
						tenantId,
						metadata: { adAccountIds: inv.adAccountIds }
					});
					skipped++;
					continue;
				}

				// Download PDF once (shared across matched clients)
				let pdfPath: string | null = null;
				const pdfUrl = inv.downloadUri || inv.cdnDownloadUri;
				console.log('[META-ADS SYNC] PDF URL check', { invoiceId: inv.invoiceId, hasPdfUrl: !!pdfUrl, source: inv.downloadUri ? 'downloadUri' : inv.cdnDownloadUri ? 'cdnDownloadUri' : 'none' });
				if (pdfUrl) {
					try {
						const pdfBuffer = await downloadInvoicePdf(pdfUrl);
						console.log('[META-ADS SYNC] PDF downloaded OK', { invoiceId: inv.invoiceId, size: pdfBuffer.length });
						const dir = join(process.cwd(), 'uploads', 'meta-ads-invoices', tenantId, integration.businessId, `${startDate.slice(0, 7)}`);
						await mkdir(dir, { recursive: true });
						// Store relative path for portability
						pdfPath = join('uploads', 'meta-ads-invoices', tenantId, integration.businessId, `${startDate.slice(0, 7)}`, `${inv.invoiceId}.pdf`);
						await writeFile(join(process.cwd(), pdfPath), pdfBuffer);
						console.log('[META-ADS SYNC] PDF saved', { pdfPath });
					} catch (pdfErr) {
						console.error('[META-ADS SYNC] PDF download FAILED', { invoiceId: inv.invoiceId, error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr) });
						logError('meta-ads-sync', `Failed to download PDF for invoice ${inv.invoiceId}`, {
							tenantId,
							metadata: { error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr), pdfUrl }
						});
					}
				}

				const issueDate = inv.invoiceDate ? new Date(inv.invoiceDate) : null;
				const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
				const amountCents = parseAmountToCents(inv.amount);
				console.log('[META-ADS SYNC] Amount parsed', { invoiceId: inv.invoiceId, rawAmount: inv.amount, amountCents, issueDate, dueDate });

				// Create one record per matched client mapping
				for (const mapping of matchedMappings) {
					console.log('[META-ADS SYNC] Checking dedup for', { invoiceId: inv.invoiceId, clientId: mapping.clientId, accountName: mapping.accountName });

					// Dedup: check if this invoice already exists for this client
					const [existing] = await db
						.select({ id: table.metaAdsInvoice.id })
						.from(table.metaAdsInvoice)
						.where(
							and(
								eq(table.metaAdsInvoice.tenantId, tenantId),
								eq(table.metaAdsInvoice.metaInvoiceId, inv.invoiceId),
								eq(table.metaAdsInvoice.clientId, mapping.clientId)
							)
						)
						.limit(1);

					if (existing) {
						console.log('[META-ADS SYNC] DEDUP — already exists', { invoiceId: inv.invoiceId, clientId: mapping.clientId, existingId: existing.id });
						skipped++;
						continue;
					}

					console.log('[META-ADS SYNC] INSERTING invoice', { invoiceId: inv.invoiceId, clientId: mapping.clientId, amountCents, currency: inv.currencyCode });
					await db.insert(table.metaAdsInvoice).values({
						id: crypto.randomUUID(),
						tenantId,
						integrationId: integration.id,
						clientId: mapping.clientId,
						metaAdAccountId: mapping.metaAdAccountId,
						metaInvoiceId: inv.invoiceId,
						invoiceNumber: inv.invoiceNumber || inv.invoiceId,
						issueDate,
						dueDate,
						amountCents,
						currencyCode: inv.currencyCode,
						invoiceType: inv.invoiceType,
						paymentStatus: inv.paymentStatus,
						pdfPath,
						status: pdfPath ? 'synced' : 'download_failed',
						syncedAt: new Date(),
						createdAt: new Date(),
						updatedAt: new Date()
					});

					console.log('[META-ADS SYNC] INSERT OK', { invoiceId: inv.invoiceId, clientId: mapping.clientId });
					logInfo('meta-ads-sync', `Imported invoice ${inv.invoiceId} for account ${mapping.accountName}`, {
						tenantId,
						metadata: { amountCents, currency: inv.currencyCode, rawAmount: inv.amount }
					});
					imported++;
				}
			} catch (invErr) {
				console.error('[META-ADS SYNC] INVOICE ERROR', { invoiceId: inv.invoiceId, error: invErr instanceof Error ? invErr.message : String(invErr), stack: invErr instanceof Error ? invErr.stack : undefined });
				logError('meta-ads-sync', `Failed to process invoice ${inv.invoiceId}`, {
					tenantId,
					metadata: { error: invErr instanceof Error ? invErr.message : String(invErr) }
				});
				errors++;
			}
		}
	} catch (err) {
		console.error('[META-ADS SYNC] FATAL — Failed to list BM invoices', { businessId: integration.businessId, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
		logError('meta-ads-sync', `Failed to list BM invoices`, {
			tenantId,
			metadata: { businessId: integration.businessId, error: err instanceof Error ? err.message : String(err) }
		});
		errors++;
	}

	// Update integration status
	console.log('[META-ADS SYNC] syncForIntegration DONE', { businessId: integration.businessId, imported, errors, skipped });
	const syncResults = JSON.stringify({ imported, errors, skipped, timestamp: new Date().toISOString() });
	await db
		.update(table.metaAdsIntegration)
		.set({ lastSyncAt: new Date(), lastSyncResults: syncResults, updatedAt: new Date() })
		.where(eq(table.metaAdsIntegration.id, integration.id));

	return { imported, errors, skipped };
}
