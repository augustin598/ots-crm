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
	responseBody?: string;
}

export interface InvoiceLinkData {
	url: string;
	invoiceId?: string;
	date?: string;
	amount?: string;
}

/** Parse an amount string like "7.536,54 RON" or "7,536.54 USD" into a number */
function parseAmountString(amountStr?: string): number | null {
	if (!amountStr) return null;
	// Remove currency codes and whitespace: "7.536,54 RON" → "7.536,54"
	const cleaned = amountStr.replace(/[A-Z]{3}/g, '').trim();
	if (!cleaned) return null;
	let value: number;
	// Detect format: if comma appears after last dot → European format
	if (cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
		// European: "7.536,54" → 7536.54
		value = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
	} else {
		// US: "7,536.54" → 7536.54
		value = parseFloat(cleaned.replace(/,/g, ''));
	}
	return isNaN(value) ? null : value;
}

function buildCookieHeader(cookies: GoogleAdsCookie[]): string {
	return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function hasExpiredCriticalCookies(cookies: GoogleAdsCookie[]): boolean {
	const now = Date.now() / 1000;
	const critical = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'];
	return cookies.some(c =>
		critical.includes(c.name) && c.expires && c.expires < now
	);
}

function isPdf(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/**
 * Download a single PDF from a URL using Bearer token (OAuth).
 */
async function downloadInvoicePdfViaBearer(pdfUrl: string, accessToken: string): Promise<DownloadResult> {
	let cleanUrl = pdfUrl
		.replace(/&amp;/g, '&')
		.replace(/\\u003d/g, '=')
		.replace(/\\u0026/g, '&')
		.trim();

	if (cleanUrl.startsWith('/payments/')) {
		cleanUrl = `https://payments.google.com${cleanUrl}`;
	}

	try {
		const response = await fetch(cleanUrl, {
			headers: {
				'Authorization': `Bearer ${accessToken}`
			}
		});

		if (!response.ok) {
			return { success: false, error: `Bearer HTTP ${response.status}: ${response.statusText}` };
		}

		const buffer = Buffer.from(await response.arrayBuffer());

		if (isPdf(buffer) && buffer.length >= 100) {
			return { success: true, pdfBuffer: buffer };
		}

		if (buffer.length > 100) {
			return { success: true, pdfBuffer: buffer };
		}

		return { success: false, error: `Bearer unexpected_content (size: ${buffer.length})` };
	} catch (err) {
		return { success: false, error: `Bearer error: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/**
 * Download a single PDF from a URL using Google session cookies.
 */
export async function downloadInvoicePdfViaCookies(pdfUrl: string, cookies: GoogleAdsCookie[]): Promise<DownloadResult> {
	if (hasExpiredCriticalCookies(cookies)) {
		logWarning('google-ads-dl', 'Critical cookies are expired', {});
		return { success: false, error: 'cookies_expired' };
	}

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

	const MAX_RETRIES = 2;

	try {
		let response!: Response;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			response = await fetch(cleanUrl, {
				headers: {
					'Cookie': cookieHeader,
					'User-Agent': USER_AGENT,
					'Accept': 'application/pdf,*/*',
					'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
					'Referer': 'https://payments.google.com/'
				},
				redirect: 'manual'
			});

			// Only retry on server errors (500/502/503)
			if (response.status >= 500 && response.status <= 503 && attempt < MAX_RETRIES) {
				const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
				logWarning('google-ads-dl', `Retry ${attempt + 1}/${MAX_RETRIES} after HTTP ${response.status}`, {
					metadata: { url: cleanUrl.substring(0, 200), delay }
				});
				await new Promise(r => setTimeout(r, delay));
				continue;
			}
			break;
		}

		// Redirect means session expired (login redirect)
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location') || '';
			logWarning('google-ads-dl', `Redirect detected (session expired)`, { metadata: { status: response.status, location: location.substring(0, 200) } });
			return { success: false, error: 'session_expired' };
		}

		const contentType = response.headers.get('content-type') || '';

		if (!response.ok) {
			let body = '';
			try {
				body = await response.text();
				if (body.length > 500) body = body.substring(0, 500);
			} catch { /* ignore */ }
			logError('google-ads-dl', `HTTP ${response.status} downloading PDF`, {
				metadata: {
					url: cleanUrl.substring(0, 200),
					status: response.status,
					contentType,
					responseBody: body
				}
			});
			return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, responseBody: body };
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
	cookies: GoogleAdsCookie[],
	accessToken?: string | null
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

		logInfo('google-ads-dl', `[DEBUG] Processing invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				linkAmount: link.amount || 'NULL',
				linkDate: link.date || 'NULL',
				linkUrl: link.url?.substring(0, 80) || 'NULL'
			}
		});

		// Dedup
		const [existing] = await db
			.select({ id: table.googleAdsInvoice.id, pdfPath: table.googleAdsInvoice.pdfPath, totalAmountMicros: table.googleAdsInvoice.totalAmountMicros })
			.from(table.googleAdsInvoice)
			.where(and(
				eq(table.googleAdsInvoice.tenantId, tenantId),
				eq(table.googleAdsInvoice.googleInvoiceId, invoiceId)
			))
			.limit(1);

		if (existing?.pdfPath) {
			// Backfill amount if missing
			const parsedBackfill = parseAmountString(link.amount);
			logInfo('google-ads-dl', `[DEBUG] Invoice ${invoiceId} EXISTS — pdfPath: ${existing.pdfPath ? 'YES' : 'NO'}, totalAmountMicros: ${existing.totalAmountMicros}, link.amount: "${link.amount}", parsedBackfill: ${parsedBackfill}`, { tenantId });

			if (existing.totalAmountMicros == null && link.amount) {
				if (parsedBackfill != null) {
					const micros = Math.round(parsedBackfill * 1_000_000);
					logInfo('google-ads-dl', `[DEBUG] BACKFILLING invoice ${invoiceId} — setting totalAmountMicros=${micros} (from "${link.amount}")`, { tenantId });
					await db.update(table.googleAdsInvoice)
						.set({ totalAmountMicros: micros, updatedAt: new Date() })
						.where(eq(table.googleAdsInvoice.id, existing.id));
				} else {
					logWarning('google-ads-dl', `[DEBUG] Invoice ${invoiceId} — parseAmountString("${link.amount}") returned NULL`, { tenantId });
				}
			} else {
				logInfo('google-ads-dl', `[DEBUG] Invoice ${invoiceId} — skipping backfill: totalAmountMicros=${existing.totalAmountMicros}, link.amount="${link.amount}"`, { tenantId });
			}
			skipped++;
			continue;
		}

		// Try Bearer token first, fall back to cookies
		let result: DownloadResult | null = null;
		if (accessToken) {
			result = await downloadInvoicePdfViaBearer(link.url, accessToken);
			if (!result.success) {
				logWarning('google-ads-dl', `Bearer download failed for ${invoiceId}, trying cookies`, {
					tenantId, metadata: { error: result.error }
				});
				result = null;
			}
		}
		if (!result) {
			result = await downloadInvoicePdfViaCookies(link.url, cookies);
		}

		if (result.success && result.pdfBuffer) {
			try {
				const upload = await uploadBuffer(
					tenantId, result.pdfBuffer,
					`google-ads-invoice-${cleanCustomerId}_${invoiceId}.pdf`,
					'application/pdf',
					{ type: 'google-ads-invoice', customerId: cleanCustomerId, invoiceId }
				);

				const issueDate = link.date ? new Date(link.date) : new Date();
				const parsedAmount = parseAmountString(link.amount);
				const totalAmountMicros = parsedAmount != null ? Math.round(parsedAmount * 1_000_000) : undefined;

				if (existing) {
					await db.update(table.googleAdsInvoice)
						.set({
							pdfPath: upload.path, status: 'synced', syncedAt: new Date(), updatedAt: new Date(),
							...(totalAmountMicros != null && { totalAmountMicros })
						})
						.where(eq(table.googleAdsInvoice.id, existing.id));
				} else {
					await db.insert(table.googleAdsInvoice).values({
						id: crypto.randomUUID(), tenantId, clientId: account.clientId!,
						googleAdsCustomerId: customerId,
						googleInvoiceId: invoiceId, invoiceNumber: invoiceId,
						issueDate, currencyCode: account.currencyCode || 'USD', invoiceType: 'INVOICE',
						pdfPath: upload.path, status: 'synced', syncedAt: new Date(),
						createdAt: new Date(), updatedAt: new Date(),
						...(totalAmountMicros != null && { totalAmountMicros })
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
