import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getDecryptedTtCookies } from './tt-cookies';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { TtCookie } from './tt-cookies';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const TIKTOK_BUSINESS_URL = 'https://business.tiktok.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DOWNLOAD_DELAY_MS = 2000;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;

interface TiktokBillingContext {
	bc_id: string;
	pa_id: string;
	platform: number;
}

interface DownloadResult {
	success: boolean;
	pdfBuffer?: Buffer;
	error?: string;
}

/**
 * Build cookie header string from TtCookie array.
 */
function buildCookieHeader(cookies: TtCookie[]): string {
	return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Common headers for TikTok Business API requests.
 */
function getHeaders(cookies: TtCookie[]): Record<string, string> {
	return {
		'Cookie': buildCookieHeader(cookies),
		'User-Agent': USER_AGENT,
		'Content-Type': 'application/json',
		'Accept': 'application/json, text/plain, */*',
		'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
		'Referer': `${TIKTOK_BUSINESS_URL}/manage/billing/v2`,
		'Origin': TIKTOK_BUSINESS_URL
	};
}

/**
 * Create a download task for a TikTok invoice.
 * POST /pa/api/download/create
 */
async function createDownloadTask(
	invoiceId: string,
	cookies: TtCookie[],
	context: TiktokBillingContext
): Promise<string> {
	const res = await fetch(`${TIKTOK_BUSINESS_URL}/pa/api/download/create`, {
		method: 'POST',
		headers: getHeaders(cookies),
		body: JSON.stringify({
			download_task_type: 136,
			query_param: JSON.stringify({ invoice_id: invoiceId }),
			timezone: 'Europe/Bucharest',
			Context: context
		})
	});

	if (res.status >= 300 && res.status < 400) {
		throw new Error('session_expired');
	}

	const json = await res.json();

	if (json.code !== 0 || !json.data?.task_id) {
		throw new Error(`Create download task failed: code=${json.code}, msg=${json.message || 'unknown'}`);
	}

	return json.data.task_id;
}

/**
 * Poll for download URL until task is complete.
 * POST /pa/api/download/query
 */
async function pollForDownloadUrl(
	taskId: string,
	cookies: TtCookie[],
	context: TiktokBillingContext
): Promise<string> {
	for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
		if (attempt > 0) {
			await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
		}

		const res = await fetch(`${TIKTOK_BUSINESS_URL}/pa/api/download/query`, {
			method: 'POST',
			headers: getHeaders(cookies),
			body: JSON.stringify({
				task_id: taskId,
				Context: context
			})
		});

		if (res.status >= 300 && res.status < 400) {
			throw new Error('session_expired');
		}

		const json = await res.json();

		if (json.code !== 0) {
			throw new Error(`Poll download failed: code=${json.code}, msg=${json.message || 'unknown'}`);
		}

		// status 1 = complete
		if (json.data?.status === 1 && json.data?.download_url) {
			return json.data.download_url;
		}

		// status 0 = pending, continue polling
		if (json.data?.status === 0) {
			continue;
		}

		// Other statuses are errors
		if (json.data?.status && json.data.status !== 0 && json.data.status !== 1) {
			throw new Error(`Download task failed with status=${json.data.status}`);
		}
	}

	throw new Error('Download task timed out after polling');
}

/**
 * Download a single invoice PDF from TikTok's billing API.
 * 3-step async: create task → poll → download signed URL
 */
export async function downloadInvoice(
	invoiceId: string,
	cookies: TtCookie[],
	context: TiktokBillingContext
): Promise<DownloadResult> {
	try {
		// Step 1: Create download task
		const taskId = await createDownloadTask(invoiceId, cookies, context);

		// Step 2: Poll for download URL
		const downloadUrl = await pollForDownloadUrl(taskId, cookies, context);

		// Step 3: Download the PDF
		const pdfRes = await fetch(downloadUrl, {
			headers: {
				'Cookie': buildCookieHeader(cookies),
				'User-Agent': USER_AGENT
			}
		});

		if (!pdfRes.ok) {
			return { success: false, error: `PDF download HTTP ${pdfRes.status}` };
		}

		const buffer = Buffer.from(await pdfRes.arrayBuffer());

		// Verify it's a PDF (magic bytes %PDF)
		if (buffer.length < 100) {
			return { success: false, error: 'empty_pdf' };
		}

		const isPdf = buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
		if (!isPdf) {
			const contentType = pdfRes.headers.get('content-type') || '';
			if (contentType.includes('text/html')) {
				return { success: false, error: 'session_expired' };
			}
			return { success: false, error: `unexpected_content (type: ${contentType}, size: ${buffer.length})` };
		}

		return { success: true, pdfBuffer: buffer };
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		if (errMsg === 'session_expired') {
			return { success: false, error: 'session_expired' };
		}
		return { success: false, error: errMsg };
	}
}

