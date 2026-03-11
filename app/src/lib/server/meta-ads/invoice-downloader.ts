import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getDecryptedFbCookies } from './fb-cookies';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';
import JSZip from 'jszip';
import type { FbCookie } from './fb-cookies';

const INVOICES_GENERATOR_URL = 'https://business.facebook.com/ads/manage/invoices_generator/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DOWNLOAD_DELAY_MS = 2000;

interface DownloadParams {
	adAccountId: string; // "act_XXXXXXXXX"
	year: number;
	month: number;
	cookies: FbCookie[];
}

interface DownloadResult {
	success: boolean;
	pdfBuffer?: Buffer;
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

/** Extract the first PDF file from a ZIP archive */
async function extractPdfFromZip(zipBuffer: Buffer): Promise<Buffer | null> {
	const zip = await JSZip.loadAsync(zipBuffer);
	const pdfFiles = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith('.pdf'));
	if (pdfFiles.length === 0) return null;
	const content = await zip.files[pdfFiles[0]].async('nodebuffer');
	return isPdf(content) ? content : null;
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

		// Check for redirect (session expired → login page)
		if (response.status >= 300 && response.status < 400) {
			return { success: false, error: 'session_expired' };
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
			const extracted = await extractPdfFromZip(buffer);
			if (!extracted) {
				return { success: false, error: 'zip_no_pdf_inside' };
			}
			pdfBuffer = extracted;
		} else if (contentType.includes('text/html')) {
			return { success: false, error: 'session_expired' };
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

		for (const account of accountsWithClient) {
			// Check dedup: already downloaded?
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

			if (existing && existing.status === 'downloaded') {
				skipped++;
				continue;
			}

			const result = await downloadReceipt({
				adAccountId: account.metaAdAccountId,
				year,
				month,
				cookies
			});

			if (result.success && result.pdfBuffer) {
				// Upload to MinIO
				let storagePath: string;
				try {
					const upload = await uploadBuffer(
						tenantId,
						result.pdfBuffer,
						`meta-invoice-${account.metaAdAccountId}_${year}-${monthStr}.pdf`,
						'application/pdf',
						{ type: 'meta-invoice', adAccountId: account.metaAdAccountId, period: periodStart }
					);
					storagePath = upload.path;
				} catch (uploadErr) {
					logError('invoice-downloader', `Failed to upload PDF for ${account.metaAdAccountId}`, {
						tenantId,
						metadata: { error: uploadErr instanceof Error ? uploadErr.message : String(uploadErr), period: periodStart }
					});
					errors++;
					continue;
				}

				// Upsert: handles race conditions via unique index (tenant_id, meta_ad_account_id, period_start)
				await db.insert(table.metaInvoiceDownload).values({
					id: existing?.id || crypto.randomUUID(),
					tenantId,
					integrationId: integration.id,
					clientId: account.clientId!,
					metaAdAccountId: account.metaAdAccountId,
					adAccountName: account.accountName,
					bmName: integration.businessName,
					periodStart,
					periodEnd,
					pdfPath: storagePath,
					status: 'downloaded',
					downloadedAt: new Date(),
					createdAt: new Date(),
					updatedAt: new Date()
				}).onConflictDoUpdate({
					target: [table.metaInvoiceDownload.tenantId, table.metaInvoiceDownload.metaAdAccountId, table.metaInvoiceDownload.periodStart],
					set: {
						pdfPath: sql`excluded.pdf_path`,
						status: sql`'downloaded'`,
						downloadedAt: new Date(),
						errorMessage: null,
						updatedAt: new Date()
					}
				});

				downloaded++;
				logInfo('invoice-downloader', `Downloaded receipt for ${account.accountName}`, {
					tenantId,
					metadata: { adAccountId: account.metaAdAccountId, period: periodStart }
				});
			} else {
				// Handle error
				if (result.error === 'session_expired') {
					// Mark session as expired
					await db
						.update(table.metaAdsIntegration)
						.set({ fbSessionStatus: 'none', updatedAt: new Date() })
						.where(eq(table.metaAdsIntegration.id, integration.id));

					logWarning('invoice-downloader', `FB session expired for BM ${integration.businessName}`, { tenantId });
					errors++;
					break; // Stop processing this integration
				}

				const errorMsg = result.error || 'Unknown error';

				// Upsert error status
				await db.insert(table.metaInvoiceDownload).values({
					id: existing?.id || crypto.randomUUID(),
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
				}).onConflictDoUpdate({
					target: [table.metaInvoiceDownload.tenantId, table.metaInvoiceDownload.metaAdAccountId, table.metaInvoiceDownload.periodStart],
					set: {
						status: sql`'error'`,
						errorMessage: sql`excluded.error_message`,
						updatedAt: new Date()
					}
				});

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
