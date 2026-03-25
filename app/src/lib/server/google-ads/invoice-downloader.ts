import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { type GoogleAdsCookie } from './google-cookies';
import { formatCustomerId } from './client';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DOWNLOAD_DELAY_MS = 1500;

interface DownloadResult {
	success: boolean;
	pdfBuffer?: Buffer;
	error?: string;
}

export interface InvoiceLinkData {
	url: string;
	invoiceId?: string;
	date?: string;
	amount?: string;
}

function buildCookieHeader(cookies: GoogleAdsCookie[]): string {
	return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function isPdf(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/**
 * Download a single PDF from a URL using Google session cookies.
 */
export async function downloadInvoicePdfViaCookies(pdfUrl: string, cookies: GoogleAdsCookie[]): Promise<DownloadResult> {
	const cookieHeader = buildCookieHeader(cookies);

	let cleanUrl = pdfUrl
		.replace(/&amp;/g, '&')
		.replace(/\\u003d/g, '=')
		.replace(/\\u0026/g, '&')
		.trim();

	if (cleanUrl.startsWith('/payments/')) {
		cleanUrl = `https://payments.google.com${cleanUrl}`;
	}

	logInfo('google-ads-dl', `Downloading PDF`, { metadata: { url: cleanUrl.substring(0, 200) } });

	try {
		const response = await fetch(cleanUrl, {
			headers: {
				'Cookie': cookieHeader,
				'User-Agent': USER_AGENT,
				'Accept': 'application/pdf,*/*',
				'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'same-origin',
				'Referer': 'https://payments.google.com/'
			},
			redirect: 'follow'
		});

		const finalUrl = response.url;
		const contentType = response.headers.get('content-type') || '';

		if (finalUrl.includes('accounts.google.com') || finalUrl.includes('signin')) {
			return { success: false, error: 'session_expired' };
		}

		if (!response.ok) {
			return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
		}

		const buffer = Buffer.from(await response.arrayBuffer());

		if (isPdf(buffer) && buffer.length >= 100) {
			return { success: true, pdfBuffer: buffer };
		}

		if (contentType.includes('text/html')) {
			return { success: false, error: 'session_expired' };
		}

		if (buffer.length > 100) {
			return { success: true, pdfBuffer: buffer };
		}

		return { success: false, error: `unexpected_content (type: ${contentType}, size: ${buffer.length})` };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Download multiple Google Ads invoices from an array of URLs extracted via browser console script.
 * Each link has: url, invoiceId (optional), date (optional), amount (optional).
 */
export async function downloadGoogleInvoicesFromLinks(
	tenantId: string,
	customerId: string,
	links: InvoiceLinkData[],
	cookies: GoogleAdsCookie[]
): Promise<{ downloaded: number; skipped: number; errors: number }> {
	const cleanCustomerId = formatCustomerId(customerId);

	logInfo('google-ads-dl', `Bulk downloading ${links.length} invoices for ${cleanCustomerId}`, { tenantId });

	// Find client for this account
	const [account] = await db
		.select({ clientId: table.googleAdsAccount.clientId, accountName: table.googleAdsAccount.accountName, currencyCode: table.googleAdsAccount.currencyCode })
		.from(table.googleAdsAccount)
		.where(and(
			eq(table.googleAdsAccount.tenantId, tenantId),
			eq(table.googleAdsAccount.googleAdsCustomerId, customerId)
		))
		.limit(1);

	if (!account?.clientId) {
		logError('google-ads-dl', `Account ${customerId} not mapped to a client`, { tenantId });
		return { downloaded: 0, skipped: 0, errors: links.length };
	}

	let downloaded = 0;
	let skipped = 0;
	let errors = 0;

	for (const link of links) {
		const invoiceId = link.invoiceId || link.url.match(/(\d{8,12})/)?.[1] || crypto.randomUUID();

		// Dedup
		const [existing] = await db
			.select({ id: table.googleAdsInvoice.id, pdfPath: table.googleAdsInvoice.pdfPath })
			.from(table.googleAdsInvoice)
			.where(and(
				eq(table.googleAdsInvoice.tenantId, tenantId),
				eq(table.googleAdsInvoice.googleInvoiceId, invoiceId)
			))
			.limit(1);

		if (existing?.pdfPath) { skipped++; continue; }

		const result = await downloadInvoicePdfViaCookies(link.url, cookies);

		if (result.success && result.pdfBuffer) {
			try {
				const upload = await uploadBuffer(
					tenantId, result.pdfBuffer,
					`google-ads-invoice-${cleanCustomerId}_${invoiceId}.pdf`,
					'application/pdf',
					{ type: 'google-ads-invoice', customerId: cleanCustomerId, invoiceId }
				);

				const issueDate = link.date ? new Date(link.date) : new Date();

				if (existing) {
					await db.update(table.googleAdsInvoice)
						.set({ pdfPath: upload.path, status: 'synced', syncedAt: new Date(), updatedAt: new Date() })
						.where(eq(table.googleAdsInvoice.id, existing.id));
				} else {
					await db.insert(table.googleAdsInvoice).values({
						id: crypto.randomUUID(), tenantId, clientId: account.clientId!,
						googleAdsCustomerId: customerId,
						googleInvoiceId: invoiceId, invoiceNumber: invoiceId,
						issueDate, currencyCode: account.currencyCode || 'USD', invoiceType: 'INVOICE',
						pdfPath: upload.path, status: 'synced', syncedAt: new Date(),
						createdAt: new Date(), updatedAt: new Date()
					});
				}

				downloaded++;
				logInfo('google-ads-dl', `Downloaded invoice ${invoiceId}`, { tenantId });
			} catch (uploadErr) {
				logError('google-ads-dl', `Upload failed for ${invoiceId}`, {
					tenantId, metadata: { error: uploadErr instanceof Error ? uploadErr.message : String(uploadErr) }
				});
				errors++;
			}
		} else {
			if (result.error === 'session_expired') {
				logWarning('google-ads-dl', 'Session expired during bulk download', { tenantId });
				return { downloaded, skipped, errors: errors + (links.length - downloaded - skipped - errors) };
			}
			logError('google-ads-dl', `Download failed for ${invoiceId}: ${result.error}`, { tenantId });
			errors++;
		}

		await new Promise(r => setTimeout(r, DOWNLOAD_DELAY_MS));
	}

	logInfo('google-ads-dl', `Bulk download completed`, {
		tenantId, metadata: { downloaded, skipped, errors }
	});

	return { downloaded, skipped, errors };
}