interface TiktokInvoiceListItem {
	invoice_id: string;
	invoice_serial: string;
	account_name: string;
	amount: string;
	currency: string;
	adv_id_list: string[];
	send_date: string;
}

/**
 * List available invoices from TikTok Business Center billing API.
 */
export async function listInvoicesFromTiktok(
	cookies: TtCookie[],
	context: TiktokBillingContext,
	startDate: string,
	endDate: string
): Promise<TiktokInvoiceListItem[]> {
	const allInvoices: TiktokInvoiceListItem[] = [];
	let pageNo = 1;
	const pageSize = 12;

	while (true) {
		const res = await fetch(`${TIKTOK_BUSINESS_URL}/pa/api/common/show/invoice/query_invoice_list`, {
			method: 'POST',
			headers: getHeaders(cookies),
			body: JSON.stringify({
				start_date: startDate,
				end_date: endDate,
				pagination: { page_no: pageNo, page_size: pageSize },
				Context: context
			})
		});

		if (res.status >= 300 && res.status < 400) {
			throw new Error('session_expired');
		}

		const json = await res.json();

		if (json.code !== 0) {
			throw new Error(`Invoice list failed: code=${json.code}, msg=${json.msg || 'unknown'}`);
		}

		const items = json.data?.data || [];
		for (const item of items) {
			allInvoices.push({
				invoice_id: item.invoice_id,
				invoice_serial: item.invoice_serial,
				account_name: item.account_name,
				amount: item.amount,
				currency: item.currency,
				adv_id_list: item.adv_id_list || [],
				send_date: item.send_date
			});
		}

		const total = json.data?.pagination?.total || 0;
		if (pageNo * pageSize >= total) break;
		pageNo++;
	}

	return allInvoices;
}

/**
 * Download all invoices for a specific month across all active integrations.
 */
