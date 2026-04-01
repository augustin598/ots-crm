import puppeteer from 'puppeteer-core';
import type { Browser, Page, Cookie } from 'puppeteer-core';
import { findChromePath } from './find-chrome';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { saveFbSessionCookies } from '$lib/server/meta-ads/fb-cookies';
import { saveGoogleSessionCookies } from '$lib/server/google-ads/google-cookies';
import { saveTtSessionCookies } from '$lib/server/tiktok-ads/tt-cookies';

// ── Types ─────────────────────────────────────────────────────────

export type ScraperPlatform = 'meta' | 'google' | 'tiktok';

export interface ScrapedInvoice {
	platform: ScraperPlatform;
	invoiceId: string;
	invoiceNumber?: string;
	date: string; // ISO date "2026-02-15"
	amount?: number; // in cents
	amountText?: string; // raw text e.g. "RON3,503.38"
	currencyCode?: string;
	accountId: string;
	accountName?: string;
	downloadUrl?: string;
	txid?: string; // Facebook transaction ID
}

export type ScraperSessionStatus =
	| 'waiting_login'
	| 'logged_in'
	| 'scraping'
	| 'done'
	| 'error'
	| 'cancelled';

export interface ScraperSession {
	id: string;
	platform: ScraperPlatform;
	tenantId: string;
	integrationId: string;
	status: ScraperSessionStatus;
	invoices: ScrapedInvoice[];
	cookiesRefreshed: boolean;
	error?: string;
	startedAt: Date;
	page?: Page; // not serialized to client
}

// ── Constants ─────────────────────────────────────────────────────

const BROWSER_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (user interaction is slow)
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes auto-expire
const LOGIN_POLL_INTERVAL_MS = 2_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for user to log in
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Login detection config per platform ───────────────────────────

const LOGIN_INDICATORS: Record<
	ScraperPlatform,
	{
		billingUrl: string;
		isLoggedIn: (url: string) => boolean;
	}
> = {
	meta: {
		billingUrl: 'https://business.facebook.com/billing_hub/accounts',
		isLoggedIn: (url: string) =>
			url.includes('billing_hub') && !url.includes('login') && !url.includes('checkpoint')
	},
	google: {
		billingUrl: 'https://ads.google.com/aw/billing/documents',
		isLoggedIn: (url: string) =>
			url.includes('ads.google.com') &&
			!url.includes('accounts.google.com/signin') &&
			!url.includes('accounts.google.com/v3')
	},
	tiktok: {
		billingUrl: 'https://business.tiktok.com/manage/billing/v2',
		isLoggedIn: (url: string) =>
			url.includes('manage/billing') && !url.includes('login') && !url.includes('signin')
	}
};

// ── Cookie domains per platform ───────────────────────────────────

const COOKIE_DOMAINS: Record<ScraperPlatform, string[]> = {
	meta: ['.facebook.com', '.business.facebook.com'],
	google: ['.google.com', '.ads.google.com', '.payments.google.com'],
	tiktok: ['.tiktok.com', '.business.tiktok.com']
};

// ── Interactive Browser Singleton ─────────────────────────────────

const INTERACTIVE_BROWSER_SYMBOL = Symbol.for('puppeteer_interactive_browser');

interface InteractiveBrowserState {
	browser: Browser | null;
	idleTimer: ReturnType<typeof setTimeout> | null;
	launching: Promise<Browser> | null;
}

function getInteractiveState(): InteractiveBrowserState {
	if (!(globalThis as any)[INTERACTIVE_BROWSER_SYMBOL]) {
		(globalThis as any)[INTERACTIVE_BROWSER_SYMBOL] = {
			browser: null,
			idleTimer: null,
			launching: null
		} satisfies InteractiveBrowserState;
	}
	return (globalThis as any)[INTERACTIVE_BROWSER_SYMBOL];
}

function resetInteractiveIdleTimer(): void {
	const state = getInteractiveState();
	if (state.idleTimer) clearTimeout(state.idleTimer);
	state.idleTimer = setTimeout(async () => {
		await closeInteractiveBrowser();
	}, BROWSER_IDLE_TIMEOUT_MS);
}

async function closeInteractiveBrowser(): Promise<void> {
	const state = getInteractiveState();
	if (state.idleTimer) {
		clearTimeout(state.idleTimer);
		state.idleTimer = null;
	}
	if (state.browser) {
		try {
			await state.browser.close();
			logInfo('invoice-scraper', 'Interactive browser closed');
		} catch {
			// Browser may already be closed
		}
		state.browser = null;
	}
	state.launching = null;
}

/**
 * Launch or reuse the interactive (non-headless) browser singleton.
 * Separate from the headless SEO scraper to avoid conflicts.
 */
