import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedClient, updateLastSyncAt } from './auth';
import { listInvoices, downloadInvoicePdf, getSyncMonths, formatCustomerId, listMonthlySpend } from './client';
import { getDecryptedGoogleCookies, type GoogleAdsCookie } from './google-cookies';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Download an invoice PDF using Google session cookies instead of Bearer token.
 * Works with payments.google.com URLs returned by the API.
 */
async function downloadPdfWithCookies(pdfUrl: string, cookies: GoogleAdsCookie[]): Promise<Buffer> {
	const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

	const response = await fetch(pdfUrl, {
		headers: {
			'Cookie': cookieHeader,
			'User-Agent': USER_AGENT,
			'Accept': '*/*',
			'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
			'Referer': 'https://payments.google.com/'
		},
		redirect: 'manual'
	});

	// Redirect means session expired
	if (response.status >= 300 && response.status < 400) {
		throw new Error('session_expired');
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const buffer = Buffer.from(await response.arrayBuffer());

	// Verify it's a PDF (magic bytes %PDF)
	if (buffer.length < 100) {
		throw new Error('empty_pdf');
	}

	const isPdf = buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
	if (!isPdf) {
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('text/html')) {
			throw new Error('session_expired');
		}
		throw new Error(`unexpected_content (type: ${contentType}, size: ${buffer.length})`);
	}

	return buffer;
}

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

	// Get Google session cookies for cookie-based PDF download fallback
	const googleCookies = await getDecryptedGoogleCookies(integration.id, tenantId);

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
						// Download PDF — try Bearer token first, then cookies as fallback
						let pdfPath: string | null = null;
						if (inv.pdfUrl) {
							let pdfBuffer: Buffer | null = null;

							// Try Bearer token (API approach)
							try {
								const accessToken = (await oauth2Client.getAccessToken()).token!;
								pdfBuffer = await downloadInvoicePdf(inv.pdfUrl, accessToken);
							} catch (bearerErr) {
								logWarning('google-ads-sync', `Bearer download failed for ${inv.invoiceId}, trying cookies`, {
									tenantId,
									metadata: { error: bearerErr instanceof Error ? bearerErr.message : String(bearerErr) }
								});
							}

							// Fallback: try cookies if Bearer failed and cookies are available
							if (!pdfBuffer && googleCookies) {
								try {
									pdfBuffer = await downloadPdfWithCookies(inv.pdfUrl, googleCookies);
									logInfo('google-ads-sync', `Downloaded PDF via cookies for ${inv.invoiceId}`, { tenantId });
								} catch (cookieErr) {
									const errMsg = cookieErr instanceof Error ? cookieErr.message : String(cookieErr);
									if (errMsg === 'session_expired') {
										// Mark session as expired
										await db
											.update(table.googleAdsIntegration)
											.set({ googleSessionStatus: 'expired', updatedAt: new Date() })
											.where(eq(table.googleAdsIntegration.id, integration.id));
										logWarning('google-ads-sync', 'Google session cookies expired', { tenantId });
									}
									logError('google-ads-sync', `Cookie download also failed for ${inv.invoiceId}`, {
										tenantId,
										metadata: { error: errMsg }
									});
								}
							}

							// Upload PDF to MinIO
							if (pdfBuffer) {
								try {
									const upload = await uploadBuffer(
										tenantId,
										pdfBuffer,
										`google-ads-invoice-${cleanCustomerId}_${inv.invoiceId}.pdf`,
										'application/pdf',
										{ type: 'google-ads-invoice', customerId: cleanCustomerId, invoiceId: inv.invoiceId }
									);
									pdfPath = upload.path;
								} catch (uploadErr) {
									logError('google-ads-sync', `Failed to upload PDF for ${inv.invoiceId}`, {
										tenantId,
										metadata: { error: uploadErr instanceof Error ? uploadErr.message : String(uploadErr) }
									});
								}
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

	// Sync monthly spending data into google_ads_spending table
	for (const mapping of mappedAccounts) {
		const cleanCustomerId = formatCustomerId(mapping.googleAdsCustomerId);
		try {
			const monthlySpend = await listMonthlySpend(
				integration.mccAccountId,
				cleanCustomerId,
				integration.developerToken,
				integration.refreshToken
			);

			for (const ms of monthlySpend) {
				// month is "YYYY-MM", derive periodStart/periodEnd
				const periodStart = `${ms.month}-01`;
				const [y, m] = ms.month.split('-').map(Number);
				const lastDay = new Date(y, m, 0).getDate();
				const periodEnd = `${ms.month}-${String(lastDay).padStart(2, '0')}`;
				const spendCents = Math.round(ms.spend * 100);

				// Upsert: check if exists
				const [existing] = await db
					.select({ id: table.googleAdsSpending.id })
					.from(table.googleAdsSpending)
					.where(
						and(
							eq(table.googleAdsSpending.tenantId, tenantId),
							eq(table.googleAdsSpending.googleAdsCustomerId, mapping.googleAdsCustomerId),
							eq(table.googleAdsSpending.periodStart, periodStart)
						)
					)
					.limit(1);

				if (existing) {
					await db
						.update(table.googleAdsSpending)
						.set({
							spendAmount: ms.spend.toString(),
							spendCents,
							currencyCode: ms.currencyCode,
							impressions: ms.impressions,
							clicks: ms.clicks,
							conversions: ms.conversions,
							syncedAt: new Date(),
							updatedAt: new Date()
						})
						.where(eq(table.googleAdsSpending.id, existing.id));
				} else {
					await db.insert(table.googleAdsSpending).values({
						id: crypto.randomUUID(),
						tenantId,
						clientId: mapping.clientId!,
						googleAdsCustomerId: mapping.googleAdsCustomerId,
						periodStart,
						periodEnd,
						spendAmount: ms.spend.toString(),
						spendCents,
						currencyCode: ms.currencyCode,
						impressions: ms.impressions,
						clicks: ms.clicks,
						conversions: ms.conversions,
						syncedAt: new Date(),
						createdAt: new Date(),
						updatedAt: new Date()
					});
				}
			}
		} catch (spendErr) {
			// Non-fatal: spending sync failure shouldn't block invoice sync
			logWarning('google-ads-sync', `Failed to sync spending for ${mapping.accountName}`, {
				tenantId,
				metadata: { error: spendErr instanceof Error ? spendErr.message : String(spendErr) }
			});
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
