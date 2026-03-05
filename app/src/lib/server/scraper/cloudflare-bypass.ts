import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { findChromePath } from './find-chrome';

// ── Constants ──────────────────────────────────────────────────────
const BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT_PAGES = 3;
const DEFAULT_PAGE_TIMEOUT_MS = 30_000;
const CLOUDFLARE_CHALLENGE_WAIT_MS = 8_000;
const PAGE_WAIT_TIMEOUT_MS = 30_000; // max wait for a page slot

// ── Singleton State ────────────────────────────────────────────────
const BROWSER_SYMBOL = Symbol.for('puppeteer_browser_instance');

interface BrowserState {
	browser: Browser | null;
	activePages: number;
	idleTimer: ReturnType<typeof setTimeout> | null;
	launching: Promise<Browser> | null;
}

function getState(): BrowserState {
	if (!(globalThis as any)[BROWSER_SYMBOL]) {
		(globalThis as any)[BROWSER_SYMBOL] = {
			browser: null,
			activePages: 0,
			idleTimer: null,
			launching: null
		} satisfies BrowserState;
	}
	return (globalThis as any)[BROWSER_SYMBOL];
}

// ── Browser Lifecycle ──────────────────────────────────────────────
async function ensureBrowser(): Promise<Browser> {
	const state = getState();

	// If browser exists and is still connected, reuse it
	if (state.browser && state.browser.connected) {
		return state.browser;
	}

	// If browser exists but disconnected, clean up
	if (state.browser && !state.browser.connected) {
		console.log('[SCRAPER] Browser disconnected, resetting state');
		state.browser = null;
		state.launching = null;
		state.activePages = 0;
	}

	// If another call is already launching, wait for it
	if (state.launching) {
		return state.launching;
	}

	// Launch new browser
	state.launching = (async () => {
		let chromePath: string;
		try {
			chromePath = findChromePath();
		} catch (e) {
			console.error(`[SCRAPER] Chrome not found:`, e instanceof Error ? e.message : e);
			console.error(`[SCRAPER] CHROME_PATH env: ${process.env.CHROME_PATH || '(not set)'}`);
			console.error(`[SCRAPER] Platform: ${process.platform}`);
			throw e;
		}
		console.log(`[SCRAPER] Launching browser (Chrome at ${chromePath})`);

		const browser = await puppeteer.launch({
			headless: true,
			executablePath: chromePath,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
				'--disable-extensions',
				'--disable-background-networking',
				'--disable-sync',
				'--no-first-run'
			]
		});

		state.browser = browser;
		state.launching = null;
		resetIdleTimer();
		console.log('[SCRAPER] Browser launched successfully');
		return browser;
	})().catch((err) => {
		state.launching = null;
		console.error(`[SCRAPER] Browser launch FAILED:`, err instanceof Error ? err.message : err);
		throw err;
	});

	return state.launching;
}

function resetIdleTimer(): void {
	const state = getState();
	if (state.idleTimer) clearTimeout(state.idleTimer);
	state.idleTimer = setTimeout(async () => {
		if (state.activePages === 0) {
			await closeBrowser();
		}
	}, BROWSER_IDLE_TIMEOUT_MS);
}

async function closeBrowser(): Promise<void> {
	const state = getState();
	if (state.idleTimer) {
		clearTimeout(state.idleTimer);
		state.idleTimer = null;
	}
	if (state.browser) {
		try {
			await state.browser.close();
			console.log('[SCRAPER] Browser closed');
		} catch {
			// Browser may already be closed
		}
		state.browser = null;
	}
	state.launching = null;
}

// ── Cloudflare Detection ───────────────────────────────────────────
function isCloudflareChallenge(response: Response): boolean {
	const cfMitigated = response.headers.get('cf-mitigated');
	if (cfMitigated === 'challenge') return true;

	const server = response.headers.get('server') || '';
	const hasCfRay = !!response.headers.get('cf-ray');
	if (server.includes('cloudflare') && (response.status === 403 || response.status === 503)) {
		return true;
	}
	if (hasCfRay && response.status === 403) return true;

	return false;
}

function isCloudflareHtml(html: string): boolean {
	if (html.includes('<title>Just a moment...</title>')) return true;
	if (html.includes('cf-browser-verification')) return true;
	if (html.includes('window._cf_chl_opt')) return true;
	if (html.includes('cdn-cgi/challenge-platform')) return true;
	return false;
}

