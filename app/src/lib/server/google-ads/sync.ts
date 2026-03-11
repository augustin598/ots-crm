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

	// Map: clean Google Ads customer ID → CRM client info
	// Multiple accounts can map to the same client
	const customerIdToClient = new Map<string, { clientId: string; accountName: string; googleAdsCustomerId: string }>();
	for (const mapping of mappedAccounts) {
		const cleanId = formatCustomerId(mapping.googleAdsCustomerId);
		customerIdToClient.set(cleanId, {
			clientId: mapping.clientId!,
			accountName: mapping.accountName,
			googleAdsCustomerId: mapping.googleAdsCustomerId
		});
	}

	logInfo('google-ads-sync', `Account mapping built`, {
		tenantId,
		metadata: { accountCount: customerIdToClient.size, customerIds: Array.from(customerIdToClient.keys()) }
	});

	const months = getSyncMonths();
	let imported = 0;
	let errors = 0;
	let skipped = 0;

	// Query invoices at MCC level (one query per month, NOT per client)
	for (const { year, month } of months) {
		try {
			const invoices = await listInvoices(
				integration.mccAccountId,
				integration.developerToken,
				integration.refreshToken,
				year,
				month
			);

			for (const inv of invoices) {
				try {
					// Match invoice to CRM clients via accountBudgetSummaries
					const matchedMappings = inv.accountCustomerIds
						.map(custId => customerIdToClient.get(custId))
						.filter(Boolean) as { clientId: string; accountName: string; googleAdsCustomerId: string }[];

					if (matchedMappings.length === 0) {
						// No CRM client matched — log and skip
						logWarning('google-ads-sync', `Invoice ${inv.invoiceId} has no matching CRM client`, {
							tenantId,
							metadata: { accountCustomerIds: inv.accountCustomerIds }
						});
						skipped++;
						continue;
					}

					// Download PDF once (shared across matched clients)
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

					// Create one record per matched client mapping
					for (const mapping of matchedMappings) {
						// Dedup: check if this invoice already exists for this client
						const [existing] = await db
							.select({ id: table.googleAdsInvoice.id })
							.from(table.googleAdsInvoice)
							.where(
								and(
									eq(table.googleAdsInvoice.tenantId, tenantId),
									eq(table.googleAdsInvoice.googleInvoiceId, inv.invoiceId),
									eq(table.googleAdsInvoice.clientId, mapping.clientId)
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
							clientId: mapping.clientId,
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

						logInfo('google-ads-sync', `Imported invoice ${inv.invoiceId} for account ${mapping.accountName}`, { tenantId });
						imported++;
					}
				} catch (invErr) {
					logError('google-ads-sync', `Failed to process invoice ${inv.invoiceId}`, {
						tenantId,
						metadata: { error: invErr instanceof Error ? invErr.message : String(invErr) }
					});
					errors++;
				}
			}
		} catch (monthErr) {
			logError('google-ads-sync', `Failed to list MCC invoices (${month} ${year})`, {
				tenantId,
				metadata: { error: monthErr instanceof Error ? monthErr.message : String(monthErr) }
			});
			errors++;
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
