import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDecryptedFbCookies } from './fb-cookies';
import { getAuthenticatedToken } from './auth';
import { META_GRAPH_URL } from './client';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';
import JSZip from 'jszip';
import type { FbCookie } from './fb-cookies';

const INVOICES_GENERATOR_URL = 'https://business.facebook.com/ads/manage/invoices_generator/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DOWNLOAD_DELAY_MS = 2000;

interface DownloadParams {
	adAccountId: string; // "act_XXXXXXXXX"
	year: number;
	month: number;
	cookies: FbCookie[];
}

interface ZipPdfEntry {
	filename: string;
	buffer: Buffer;
}

interface DownloadResult {
	success: boolean;
	pdfBuffer?: Buffer;
	/** When the response was a ZIP with multiple PDFs, all extracted PDFs are here */
	allPdfBuffers?: ZipPdfEntry[];
	error?: string;
}

/**
 * Build cookie header string from Cookie-Editor format cookies.
 */
function buildCookieHeader(cookies: FbCookie[]): string {
	return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Get Unix timestamps for the first and last second of a month.
 */
function getMonthTimestamps(year: number, month: number): { ts: number; timeEnd: number } {
	const firstDay = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
	const lastDay = new Date(Date.UTC(year, month, 0, 23, 59, 59));
	return {
		ts: Math.floor(firstDay.getTime() / 1000),
		timeEnd: Math.floor(lastDay.getTime() / 1000)
	};
}

/** Check if buffer starts with PDF magic bytes (%PDF) */
function isPdf(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/** Check if buffer starts with ZIP magic bytes (PK) */
function isZip(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B;
}

/** Extract ALL PDF files from a ZIP archive */
async function extractAllPdfsFromZip(zipBuffer: Buffer): Promise<ZipPdfEntry[]> {
	const zip = await JSZip.loadAsync(zipBuffer);
	const pdfFiles = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith('.pdf'));
	const results: ZipPdfEntry[] = [];
	for (const filename of pdfFiles) {
		const content = await zip.files[filename].async('nodebuffer');
		if (isPdf(content) && content.length >= 100) {
			results.push({ filename, buffer: content });
		}
	}
	return results;
}

/**
 * Download a single receipt PDF from Facebook's invoices_generator.
 * Facebook may return a ZIP archive containing multiple transaction PDFs.
 */
export async function downloadReceipt(params: DownloadParams): Promise<DownloadResult> {
	const { adAccountId, year, month, cookies } = params;

	// Strip "act_" prefix for the URL
	const numericId = adAccountId.replace(/^act_/, '');

	const { ts, timeEnd } = getMonthTimestamps(year, month);
	const url = `${INVOICES_GENERATOR_URL}?act=${numericId}&ts=${ts}&time_end=${timeEnd}&format=&report=false&tax_invoices_only=false`;

	const cookieHeader = buildCookieHeader(cookies);

	// Debug: log request details
	const hasCUser = cookies.some(c => c.name === 'c_user');
	const hasXs = cookies.some(c => c.name === 'xs');
	const hasDatr = cookies.some(c => c.name === 'datr');
	logInfo('invoice-downloader', `Fetching invoice for ${adAccountId} (${year}-${String(month).padStart(2, '0')})`, {
		metadata: { url, cookieCount: cookies.length, hasCUser, hasXs, hasDatr }
	});

	try {
		const response = await fetch(url, {
			headers: {
				'Cookie': cookieHeader,
				'User-Agent': USER_AGENT,
				'Accept': '*/*',
				'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'same-origin',
				'Referer': 'https://business.facebook.com/'
			},
			redirect: 'manual'
		});

		logInfo('invoice-downloader', `Response for ${adAccountId}: status=${response.status} content-type=${response.headers.get('content-type') || 'none'}`);

		// HTTP 204 No Content = no invoice exists for this account/period
		if (response.status === 204) {
			return { success: false, error: 'no_invoice' };
		}

		// Check for redirect
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location') || '';
			logInfo('invoice-downloader', `Redirect ${response.status} for ${adAccountId}: ${location}`);
			const isLoginRedirect = location.includes('/login') || location.includes('checkpoint') || location.includes('cookie/consent');
			return { success: false, error: isLoginRedirect ? 'session_expired' : `redirect_${response.status}: ${location}` };
		}

		if (!response.ok) {
			return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
		}

		const contentType = response.headers.get('content-type') || '';
		const buffer = Buffer.from(await response.arrayBuffer());

		let pdfBuffer: Buffer;

		let allPdfBuffers: ZipPdfEntry[] | undefined;

		if (isPdf(buffer)) {
			pdfBuffer = buffer;
		} else if (isZip(buffer)) {
			const extracted = await extractAllPdfsFromZip(buffer);
			if (extracted.length === 0) {
				return { success: false, error: 'zip_no_pdf_inside' };
			}
			pdfBuffer = extracted[0].buffer;
			if (extracted.length > 1) {
				allPdfBuffers = extracted;
			}
		} else if (contentType.includes('text/html')) {
			const htmlSnippet = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
			logInfo('invoice-downloader', `HTML response for ${adAccountId}: size=${buffer.length} snippet=${htmlSnippet}`);
			// Empty body = no invoice, not session expired
			if (buffer.length === 0) {
				return { success: false, error: 'no_invoice' };
			}
			const isSessionPage = htmlSnippet.includes('/login') ||
				htmlSnippet.includes('checkpoint') ||
				htmlSnippet.includes('not_logged_in') ||
				htmlSnippet.includes('login_form');
			return { success: false, error: isSessionPage ? 'session_expired' : `html_response (size: ${buffer.length})` };
		} else {
			return { success: false, error: `unexpected_content (type: ${contentType}, size: ${buffer.length})` };
		}

		if (pdfBuffer.length < 100) {
			return { success: false, error: 'empty_pdf' };
		}

		return { success: true, pdfBuffer, allPdfBuffers };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Download a single receipt PDF from a direct Facebook billing_transaction URL.
 * Used for manual import and as fallback when invoices_generator returns 204.
 */
export async function downloadReceiptFromUrl(
	url: string,
	cookies: FbCookie[]
): Promise<DownloadResult> {
	const cookieHeader = buildCookieHeader(cookies);

	try {
		const response = await fetch(url, {
			headers: {
				'Cookie': cookieHeader,
				'User-Agent': USER_AGENT,
				'Accept': 'application/pdf,*/*',
				'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'same-origin',
				'Referer': 'https://business.facebook.com/'
			},
			redirect: 'manual'
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location') || '';
			const isLoginRedirect = location.includes('/login') || location.includes('checkpoint') || location.includes('cookie/consent');
			return { success: false, error: isLoginRedirect ? 'session_expired' : `redirect_${response.status}: ${location}` };
		}

		if (!response.ok) {
			return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
		}

		const contentType = response.headers.get('content-type') || '';
		const buffer = Buffer.from(await response.arrayBuffer());

		let pdfBuffer: Buffer;

		if (isPdf(buffer)) {
			pdfBuffer = buffer;
		} else if (isZip(buffer)) {
			const extracted = await extractAllPdfsFromZip(buffer);
			if (extracted.length === 0) {
				return { success: false, error: 'zip_no_pdf_inside' };
			}
			pdfBuffer = extracted[0].buffer;
		} else if (contentType.includes('text/html')) {
			if (buffer.length === 0) {
				return { success: false, error: 'no_invoice' };
			}
			const htmlSnippet = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
			const isSessionPage = htmlSnippet.includes('/login') || htmlSnippet.includes('checkpoint') || htmlSnippet.includes('not_logged_in');
			return { success: false, error: isSessionPage ? 'session_expired' : `html_response (size: ${buffer.length})` };
		} else {
			return { success: false, error: `unexpected_content (type: ${contentType}, size: ${buffer.length})` };
		}

		if (pdfBuffer.length < 100) {
			return { success: false, error: 'empty_pdf' };
		}

		return { success: true, pdfBuffer };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

interface BillingTransaction {
	txid: string;
	date: string;
	amount: string;
	amountCents: number;
	url: string;
}

/**
 * Fetch billing transactions for an ad account in a specific month.
 * Uses the billing_transaction endpoint pattern to build download URLs.
 * Falls back to Meta Graph API GET /act_{id}/transactions.
 */
export async function fetchBillingTransactions(
	adAccountId: string,
	year: number,
	month: number,
	cookies: FbCookie[],
	accessToken?: string | null
): Promise<BillingTransaction[]> {
	const numericId = adAccountId.replace(/^act_/, '');
	const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
	const lastDay = new Date(year, month, 0).getDate();
	const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

	// Try Meta Graph API (if we have an access token)
	if (accessToken) {
		try {
			const apiUrl = `${META_GRAPH_URL}/act_${numericId}/transactions?time_start=${Math.floor(new Date(monthStart).getTime() / 1000)}&time_stop=${Math.floor(new Date(monthEnd + 'T23:59:59Z').getTime() / 1000)}&fields=id,time,amount,currency&access_token=${accessToken}`;
			logInfo('invoice-downloader', `Graph API: fetching transactions for act_${numericId} (${monthStart} to ${monthEnd})`);
			const res = await fetch(apiUrl);
			const responseText = await res.text();
			logInfo('invoice-downloader', `Graph API response: status=${res.status} body=${responseText.substring(0, 500)}`);

			if (res.ok) {
				const data = JSON.parse(responseText);
				if (data.data && Array.isArray(data.data) && data.data.length > 0) {
					logInfo('invoice-downloader', `Graph API: found ${data.data.length} transactions for act_${numericId}`);
					return data.data.map((tx: any) => ({
						txid: tx.id,
						date: tx.time || monthStart,
						amount: tx.amount ? `${tx.currency || ''}${(tx.amount / 100).toFixed(2)}` : '',
						amountCents: typeof tx.amount === 'number' ? tx.amount : 0,
						url: `https://business.facebook.com/ads/manage/billing_transaction/?act=${numericId}&pdf=true&print=false&source=billing_summary&tx_type=3&txid=${tx.id}`
					}));
				} else {
					logInfo('invoice-downloader', `Graph API: no transactions found for act_${numericId}`);
				}
			}
		} catch (err) {
			logWarning('invoice-downloader', `Graph API error for act_${numericId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	} else {
		logInfo('invoice-downloader', `No access token for act_${numericId}, skipping Graph API`);
	}

	return [];
}

/**
 * Download all receipts for a specific month across all active integrations.
 */
export async function downloadAllReceiptsForMonth(
	tenantId: string,
	year: number,
	month: number
): Promise<{ downloaded: number; skipped: number; errors: number }> {
	const monthStr = String(month).padStart(2, '0');
	const periodStart = `${year}-${monthStr}-01`;
	// Calculate period end (last day of month)
	const lastDay = new Date(year, month, 0).getDate();
	const periodEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

	logInfo('invoice-downloader', `Starting receipt download for ${year}-${monthStr}`, { tenantId });

	// Get integrations with active FB session
	const integrations = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.tenantId, tenantId),
				eq(table.metaAdsIntegration.isActive, true),
				eq(table.metaAdsIntegration.fbSessionStatus, 'active')
			)
		);

	if (integrations.length === 0) {
		logInfo('invoice-downloader', 'No integrations with active FB session', { tenantId });
		return { downloaded: 0, skipped: 0, errors: 0 };
	}

	let downloaded = 0;
	let skipped = 0;
	let errors = 0;

	for (const integration of integrations) {
		logInfo('invoice-downloader', `Processing BM: ${integration.businessName} (${integration.businessId})`, { tenantId });

		const cookies = await getDecryptedFbCookies(integration.id, tenantId);
		if (!cookies) {
			logWarning('invoice-downloader', `No cookies for BM ${integration.businessName}`, { tenantId });
			errors++;
			continue;
		}

		// Get ad accounts mapped to clients
		const accounts = await db
			.select({
				metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
				accountName: table.metaAdsAccount.accountName,
				clientId: table.metaAdsAccount.clientId
			})
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.integrationId, integration.id),
					eq(table.metaAdsAccount.isActive, true)
				)
			);

		const accountsWithClient = accounts.filter(a => a.clientId);
		logInfo('invoice-downloader', `BM ${integration.businessName}: ${accountsWithClient.length} accounts with client (${accounts.length} total)`, { tenantId });

		let sessionExpiredCount = 0;

		for (const account of accountsWithClient) {
			// Find existing download for this account+period (used for update-vs-insert logic)
			// NOTE: We do NOT skip months that already have downloads — old code may have
			// only saved 1 PDF from a multi-PDF ZIP. The txid-based dedup in saving logic
			// prevents actual duplicates while allowing recovery of missing transactions.
			const [existing] = await db
				.select({ id: table.metaInvoiceDownload.id, status: table.metaInvoiceDownload.status })
				.from(table.metaInvoiceDownload)
				.where(
					and(
						eq(table.metaInvoiceDownload.tenantId, tenantId),
						eq(table.metaInvoiceDownload.metaAdAccountId, account.metaAdAccountId),
						eq(table.metaInvoiceDownload.periodStart, periodStart)
					)
				)
				.limit(1);

			const result = await downloadReceipt({
				adAccountId: account.metaAdAccountId,
				year,
				month,
				cookies
			});

			if (result.success && result.pdfBuffer) {
				// Determine all PDFs to save (single PDF or multiple from ZIP)
				const pdfsToSave: Array<{ buffer: Buffer; filename: string }> = result.allPdfBuffers
					? result.allPdfBuffers
					: [{ buffer: result.pdfBuffer, filename: `meta-invoice-${account.metaAdAccountId}_${year}-${monthStr}.pdf` }];

				let firstSaved = false;
				for (const pdfEntry of pdfsToSave) {
					// Try to extract txid from ZIP filename (Facebook uses txid in filenames)
					const txidFromFilename = pdfEntry.filename.match(/(\d{10,}[-_]\d{10,})/)?.[1]?.replace('_', '-') || null;

					// Dedup by txid if available (for additional PDFs from ZIP)
					if (txidFromFilename && firstSaved) {
						const [existingTx] = await db
							.select({ id: table.metaInvoiceDownload.id })
							.from(table.metaInvoiceDownload)
							.where(and(eq(table.metaInvoiceDownload.tenantId, tenantId), eq(table.metaInvoiceDownload.txid, txidFromFilename)))
							.limit(1);
						if (existingTx) continue; // Already downloaded this transaction
					}

					let storagePath: string;
					try {
						const upload = await uploadBuffer(
							tenantId,
							pdfEntry.buffer,
							pdfEntry.filename,
							'application/pdf',
							{ type: 'meta-invoice', adAccountId: account.metaAdAccountId, period: periodStart }
						);
						storagePath = upload.path;
					} catch (uploadErr) {
						logError('invoice-downloader', `Failed to upload PDF for ${account.metaAdAccountId}`, {
							tenantId,
							metadata: { error: uploadErr instanceof Error ? uploadErr.message : String(uploadErr), period: periodStart, filename: pdfEntry.filename }
						});
						errors++;
						continue;
					}

					if (!firstSaved && existing) {
						// Update existing record with first PDF
						const updateData: Record<string, unknown> = {
							pdfPath: storagePath,
							status: 'downloaded',
							downloadedAt: new Date(),
							errorMessage: null,
							updatedAt: new Date()
						};
						if (txidFromFilename) updateData.txid = txidFromFilename;
						await db.update(table.metaInvoiceDownload)
							.set(updateData)
							.where(eq(table.metaInvoiceDownload.id, existing.id));
					} else if (!firstSaved) {
						await db.insert(table.metaInvoiceDownload).values({
							id: crypto.randomUUID(),
							tenantId,
							integrationId: integration.id,
							clientId: account.clientId!,
							metaAdAccountId: account.metaAdAccountId,
							adAccountName: account.accountName,
							bmName: integration.businessName,
							periodStart,
							periodEnd,
							txid: txidFromFilename,
							pdfPath: storagePath,
							status: 'downloaded',
							downloadedAt: new Date(),
							createdAt: new Date(),
							updatedAt: new Date()
						});
					} else {
						// Additional PDFs from ZIP — always insert new records
						await db.insert(table.metaInvoiceDownload).values({
							id: crypto.randomUUID(),
							tenantId,
							integrationId: integration.id,
							clientId: account.clientId!,
							metaAdAccountId: account.metaAdAccountId,
							adAccountName: account.accountName,
							bmName: integration.businessName,
							periodStart,
							periodEnd,
							txid: txidFromFilename,
							pdfPath: storagePath,
							status: 'downloaded',
							downloadedAt: new Date(),
							createdAt: new Date(),
							updatedAt: new Date()
						});
					}

					downloaded++;
					firstSaved = true;
				}

				logInfo('invoice-downloader', `Downloaded ${pdfsToSave.length} receipt(s) for ${account.accountName}`, {
					tenantId,
					metadata: { adAccountId: account.metaAdAccountId, period: periodStart, pdfCount: pdfsToSave.length }
				});
			} else {
				// invoices_generator returned no invoice — try billing_transaction fallback
				if (result.error === 'no_invoice') {
					// Try Graph API for individual billing transactions
					let txDownloaded = 0;
					try {
						const authResult = await getAuthenticatedToken(integration.id);
						const accessToken = authResult?.accessToken || null;
						const transactions = await fetchBillingTransactions(account.metaAdAccountId, year, month, cookies, accessToken);

						if (transactions.length > 0) {
							logInfo('invoice-downloader', `Found ${transactions.length} billing transactions for ${account.accountName} via Graph API`, { tenantId });

							// Download ALL transactions (not just the first one)
							let isFirstTx = true;
							for (const tx of transactions) {
								// Dedup by txid
								if (tx.txid) {
									const [existingTx] = await db
										.select({ id: table.metaInvoiceDownload.id })
										.from(table.metaInvoiceDownload)
										.where(and(eq(table.metaInvoiceDownload.tenantId, tenantId), eq(table.metaInvoiceDownload.txid, tx.txid)))
										.limit(1);
									if (existingTx) continue;
								}

								const txResult = await downloadReceiptFromUrl(tx.url, cookies);
								if (txResult.success && txResult.pdfBuffer) {
									try {
										const upload = await uploadBuffer(
											tenantId,
											txResult.pdfBuffer,
											`meta-invoice-${account.metaAdAccountId}_${tx.txid || `${year}-${monthStr}`}_tx.pdf`,
											'application/pdf',
											{ type: 'meta-invoice', adAccountId: account.metaAdAccountId, period: periodStart, txid: tx.txid || '' }
										);

										// Detect invoice type: positive amount = invoice, zero/negative = credit
										const txInvoiceType = tx.amountCents > 0 ? 'invoice' : 'credit';

										if (isFirstTx && existing) {
											await db.update(table.metaInvoiceDownload)
												.set({
													pdfPath: upload.path,
													txid: tx.txid,
													amountText: tx.amount || null,
													invoiceType: txInvoiceType,
													status: 'downloaded',
													downloadedAt: new Date(),
													errorMessage: null,
													updatedAt: new Date()
												})
												.where(eq(table.metaInvoiceDownload.id, existing.id));
										} else {
											await db.insert(table.metaInvoiceDownload).values({
												id: crypto.randomUUID(),
												tenantId,
												integrationId: integration.id,
												clientId: account.clientId!,
												metaAdAccountId: account.metaAdAccountId,
												adAccountName: account.accountName,
												bmName: integration.businessName,
												periodStart,
												periodEnd,
												txid: tx.txid || null,
												amountText: tx.amount || null,
												invoiceType: txInvoiceType,
												pdfPath: upload.path,
												status: 'downloaded',
												downloadedAt: new Date(),
												createdAt: new Date(),
												updatedAt: new Date()
											});
										}

										txDownloaded++;
										isFirstTx = false;
									} catch (uploadErr) {
										logWarning('invoice-downloader', `Upload failed for tx ${tx.txid}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`, { tenantId });
									}
								}

								// Rate limiting between transaction downloads
								await new Promise(r => setTimeout(r, 1000));
							}

							if (txDownloaded > 0) {
								downloaded += txDownloaded;
								logInfo('invoice-downloader', `Downloaded ${txDownloaded} receipt(s) for ${account.accountName} via billing_transaction fallback`, {
									tenantId,
									metadata: { adAccountId: account.metaAdAccountId, period: periodStart, txCount: txDownloaded, totalTx: transactions.length }
								});
							}
						}
					} catch (fallbackErr) {
						logWarning('invoice-downloader', `billing_transaction fallback failed for ${account.accountName}: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`, { tenantId });
					}

					if (txDownloaded === 0) {
						// Genuinely no invoice — clean up stale errors
						if (existing && existing.status === 'error') {
							await db
								.delete(table.metaInvoiceDownload)
								.where(eq(table.metaInvoiceDownload.id, existing.id));
							logInfo('invoice-downloader', `Cleaned stale error for ${account.accountName} (${account.metaAdAccountId}) in ${periodStart} — no invoice exists`, { tenantId });
						} else {
							logInfo('invoice-downloader', `No invoice for ${account.accountName} (${account.metaAdAccountId}) in ${periodStart}`, { tenantId });
						}
						skipped++;
					}
					continue;
				}

				// Handle error
				logWarning('invoice-downloader', `Download failed for ${account.accountName} (${account.metaAdAccountId}): ${result.error}`, {
					tenantId,
					metadata: { period: periodStart, error: result.error }
				});

				if (result.error === 'session_expired') {
					sessionExpiredCount++;
					errors++;

					if (sessionExpiredCount >= 2) {
						// 2+ accounts confirm session is truly expired — mark and stop
						await db
							.update(table.metaAdsIntegration)
							.set({ fbSessionStatus: 'expired', updatedAt: new Date() })
							.where(eq(table.metaAdsIntegration.id, integration.id));

						logWarning('invoice-downloader', `FB session expired for BM ${integration.businessName} (confirmed by ${sessionExpiredCount} accounts)`, { tenantId });
						break;
					}

					logWarning('invoice-downloader', `Possible session issue for ${account.accountName}, trying next account...`, { tenantId });
					continue;
				}

				const errorMsg = result.error || 'Unknown error';

				if (existing) {
					await db.update(table.metaInvoiceDownload)
						.set({ status: 'error', errorMessage: errorMsg, updatedAt: new Date() })
						.where(eq(table.metaInvoiceDownload.id, existing.id));
				} else {
					await db.insert(table.metaInvoiceDownload).values({
						id: crypto.randomUUID(),
						tenantId,
						integrationId: integration.id,
						clientId: account.clientId!,
						metaAdAccountId: account.metaAdAccountId,
						adAccountName: account.accountName,
						bmName: integration.businessName,
						periodStart,
						periodEnd,
						status: 'error',
						errorMessage: errorMsg,
						createdAt: new Date(),
						updatedAt: new Date()
					});
				}

				errors++;
				logError('invoice-downloader', `Download failed for ${account.metaAdAccountId}`, {
					tenantId,
					metadata: { error: errorMsg, period: periodStart }
				});
			}

			// Rate limiting between downloads
			await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY_MS));
		}
	}

	logInfo('invoice-downloader', `Receipt download completed for ${year}-${monthStr}`, {
		tenantId,
		metadata: { downloaded, skipped, errors }
	});

	return { downloaded, skipped, errors };
}
