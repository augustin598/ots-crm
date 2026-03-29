import type { Page } from 'puppeteer-core';
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
 * Date parser matching the userscript logic.
 * Handles English ("9 Apr 2025") and Romanian ("6 ian. 2025") date formats.
 */
function parseDate(text: string): string | undefined {
	if (!text) return undefined;

	// English: "9 Apr 2025", "6 Jan 2025", "29 Oct 2024"
	const enMonths: Record<string, string> = {
		jan: '01', january: '01', feb: '02', february: '02',
		mar: '03', march: '03', apr: '04', april: '04',
		may: '05', jun: '06', june: '06', jul: '07', july: '07',
		aug: '08', august: '08', sep: '09', september: '09',
		oct: '10', october: '10', nov: '11', november: '11',
		dec: '12', december: '12'
	};
	const m = text.match(/(\d{1,2})\s+(\w{3,9})\s+(\d{4})/);
	if (m) {
		const mm = enMonths[m[2].toLowerCase()];
		if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
	}

	// Romanian: "6 ian. 2025", "10 decembrie 2025"
	const roMonths: Record<string, string> = {
		ian: '01', ianuarie: '01', feb: '02', februarie: '02',
		mar: '03', martie: '03', apr: '04', aprilie: '04',
		mai: '05', iun: '06', iunie: '06', iul: '07', iulie: '07',
		aug: '08', august: '08', sep: '09', septembrie: '09',
		oct: '10', octombrie: '10', noi: '11', noiembrie: '11',
		dec: '12', decembrie: '12'
	};
	const m2 = text.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
	if (m2) {
		const key = m2[2].toLowerCase();
		const mm2 = roMonths[key] || roMonths[key.substring(0, 3)];
		if (mm2) return `${m2[3]}-${mm2}-${m2[1].padStart(2, '0')}`;
	}

	return undefined;
}

/**
 * Extract invoice data from Facebook billing page DOM.
 * Replicates the logic from facebook-ads-invoice-extractor.user.js
 */
async function extractInvoicesFromPage(page: Page): Promise<ScrapedInvoice[]> {
	const rawInvoices = await page.evaluate(() => {
		const links: Array<{
			url: string;
			txid?: string;
			invoiceId?: string;
			date?: string;
			amount?: string;
		}> = [];
		const seen: Record<string, boolean> = {};

		// Find all billing_transaction download links on the page
		document.querySelectorAll('a[href*="billing_transaction"]').forEach((a) => {
			const anchor = a as HTMLAnchorElement;
			const url = anchor.href;
			if (!url || !url.includes('pdf=true')) return;
			if (seen[url]) return;
			seen[url] = true;

			// Walk up to the table row to get metadata
			const row = anchor.closest('[role="row"]') || anchor.closest('tr');
			const text = row ? (row as HTMLElement).innerText : '';

			// Extract txid from URL parameter
			const txidMatch = url.match(/txid=([^&]+)/);
			const txid = txidMatch ? txidMatch[1] : undefined;

			const invoiceMatch = text.match(/(FBADS-[\w-]+)/);
			const dateMatch = text.match(/(\d{1,2}\s+\w{3,9}\s+\d{4})/);
			const amountMatch = text.match(/(RON[\d.,]+|USD[\d.,]+|EUR[\d.,]+)/);

			links.push({
				url,
				txid,
				invoiceId: invoiceMatch ? invoiceMatch[1] : undefined,
				date: dateMatch ? dateMatch[1] : undefined,
				amount: amountMatch ? amountMatch[1] : undefined
			});
		});

		return links;
	});

	// Extract ad account ID from the current URL or page
	const currentUrl = page.url();
	const actMatch = currentUrl.match(/act[=\/](\d+)/);
	const accountId = actMatch ? `act_${actMatch[1]}` : 'unknown';

	return rawInvoices.map((inv) => ({
		platform: 'meta' as const,
		invoiceId: inv.txid || inv.invoiceId || `meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		invoiceNumber: inv.invoiceId,
		date: parseDate(inv.date || '') || new Date().toISOString().slice(0, 10),
		amountText: inv.amount,
		accountId,
		downloadUrl: inv.url,
		txid: inv.txid
	}));
}

/**
 * Run the Meta Ads billing page scraper.
 * Extracts invoices from the DOM and saves fresh cookies.
 */
export async function scrapeMetaInvoices(sessionId: string): Promise<ScrapedInvoice[]> {
	const session = getSession(sessionId);
	if (!session || !session.page || session.page.isClosed()) {
		throw new Error('Sesiunea nu există sau browserul s-a închis');
	}

	const page = session.page;
	session.status = 'scraping';

	try {
		// Make sure we're on the billing page
		const currentUrl = page.url();
		if (!currentUrl.includes('billing_hub') && !currentUrl.includes('billing')) {
			logInfo('meta-scraper', `Navigating to billing hub from ${currentUrl}`);
			await page.goto('https://business.facebook.com/billing_hub/accounts', {
				waitUntil: 'networkidle2',
				timeout: 30_000
			});
		}

		// Wait for billing content to load
		await page.waitForSelector('a[href*="billing_transaction"], [role="row"]', {
			timeout: 15_000
		}).catch(() => {
			logInfo('meta-scraper', 'No billing_transaction links found after initial wait, scrolling...');
		});

		// Scroll down to load more invoices (lazy loading)
		await autoScroll(page);

		// Wait a bit for any lazy-loaded content
		await new Promise((r) => setTimeout(r, 2000));

		// Extract invoices
		const invoices = await extractInvoicesFromPage(page);
		logInfo('meta-scraper', `Extracted ${invoices.length} invoices from Meta billing page`, {
			tenantId: session.tenantId,
			metadata: { invoiceCount: invoices.length }
		});

		// Extract and save cookies (the most valuable part!)
		try {
			const cookies = await extractBrowserCookies(page, 'meta');
			if (cookies.length > 0) {
				await saveCookiesFromBrowser('meta', session.integrationId, session.tenantId, cookies);
				session.cookiesRefreshed = true;
				logInfo('meta-scraper', 'Facebook cookies refreshed successfully', {
					tenantId: session.tenantId
				});
			}
		} catch (cookieErr) {
			logError('meta-scraper', `Failed to refresh cookies: ${cookieErr instanceof Error ? cookieErr.message : String(cookieErr)}`, {
				tenantId: session.tenantId
			});
			// Don't fail the whole scrape just because cookies couldn't be saved
		}

		completeSession(sessionId, invoices);
		return invoices;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		failSession(sessionId, message);
		throw err;
	}
}

/**
 * Scroll down the page to trigger lazy loading of invoice rows.
 */
async function autoScroll(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await new Promise<void>((resolve) => {
			let totalHeight = 0;
			const distance = 400;
			const maxScrolls = 10;
			let scrollCount = 0;

			const timer = setInterval(() => {
				const scrollHeight = document.body.scrollHeight;
				window.scrollBy(0, distance);
				totalHeight += distance;
				scrollCount++;

				if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
					clearInterval(timer);
					resolve();
				}
			}, 300);
		});
	});
}
