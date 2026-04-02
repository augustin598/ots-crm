import type { Page } from 'puppeteer-core';
import type { ScrapedInvoice } from '../invoice-scraper';
import {
	getSession,
	extractBrowserCookies,
	saveCookiesFromBrowser,
	completeSession,
	failSession
} from '../invoice-scraper';
import { logInfo, logError, logWarning } from '$lib/server/logger';

// ── Date Parsing ─────────────────────────────────────────────────

/**
 * Date parser for Romanian and English date formats.
 * Replicates the logic from google-ads-invoice-extractor.user.js
 */
function parseDate(text: string): string | undefined {
	if (!text) return undefined;

	// Romanian: "30 noiembrie 2025", "10 dec. 2025"
	const roMonths: Record<string, string> = {
		ian: '01', ianuarie: '01', feb: '02', februarie: '02',
		mar: '03', martie: '03', apr: '04', aprilie: '04',
		mai: '05', iun: '06', iunie: '06', iul: '07', iulie: '07',
		aug: '08', august: '08', sep: '09', septembrie: '09',
		oct: '10', octombrie: '10', noi: '11', noiembrie: '11', noiembre: '11',
		dec: '12', decembrie: '12'
	};

	const m = text.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
	if (m) {
		const monthKey = m[2].toLowerCase().replace('.', '');
		const mm = roMonths[monthKey] || roMonths[monthKey.substring(0, 3)];
		if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
	}

	// English: "November 30, 2025", "Dec 10, 2025"
	const enMonths: Record<string, string> = {
		jan: '01', january: '01', feb: '02', february: '02',
		mar: '03', march: '03', apr: '04', april: '04',
		may: '05', jun: '06', june: '06', jul: '07', july: '07',
		aug: '08', august: '08', sep: '09', september: '09',
		oct: '10', october: '10', nov: '11', november: '11',
		dec: '12', december: '12'
	};
	const m2 = text.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
	if (m2) {
		const enKey = m2[1].toLowerCase();
		const enMm = enMonths[enKey] || enMonths[enKey.substring(0, 3)];
		if (enMm) return `${m2[3]}-${enMm}-${m2[2].padStart(2, '0')}`;
	}

	// Day-month-year: "9 Apr 2025"
	const m3 = text.match(/(\d{1,2})\s+(\w{3,9})\s+(\d{4})/);
	if (m3) {
		const mm = enMonths[m3[2].toLowerCase()];
		if (mm) return `${m3[3]}-${mm}-${m3[1].padStart(2, '0')}`;
	}

	return undefined;
}

// ── Account Info Extraction ──────────────────────────────────────

interface SubAccount {
	ocid: string;
	name: string;
	customerId: string; // display format: "800-456-6658"
}

/**
 * Extract account info from the current billing/documents page.
 * Gets customer ID from URL and account name from page header.
 */
async function extractAccountInfo(page: Page): Promise<{ customerId: string; accountName: string }> {
	const currentUrl = page.url();

	// Get customer ID from URL (?ocid=)
	const ocidMatch = currentUrl.match(/[?&]ocid=(\d+)/);
	let customerId = ocidMatch ? ocidMatch[1] : '';

	// Extract account name from page header
	const pageInfo = await page.evaluate(() => {
		let name = '';
		let cid = '';

		// Google Ads shows account name in the header bar
		// Look for the account name text near the hamburger menu
		const headerEls = document.querySelectorAll('header, [role="banner"], .top-bar');
		for (const header of headerEls) {
			const text = (header as HTMLElement).innerText || '';
			// Match CID pattern: XXX-XXX-XXXX
			const cidMatch = text.match(/(\d{3}[-\s]?\d{3}[-\s]?\d{4})/);
			if (cidMatch) {
				cid = cidMatch[1].replace(/[-\s]/g, '');
			}
		}

		// Account name from title: "Documente - beonemedical.ro" or "Performanță - One Top Solution"
		const titleMatch = document.title.match(/[-–]\s*(.+?)(?:\s*[-–]|$)/);
		if (titleMatch) name = titleMatch[1].trim();

		// Fallback: try the breadcrumb/header area
		if (!name) {
			const nameEl = document.querySelector('.customer-name, [data-customer-name]');
			if (nameEl) name = (nameEl as HTMLElement).textContent?.trim() || '';
		}

		return { name, cid };
	});

	if (pageInfo.cid && !customerId) {
		customerId = pageInfo.cid;
	}

	return {
		customerId: customerId || 'unknown',
		accountName: pageInfo.name || ''
	};
}

// ── Account Selection & Navigation ───────────────────────────────

/**
 * Handle the selectaccount page: auto-click the first MCC (Manager) account.
 * Google Ads shows this when the user has multiple top-level accounts.
 */
