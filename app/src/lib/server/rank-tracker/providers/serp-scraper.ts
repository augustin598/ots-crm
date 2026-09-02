// Provider SERP in-house: puppeteer-core + Chromium de sistem (CHROME_PATH în prod).
// Construiește URL-ul Google (num=100, hl/gl, uule pentru locație), emulează
// desktop/mobil, setează cookie-urile de consimțământ, aplică stealth manual,
// paceuiește cererile și clasifică erorile (blocat/timeout/parse). Toate
// dependențele externe (launch, sleep, env) sunt injectabile → testabil fără browser.
// Modelul de stealth/launch e preluat din scraper/cloudflare-bypass.ts.
import { findChromePath } from '$lib/server/scraper/find-chrome';
import { detectBlocked, parseSerpHtml } from './serp-parser';
import { SerpProviderError, type SerpQuery, type SerpResult, type SerpProvider } from './types';

const DEFAULT_PACE_MS = 8000;
const NAV_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 2; // 1 încercare + 2 reîncercări = 3 total

// ── Tipuri minime de browser (compatibile puppeteer-core, dar injectabile) ──
export interface PageLike {
	setUserAgent(ua: string): Promise<void>;
	setViewport(v: {
		width: number;
		height: number;
		isMobile?: boolean;
		hasTouch?: boolean;
	}): Promise<void>;
	setExtraHTTPHeaders(h: Record<string, string>): Promise<void>;
	setCookie(...cookies: Array<Record<string, unknown>>): Promise<void>;
	evaluateOnNewDocument(fn: (...a: unknown[]) => unknown): Promise<void>;
	goto(url: string, opts: { waitUntil?: string; timeout?: number }): Promise<unknown>;
	content(): Promise<string>;
	close(): Promise<void>;
}
export interface BrowserLike {
	newPage(): Promise<PageLike>;
	close(): Promise<void>;
}
export type LaunchFn = (opts: { args: string[] }) => Promise<BrowserLike>;

export interface ScraperDeps {
	/** Lansează un browser; implicit puppeteer-core cu Chromium de sistem. */
	launch?: LaunchFn;
	/** Un browser deja deschis (partajat de runner); dacă e dat, NU se închide aici. */
	browser?: BrowserLike;
	sleep?: (ms: number) => Promise<void>;
	env?: Record<string, string | undefined>;
	/** Jitter 0..1 (implicit aleator) — injectabil pentru determinism în teste. */
	jitter?: () => number;
}

// Contor round-robin pentru proxy-uri, la nivel de proces.
let proxyCounter = 0;
/** Doar pentru teste: resetează starea la nivel de modul. */
export function _resetScraperState(): void {
	proxyCounter = 0;
}

