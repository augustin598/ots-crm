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
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * TikTok invoice item — matches the actual API response from query_invoice_list.
 */
interface TiktokInvoiceItem {
	invoice_id?: string;
	invoice_serial?: string;
	invoice_no?: string;
	account_name?: string;
	amount?: string | number;
	currency?: string;
	currency_code?: string;
	send_date?: string;
	create_time?: string;
	adv_id_list?: string[];
	status?: number;
}

/**
 * Parse TikTok invoice items into ScrapedInvoice format.
 */
function parseInvoiceItems(items: TiktokInvoiceItem[]): ScrapedInvoice[] {
	const invoices: ScrapedInvoice[] = [];
	for (const item of items) {
		const invoiceId = item.invoice_id || item.invoice_serial || item.invoice_no || '';
		if (!invoiceId) continue;

		const amount =
			typeof item.amount === 'string'
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
	return invoices;
}

/**
 * Strategy 1: Call TikTok's invoice list API directly from the browser context.
 * Uses the same request format as invoice-downloader.ts (start_date, end_date, pagination).
 */
async function extractInvoicesViaDirectAPI(page: Page, integrationId: string): Promise<ScrapedInvoice[]> {
	logInfo('tiktok-scraper', 'Trying direct API call from browser context');

	// Get bc_id and pa_id from the integration record
	const [integration] = await db
		.select({
			orgId: table.tiktokAdsIntegration.orgId,
			paymentAccountId: table.tiktokAdsIntegration.paymentAccountId
		})
		.from(table.tiktokAdsIntegration)
		.where(eq(table.tiktokAdsIntegration.id, integrationId))
		.limit(1);

	const bcId = integration?.orgId || '';
	const paId = integration?.paymentAccountId || '';

	logInfo('tiktok-scraper', `Direct API context: bc_id=${bcId}, pa_id=${paId}`);

	// Ensure we're on TikTok before calling API
	const currentUrl = page.url();
	if (!currentUrl.includes('tiktok.com')) {
		logInfo('tiktok-scraper', `Page not on TikTok (${currentUrl}), navigating...`);
		try {
			await page.goto('https://business.tiktok.com/manage/billing/v2', {
				waitUntil: 'networkidle2',
				timeout: 30_000
			});
		} catch {
			// Navigation timeout is OK
		}
	}

	// Date range: last 6 months to today
	const now = new Date();
	const sixMonthsAgo = new Date(now);
	sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
	const startDate = sixMonthsAgo.toISOString().slice(0, 10);
	const endDate = now.toISOString().slice(0, 10);

	const apiResult = await page.evaluate(async (bcIdParam, paIdParam, startDateParam, endDateParam) => {
		const allItems: any[] = [];
		const pageSize = 50;
		let pageNo = 1;
		let totalFound = 0;
		const debugInfo: any[] = [];

		// Paginate through all results
		while (true) {
			try {
				const res = await fetch('https://business.tiktok.com/pa/api/common/show/invoice/query_invoice_list', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify({
						start_date: startDateParam,
						end_date: endDateParam,
						pagination: { page_no: pageNo, page_size: pageSize },
						Context: {
							bc_id: bcIdParam,
							pa_id: paIdParam,
							platform: 2
						}
					})
				});

				if (!res.ok) {
					debugInfo.push({ pageNo, status: res.status, error: 'HTTP ' + res.status });
					break;
				}

				const json = await res.json();
				debugInfo.push({
					pageNo,
					status: res.status,
					code: json.code,
					msg: json.msg,
					dataKeys: json.data ? Object.keys(json.data) : [],
					paginationInfo: json.data?.pagination,
					itemCount: (json.data?.data || json.data?.invoice_list || json.data?.list || []).length,
					// Dump first item for debugging structure
					sampleItem: (json.data?.data || json.data?.invoice_list || json.data?.list || [])[0] || null
				});

				if (json.code !== 0) break;

				// Try multiple response formats: data.data (confirmed), data.invoice_list, data.list
				const items = json.data?.data || json.data?.invoice_list || json.data?.list || [];
				allItems.push(...items);

				totalFound = json.data?.pagination?.total || json.data?.total || items.length;
				if (pageNo * pageSize >= totalFound) break;
				pageNo++;
			} catch (e) {
				debugInfo.push({ pageNo, error: String(e) });
				break;
			}
		}

		return {
			success: allItems.length > 0,
			items: allItems,
			totalFound,
			debugInfo
		};
	}, bcId, paId, startDate, endDate);

	logInfo('tiktok-scraper', 'Direct API results', {
		metadata: {
			itemCount: apiResult.items.length,
			totalFound: apiResult.totalFound,
			debugInfo: JSON.stringify(apiResult.debugInfo)
		}
	});

	if (apiResult.success) {
		logInfo('tiktok-scraper', `Direct API returned ${apiResult.items.length} invoices`);
		return parseInvoiceItems(apiResult.items);
	}

	return [];
}

/**
 * Strategy 2: Intercept XHR responses when navigating the billing page.
 * Also logs raw response structure for debugging.
 */