export async function downloadAllInvoicesForMonth(
	tenantId: string,
	year: number,
	month: number
): Promise<{ downloaded: number; skipped: number; errors: number; listed: number; created: number }> {
	const monthStr = String(month).padStart(2, '0');
	const periodStart = `${year}-${monthStr}-01`;
	const lastDay = new Date(year, month, 0).getDate();
	const periodEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

	logInfo('tiktok-invoice-downloader', `Starting invoice download for ${year}-${monthStr}`, { tenantId });

	// Get integrations with active TikTok session
	const integrations = await db
		.select()
		.from(table.tiktokAdsIntegration)
		.where(
			and(
				eq(table.tiktokAdsIntegration.tenantId, tenantId),
				eq(table.tiktokAdsIntegration.isActive, true),
				eq(table.tiktokAdsIntegration.ttSessionStatus, 'active')
			)
		);

	if (integrations.length === 0) {
		logInfo('tiktok-invoice-downloader', 'No integrations with active TikTok session', { tenantId });
		return { downloaded: 0, skipped: 0, errors: 0, listed: 0, created: 0 };
	}

	let downloaded = 0;
	let skipped = 0;
	let errors = 0;
	let listed = 0;
	let created = 0;

	for (const integration of integrations) {
		if (!integration.orgId || !integration.paymentAccountId) {
			logWarning('tiktok-invoice-downloader', 'Integration missing orgId or paymentAccountId', {
				tenantId,
				metadata: { integrationId: integration.id, orgId: integration.orgId || 'MISSING', paymentAccountId: integration.paymentAccountId || 'MISSING' }
			});
			errors++;
			continue;
		}

		const cookies = await getDecryptedTtCookies(integration.id, tenantId);
		if (!cookies) {
			logWarning('tiktok-invoice-downloader', 'No cookies for integration', { tenantId, metadata: { integrationId: integration.id } });
			errors++;
			continue;
		}

		const hasSessionId = cookies.some(c => c.name === 'sessionid');
		logInfo('tiktok-invoice-downloader', `Integration ready`, {
			tenantId,
			metadata: { integrationId: integration.id, orgId: integration.orgId, paymentAccountId: integration.paymentAccountId, cookieCount: cookies.length, hasSessionId }
		});

		const context: TiktokBillingContext = {
			bc_id: integration.orgId,
			pa_id: integration.paymentAccountId,
			platform: 2
		};

		// Get ad accounts mapped to clients for this integration
		const accounts = await db
			.select({
				tiktokAdvertiserId: table.tiktokAdsAccount.tiktokAdvertiserId,
				accountName: table.tiktokAdsAccount.accountName,
				clientId: table.tiktokAdsAccount.clientId
			})
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.integrationId, integration.id),
					eq(table.tiktokAdsAccount.isActive, true)
				)
			);

		// Build advertiser → client mapping
		const advToClient = new Map<string, { clientId: string | null; accountName: string | null }>();
		for (const acc of accounts) {
			advToClient.set(acc.tiktokAdvertiserId, { clientId: acc.clientId, accountName: acc.accountName });
		}

		logInfo('tiktok-invoice-downloader', `Accounts loaded`, {
			tenantId,
			metadata: { total: accounts.length, withClient: accounts.filter(a => a.clientId).length }
		});

		// Step 1: List invoices from TikTok API
		let tiktokInvoices: TiktokInvoiceListItem[] = [];
		try {
			tiktokInvoices = await listInvoicesFromTiktok(cookies, context, periodStart, periodEnd);
			listed += tiktokInvoices.length;
			logInfo('tiktok-invoice-downloader', `Listed ${tiktokInvoices.length} invoices from TikTok API`, {
				tenantId,
				metadata: { period: periodStart, invoices: tiktokInvoices.map(i => ({ id: i.invoice_id, serial: i.invoice_serial, amount: i.amount, currency: i.currency })) }
			});
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg === 'session_expired') {
				await db
					.update(table.tiktokAdsIntegration)
					.set({ ttSessionStatus: 'expired', updatedAt: new Date() })
					.where(eq(table.tiktokAdsIntegration.id, integration.id));
				logWarning('tiktok-invoice-downloader', 'TikTok session expired during listing', { tenantId });
				errors++;
				continue;
			}
			logError('tiktok-invoice-downloader', `Failed to list invoices: ${errMsg}`, { tenantId, metadata: { period: periodStart } });
			errors++;
			continue;
		}

		// Step 2: Get existing records and create pending ones for new invoices
		const existingDownloads = await db
			.select({ id: table.tiktokInvoiceDownload.id, tiktokInvoiceId: table.tiktokInvoiceDownload.tiktokInvoiceId, status: table.tiktokInvoiceDownload.status })
			.from(table.tiktokInvoiceDownload)
			.where(
				and(
					eq(table.tiktokInvoiceDownload.tenantId, tenantId),
					eq(table.tiktokInvoiceDownload.integrationId, integration.id),
					eq(table.tiktokInvoiceDownload.periodStart, periodStart)
				)
			);

		const existingInvoiceIds = new Set(existingDownloads.map(d => d.tiktokInvoiceId));
		const downloadedSet = new Set(
			existingDownloads
				.filter(d => d.status === 'downloaded')
				.map(d => d.tiktokInvoiceId)
		);

		// Create pending records for new invoices
		for (const inv of tiktokInvoices) {
			if (existingInvoiceIds.has(inv.invoice_id)) continue;

			// Map advertiser IDs to client
			let clientId: string | null = null;
			let accountName: string | null = inv.account_name;
			const firstAdvId = inv.adv_id_list[0] || '';

			if (firstAdvId && advToClient.has(firstAdvId)) {
				const mapping = advToClient.get(firstAdvId)!;
				clientId = mapping.clientId;
				if (mapping.accountName) accountName = mapping.accountName;
			}

			const amountCents = Math.round(parseFloat(inv.amount) * 100);

			await db.insert(table.tiktokInvoiceDownload).values({
				id: generateId(),
				tenantId,
				integrationId: integration.id,
				clientId,
				tiktokAdvertiserId: firstAdvId,
				adAccountName: accountName,
				tiktokInvoiceId: inv.invoice_id,
				invoiceNumber: inv.invoice_serial,
				amountCents,
				currencyCode: inv.currency,
				periodStart,
				periodEnd,
				status: 'pending',
				createdAt: new Date(),
				updatedAt: new Date()
			});
			created++;
		}

		if (created > 0) {
			logInfo('tiktok-invoice-downloader', `Created ${created} new pending invoice records`, { tenantId, metadata: { period: periodStart } });
		}

		// Step 3: Query all pending downloads (including newly created)
		const pendingDownloads = await db
			.select()
			.from(table.tiktokInvoiceDownload)
			.where(
				and(
					eq(table.tiktokInvoiceDownload.tenantId, tenantId),
					eq(table.tiktokInvoiceDownload.integrationId, integration.id),
					eq(table.tiktokInvoiceDownload.periodStart, periodStart),
					eq(table.tiktokInvoiceDownload.status, 'pending')
				)
			);

		logInfo('tiktok-invoice-downloader', `Found ${pendingDownloads.length} pending downloads`, { tenantId, metadata: { period: periodStart } });

		for (const pending of pendingDownloads) {
			if (downloadedSet.has(pending.tiktokInvoiceId)) {
				skipped++;
				continue;
			}

			const result = await downloadInvoice(pending.tiktokInvoiceId, cookies, context);

			if (result.success && result.pdfBuffer) {
				let storagePath: string;
				try {
					const upload = await uploadBuffer(
						tenantId,
						result.pdfBuffer,
						`tiktok-invoice-${pending.tiktokInvoiceId}_${year}-${monthStr}.pdf`,
						'application/pdf',
						{ type: 'tiktok-invoice', invoiceId: pending.tiktokInvoiceId, period: periodStart }
					);
					storagePath = upload.path;
				} catch (uploadErr) {
					logError('tiktok-invoice-downloader', `Failed to upload PDF for ${pending.tiktokInvoiceId}`, {
						tenantId,
						metadata: { error: uploadErr instanceof Error ? uploadErr.message : String(uploadErr), period: periodStart }
					});
					errors++;
					continue;
				}

				await db
					.update(table.tiktokInvoiceDownload)
					.set({
						pdfPath: storagePath,
						status: 'downloaded',
						downloadedAt: new Date(),
						errorMessage: null,
						updatedAt: new Date()
					})
					.where(eq(table.tiktokInvoiceDownload.id, pending.id));

				downloaded++;
				logInfo('tiktok-invoice-downloader', `Downloaded invoice ${pending.tiktokInvoiceId}`, {
					tenantId,
					metadata: { period: periodStart }
				});
			} else {
				if (result.error === 'session_expired') {
					await db
						.update(table.tiktokAdsIntegration)
						.set({ ttSessionStatus: 'expired', updatedAt: new Date() })
						.where(eq(table.tiktokAdsIntegration.id, integration.id));

					logWarning('tiktok-invoice-downloader', 'TikTok session expired', { tenantId });
					errors++;
					break;
				}

				const errorMsg = result.error || 'Unknown error';
				await db
					.update(table.tiktokInvoiceDownload)
					.set({
						status: 'error',
						errorMessage: errorMsg,
						updatedAt: new Date()
					})
					.where(eq(table.tiktokInvoiceDownload.id, pending.id));

				errors++;
				logError('tiktok-invoice-downloader', `Download failed for ${pending.tiktokInvoiceId}`, {
					tenantId,
					metadata: { error: errorMsg, period: periodStart }
				});
			}

			// Rate limiting
			await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY_MS));
		}
	}

	logInfo('tiktok-invoice-downloader', `Invoice download completed for ${year}-${monthStr}`, {
		tenantId,
		metadata: { downloaded, skipped, errors, listed, created }
	});

	return { downloaded, skipped, errors, listed, created };
}