export async function launchInteractiveBrowser(): Promise<Browser> {
	const state = getInteractiveState();

	if (state.browser && state.browser.connected) {
		resetInteractiveIdleTimer();
		return state.browser;
	}

	if (state.browser && !state.browser.connected) {
		logInfo('invoice-scraper', 'Interactive browser disconnected, resetting');
		state.browser = null;
		state.launching = null;
	}

	if (state.launching) {
		return state.launching;
	}

	state.launching = (async () => {
		let chromePath: string;
		try {
			chromePath = findChromePath();
			console.log(`[SCRAPER-DEBUG] Chrome found at: ${chromePath}`);
		} catch (e) {
			const { message, stack } = serializeError(e);
			console.error(`[SCRAPER-DEBUG] Chrome not found:`, message, stack);
			logError('invoice-scraper', `Chrome not found: ${message}`, {
				stackTrace: stack
			});
			throw e;
		}

		console.log(`[SCRAPER-DEBUG] Launching interactive browser at ${chromePath}`);
		logInfo('invoice-scraper', `Launching interactive browser`, {
			metadata: { chromePath }
		});

		// Use a persistent profile directory so login sessions survive between scans
		const scraperProfileDir = join(homedir(), '.crm-scraper-profile');
		try { mkdirSync(scraperProfileDir, { recursive: true }); } catch { /* exists */ }

		const browser = await puppeteer.launch({
			headless: false,
			executablePath: chromePath,
			userDataDir: scraperProfileDir, // Persistent profile — keeps login sessions
			defaultViewport: null, // Use full window size
			ignoreDefaultArgs: ['--enable-automation'], // Hide "controlled by automated test software" banner
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--window-size=1440,900',
				'--no-first-run',
				'--disable-background-networking',
				'--disable-blink-features=AutomationControlled' // Don't expose navigator.webdriver
				// Note: NO --disable-extensions (user may need password manager)
			]
		});

		state.browser = browser;
		state.launching = null;
		resetInteractiveIdleTimer();
		console.log(`[SCRAPER-DEBUG] Interactive browser launched successfully`);
		logInfo('invoice-scraper', 'Interactive browser launched successfully');
		return browser;
	})().catch((err) => {
		state.launching = null;
		console.error(`[SCRAPER-DEBUG] Browser launch FAILED:`, err instanceof Error ? err.message : String(err), err instanceof Error ? err.stack : '');
		logError(
			'invoice-scraper',
			`Browser launch failed: ${err instanceof Error ? err.message : String(err)}`,
			{ stackTrace: err instanceof Error ? err.stack : undefined }
		);
		throw err;
	});

	return state.launching;
}

/**
 * Shut down the interactive browser explicitly.
 */
export async function shutdownInteractiveBrowser(): Promise<void> {
	await closeInteractiveBrowser();
}

// ── Session Management ────────────────────────────────────────────

const sessions = new Map<string, ScraperSession>();

// Auto-cleanup expired sessions every 5 minutes
setInterval(
	() => {
		const now = Date.now();
		for (const [id, session] of sessions) {
			if (now - session.startedAt.getTime() > SESSION_EXPIRY_MS) {
				// Close page if still open
				if (session.page && !session.page.isClosed()) {
					session.page.close().catch(() => {});
				}
				sessions.delete(id);
				logInfo('invoice-scraper', `Session ${id} expired and cleaned up`);
			}
		}
	},
	5 * 60 * 1000
);