async function extractInvoicesViaXHR(page: Page): Promise<ScrapedInvoice[]> {
	logInfo('tiktok-scraper', 'Trying XHR interception');

	return new Promise<ScrapedInvoice[]>((resolve) => {
		let resolved = false;
		const capturedItems: TiktokInvoiceItem[] = [];

		const responseHandler = async (response: HTTPResponse) => {
			const url = response.url();
			if (
				url.includes('query_invoice_list') ||
				url.includes('invoice/list') ||
				url.includes('invoice_list')
			) {
				try {
					const json = await response.json();
					// Log raw response structure for debugging
					const dataKeys = json.data ? Object.keys(json.data) : [];
					const items = json.data?.data || json.data?.invoice_list || json.data?.list || [];
					logInfo('tiktok-scraper', `XHR captured: ${url}`, {
						metadata: {
							code: json.code,
							dataKeys: dataKeys.join(','),
							itemCount: items.length,
							sampleItem: items[0] ? JSON.stringify(items[0]).slice(0, 300) : 'none'
						}
					});
					capturedItems.push(...items);
				} catch {
					// Response might not be JSON
				}
			}
		};

		page.on('response', responseHandler);

		(async () => {
			try {
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
			page.off('response', responseHandler);

			const invoices = parseInvoiceItems(capturedItems);

			resolved = true;
			resolve(invoices);
		})();

		// Safety timeout
		setTimeout(() => {
			if (!resolved) {
				page.off('response', responseHandler);
				resolve([]);
			}
		}, 20_000);
	});
}

/**
 * Strategy 3: Extract invoices from TikTok billing page DOM.
 * Dumps sample row HTML for debugging. IDs are synthetic (for display only, not downloadable).
 */
async function extractInvoicesFromDOM(page: Page): Promise<ScrapedInvoice[]> {
	logInfo('tiktok-scraper', 'Trying DOM extraction (fallback — IDs will be synthetic)');

	const rawInvoices = await page.evaluate(() => {
		const invoices: Array<{
			invoiceId: string;
			date: string;
			amount: string;
			rowIndex: number;
			debugHtml: string;
		}> = [];

		// Try to find invoice rows in the billing table
		const rows = document.querySelectorAll(
			'table tbody tr, [class*="invoice"] [class*="row"], [class*="billing"] [class*="item"]'
		);

		let rowIndex = 0;
		rows.forEach((row) => {
			const el = row as HTMLElement;
			const text = el.innerText || '';
			const cells = Array.from(el.querySelectorAll('td, [class*="cell"]'));

			// Try to find invoice ID from data attributes, links, or cell text
			let invoiceId = '';

			// Check data attributes on the row and all ancestors up to table
			const dataId = el.getAttribute('data-invoice-id') ||
				el.getAttribute('data-id') ||
				el.getAttribute('data-row-key') ||
				el.getAttribute('data-key');
			if (dataId) {
				invoiceId = dataId;
			}

			// Check links inside the row
			if (!invoiceId) {
				const link = el.querySelector('a[href*="invoice"], a[href*="billing"]');
				if (link) {
					const href = link.getAttribute('href') || '';
					const idFromHref = href.match(/(?:invoice|billing)[_/]?(\w+)/);
					if (idFromHref) invoiceId = idFromHref[1];
				}
			}

			// Check for invoice ID patterns in cell text
			if (!invoiceId) {
				for (const cell of cells) {
					const cellText = (cell as HTMLElement).innerText?.trim() || '';
					// Match TikTok invoice patterns: INV-xxx, TT-xxx, or standalone IDs
					const idMatch = cellText.match(/^(INV[-\s]?\d+|TT[-\s]?\d+|\d{6,9})$/);
					if (idMatch) {
						invoiceId = idMatch[1].replace(/\s/g, '');
						break;
					}
				}
			}

			// Look for dates
			const dateMatch = text.match(/(\d{4}[-/]\d{2}[-/]\d{2})/);
			// Look for amounts
			const amountMatch = text.match(/([\d.,]+)\s*(RON|USD|EUR|lei)/i);

			// Only include if we found a date (minimum signal that this is a real invoice row)
			if (dateMatch) {
				invoices.push({
					invoiceId: invoiceId || `tt_dom_${rowIndex}_${dateMatch[1].replace(/[-/]/g, '')}`,
					date: dateMatch[1],
					amount: amountMatch ? amountMatch[0] : '',
					rowIndex,
					// Capture first 3 rows' HTML for debugging
					debugHtml: rowIndex < 3 ? el.outerHTML.slice(0, 500) : ''
				});
			}
			rowIndex++;
		});

		return invoices;
	});

	// Log sample HTML for debugging DOM structure
	const samplesWithHtml = rawInvoices.filter(r => r.debugHtml);
	if (samplesWithHtml.length > 0) {
		for (const sample of samplesWithHtml) {
			logInfo('tiktok-scraper', `DOM row #${sample.rowIndex} HTML sample`, {
				metadata: { html: sample.debugHtml, invoiceId: sample.invoiceId }
			});
		}
	}

	logInfo('tiktok-scraper', `DOM extraction found ${rawInvoices.length} rows`);

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
 * Strategies: Direct API → XHR interception → DOM extraction.
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
		// Strategy 1: Direct API call from browser context (most reliable)
		let invoices = await extractInvoicesViaDirectAPI(page, session.integrationId);
		logInfo('tiktok-scraper', `Direct API found ${invoices.length} invoices`, {
			tenantId: session.tenantId
		});

		// Strategy 2: XHR interception
		if (invoices.length === 0) {
			invoices = await extractInvoicesViaXHR(page);
			logInfo('tiktok-scraper', `XHR extraction found ${invoices.length} invoices`, {
				tenantId: session.tenantId
			});
		}

		// Strategy 3: DOM fallback
		if (invoices.length === 0) {
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
			logError(
				'tiktok-scraper',
				`Failed to refresh cookies: ${cookieErr instanceof Error ? cookieErr.message : String(cookieErr)}`,
				{
					tenantId: session.tenantId
				}
			);
		}

		completeSession(sessionId, invoices);
		return invoices;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		failSession(sessionId, message);
		throw err;
	}
}