async function handleAccountSelector(page: Page): Promise<boolean> {
	logInfo('google-scraper', 'On account selector page, auto-selecting first account...');

	try {
		// Wait for account list items to appear
		await page.waitForSelector('material-list-item.user-customer-list-item', { timeout: 10_000 });

		// Click the first account (typically the MCC/Manager account)
		const clicked = await page.evaluate(() => {
			const item = document.querySelector('material-list-item.user-customer-list-item');
			if (item) {
				(item as HTMLElement).click();
				const name = item.querySelector('.customer-name')?.textContent?.trim() || '';
				const cid = item.querySelector('.material-list-item-secondary')?.textContent?.trim() || '';
				return { name, cid };
			}
			return null;
		});

		if (clicked) {
			logInfo('google-scraper', `Auto-selected account: ${clicked.name} (${clicked.cid})`);
			// Wait for navigation after click
			await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {});
			await new Promise((r) => setTimeout(r, 2000));
			return true;
		}

		logInfo('google-scraper', 'No account items found to click');
		return false;
	} catch (err) {
		logInfo('google-scraper', `Account selector handling failed: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

/**
 * Set the accounts table to show 100 rows per page.
 * Google Ads defaults to 10, which misses accounts.
 */
async function setPageSizeTo100(page: Page): Promise<boolean> {
	try {
		// Find and click the "Rows per page" dropdown (shows "10" by default)
		const clicked = await page.evaluate(() => {
			// Strategy 1: dropdown-button .button (legacy Material)
			const buttons = document.querySelectorAll('dropdown-button .button');
			for (const btn of buttons) {
				const text = btn.querySelector('.button-text')?.textContent?.trim();
				if (text && /^\d+$/.test(text) && parseInt(text) < 100) {
					(btn as HTMLElement).click();
					return text;
				}
			}

			// Strategy 2: Look for any element near "Rânduri pe pagină" / "Rows per page"
			// that shows a number (the page size value)
			const allText = document.body.innerText;
			const pageSizeLabels = ['Rânduri pe pagină', 'Rows per page', 'rânduri pe pagină', 'rows per page'];
			for (const label of pageSizeLabels) {
				if (!allText.includes(label)) continue;
				// Find the label element, then look for a clickable number nearby
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				while (walker.nextNode()) {
					if (walker.currentNode.textContent?.includes(label)) {
						const parent = walker.currentNode.parentElement?.closest('[class*="pagination"], [class*="paging"], [class*="footer"], [class*="table-footer"]')
							|| walker.currentNode.parentElement?.parentElement?.parentElement;
						if (parent) {
							const clickables = parent.querySelectorAll('button, [role="button"], [tabindex], .clickable, dropdown-button, [class*="dropdown"]');
							for (const el of clickables) {
								const t = (el as HTMLElement).textContent?.trim();
								if (t && /^\d+$/.test(t) && parseInt(t) < 100) {
									(el as HTMLElement).click();
									return t;
								}
							}
						}
					}
				}
			}

			// Strategy 3: Look for any dropdown/select near bottom of table with numeric values
			const dropdowns = document.querySelectorAll('select, [role="listbox"], [role="combobox"]');
			for (const dd of dropdowns) {
				if (dd.tagName === 'SELECT') {
					const opts = Array.from((dd as HTMLSelectElement).options);
					if (opts.some(o => ['10', '25', '50', '100'].includes(o.value))) {
						const opt100 = opts.find(o => o.value === '100');
						if (opt100) {
							(dd as HTMLSelectElement).value = '100';
							dd.dispatchEvent(new Event('change', { bubbles: true }));
							return 'select:100';
						}
					}
				}
			}

			return null;
		});

		if (!clicked) {
			logInfo('google-scraper', 'Page size dropdown not found or already at max');
			return false;
		}

		logInfo('google-scraper', `Clicked page size dropdown (was ${clicked}), selecting 100`);
		await new Promise((r) => setTimeout(r, 500));

		// If we used a <select>, it's already set — skip dropdown option click
		if (typeof clicked === 'string' && clicked.startsWith('select:')) {
			logInfo('google-scraper', 'Page size set via native select, waiting for table reload');
			await new Promise((r) => setTimeout(r, 3000));
			return true;
		}

		// Select "100" from the dropdown options
		const selected = await page.evaluate(() => {
			const items = document.querySelectorAll('material-select-dropdown-item, [role="option"], material-list-item, [role="menuitem"], li');
			for (const item of items) {
				const text = (item as HTMLElement).textContent?.trim();
				if (text === '100') {
					(item as HTMLElement).click();
					return true;
				}
			}
			return false;
		});

		if (selected) {
			logInfo('google-scraper', 'Selected 100 rows per page, waiting for table reload');
			await new Promise((r) => setTimeout(r, 3000));
			return true;
		} else {
			logInfo('google-scraper', 'Could not find "100" option in dropdown');
			return false;
		}
	} catch (err) {
		logInfo('google-scraper', `setPageSizeTo100 failed: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

/**
 * Extract all accounts by paginating through the table.
 * Clicks "Next page" button repeatedly until no more pages.
 */
async function paginateAndExtractAll(page: Page): Promise<Array<{ ocid: string; name: string; customerId: string; isManager: boolean }>> {
	const allResults: Array<{ ocid: string; name: string; customerId: string; isManager: boolean }> = [];
	const seenOcids = new Set<string>();
	let pageNum = 1;

	const extractCurrentPage = async () => {
		return page.evaluate(() => {
			const results: Array<{ ocid: string; name: string; customerId: string; isManager: boolean }> = [];
			document.querySelectorAll('a.account-cell-link').forEach((link) => {
				const href = link.getAttribute('href') || '';
				const ocidMatch = href.match(/[?&]ocid=(\d+)/);
				if (!ocidMatch) return;

				const ocid = ocidMatch[1];
				const name = link.textContent?.trim() || '';
				const cell = link.closest('ess-cell, td, [role="gridcell"]');
				const parent = cell || link.parentElement;
				const cidEl = parent?.querySelector('.customer-id, .external-customer-id');
				const rawCid = cidEl?.textContent?.trim() || '';
				const row = link.closest('ess-row, tr, [role="row"]');
				const rowText = row ? (row as HTMLElement).innerText : '';
				const isManager = rowText.includes('Manager') || rawCid.includes('Manager');
				const customerId = rawCid.replace(/\s*\(Manager\).*$/, '').trim();

				results.push({ ocid, name, customerId, isManager });
			});
			return results;
		});
	};

	// Extract first page
	const firstPage = await extractCurrentPage();
	for (const acc of firstPage) {
		if (!seenOcids.has(acc.ocid)) {
			seenOcids.add(acc.ocid);
			allResults.push(acc);
		}
	}

	// Paginate through remaining pages
	const MAX_PAGES = 20;
	while (pageNum < MAX_PAGES) {
		// Look for a "Next page" button
		const hasNext = await page.evaluate(() => {
			// Google Ads uses various next-page selectors
			const nextBtns = document.querySelectorAll<HTMLElement>(
				'[aria-label="Next page"], [aria-label="Pagina următoare"], [aria-label="Go to next page"], ' +
				'button.next-page, [class*="next-page"], [class*="pagination"] button:last-child, ' +
				'material-button[icon="chevron_right"], [icon="navigate_next"], ' +
				'button[icon="chevron_right"], [data-tooltip="Next page"], [data-tooltip="Pagina următoare"]'
			);
			for (const btn of nextBtns) {
				// Check if the button is enabled (not disabled)
				if (!btn.hasAttribute('disabled') && !btn.classList.contains('disabled') &&
					btn.getAttribute('aria-disabled') !== 'true' && btn.offsetParent !== null) {
					btn.click();
					return true;
				}
			}

			// Fallback: look for a ">" or "›" navigation button near pagination area
			const paginationArea = document.querySelector('[class*="pagination"], [class*="paging"], [class*="table-footer"]');
			if (paginationArea) {
				const buttons = paginationArea.querySelectorAll<HTMLElement>('button, [role="button"]');
				const arr = Array.from(buttons);
				// The last enabled button in pagination is typically "Next"
				for (let i = arr.length - 1; i >= 0; i--) {
					const btn = arr[i];
					const text = btn.textContent?.trim() || '';
					const icon = btn.querySelector('material-icon, [class*="icon"]')?.textContent?.trim() || '';
					if ((text === '›' || text === '>' || icon === 'chevron_right' || icon === 'navigate_next') &&
						!btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
						btn.click();
						return true;
					}
				}
			}

			return false;
		});

		if (!hasNext) {
			logInfo('google-scraper', `Pagination ended at page ${pageNum} (no next button or disabled)`);
			break;
		}

		pageNum++;
		logInfo('google-scraper', `Navigating to page ${pageNum} of accounts table`);
		await new Promise((r) => setTimeout(r, 3000));

		// Wait for table to update
		await page.waitForSelector('a.account-cell-link', { timeout: 10_000 }).catch(() => {});

		const pageAccounts = await extractCurrentPage();
		let newCount = 0;
		for (const acc of pageAccounts) {
			if (!seenOcids.has(acc.ocid)) {
				seenOcids.add(acc.ocid);
				allResults.push(acc);
				newCount++;
			}
		}

		logInfo('google-scraper', `Page ${pageNum}: found ${pageAccounts.length} entries, ${newCount} new`);

		// If we got no new accounts, we've likely looped back or reached the end
		if (newCount === 0) {
			logInfo('google-scraper', 'No new accounts on this page, stopping pagination');
			break;
		}
	}

	return allResults;
}

/**
 * Search for a specific account by customer ID using the accounts page search/filter UI.
 * This handles accounts that aren't visible in the main table or sub-MCCs.
 * Flow: Navigate to accounts page → Click search → Select "Conturi" filter → Type customer ID → Extract result.
 */
async function searchAccountById(page: Page, customerId: string): Promise<SubAccount | null> {
	// Format customer ID with dashes for search (e.g., "6924130019" → "692-413-0019")
	const formattedId = customerId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
	logInfo('google-scraper', `Searching for account ${formattedId} via UI search`);

	// Navigate to accounts page
	const currentUrl = page.url();
	const urlObj = new URL(currentUrl);
	const accountsUrl = `https://ads.google.com/aw/accounts?${urlObj.searchParams.toString()}`;
	await page.goto(accountsUrl, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
	await new Promise((r) => setTimeout(r, 3000));

	// Click the search box / filter bar to open it
	const searchOpened = await page.evaluate(() => {
		// Look for the search box trigger — the filter bar or search icon
		const searchBox = document.querySelector<HTMLInputElement>(
			'input.search-box, input.popup-search-box, [placeholder="Căutați"], [placeholder="Search"], [aria-label="Search"], [aria-label="Căutați"]'
		);
		if (searchBox) {
			searchBox.click();
			searchBox.focus();
			return 'input-found';
		}

		// Try the filter bar / search icon
		const searchIcon = document.querySelector<HTMLElement>(
			'[class*="search-icon"], [class*="filter-bar"] input, material-search-box input, .filter-bar-container input'
		);
		if (searchIcon) {
			searchIcon.click();
			return 'icon-found';
		}

		// Try clicking the filter bar area
		const filterBar = document.querySelector<HTMLElement>(
			'.filter-bar, [class*="filter-bar"], filter-bar'
		);
		if (filterBar) {
			filterBar.click();
			return 'filter-bar-found';
		}

		return null;
	});

	if (!searchOpened) {
		logInfo('google-scraper', 'Could not find search box on accounts page');
		return null;
	}

	logInfo('google-scraper', `Search UI opened: ${searchOpened}`);
	await new Promise((r) => setTimeout(r, 1500));

	// Select "Conturi" (Accounts) from the filter dropdown
	const filterSelected = await page.evaluate(() => {
		// Look for filter options in dropdown — "Conturi" or "Accounts"
		const options = document.querySelectorAll<HTMLElement>(
			'[role="option"], [role="menuitem"], .filter-option, .dropdown-item, li, material-select-dropdown-item'
		);
		for (const opt of options) {
			const text = opt.textContent?.trim() || '';
			if (text === 'Conturi' || text === 'Accounts' || text === 'Account') {
				opt.click();
				return text;
			}
		}

		// Fallback: look for any element with text matching "Conturi" / "Accounts"
		const allElements = document.querySelectorAll<HTMLElement>('*');
		for (const el of allElements) {
			if (el.children.length === 0 && el.offsetParent !== null) {
				const text = el.textContent?.trim() || '';
				if (text === 'Conturi' || text === 'Accounts') {
					el.click();
					return `fallback:${text}`;
				}
			}
		}

		return null;
	});

	if (!filterSelected) {
		logInfo('google-scraper', 'Could not select "Conturi" filter option');
		// Try alternative: directly type in the search box
	} else {
		logInfo('google-scraper', `Filter selected: ${filterSelected}`);
	}

	await new Promise((r) => setTimeout(r, 1500));

	// Type the customer ID into the picker search box
	const searchInput = await page.evaluate((cid: string) => {
		// Look for the picker search box input
		const inputs = document.querySelectorAll<HTMLInputElement>(
			'picker-search-box input, input.search-box, input.popup-search-box, input[placeholder*="Căutați"], input[placeholder*="Search"], input[type="text"]'
		);

		// Find the most relevant visible input
		for (const input of inputs) {
			if (input.offsetParent !== null && (input.placeholder || input.type === 'text')) {
				input.value = '';
				input.focus();
				input.value = cid;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
				// Also try keyboard event
				input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
				return 'typed';
			}
		}
		return null;
	}, formattedId);

	if (!searchInput) {
		// Fallback: use page.type to simulate keyboard input
		try {
			await page.keyboard.type(formattedId, { delay: 50 });
			logInfo('google-scraper', `Typed customer ID via keyboard: ${formattedId}`);
		} catch {
			logInfo('google-scraper', 'Could not type customer ID in search');
			return null;
		}
	}

	// Wait for search results
	await new Promise((r) => setTimeout(r, 3000));

	// Extract the result from customer-picker-cell or similar
	const result = await page.evaluate((targetCid: string) => {
		const cleanTarget = targetCid.replace(/-/g, '');

		// Look for customer-picker-cell elements
		const cells = document.querySelectorAll('customer-picker-cell, [class*="picker-cell"], [class*="picker-row"], [role="option"], [role="listitem"]');
		for (const cell of cells) {
			const cidEl = cell.querySelector('.picker-customer-id, [class*="customer-id"]');
			const nameEl = cell.querySelector('.picker-descriptive-name, [class*="descriptive-name"], [class*="account-name"]');

			const cellCid = (cidEl?.textContent?.trim() || '').replace(/-/g, '');
			const cellName = nameEl?.textContent?.trim() || '';

			if (cellCid === cleanTarget || cellCid.includes(cleanTarget)) {
				// Click on the result to select it
				(cell as HTMLElement).click();
				return { name: cellName, customerId: cidEl?.textContent?.trim() || targetCid };
			}
		}

		// Fallback: search in all visible text
		const allText = document.body.innerText;
		if (allText.includes(targetCid) || allText.includes(cleanTarget)) {
			// Try to find a clickable result
			const links = document.querySelectorAll<HTMLElement>('a, [role="option"], [tabindex], .clickable');
			for (const link of links) {
				const text = link.textContent || '';
				if (text.includes(targetCid) || text.replace(/-/g, '').includes(cleanTarget)) {
					link.click();
					const nameMatch = text.match(/^([^\d]+)/);
					return { name: nameMatch ? nameMatch[1].trim() : '', customerId: targetCid };
				}
			}
		}

		return null;
	}, formattedId);

	if (!result) {
		logInfo('google-scraper', `No search result found for ${formattedId}`);
		// Press Escape to close search dropdown
		await page.keyboard.press('Escape').catch(() => {});
		return null;
	}

	logInfo('google-scraper', `Search result clicked: ${result.name} (${result.customerId})`);

	// Wait for the filter to apply
	await new Promise((r) => setTimeout(r, 3000));

	// Now the accounts table should show only the filtered account — extract its ocid
	const account = await page.evaluate(() => {
		const link = document.querySelector<HTMLAnchorElement>('a.account-cell-link');
		if (!link) return null;

		const href = link.getAttribute('href') || '';
		const ocidMatch = href.match(/[?&]ocid=(\d+)/);
		if (!ocidMatch) return null;

		const name = link.textContent?.trim() || '';
		const cell = link.closest('ess-cell, td, [role="gridcell"]');
		const parent = cell || link.parentElement;
		const cidEl = parent?.querySelector('.customer-id, .external-customer-id');
		const rawCid = cidEl?.textContent?.trim() || '';
		const customerId = rawCid.replace(/\s*\(Manager\).*$/, '').trim();

		return { ocid: ocidMatch[1], name, customerId };
	});

	// Clear the filter after we're done
	await page.evaluate(() => {
		// Look for clear/remove filter buttons
		const clearBtns = document.querySelectorAll<HTMLElement>(
			'[aria-label="Eliminați"], [aria-label="Remove"], [aria-label="Clear"], .chip-remove, .filter-remove, material-chip .remove'
		);
		clearBtns.forEach(btn => btn.click());
	}).catch(() => {});

	if (!account) {
		logInfo('google-scraper', `Could not extract ocid after search for ${formattedId}`);
		return null;
	}

	return account;
}

/**
 * Extract ALL sub-accounts using the Graph (Hartă) view which shows all accounts
 * as cards without pagination. This is more reliable than the Table view.
 *
 * Each card has a "go-to-table" link like:
 *   <a href="/aw/campaigns?ocid=7875955146&ascid=..." aria-label="beautyoneshop.ro">
 * The card also contains the customer ID (xxx-xxx-xxxx) and "(Administrator)" for managers.
 */
async function extractAccountsFromGraphView(page: Page): Promise<Array<{ ocid: string; name: string; customerId: string; isManager: boolean }> | null> {
	try {
		// Navigate to graph view — keep essential URL params (ocid, ascid, authuser, etc.)
		const currentUrl = page.url();
		const urlObj = new URL(currentUrl);
		const graphUrl = `https://ads.google.com/aw/accounts/graph?${urlObj.searchParams.toString()}`;
		logInfo('google-scraper', `Navigating to graph (Hartă) view: ${graphUrl}`);
		await page.goto(graphUrl, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
		await new Promise((r) => setTimeout(r, 5000));

		// Scroll to bottom to ensure all cards are rendered (lazy-loaded)
		await page.evaluate(async () => {
			for (let i = 0; i < 10; i++) {
				window.scrollTo(0, document.body.scrollHeight);
				await new Promise(r => setTimeout(r, 800));
			}
		});
		await new Promise((r) => setTimeout(r, 2000));

		// Extract accounts from graph card nodes (tree-node-cell elements)
		// Each card structure:
		//   tree-node-cell > .cell-container > .title-container >
		//     .titles > .title (account name) + .sub-title > .cid (xxx-xxx-xxxx)
		//     .go-to-table-model > .go-to-table-container > a[href="/aw/campaigns?ocid=..."]
		const accounts = await page.evaluate(() => {
			const results: Array<{ ocid: string; name: string; customerId: string; isManager: boolean }> = [];
			const seen = new Set<string>();

			// Each account is a tree-node-cell in the graph
			const cells = document.querySelectorAll('tree-node-cell');

			for (const cell of cells) {
				// Get the ocid from the go-to-table link
				const link = cell.querySelector<HTMLAnchorElement>('a[href*="ocid="]');
				if (!link) continue;

				const href = link.getAttribute('href') || '';
				const ocidMatch = href.match(/[?&]ocid=(\d+)/);
				if (!ocidMatch) continue;

				const ocid = ocidMatch[1];
				if (seen.has(ocid)) continue;
				seen.add(ocid);

				// Account name from .title element
				const titleEl = cell.querySelector('.title');
				const name = titleEl?.textContent?.trim() || link.getAttribute('aria-label') || '';

				// Customer ID from .cid element (format: xxx-xxx-xxxx)
				const cidEl = cell.querySelector('.cid');
				const customerId = cidEl?.textContent?.trim() || '';

				// Check if it's a Manager/Administrator account — shown in .sub-title
				const subTitle = cell.querySelector('.sub-title');
				const subTitleText = subTitle?.textContent?.trim() || '';
				const isManager = subTitleText.includes('Administrator') || subTitleText.includes('Manager');

				if (customerId) {
					results.push({ ocid, name, customerId, isManager });
				}
			}

			return results;
		});

		if (accounts.length > 0) {
			logInfo('google-scraper', `Graph view: found ${accounts.length} accounts`, {
				metadata: { accounts: accounts.map(a => `${a.name} (${a.customerId}${a.isManager ? ' Manager' : ''})`).slice(0, 25) }
			});
			return accounts;
		}

		logInfo('google-scraper', 'Graph view: no accounts extracted, falling back to table view');
		return null;
	} catch (err) {
		logInfo('google-scraper', `Graph view extraction failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

/**
 * Extract sub-accounts from the MCC table view (legacy fallback).
 */
async function extractAccountsFromTableView(page: Page): Promise<Array<{ ocid: string; name: string; customerId: string; isManager: boolean }>> {
	// Navigate to table view
	const currentUrl = page.url();
	const urlObj = new URL(currentUrl);
	const accountsUrl = `https://ads.google.com/aw/accounts?${urlObj.searchParams.toString()}`;
	logInfo('google-scraper', `Navigating to accounts table view: ${accountsUrl}`);
	await page.goto(accountsUrl, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
	await new Promise((r) => setTimeout(r, 3000));

	await page.waitForSelector('a.account-cell-link', { timeout: 15_000 }).catch(() => {
		logInfo('google-scraper', 'No account-cell-link elements found');
	});

	// Try to set page size to 100
	const pageSizeChanged = await setPageSizeTo100(page);

	if (!pageSizeChanged) {
		logInfo('google-scraper', 'Page size change failed, using pagination');
		return await paginateAndExtractAll(page);
	}

	return page.evaluate(() => {
		const results: Array<{ ocid: string; name: string; customerId: string; isManager: boolean }> = [];
		const seen = new Set<string>();

		document.querySelectorAll('a.account-cell-link').forEach((link) => {
			const href = link.getAttribute('href') || '';
			const ocidMatch = href.match(/[?&]ocid=(\d+)/);
			if (!ocidMatch) return;

			const ocid = ocidMatch[1];
			if (seen.has(ocid)) return;
			seen.add(ocid);

			const name = link.textContent?.trim() || '';
			const cell = link.closest('ess-cell, td, [role="gridcell"]');
			const parent = cell || link.parentElement;
			const cidEl = parent?.querySelector('.customer-id, .external-customer-id');
			const rawCid = cidEl?.textContent?.trim() || '';
			const row = link.closest('ess-row, tr, [role="row"]');
			const rowText = row ? (row as HTMLElement).innerText : '';
			const isManager = rowText.includes('Manager') || rawCid.includes('Manager');
			const customerId = rawCid.replace(/\s*\(Manager\).*$/, '').trim();

			results.push({ ocid, name, customerId, isManager });
		});

		return results;
	});
}

/**
 * Extract sub-accounts from the MCC.
 * Primary: uses Graph (Hartă) view which shows ALL accounts without pagination.
 * Fallback: uses Table view with pagination if Graph view fails.
 */
async function extractSubAccounts(page: Page, allowedCustomerIds?: string[]): Promise<SubAccount[]> {
	// Primary strategy: Graph view (shows all accounts without pagination)
	let rawAccounts = await extractAccountsFromGraphView(page);

	// Fallback: Table view with pagination
	if (!rawAccounts || rawAccounts.length === 0) {
		rawAccounts = await extractAccountsFromTableView(page);
	}

	logInfo('google-scraper', `Found ${rawAccounts.length} entries on accounts page`, {
		metadata: { accounts: rawAccounts.map(a => `${a.name} (${a.customerId}${a.isManager ? ' Manager' : ''})`).slice(0, 20) }
	});

	// Separate regular accounts from sub-MCC (Manager) accounts
	const regularAccounts: SubAccount[] = [];
	const managerAccounts: typeof rawAccounts = [];

	for (const acc of rawAccounts) {
		if (acc.isManager) {
			managerAccounts.push(acc);
		} else {
			regularAccounts.push({ ocid: acc.ocid, name: acc.name, customerId: acc.customerId });
		}
	}

	// Check if any allowed accounts are still missing — explore sub-MCCs
	if (allowedCustomerIds?.length && managerAccounts.length > 0) {
		const foundIds = new Set(regularAccounts.map(a => a.customerId.replace(/-/g, '')));
		const missingIds = allowedCustomerIds.filter(id => !foundIds.has(id));
		if (missingIds.length > 0) {
			logInfo('google-scraper', `${missingIds.length} CRM accounts not found at top level, exploring ${managerAccounts.length} sub-MCC(s)`, {
				metadata: { missingIds, subMccs: managerAccounts.map(a => a.name) }
			});

			for (const mcc of managerAccounts) {
				try {
					const mccAccountsUrl = `https://ads.google.com/aw/accounts?ocid=${mcc.ocid}&ascid=${mcc.ocid}`;
					logInfo('google-scraper', `Exploring sub-MCC: ${mcc.name} (${mcc.customerId})`);
					await page.goto(mccAccountsUrl, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
					await new Promise((r) => setTimeout(r, 3000));

					await page.waitForSelector('a.account-cell-link', { timeout: 10_000 }).catch(() => {});
					await setPageSizeTo100(page);

					const subAccounts = await page.evaluate(() => {
						const results: Array<{ ocid: string; name: string; customerId: string }> = [];
						const seen = new Set<string>();

						document.querySelectorAll('a.account-cell-link').forEach((link) => {
							const href = link.getAttribute('href') || '';
							const ocidMatch = href.match(/[?&]ocid=(\d+)/);
							if (!ocidMatch) return;

							const ocid = ocidMatch[1];
							if (seen.has(ocid)) return;
							seen.add(ocid);

							const name = link.textContent?.trim() || '';
							const cell = link.closest('ess-cell, td, [role="gridcell"]');
							const parent = cell || link.parentElement;
							const cidEl = parent?.querySelector('.customer-id, .external-customer-id');
							const rawCid = cidEl?.textContent?.trim() || '';
							const customerId = rawCid.replace(/\s*\(Manager\).*$/, '').trim();

							results.push({ ocid, name, customerId });
						});

						return results;
					});

					logInfo('google-scraper', `Sub-MCC ${mcc.name}: found ${subAccounts.length} accounts`, {
						metadata: { accounts: subAccounts.map(a => `${a.name} (${a.customerId})`).slice(0, 10) }
					});

					const existingOcids = new Set(regularAccounts.map(a => a.ocid));
					for (const sub of subAccounts) {
						if (!existingOcids.has(sub.ocid)) {
							regularAccounts.push(sub);
							existingOcids.add(sub.ocid);
						}
					}
				} catch (err) {
					logInfo('google-scraper', `Could not explore sub-MCC ${mcc.name}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	}

	// Last resort: search for still-missing accounts individually
	if (allowedCustomerIds?.length) {
		const foundIds = new Set(regularAccounts.map(a => a.customerId.replace(/-/g, '')));
		const stillMissing = allowedCustomerIds.filter(id => !foundIds.has(id));

		if (stillMissing.length > 0) {
			logInfo('google-scraper', `${stillMissing.length} accounts still missing after all discovery, trying search`, {
				metadata: { missingIds: stillMissing }
			});

			for (const missingId of stillMissing) {
				try {
					const found = await searchAccountById(page, missingId);
					if (found) {
						regularAccounts.push(found);
						logInfo('google-scraper', `Found account via search: ${found.name} (${found.customerId}) — ocid=${found.ocid}`);
					} else {
						logWarning('google-scraper', `Account ${missingId} not found via search`);
					}
				} catch (err) {
					logWarning('google-scraper', `Search failed for ${missingId}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	}

	logInfo('google-scraper', `Total ${regularAccounts.length} sub-accounts (after exploring sub-MCCs + search)`, {
		metadata: { accounts: regularAccounts.map(a => `${a.name} (${a.customerId})`).slice(0, 15) }
	});

	return regularAccounts;
}

// ── Invoice Extraction ───────────────────────────────────────────

/**
 * Wait for the payments iframe content to load inside the billing/documents page.
 */
async function waitForIframeContent(page: Page, maxWaitMs = 20_000): Promise<import('puppeteer-core').Frame | null> {
	const startTime = Date.now();

	while (Date.now() - startTime < maxWaitMs) {
		const frames = page.frames();
		for (const frame of frames) {
			if (frame.url().includes('payments.google.com') && !frame.url().includes('auth_warmup')) {
				try {
					const hasContent = await frame.evaluate(() => {
						return document.querySelectorAll('[data-url]').length;
					});
					if (hasContent > 0) {
						logInfo('google-scraper', `Iframe content loaded: ${hasContent} [data-url] elements found`);
						return frame;
					}
				} catch {
					// Frame might not be accessible yet
				}
			}
		}
		await new Promise((r) => setTimeout(r, 2000));
	}

	logInfo('google-scraper', `Iframe content wait timed out after ${maxWaitMs / 1000}s`);
	return null;
}

/**
 * Set the billing/documents iframe to show max rows (250) to avoid pagination.
 * The iframe is from payments.google.com and has its own page size dropdown.
 */
async function setBillingPageSizeToMax(page: Page): Promise<void> {
	const frames = page.frames();
	for (const frame of frames) {
		if (!frame.url().includes('payments.google.com') || frame.url().includes('auth_warmup')) continue;
		try {
			const result = await frame.evaluate(() => {
				// Find the page size dropdown — look for elements showing "10" or "25" near "Rânduri pe pagină" / "Rows per page"
				const selects = document.querySelectorAll('select, [role="listbox"]');
				for (const sel of selects) {
					const selectEl = sel as HTMLSelectElement;
					if (selectEl.tagName === 'SELECT') {
						// Check if it has numeric options like 10, 25, 50, 100, 250
						const options = Array.from(selectEl.options);
						const hasPageSizes = options.some(o => ['10', '25', '50', '100', '250'].includes(o.value));
						if (hasPageSizes) {
							// Find max option
							const maxOpt = options.reduce((max, o) => {
								const v = parseInt(o.value);
								return v > max ? v : max;
							}, 0);
							selectEl.value = String(maxOpt);
							selectEl.dispatchEvent(new Event('change', { bubbles: true }));
							return `select:${maxOpt}`;
						}
					}
				}

				// Try Material Design dropdown pattern (Google's internal components)
				const dropdowns = document.querySelectorAll('[class*="page-size"], [class*="rows-per"], [aria-label*="page"], [aria-label*="rows"]');
				for (const dd of dropdowns) {
					(dd as HTMLElement).click();
					return 'clicked-dropdown';
				}

				// Fallback: look for any clickable element near text "Rânduri pe pagină" or "Rows per page"
				const allText = document.body.innerText;
				if (allText.includes('Rânduri pe pagină') || allText.includes('Rows per page')) {
					// Find the dropdown/select near this text
					const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
					while (walker.nextNode()) {
						const node = walker.currentNode;
						if (node.textContent?.includes('Rânduri pe pagină') || node.textContent?.includes('Rows per page')) {
							const parent = node.parentElement?.closest('div, td, tr, section');
							if (parent) {
								const select = parent.querySelector('select');
								if (select) {
									const options = Array.from(select.options);
									const maxVal = options.reduce((max, o) => Math.max(max, parseInt(o.value) || 0), 0);
									if (maxVal > 0) {
										select.value = String(maxVal);
										select.dispatchEvent(new Event('change', { bubbles: true }));
										return `text-select:${maxVal}`;
									}
								}
							}
						}
					}
				}

				return null;
			});

			if (result) {
				logInfo('google-scraper', `Set billing page size: ${result}`);
				await new Promise((r) => setTimeout(r, 3000)); // Wait for table to reload
				return;
			}
		} catch (err) {
			logInfo('google-scraper', `setBillingPageSizeToMax failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	logInfo('google-scraper', 'Could not find billing page size dropdown (may already show all)');
}

/**
 * Extract invoices from a single billing/documents page (for one sub-account).
 */
async function extractInvoicesFromPage(page: Page): Promise<ScrapedInvoice[]> {
	const { customerId, accountName } = await extractAccountInfo(page);
	logInfo('google-scraper', `Extracting invoices for: ${accountName} (${customerId})`);

	let invoices: ScrapedInvoice[] = [];

	// Strategy 1: Extract from payments iframe
	const frames = page.frames();
	for (const frame of frames) {
		const frameUrl = frame.url();
		if (frameUrl.includes('payments.google.com') && !frameUrl.includes('auth_warmup')) {
			try {
				const rawLinks = await frame.evaluate(() => {
					const links: Array<{ url: string; invoiceId?: string; date?: string; amount?: string }> = [];
					const seen: Record<string, boolean> = {};

					document.querySelectorAll('[data-url]').forEach((el) => {
						const url = el.getAttribute('data-url');
						if (url && url.includes('/payments/apis-secure/doc')) {
							if (seen[url]) return;
							seen[url] = true;

							const row = el.closest('tr') || el.closest('[role="row"]') || el.parentElement?.parentElement?.parentElement;

							// Extract structured data from cells with aria-label
							let invoiceId: string | undefined;
							let date: string | undefined;
							let amount: string | undefined;

							if (row) {
								// Invoice number from cell with aria-label containing "documentului" or "Document number"
								const invoiceCell = row.querySelector('[aria-label*="documentului"], [aria-label*="Document number"], [aria-label*="Invoice number"]');
								if (invoiceCell) {
									const span = invoiceCell.querySelector('span');
									const cellText = span?.textContent?.trim() || invoiceCell.textContent?.trim() || '';
									const numMatch = cellText.match(/(\d{8,12})/);
									if (numMatch) invoiceId = numMatch[1];
								}

								// Amount from cell with aria-label containing "documentelor" or "Amount"
								const amountCell = row.querySelector('[aria-label*="documentelor"], [aria-label*="Amount"], [aria-label*="Sumă"]');
								if (amountCell) {
									const span = amountCell.querySelector('span');
									// Replace &nbsp; with regular space
									amount = (span?.textContent?.trim() || amountCell.textContent?.trim() || '').replace(/\u00a0/g, ' ');
								}

								// Date from cell with aria-label containing "emiterii" or "Issue date"
								const dateCell = row.querySelector('[aria-label*="emiterii"], [aria-label*="Issue date"], [aria-label*="Date"]');
								if (dateCell) {
									const span = dateCell.querySelector('span');
									date = span?.textContent?.trim() || dateCell.textContent?.trim() || '';
								}
							}

							// Fallback to regex on full row text if structured extraction missed data
							if (!invoiceId || !amount) {
								const text = row ? (row as HTMLElement).innerText : '';
								if (!invoiceId) {
									const idMatch = text.match(/(\d{8,12})/);
									invoiceId = idMatch ? idMatch[1] : undefined;
								}
								if (!amount) {
									const amountMatch = text.match(/([\d.,]+\s*(?:RON|USD|EUR|GBP|CHF|lei))/i) || text.match(/(?:RON|USD|EUR|GBP|CHF)\s*([\d.,]+)/i);
									amount = amountMatch ? amountMatch[0].trim() : undefined;
								}
								if (!date) {
									date = text;
								}
							}

							links.push({
								url: url.replace(/&amp;/g, '&'),
								invoiceId,
								date: date || '',
								amount
							});
						}
					});

					return links;
				});

				invoices = rawLinks.map((inv) => ({
					platform: 'google' as const,
					invoiceId: inv.invoiceId || `google_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
					date: parseDate(inv.date || '') || new Date().toISOString().slice(0, 10),
					accountId: customerId,
					accountName,
					downloadUrl: inv.url,
					amountText: inv.amount
				}));

				if (invoices.length > 0) break;
			} catch (frameErr) {
				logInfo('google-scraper', `Could not extract from iframe: ${frameErr instanceof Error ? frameErr.message : String(frameErr)}`);
			}
		}
	}

	// Strategy 2: Fallback — direct page extraction
	if (invoices.length === 0) {
		const rawLinks = await page.evaluate(() => {
			const links: Array<{ url: string; invoiceId?: string; date?: string; amount?: string }> = [];
			const seen: Record<string, boolean> = {};

			document.querySelectorAll('[data-url*="apis-secure"]').forEach((el) => {
				const url = el.getAttribute('data-url');
				if (!url) return;
				if (seen[url]) return;
				seen[url] = true;

				const row = el.closest('tr') || el.closest('[role="row"]');

				let invoiceId: string | undefined;
				let date: string | undefined;
				let amount: string | undefined;

				if (row) {
					const invoiceCell = row.querySelector('[aria-label*="documentului"], [aria-label*="Document number"], [aria-label*="Invoice number"]');
					if (invoiceCell) {
						const span = invoiceCell.querySelector('span');
						const cellText = span?.textContent?.trim() || invoiceCell.textContent?.trim() || '';
						const numMatch = cellText.match(/(\d{8,12})/);
						if (numMatch) invoiceId = numMatch[1];
					}

					const amountCell = row.querySelector('[aria-label*="documentelor"], [aria-label*="Amount"], [aria-label*="Sumă"]');
					if (amountCell) {
						const span = amountCell.querySelector('span');
						amount = (span?.textContent?.trim() || amountCell.textContent?.trim() || '').replace(/\u00a0/g, ' ');
					}

					const dateCell = row.querySelector('[aria-label*="emiterii"], [aria-label*="Issue date"], [aria-label*="Date"]');
					if (dateCell) {
						const span = dateCell.querySelector('span');
						date = span?.textContent?.trim() || dateCell.textContent?.trim() || '';
					}
				}

				// Fallback to regex
				if (!invoiceId || !amount) {
					const text = row ? (row as HTMLElement).innerText : '';
					if (!invoiceId) {
						const idMatch = text.match(/(\d{8,12})/);
						invoiceId = idMatch ? idMatch[1] : undefined;
					}
					if (!amount) {
						const amountMatch = text.match(/([\d.,]+\s*(?:RON|USD|EUR|GBP|CHF|lei))/i) || text.match(/(?:RON|USD|EUR|GBP|CHF)\s*([\d.,]+)/i);
						amount = amountMatch ? amountMatch[0].trim() : undefined;
					}
					if (!date) {
						date = row ? (row as HTMLElement).innerText : '';
					}
				}

				links.push({
					url: url.replace(/&amp;/g, '&'),
					invoiceId,
					date: date || '',
					amount
				});
			});

			return links;
		});

		invoices = rawLinks.map((inv) => ({
			platform: 'google' as const,
			invoiceId: inv.invoiceId || `google_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			date: parseDate(inv.date || '') || new Date().toISOString().slice(0, 10),
			accountId: customerId,
			accountName,
			downloadUrl: inv.url,
			amountText: inv.amount
		}));
	}

	return invoices;
}

/**
 * Navigate to billing/documents for a specific sub-account and extract invoices.
 */
async function scrapeSubAccount(page: Page, account: SubAccount, baseParams: string): Promise<ScrapedInvoice[]> {
	// Build billing URL for this sub-account
	const billingUrl = `https://ads.google.com/aw/billing/documents?ocid=${account.ocid}&ascid=${account.ocid}&${baseParams}`;
	logInfo('google-scraper', `Navigating to billing for: ${account.name} (${account.customerId}) — ocid=${account.ocid}`);

	await page.goto(billingUrl, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {
		logInfo('google-scraper', `Navigation timeout for ${account.name}`);
	});

	// Wait for page to settle
	await new Promise((r) => setTimeout(r, 2000));

	// Check if we actually landed on billing/documents (not redirected elsewhere)
	const currentUrl = page.url();
	if (!currentUrl.includes('billing') && !currentUrl.includes('payments.google.com')) {
		logInfo('google-scraper', `Skipping ${account.name} — redirected to: ${currentUrl.substring(0, 100)}`);
		return [];
	}

	// Wait for iframe content
	const readyFrame = await waitForIframeContent(page, 20_000);
	if (!readyFrame) {
		logInfo('google-scraper', `No billing iframe for ${account.name}, trying direct extraction`);
		await new Promise((r) => setTimeout(r, 3000));
	} else {
		// Set page size to max (250) to avoid missing invoices due to pagination
		await setBillingPageSizeToMax(page);
	}

	// Extract invoices
	const invoices = await extractInvoicesFromPage(page);

	// Override account info with the sub-account details (more accurate)
	for (const inv of invoices) {
		inv.accountId = account.customerId.replace(/-/g, '');
		inv.accountName = account.name;
	}

	logInfo('google-scraper', `Found ${invoices.length} invoices for ${account.name}`);
	return invoices;
}

// ── Main Scraper ─────────────────────────────────────────────────

/**
 * Run the Google Ads billing page scraper.
 *
 * Handles the full MCC flow:
 * 1. selectaccount → auto-click MCC
 * 2. Extract sub-accounts from accounts page
 * 3. For each sub-account → billing/documents → extract invoices
 * 4. Save fresh cookies
 */
export async function scrapeGoogleInvoices(sessionId: string, allowedCustomerIds?: string[]): Promise<ScrapedInvoice[]> {
	const session = getSession(sessionId);
	if (!session || !session.page || session.page.isClosed()) {
		throw new Error('Sesiunea nu există sau browserul s-a închis');
	}

	const page = session.page;
	session.status = 'scraping';

	try {
		// Step 1: Navigate to billing documents
		const currentUrl = page.url();
		logInfo('google-scraper', `Starting scrape. Current URL: ${currentUrl}`);

		await page.goto('https://ads.google.com/aw/billing/documents', {
			waitUntil: 'networkidle2',
			timeout: 30_000
		}).catch(() => {
			logInfo('google-scraper', 'Initial navigation timeout');
		});

		// Step 2: Handle account selector if present
		let postNavUrl = page.url();
		if (postNavUrl.includes('selectaccount')) {
			const autoSelected = await handleAccountSelector(page);
			if (!autoSelected) {
				// Wait for user to manually select
				logInfo('google-scraper', 'Auto-select failed, waiting for manual selection...');
				const startWait = Date.now();
				while (Date.now() - startWait < 60_000) {
					const url = page.url();
					if (!url.includes('selectaccount')) break;
					await new Promise((r) => setTimeout(r, 3000));
				}
			}
			postNavUrl = page.url();
		}

		logInfo('google-scraper', `After account selection: ${postNavUrl}`);

		// Step 3: Determine if this is an MCC account (has sub-accounts) or a single account
		// Extract base URL params (authuser, euid, etc.) for reuse
		const urlObj = new URL(postNavUrl);
		const preserveParams = ['euid', '__u', 'uscid', '__c', 'authuser', '__e'];
		const baseParams = preserveParams
			.filter(p => urlObj.searchParams.has(p))
			.map(p => `${p}=${urlObj.searchParams.get(p)}`)
			.join('&');

		// Check if we're on accounts page or can navigate to it
		let allInvoices: ScrapedInvoice[] = [];

		// Try to get sub-accounts (MCC flow)
		const subAccounts = await extractSubAccounts(page, allowedCustomerIds);

		// Filter to only CRM-active accounts if allowedCustomerIds provided
		let accountsToScrape = subAccounts;
		if (subAccounts.length > 0 && allowedCustomerIds?.length) {
			const allowedSet = new Set(allowedCustomerIds);
			accountsToScrape = subAccounts.filter(a =>
				allowedSet.has(a.customerId.replace(/-/g, ''))
			);
			logInfo('google-scraper', `Filtered ${subAccounts.length} sub-accounts to ${accountsToScrape.length} CRM-active`, {
				metadata: {
					total: subAccounts.length,
					filtered: accountsToScrape.length,
					accounts: accountsToScrape.map(a => `${a.name} (${a.customerId})`)
				}
			});
		}

		if (accountsToScrape.length > 0) {
			// MCC flow: iterate through each sub-account
			logInfo('google-scraper', `MCC mode: scraping ${accountsToScrape.length} sub-accounts`);

			for (const account of accountsToScrape) {
				try {
					const invoices = await scrapeSubAccount(page, account, baseParams);
					allInvoices.push(...invoices);
				} catch (err) {
					logError('google-scraper', `Error scraping ${account.name}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		} else {
			// Single account flow: just extract from current page
			logInfo('google-scraper', 'Single account mode (no sub-accounts found)');

			// Make sure we're on billing/documents
			if (!postNavUrl.includes('billing/documents')) {
				await page.goto('https://ads.google.com/aw/billing/documents', {
					waitUntil: 'networkidle2',
					timeout: 30_000
				}).catch(() => {});
				await new Promise((r) => setTimeout(r, 3000));
			}

			// Wait for iframe content
			const readyFrame = await waitForIframeContent(page, 25_000);
			if (!readyFrame) {
				await new Promise((r) => setTimeout(r, 5000));
			}

			allInvoices = await extractInvoicesFromPage(page);
		}

		logInfo('google-scraper', `Total: ${allInvoices.length} invoices from ${accountsToScrape.length || 1} account(s)`, {
			tenantId: session.tenantId,
			metadata: { invoiceCount: allInvoices.length, accountCount: accountsToScrape.length || 1 }
		});

		// Step 4: Save fresh cookies
		try {
			const cookies = await extractBrowserCookies(page, 'google');
			if (cookies.length > 0) {
				await saveCookiesFromBrowser('google', session.integrationId, session.tenantId, cookies);
				session.cookiesRefreshed = true;
				logInfo('google-scraper', 'Google cookies refreshed successfully', {
					tenantId: session.tenantId
				});
			}
		} catch (cookieErr) {
			logError('google-scraper', `Failed to refresh cookies: ${cookieErr instanceof Error ? cookieErr.message : String(cookieErr)}`, {
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