function generateSessionId(): string {
	return `scraper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getSession(sessionId: string): ScraperSession | undefined {
	return sessions.get(sessionId);
}

/**
 * Get session data safe for sending to client (no Page reference).
 */
export function getSessionForClient(
	sessionId: string
): Omit<ScraperSession, 'page'> | undefined {
	const session = sessions.get(sessionId);
	if (!session) return undefined;
	const { page: _page, ...clientSafe } = session;
	return clientSafe;
}

/**
 * Create a new scraper session: launches browser and navigates to billing page.
 */
export async function createSession(
	platform: ScraperPlatform,
	tenantId: string,
	integrationId: string
): Promise<string> {
	const sessionId = generateSessionId();
	console.log(`[SCRAPER-DEBUG] createSession: ${sessionId}, platform=${platform}, tenantId=${tenantId}`);

	const browser = await launchInteractiveBrowser();
	console.log(`[SCRAPER-DEBUG] Browser obtained, creating new page...`);
	const page = await browser.newPage();
	console.log(`[SCRAPER-DEBUG] New page created`);

	// Stealth settings
	await page.setUserAgent(USER_AGENT);
	await page.evaluateOnNewDocument(() => {
		Object.defineProperty(navigator, 'webdriver', { get: () => false });
	});
	await page.setExtraHTTPHeaders({
		'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
	});

	const session: ScraperSession = {
		id: sessionId,
		platform,
		tenantId,
		integrationId,
		status: 'waiting_login',
		invoices: [],
		cookiesRefreshed: false,
		startedAt: new Date(),
		page
	};

	sessions.set(sessionId, session);

	// Navigate to billing page
	const { billingUrl } = LOGIN_INDICATORS[platform];
	logInfo('invoice-scraper', `Session ${sessionId}: Navigating to ${billingUrl}`, {
		tenantId,
		metadata: { platform, integrationId }
	});

	try {
		await page.goto(billingUrl, {
			waitUntil: 'networkidle2',
			timeout: 30_000
		});
	} catch {
		// Navigation timeout is OK — page might have redirected to login
		logInfo('invoice-scraper', `Session ${sessionId}: Initial navigation completed (may be on login page)`);
	}

	// Check if already logged in
	const currentUrl = page.url();
	const { isLoggedIn } = LOGIN_INDICATORS[platform];
	if (isLoggedIn(currentUrl)) {
		session.status = 'logged_in';
		logInfo('invoice-scraper', `Session ${sessionId}: Already logged in`, {
			tenantId,
			metadata: { platform, currentUrl }
		});
	}

	return sessionId;
}

/**
 * Check if the user has completed login in the browser.
 * Returns true if logged in.
 */
export async function checkLogin(sessionId: string): Promise<boolean> {
	const session = sessions.get(sessionId);
	if (!session || !session.page || session.page.isClosed()) {
		throw new Error('Sesiunea nu există sau browserul s-a închis');
	}

	if (session.status === 'logged_in' || session.status === 'scraping' || session.status === 'done') {
		return true;
	}

	const currentUrl = session.page.url();
	const { isLoggedIn } = LOGIN_INDICATORS[session.platform];

	if (isLoggedIn(currentUrl)) {
		session.status = 'logged_in';
		logInfo('invoice-scraper', `Session ${sessionId}: Login detected`, {
			tenantId: session.tenantId,
			metadata: { platform: session.platform, currentUrl }
		});
		return true;
	}

	return false;
}

/**
 * Wait for user to complete login (blocking, with timeout).
 * Used internally by scrapers if needed.
 */
export async function waitForLogin(
	sessionId: string,
	timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const loggedIn = await checkLogin(sessionId);
		if (loggedIn) return true;
		await new Promise((r) => setTimeout(r, LOGIN_POLL_INTERVAL_MS));
	}
	return false;
}

// ── Cookie Extraction & Saving ────────────────────────────────────

/**
 * Extract cookies from the browser page for the specified platform domains.
 */
export async function extractBrowserCookies(
	page: Page,
	platform: ScraperPlatform
): Promise<Cookie[]> {
	const domains = COOKIE_DOMAINS[platform];

	// Get all cookies from browser
	const allCookies = await page.cookies();

	// Filter by platform domains
	const filtered = allCookies.filter((c) =>
		domains.some((d) => c.domain.endsWith(d.replace(/^\./, '')) || c.domain === d)
	);

	logInfo('invoice-scraper', `Extracted ${filtered.length} cookies for ${platform}`, {
		metadata: { totalCookies: allCookies.length, filteredCookies: filtered.length }
	});

	return filtered;
}

/**
 * Convert Puppeteer cookies to the format expected by existing cookie save functions,
 * then save them to DB. This refreshes the session for API-based downloads.
 */
export async function saveCookiesFromBrowser(
	platform: ScraperPlatform,
	integrationId: string,
	tenantId: string,
	cookies: Cookie[]
): Promise<void> {
	// Convert Puppeteer Cookie format to our internal format
	const formatted = cookies.map((c) => ({
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite
	}));

	const cookiesJson = JSON.stringify(formatted);

	switch (platform) {
		case 'meta':
			await saveFbSessionCookies(integrationId, tenantId, cookiesJson);
			break;
		case 'google':
			await saveGoogleSessionCookies(integrationId, tenantId, cookiesJson);
			break;
		case 'tiktok':
			await saveTtSessionCookies(integrationId, tenantId, cookiesJson);
			break;
	}

	logInfo('invoice-scraper', `Cookies saved for ${platform}`, {
		tenantId,
		metadata: { integrationId, cookieCount: formatted.length }
	});
}

// ── Session Cleanup ───────────────────────────────────────────────

/**
 * Cancel a scraper session and close the browser page.
 */
export async function cancelSession(sessionId: string): Promise<void> {
	const session = sessions.get(sessionId);
	if (!session) return;

	session.status = 'cancelled';
	if (session.page && !session.page.isClosed()) {
		await session.page.close().catch(() => {});
	}
	sessions.delete(sessionId);

	logInfo('invoice-scraper', `Session ${sessionId} cancelled`);
}

/**
 * Mark session as done with results.
 */
export function completeSession(sessionId: string, invoices: ScrapedInvoice[]): void {
	const session = sessions.get(sessionId);
	if (!session) return;

	session.invoices = invoices;
	session.status = 'done';

	logInfo('invoice-scraper', `Session ${sessionId} completed with ${invoices.length} invoices`, {
		tenantId: session.tenantId,
		metadata: { platform: session.platform, invoiceCount: invoices.length }
	});
}

/**
 * Mark session as errored.
 */
export function failSession(sessionId: string, error: string): void {
	const session = sessions.get(sessionId);
	if (!session) return;

	session.status = 'error';
	session.error = error;

	logError('invoice-scraper', `Session ${sessionId} failed: ${error}`, {
		tenantId: session.tenantId,
		metadata: { platform: session.platform }
	});
}