const UA_DESKTOP =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA_MOBILE =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// Alfabetul base64url folosit de UULE pentru caracterul de lungime.
const UULE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Codificarea UULE v2 pe nume canonic de locație:
 * „w+CAIQICI" + caracterul de lungime (alfabet[len % 64]) + base64(locație).
 * Google acceptă numele canonic („Oraș,Județ,Țara") pentru geolocalizarea SERP.
 */
export function buildUule(location: string): string {
	const lengthChar = UULE_ALPHABET[location.length % 64];
	const b64 = Buffer.from(location, 'utf8').toString('base64');
	return `w+CAIQICI${lengthChar}${b64}`;
}

/** URL-ul de căutare Google pentru interogare (num=depth, hl/gl, pws=0, uule opțional). */
export function buildSerpUrl(q: SerpQuery): string {
	const params = new URLSearchParams({
		q: q.keyword,
		num: String(q.depth),
		hl: q.hl,
		gl: q.gl,
		pws: '0'
	});
	if (q.location) params.set('uule', buildUule(q.location));
	return `https://www.${q.googleDomain}/search?${params.toString()}`;
}

function pickProxy(proxies: string[]): string | null {
	if (proxies.length === 0) return null;
	const p = proxies[proxyCounter % proxies.length];
	proxyCounter++;
	return p;
}

function isTimeoutError(e: unknown): boolean {
	const name = (e as { name?: string })?.name ?? '';
	const msg = (e as { message?: string })?.message ?? '';
	return name === 'TimeoutError' || /timeout/i.test(msg);
}

async function defaultLaunch(opts: { args: string[] }): Promise<BrowserLike> {
	const puppeteer = (await import('puppeteer-core')).default;
	return (await puppeteer.launch({
		headless: true,
		executablePath: findChromePath(),
		args: opts.args
	})) as unknown as BrowserLike;
}

async function preparePage(page: PageLike, q: SerpQuery): Promise<void> {
	if (q.device === 'mobile') {
		await page.setUserAgent(UA_MOBILE);
		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
	} else {
		await page.setUserAgent(UA_DESKTOP);
		await page.setViewport({ width: 1366, height: 768 });
	}
	await page.evaluateOnNewDocument(() => {
		Object.defineProperty(navigator, 'webdriver', { get: () => false });
	});
	await page.setExtraHTTPHeaders({ 'Accept-Language': `${q.hl}-${q.gl.toUpperCase()},${q.hl};q=0.9,en;q=0.8` });
	// Cookie-uri de consimțământ ca să sărim peste peretele „Înainte de a continua".
	// SOCS = token de accept al consimțământului; CONSENT=YES+ = varianta legacy.
	const cookieDomain = `.${q.googleDomain}`;
	await page.setCookie(
		{ name: 'SOCS', value: 'CAISNQgQEitib3', domain: cookieDomain, path: '/' },
		{ name: 'CONSENT', value: 'YES+', domain: cookieDomain, path: '/' }
	);
}

async function attemptOnce(
	browser: BrowserLike,
	q: SerpQuery,
	targetDomain: string
): Promise<SerpResult> {
	const page = await browser.newPage();
	try {
		await preparePage(page, q);
		try {
			await page.goto(buildSerpUrl(q), { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
		} catch (e) {
			if (isTimeoutError(e)) throw new SerpProviderError('timeout la navigare', 'timeout', true);
			throw new SerpProviderError('eroare de rețea la navigare', 'network', true);
		}
		const html = await page.content();
		if (detectBlocked(html)) {
			throw new SerpProviderError('blocat de Google (CAPTCHA)', 'blocked', false);
		}
		const result = parseSerpHtml(html, { targetDomain, competitors: [] });
		// Anti-„lost fals": pagină nedetectată ca blocată, dar cu 0 organice = selector rupt.
		if (result.organic.length === 0) {
			throw new SerpProviderError('0 rezultate organice — selector posibil rupt', 'parse', false);
		}
		return result;
	} finally {
		await page.close().catch(() => {});
	}
}

/** Rulează o interogare SERP prin scraper, cu pacing, retry și clasificare de erori. */
export async function fetchSerpScraper(
	q: SerpQuery,
	targetDomain: string,
	deps: ScraperDeps = {}
): Promise<SerpResult> {
	const env = deps.env ?? (process.env as Record<string, string | undefined>);
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const jitter = deps.jitter ?? Math.random;
	const paceMs = Number(env.RANK_PACE_MS ?? DEFAULT_PACE_MS) || DEFAULT_PACE_MS;
	const proxies = (env.RANK_PROXY_URLS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	// Pacing: distanțăm cererile ca să nu declanșăm blocarea Google.
	await sleep(paceMs + Math.floor(jitter() * paceMs * 0.25));

	const ownBrowser = !deps.browser;
	let browser: BrowserLike;
	if (deps.browser) {
		browser = deps.browser;
	} else {
		const args = [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu',
			'--disable-extensions',
			'--disable-background-networking',
			'--disable-sync',
			'--no-first-run'
		];
		const proxy = pickProxy(proxies);
		if (proxy) args.push(`--proxy-server=${proxy}`);
		const launch = deps.launch ?? defaultLaunch;
		browser = await launch({ args });
	}

	try {
		let lastErr: unknown;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				return await attemptOnce(browser, q, targetDomain);
			} catch (e) {
				lastErr = e;
				const retryable = e instanceof SerpProviderError ? e.retryable : true;
				if (!retryable || attempt === MAX_RETRIES) throw e;
				const backoff = 500 * 2 ** attempt;
				await sleep(backoff + Math.floor(jitter() * 250));
			}
		}
		throw lastErr;
	} finally {
		if (ownBrowser) await browser.close().catch(() => {});
	}
}

/** Providerul scraper ca `SerpProvider` (dependențe legate prin closure). */
export function createScraperProvider(deps: ScraperDeps = {}): SerpProvider {
	return {
		name: 'scraper',
		fetchSerp: (q, targetDomain) => fetchSerpScraper(q, targetDomain, deps)
	};
}
