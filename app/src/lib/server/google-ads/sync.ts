import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedClient, updateLastSyncAt } from './auth';
import { listInvoices, downloadInvoicePdf, getSyncMonths, formatCustomerId } from './client';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * Sync Google Ads invoices for a specific tenant.
 * Queries invoices at MCC (manager account) level, then maps them to CRM clients
 * via accountBudgetSummaries → googleAdsCustomerId matching.
 */
export async function syncGoogleAdsInvoicesForTenant(tenantId: string) {
	logInfo('google-ads-sync', `Starting sync for tenant`, { tenantId });

	const authResult = await getAuthenticatedClient(tenantId);
	if (!authResult) {
		logInfo('google-ads-sync', 'No active integration found', { tenantId });
		return { imported: 0, errors: 0, skipped: 0 };
	}

	const { oauth2Client, integration } = authResult;

	// Get Google Ads account mappings (sub-accounts assigned to CRM clients)
	const accountMappings = await db
		.select({
			googleAdsCustomerId: table.googleAdsAccount.googleAdsCustomerId,
			clientId: table.googleAdsAccount.clientId,
			accountName: table.googleAdsAccount.accountName
		})
		.from(table.googleAdsAccount)
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, tenantId),
				eq(table.googleAdsAccount.isActive, true)
			)
		);

	// Filter to only accounts that have a client assigned
	const mappedAccounts = accountMappings.filter(a => a.clientId);

	if (mappedAccounts.length === 0) {
		logInfo('google-ads-sync', 'No Google Ads accounts mapped to CRM clients', { tenantId });
		return { imported: 0, errors: 0, skipped: 0 };
	}

	logInfo('google-ads-sync', `Found ${mappedAccounts.length} mapped accounts to sync`, {
		tenantId,
		metadata: { accounts: mappedAccounts.map(a => a.accountName) }
	});

	const months = getSyncMonths();
	let imported = 0;
	let errors = 0;
	let skipped = 0;

	// Query invoices per sub-account (each client has their own billing)
	for (const mapping of mappedAccounts) {
		const cleanCustomerId = formatCustomerId(mapping.googleAdsCustomerId);

		for (const { year, month } of months) {
			try {
				const invoices = await listInvoices(
					integration.mccAccountId,
					cleanCustomerId,
					integration.developerToken,
					integration.refreshToken,
					year,
					month
				);

				for (const inv of invoices) {
					try {
						// Download PDF
						let pdfPath: string | null = null;
						if (inv.pdfUrl) {
							try {
								const accessToken = (await oauth2Client.getAccessToken()).token!;
								const pdfBuffer = await downloadInvoicePdf(inv.pdfUrl, accessToken);
								const dir = join('uploads', 'google-ads-invoices', tenantId, `${year}-${month}`);
								await mkdir(dir, { recursive: true });
								pdfPath = join(dir, `${inv.invoiceId}.pdf`);
								await writeFile(pdfPath, pdfBuffer);
							} catch (pdfErr) {
								logError('google-ads-sync', `Failed to download PDF for invoice ${inv.invoiceId}`, {
									tenantId,
									metadata: { error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr) }
								});
							}
						}

						const issueDate = inv.issueDate ? new Date(inv.issueDate) : null;
						const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;

						// Dedup: check if this invoice already exists for this client
						const [existing] = await db
							.select({ id: table.googleAdsInvoice.id })
							.from(table.googleAdsInvoice)
							.where(
								and(
									eq(table.googleAdsInvoice.tenantId, tenantId),
									eq(table.googleAdsInvoice.googleInvoiceId, inv.invoiceId),
									eq(table.googleAdsInvoice.clientId, mapping.clientId!)
								)
							)
							.limit(1);

						if (existing) {
							skipped++;
							continue;
						}

						await db.insert(table.googleAdsInvoice).values({
							id: crypto.randomUUID(),
							tenantId,
							clientId: mapping.clientId!,
							googleAdsCustomerId: mapping.googleAdsCustomerId,
							googleInvoiceId: inv.invoiceId,
							invoiceNumber: inv.invoiceId,
							issueDate,
							dueDate,
							subtotalAmountMicros: inv.subtotalAmountMicros,
							totalAmountMicros: inv.totalAmountMicros,
							currencyCode: inv.currencyCode,
							invoiceType: inv.invoiceType,
							pdfPath,
							status: pdfPath ? 'synced' : 'download_failed',
							syncedAt: new Date(),
							createdAt: new Date(),
							updatedAt: new Date()
						});

						logInfo('google-ads-sync', `Imported invoice ${inv.invoiceId} for ${mapping.accountName}`, { tenantId });
						imported++;
					} catch (invErr) {
						logError('google-ads-sync', `Failed to process invoice ${inv.invoiceId}`, {
							tenantId,
							metadata: { error: invErr instanceof Error ? invErr.message : String(invErr) }
						});
						errors++;
					}
				}
			} catch (monthErr) {
				// Not all accounts have monthly invoicing - skip silently
				const errMsg = monthErr instanceof Error ? monthErr.message : String(monthErr);
				if (errMsg.includes('INVALID_VALUE') || errMsg.includes('billingSetups') || errMsg.includes('BILLING_SETUP_NOT_ON_MONTHLY_INVOICING')) {
					logInfo('google-ads-sync', `No monthly invoicing for ${mapping.accountName} (${cleanCustomerId}) - skipping`, { tenantId });
				} else {
					logError('google-ads-sync', `Failed to list invoices for ${mapping.accountName} (${month} ${year})`, {
						tenantId,
						metadata: { error: errMsg.slice(0, 500) }
					});
					errors++;
				}
			}
		}
	}

	// Update integration status
	await updateLastSyncAt(tenantId);
	const syncResults = JSON.stringify({ imported, errors, skipped, timestamp: new Date().toISOString() });
	await db
		.update(table.googleAdsIntegration)
		.set({ lastSyncResults: syncResults, updatedAt: new Date() })
		.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)));

	logInfo('google-ads-sync', `Sync completed for tenant`, {
		tenantId,
		metadata: { imported, errors, skipped }
	});

	return { imported, errors, skipped };
}
