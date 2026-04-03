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

export interface MetaAccountInfo {
	metaAdAccountId: string; // e.g. "act_437272720519106"
	accountName: string;
	businessId: string; // Meta Business Manager ID
}

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
 * Build the payment_activity URL for a specific ad account.
 * Uses unix timestamps for the date range (last 6 months).
 */
function buildPaymentActivityUrl(businessId: string, adAccountId: string): string {
	// Strip "act_" prefix for the URL parameters
	const numericId = adAccountId.replace(/^act_/, '');

	// Date range: wide range covering account lifetime (Jan 2022 – far future)
	const startTs = 1642284000;
	const endTs = Math.floor(Date.now() / 1000) + 86400; // now + 1 day

	return `https://business.facebook.com/latest/billing_hub/payment_activity?business_id=${businessId}&asset_id=${numericId}&payment_account_id=${numericId}&placement=mbs_all_tools_menu&query=&date=${startTs}_${endTs}`;
}

/**
 * Extract invoice data from the Facebook payment_activity page table.
 * The table has columns: Transaction ID, Date, Amount, Payment method, Payment status, VAT invoice ID, Action
 */
async function extractInvoicesFromPage(page: Page, adAccountId: string): Promise<ScrapedInvoice[]> {
	const rawInvoices = await page.evaluate(() => {
		const invoices: Array<{
			txid?: string;
			invoiceNumber?: string;
			date?: string;
			amount?: string;
			downloadUrl?: string;
		}> = [];

		// Strategy 1: Find rows in the payment activity table
		// Look for table rows with FBADS invoice numbers
		const allRows = document.querySelectorAll('[role="row"], tr');
		for (const row of allRows) {
			const text = (row as HTMLElement).innerText || '';
			// Skip header rows and rows without FBADS invoice numbers
			if (!text.includes('FBADS-')) continue;

			const invoiceMatch = text.match(/(FBADS-[\w-]+)/);
			const dateMatch = text.match(/(\d{1,2}\s+\w{3,9}\s+\d{4})/);
			const amountMatch = text.match(/(RON[\s]?[\d.,]+|USD[\s]?[\d.,]+|EUR[\s]?[\d.,]+)/);

			// Extract transaction ID from link in the row
			const txLink = row.querySelector('a[href]');
			let txid: string | undefined;
			if (txLink) {
				const href = (txLink as HTMLAnchorElement).href;
				// Transaction IDs in the link text or href
				const txidFromUrl = href.match(/txid=([^&]+)/);
				if (txidFromUrl) {
					txid = txidFromUrl[1];
				} else {
					// The link text itself might be the transaction ID (e.g. "26129265816763790-26043751478648563")
					const linkText = (txLink as HTMLElement).innerText.trim();
					if (/^\d+-\d+$/.test(linkText)) {
						txid = linkText;
					}
				}
			}

			// Also check for billing_transaction download links
			const downloadLink = row.querySelector('a[href*="billing_transaction"]');
			let downloadUrl: string | undefined;
			if (downloadLink) {
				downloadUrl = (downloadLink as HTMLAnchorElement).href;
				if (!txid) {
					const txidMatch = downloadUrl.match(/txid=([^&]+)/);
					txid = txidMatch ? txidMatch[1] : undefined;
				}
			}

			// Check for download button/link in Action column
			if (!downloadUrl) {
				const actionLinks = row.querySelectorAll('a[href*="pdf"], a[download], a[aria-label*="Download"], a[aria-label*="Descarcă"]');
				if (actionLinks.length > 0) {
					downloadUrl = (actionLinks[0] as HTMLAnchorElement).href;
				}
			}

			if (invoiceMatch || txid) {
				invoices.push({
					txid,
					invoiceNumber: invoiceMatch ? invoiceMatch[1] : undefined,
					date: dateMatch ? dateMatch[1] : undefined,
					amount: amountMatch ? amountMatch[1] : undefined,
					downloadUrl
				});
			}
		}

		// Strategy 2: Fallback — look for billing_transaction links (old Facebook UI)
		if (invoices.length === 0) {
			const seen: Record<string, boolean> = {};
			document.querySelectorAll('a[href*="billing_transaction"]').forEach((a) => {
				const anchor = a as HTMLAnchorElement;
				const url = anchor.href;
				if (!url || !url.includes('pdf=true')) return;
				if (seen[url]) return;
				seen[url] = true;

				const row = anchor.closest('[role="row"]') || anchor.closest('tr');
				const text = row ? (row as HTMLElement).innerText : '';

				const txidMatch = url.match(/txid=([^&]+)/);
				const invoiceMatch = text.match(/(FBADS-[\w-]+)/);
				const dateMatch = text.match(/(\d{1,2}\s+\w{3,9}\s+\d{4})/);
				const amountMatch = text.match(/(RON[\s]?[\d.,]+|USD[\s]?[\d.,]+|EUR[\s]?[\d.,]+)/);

				invoices.push({
					txid: txidMatch ? txidMatch[1] : undefined,
					invoiceNumber: invoiceMatch ? invoiceMatch[1] : undefined,
					date: dateMatch ? dateMatch[1] : undefined,
					amount: amountMatch ? amountMatch[1] : undefined,
					downloadUrl: url
				});
			});
		}

		return invoices;
	});

	return rawInvoices.map((inv) => ({
		platform: 'meta' as const,
		invoiceId: inv.txid || inv.invoiceNumber || `meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		invoiceNumber: inv.invoiceNumber,
		date: parseDate(inv.date || '') || new Date().toISOString().slice(0, 10),
		amountText: inv.amount,
		accountId: adAccountId,
		downloadUrl: inv.downloadUrl,
		txid: inv.txid
	}));
}

/**
 * Run the Meta Ads billing page scraper.
 * Navigates to payment_activity for each account, extracts invoices, and saves fresh cookies.
 */
export async function scrapeMetaInvoices(sessionId: string, accounts: MetaAccountInfo[]): Promise<ScrapedInvoice[]> {
	const session = getSession(sessionId);
	if (!session || !session.page || session.page.isClosed()) {
		throw new Error('Sesiunea nu există sau browserul s-a închis');
	}

	const page = session.page;
	session.status = 'scraping';

	try {
		const allInvoices: ScrapedInvoice[] = [];

		if (accounts.length === 0) {
			logInfo('meta-scraper', 'No accounts with client assigned, skipping invoice scrape', {
				tenantId: session.tenantId
			});
		}

		for (const account of accounts) {
			const url = buildPaymentActivityUrl(account.businessId, account.metaAdAccountId);
			logInfo('meta-scraper', `Navigating to payment_activity for ${account.accountName}`, {
				tenantId: session.tenantId,
				metadata: { accountId: account.metaAdAccountId, url }
			});

			try {
				await page.goto(url, {
					waitUntil: 'networkidle2',
					timeout: 30_000
				});

				// Wait for table content to load
				await page.waitForSelector('[role="row"], tr, a[href*="billing_transaction"]', {
					timeout: 15_000
				}).catch(() => {
					logInfo('meta-scraper', `No table rows found for ${account.accountName}, scrolling...`);
				});

				// Load all transactions (scroll + click "See More")
				await loadAllTransactions(page);

				const invoices = await extractInvoicesFromPage(page, account.metaAdAccountId);
				logInfo('meta-scraper', `Extracted ${invoices.length} invoices for ${account.accountName}`, {
					tenantId: session.tenantId,
					metadata: {
						accountId: account.metaAdAccountId,
						invoiceCount: invoices.length
					}
				});

				allInvoices.push(...invoices);
			} catch (err) {
				logError('meta-scraper', `Failed to scrape ${account.accountName}: ${err instanceof Error ? err.message : String(err)}`, {
					tenantId: session.tenantId,
					metadata: { accountId: account.metaAdAccountId }
				});
				// Continue with next account
			}
		}

		logInfo('meta-scraper', `Total: extracted ${allInvoices.length} invoices from ${accounts.length} accounts`, {
			tenantId: session.tenantId,
			metadata: { invoiceCount: allInvoices.length, accountCount: accounts.length }
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
		}

		completeSession(sessionId, allInvoices);
		return allInvoices;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		failSession(sessionId, message);
		throw err;
	}
}

/**
 * Load all transactions by scrolling and clicking "See More" button.
 * Facebook loads ~10 items initially, then requires clicking "See More" for more.
 */
async function loadAllTransactions(page: Page): Promise<void> {
	const MAX_ITERATIONS = 50; // ~500 transactions max

	for (let i = 0; i < MAX_ITERATIONS; i++) {
		// Scroll to bottom first to make sure "See More" button is visible
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await new Promise(r => setTimeout(r, 500));

		// Try to find and click "See More" / "Afișează mai multe" / "Vezi mai multe" button
		const clicked = await page.evaluate(() => {
			const buttons = Array.from(document.querySelectorAll('div[role="button"], button, span[role="button"], a[role="button"]'));
			const seeMoreTexts = ['see more', 'afișează mai multe', 'vezi mai multe', 'show more', 'afiseaza mai multe'];

			for (const btn of buttons) {
				const text = ((btn as HTMLElement).innerText || '').toLowerCase().trim();
				if (seeMoreTexts.some(t => text.includes(t))) {
					(btn as HTMLElement).click();
					return true;
				}
			}
			return false;
		});

		if (!clicked) {
			// No "See More" button found — all transactions loaded
			break;
		}

		// Wait for new content to load
		await new Promise(r => setTimeout(r, 2000));
	}

	// Final scroll to ensure everything is visible
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await new Promise(r => setTimeout(r, 500));
}
