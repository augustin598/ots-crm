import type { Page, HTTPResponse } from 'puppeteer-core';
import type { ScrapedInvoice } from '../invoice-scraper';
import {
	getSession,
	extractBrowserCookies,
	saveCookiesFromBrowser,
	completeSession,
	failSession
} from '../invoice-scraper';
import { logInfo, logError } from '$lib/server/logger';

/**
 * TikTok invoice list API response structure.
 */
interface TiktokInvoiceItem {
	invoice_id?: string;
	invoice_serial?: string;
	invoice_no?: string;
	amount?: string | number;
	currency?: string;
	currency_code?: string;
	send_date?: string;
	create_time?: string;
	adv_id_list?: string[];
	status?: number;
}

interface TiktokInvoiceListResponse {
	code?: number;
	data?: {
		invoice_list?: TiktokInvoiceItem[];
		list?: TiktokInvoiceItem[];
		total?: number;
	};
}

/**
 * Extract invoices from TikTok by intercepting the API response.
 * This is more reliable than DOM parsing since TikTok is a SPA.
 */
async function extractInvoicesViaXHR(page: Page): Promise<ScrapedInvoice[]> {
	const invoices: ScrapedInvoice[] = [];

	return new Promise<ScrapedInvoice[]>((resolve) => {
		let resolved = false;
		const capturedResponses: TiktokInvoiceListResponse[] = [];

		const responseHandler = async (response: HTTPResponse) => {
			const url = response.url();
			if (
				url.includes('query_invoice_list') ||
				url.includes('invoice/list') ||
				url.includes('invoice_list')
			) {
				try {
					const json = (await response.json()) as TiktokInvoiceListResponse;
					logInfo('tiktok-scraper', `Captured invoice list API response`, {
						metadata: { url, code: json.code }
					});
					capturedResponses.push(json);
				} catch {
					// Response might not be JSON
				}
			}
		};

		page.on('response', responseHandler);

		// Trigger the invoice list by navigating/refreshing the billing page
		(async () => {
			try {
				// If we're already on billing, reload to trigger the API call
				const currentUrl = page.url();
				if (currentUrl.includes('billing')) {
					await page.reload({ waitUntil: 'networkidle2', timeout: 30_000 });
				} else {
					await page.goto('https://business.tiktok.com/manage/billing/v2', {
						waitUntil: 'networkidle2',
						timeout: 30_000
					});
				}
			} catch {
				// Timeout is OK
			}

			// Wait for API responses
			await new Promise((r) => setTimeout(r, 5000));

			// Remove listener
			page.off('response', responseHandler);

			// Process captured responses
			for (const json of capturedResponses) {
				const items = json.data?.invoice_list || json.data?.list || [];
				for (const item of items) {
					const invoiceId =
						item.invoice_id || item.invoice_serial || item.invoice_no || '';
					if (!invoiceId) continue;

					const amount = typeof item.amount === 'string'
						? Math.round(parseFloat(item.amount) * 100)
						: typeof item.amount === 'number'
							? Math.round(item.amount * 100)
							: undefined;

					invoices.push({
						platform: 'tiktok',
						invoiceId,
						invoiceNumber: item.invoice_serial || item.invoice_no,
						date: item.send_date || item.create_time || new Date().toISOString().slice(0, 10),
						amount,
						currencyCode: item.currency_code || item.currency,
						accountId: item.adv_id_list?.[0] || 'unknown'
					});
				}
			}

			resolved = true;
			resolve(invoices);
		})();

		// Safety timeout
		setTimeout(() => {
			if (!resolved) {
				page.off('response', responseHandler);
				resolve(invoices);
			}
		}, 20_000);
	});
}

/**
 * Fallback: extract invoices from TikTok billing page DOM.
 */
async function extractInvoicesFromDOM(page: Page): Promise<ScrapedInvoice[]> {
	const rawInvoices = await page.evaluate(() => {
		const invoices: Array<{
			invoiceId: string;
			date: string;
			amount: string;
		}> = [];

		// Try to find invoice rows in the billing table
		const rows = document.querySelectorAll(
			'table tbody tr, [class*="invoice"] [class*="row"], [class*="billing"] [class*="item"]'
		);

		rows.forEach((row) => {
			const text = (row as HTMLElement).innerText || '';
			const cells = text.split('\n').filter((s) => s.trim());

			// Look for invoice-like patterns
			const idMatch = text.match(/INV[-\d]+|TT[-\d]+|\d{10,}/);
			const dateMatch = text.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
			const amountMatch = text.match(/([\d.,]+)\s*(RON|USD|EUR)/i);

			if (idMatch || dateMatch) {
				invoices.push({
					invoiceId: idMatch ? idMatch[0] : `tt_${Date.now()}`,
					date: dateMatch ? dateMatch[0] : '',
					amount: amountMatch ? amountMatch[0] : ''
				});
			}
		});

		return invoices;
	});

	return rawInvoices.map((inv) => ({
		platform: 'tiktok' as const,
		invoiceId: inv.invoiceId,
		date: inv.date || new Date().toISOString().slice(0, 10),
		amountText: inv.amount,
		accountId: 'tiktok'
	}));
}

/**
 * Run the TikTok Ads billing page scraper.
 * Uses XHR interception (primary) or DOM extraction (fallback).
 * Saves fresh cookies for future API-based downloads.
 */
export async function scrapeTiktokInvoices(sessionId: string): Promise<ScrapedInvoice[]> {
	const session = getSession(sessionId);
	if (!session || !session.page || session.page.isClosed()) {
		throw new Error('Sesiunea nu există sau browserul s-a închis');
	}

	const page = session.page;
	session.status = 'scraping';

	try {
		// Strategy 1: XHR interception (more reliable for SPA)
		let invoices = await extractInvoicesViaXHR(page);
		logInfo('tiktok-scraper', `XHR extraction found ${invoices.length} invoices`, {
			tenantId: session.tenantId
		});

		// Strategy 2: DOM fallback
		if (invoices.length === 0) {
			logInfo('tiktok-scraper', 'No invoices from XHR, trying DOM extraction');
			invoices = await extractInvoicesFromDOM(page);
			logInfo('tiktok-scraper', `DOM extraction found ${invoices.length} invoices`, {
				tenantId: session.tenantId
			});
		}

		// Extract and save cookies (the critical part)
		try {
			const cookies = await extractBrowserCookies(page, 'tiktok');
			if (cookies.length > 0) {
				await saveCookiesFromBrowser('tiktok', session.integrationId, session.tenantId, cookies);
				session.cookiesRefreshed = true;
				logInfo('tiktok-scraper', 'TikTok cookies refreshed successfully', {
					tenantId: session.tenantId
				});
			}
		} catch (cookieErr) {
			logError('tiktok-scraper', `Failed to refresh cookies: ${cookieErr instanceof Error ? cookieErr.message : String(cookieErr)}`, {
				tenantId: session.tenantId
			});
		}

		completeSession(sessionId, invoices);
		return invoices;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		failSession(sessionId, message);
		throw err;
	}
}
