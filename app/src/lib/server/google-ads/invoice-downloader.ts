import { type GoogleAdsCookie } from './google-cookies';
import { formatCustomerId } from './client';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { isPdfBuffer, parseIssueDate } from './invoice-parsing';
import {
	resolveMappedAccount,
	findExistingInvoice,
	backfillExistingInvoice,
	persistGoogleInvoicePdf
} from './invoice-ingest';

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

function normalizePdfUrl(pdfUrl: string): string {
	let cleanUrl = pdfUrl
		.replace(/&amp;/g, '&')
		.replace(/\\u003d/g, '=')
		.replace(/\\u0026/g, '&')
		.trim();
	if (cleanUrl.startsWith('/payments/')) {
		cleanUrl = `https://payments.google.com${cleanUrl}`;
	}
	return cleanUrl;
}

/**
 * Download a single PDF from a URL using Bearer token (OAuth).
 */
async function downloadInvoicePdfViaBearer(pdfUrl: string, accessToken: string): Promise<DownloadResult> {
	const cleanUrl = normalizePdfUrl(pdfUrl);

	try {
		const response = await fetch(cleanUrl, {
			headers: {
				'Authorization': `Bearer ${accessToken}`
			},
			signal: AbortSignal.timeout(30_000)
		});

		if (!response.ok) {
			return { success: false, error: `Bearer HTTP ${response.status}: ${response.statusText}` };
		}

		const buffer = Buffer.from(await response.arrayBuffer());

		if (isPdfBuffer(buffer) && buffer.length >= 100) {
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
	const cleanUrl = normalizePdfUrl(pdfUrl);

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
				redirect: 'manual',
				signal: AbortSignal.timeout(30_000)
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

		if (isPdfBuffer(buffer) && buffer.length >= 100) {
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
 * Download multiple Google Ads invoices from an array of URLs extracted via
 * the browser scraper / Tampermonkey JSON. Persistence goes through
 * persistGoogleInvoicePdf (shared with the userscript ingest API).
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

	const account = await resolveMappedAccount(tenantId, cleanCustomerId);
	if (!account) {
		logError('google-ads-dl', `Account ${cleanCustomerId} not mapped to a client`, { tenantId });
		return { downloaded: 0, skipped: 0, errors: links.length };
	}

	let downloaded = 0;
	let skipped = 0;
	let errors = 0;

	for (const link of links) {
		const invoiceId = link.invoiceId || link.url.match(/(\d{8,12})/)?.[1] || crypto.randomUUID();

		// Already have the PDF: don't hit Google again, just fix attribution/amount.
		const existing = await findExistingInvoice(tenantId, invoiceId);
		if (existing?.pdfPath) {
			await backfillExistingInvoice({ tenantId, existing, account, customerId: cleanCustomerId, amountText: link.amount });
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
				const persisted = await persistGoogleInvoicePdf({
					tenantId,
					customerId: cleanCustomerId,
					invoiceId,
					issueDate: parseIssueDate(link.date),
					amountText: link.amount,
					pdfBuffer: result.pdfBuffer,
					source: 'server-download'
				});
				if (persisted.status === 'skipped') skipped++;
				else downloaded++;
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