// ── Puppeteer Fetch ────────────────────────────────────────────────
async function waitForPageSlot(): Promise<void> {
	const state = getState();
	if (state.activePages < MAX_CONCURRENT_PAGES) return;

	const start = Date.now();
	while (state.activePages >= MAX_CONCURRENT_PAGES) {
		if (Date.now() - start > PAGE_WAIT_TIMEOUT_MS) {
			throw new Error('[SCRAPER] Timeout waiting for available page slot');
		}
		await new Promise((r) => setTimeout(r, 100));
	}
}

async function fetchWithPuppeteer(url: string, timeoutMs: number): Promise<string> {
	const state = getState();
	await waitForPageSlot();
	state.activePages++;
	resetIdleTimer();

	const browser = await ensureBrowser();
	const page = await browser.newPage();

	try {
		// Manual stealth settings (replaces puppeteer-extra-plugin-stealth)
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
		);
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'webdriver', { get: () => false });
		});
		await page.setViewport({ width: 1920, height: 1080 });
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
		});

		const start = Date.now();
		await page.goto(url, {
			waitUntil: 'networkidle2',
			timeout: timeoutMs
		});

		// Wait for Cloudflare challenge to auto-resolve
		try {
			await page.waitForFunction(() => !document.title.includes('Just a moment'), {
				timeout: CLOUDFLARE_CHALLENGE_WAIT_MS
			});
		} catch {
			// Title may never have been "Just a moment" — that's fine
		}

		const html = await page.content();
		const elapsed = Date.now() - start;
		console.log(`[SCRAPER] Puppeteer fetched ${url} in ${elapsed}ms`);

		if (isCloudflareHtml(html)) {
			console.warn(`[SCRAPER] Puppeteer still got Cloudflare challenge page for ${url}`);
		}

		return html;
	} finally {
		await Promise.race([page.close(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
		state.activePages--;
		resetIdleTimer();
	}
}

// ── Public API ─────────────────────────────────────────────────────

export async function fetchWithCloudflareFallback(
	url: string,
	options?: {
		headers?: Record<string, string>;
		timeoutMs?: number;
		signal?: AbortSignal;
	}
): Promise<{ html: string; usedPuppeteer: boolean }> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;

	// Step 1: Try normal fetch first
	try {
		const controller = new AbortController();
		const fetchTimeout = setTimeout(() => controller.abort(), timeoutMs);

		// If external signal provided, forward abort
		if (options?.signal) {
			if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			options.signal.addEventListener('abort', () => controller.abort(), { once: true });
		}

		const res = await fetch(url, {
			method: 'GET',
			redirect: 'follow',
			signal: controller.signal,
			headers: options?.headers ?? {}
		});
		clearTimeout(fetchTimeout);

		// Check for Cloudflare at response level
		if (isCloudflareChallenge(res)) {
			res.body?.cancel();
			console.log(`[SCRAPER] Cloudflare detected for ${url} — falling back to Puppeteer`);
			try {
				const html = await fetchWithPuppeteer(url, timeoutMs);
				return { html, usedPuppeteer: true };
			} catch (puppeteerErr) {
				console.warn(`[SCRAPER] Puppeteer fallback failed for ${url}:`, puppeteerErr instanceof Error ? puppeteerErr.message : puppeteerErr);
				// Return empty so caller can handle gracefully
				return { html: '', usedPuppeteer: false };
			}
		}

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}

		const html = await res.text();

		// Check for Cloudflare in HTML body
		if (isCloudflareHtml(html)) {
			console.log(
				`[SCRAPER] Cloudflare HTML detected for ${url} — falling back to Puppeteer`
			);
			try {
				const puppeteerHtml = await fetchWithPuppeteer(url, timeoutMs);
				return { html: puppeteerHtml, usedPuppeteer: true };
			} catch (puppeteerErr) {
				console.warn(`[SCRAPER] Puppeteer fallback failed for ${url}:`, puppeteerErr instanceof Error ? puppeteerErr.message : puppeteerErr);
				// Return the Cloudflare HTML — caller can decide
				return { html, usedPuppeteer: false };
			}
		}

		return { html, usedPuppeteer: false };
	} catch (e) {
		// Try Puppeteer as last resort for any fetch failure
		const err = e instanceof Error ? e : new Error(String(e));
		console.log(
			`[SCRAPER] Fetch failed with ${err.message} for ${url} — trying Puppeteer`
		);
		try {
			const html = await fetchWithPuppeteer(url, timeoutMs);
			return { html, usedPuppeteer: true };
		} catch (puppeteerErr) {
			console.warn(`[SCRAPER] Puppeteer also failed for ${url}:`, puppeteerErr instanceof Error ? puppeteerErr.message : puppeteerErr);
			throw err;
		}
	}
}

export async function shutdownBrowser(): Promise<void> {
	await closeBrowser();
}
