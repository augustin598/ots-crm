import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { findChromePath } from './find-chrome';
import {
	normalizeCookiesForInjection,
	extractBrowserCookies,
	saveCookiesFromBrowser,
	type ScraperPlatform,
	type StoredCookie
} from './invoice-scraper';
import { getDecryptedFbCookies } from '$lib/server/meta-ads/fb-cookies';
import { getDecryptedGoogleCookies } from '$lib/server/google-ads/google-cookies';
import { getDecryptedTtCookies } from '$lib/server/tiktok-ads/tt-cookies';
import { FB_USER_AGENT } from '$lib/server/meta-ads/constants';
import { refreshTtSessionViaApi } from '$lib/server/tiktok-ads/session-refresh';
import { logInfo, logError, logWarning, serializeError, type LogSource } from '$lib/server/logger';

/**
 * Headless ad-platform session refresh — the server-side replacement for the
 * "Scan cu Browser" laptop ritual, generalized across Meta, Google and TikTok.
 *
 * Injects the DB-stored session cookies into a fresh ALWAYS-headless browser,
 * visits the platform's billing page, and — if the session is still alive —
 * saves back the cookies the platform rotated during the visit. Regular runs
 * keep the session alive indefinitely; the visible-browser flow is only needed
 * for the first login (bootstrap) or after a platform checkpoint/2FA.
 */

export type HeadlessRefreshStatus =
	| 'refreshed' // session alive, rotated cookies saved back to DB
	| 'expired' // platform redirected to login/checkpoint — needs manual bootstrap
	| 'two_factor' // session valid but platform challenged the headless browser with 2FA — cookies kept, rotation blocked
	| 'no_cookies' // nothing stored to refresh
	| 'skipped_fresh' // session refreshedAt newer than opts.skipIfFresherThanMs
	| 'busy' // another refresh for this integration is in flight
	| 'error'; // navigation/infra error — session status left untouched

export interface HeadlessRefreshResult {
	status: HeadlessRefreshStatus;
	cookieCount?: number;
	error?: string;
}

const NAV_TIMEOUT_MS = 45_000;
const SETTLE_DELAY_MS = 3_000;
// Google/TikTok invoice downloaders send this UA; the refresh browser must match
// so the rotated cookie jar stays consistent with the fetch-based downloads.
const CHROME_131_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface SessionMeta {
	refreshedAt: Date | null;
	/** True when an encrypted cookie blob is stored (regardless of decryptability). */
	hasStoredCookies: boolean;
}

interface PlatformAdapter {
	logSource: LogSource;
	billingUrl: string;
	userAgent: string;
	getCookies: (integrationId: string, tenantId: string) => Promise<StoredCookie[] | null>;
	getSessionMeta: (integrationId: string, tenantId: string) => Promise<SessionMeta | null>;
	markExpired: (integrationId: string, tenantId: string) => Promise<void>;
	isLoginRedirect: (url: string) => boolean;
	isLoggedIn: (url: string) => boolean;
	/** Validate the freshly-extracted cookie jar actually carries a live session. */
	hasSession: (cookieNames: Set<string>) => boolean;
}

function anyOf(names: Set<string>, wanted: string[]): boolean {
	return wanted.some((w) => names.has(w));
}

const ADAPTERS: Record<ScraperPlatform, PlatformAdapter> = {
	meta: {
		logSource: 'fb-session-refresh',
		billingUrl: 'https://business.facebook.com/billing_hub/accounts',
		userAgent: FB_USER_AGENT,
		getCookies: getDecryptedFbCookies,
		getSessionMeta: async (id, t) => {
			const [r] = await db
				.select({ refreshedAt: table.metaAdsIntegration.fbSessionRefreshedAt, hasCookies: sql<number>`length(coalesce(${table.metaAdsIntegration.fbSessionCookies}, ''))` })
				.from(table.metaAdsIntegration)
				.where(and(eq(table.metaAdsIntegration.id, id), eq(table.metaAdsIntegration.tenantId, t)))
				.limit(1);
			return r ? { refreshedAt: r.refreshedAt, hasStoredCookies: r.hasCookies > 0 } : null;
		},
		markExpired: async (id, t) => {
			await db
				.update(table.metaAdsIntegration)
				.set({ fbSessionStatus: 'expired', updatedAt: new Date() })
				.where(and(eq(table.metaAdsIntegration.id, id), eq(table.metaAdsIntegration.tenantId, t)));
		},
		isLoginRedirect: (url) =>
			url.includes('/login') ||
			url.includes('checkpoint') ||
			url.includes('cookie/consent') ||
			url.includes('two_step_verification'),
		isLoggedIn: (url) =>
			url.includes('billing_hub') &&
			!(url.includes('/login') || url.includes('checkpoint') || url.includes('cookie/consent')),
		hasSession: (names) => names.has('c_user') && names.has('xs')
	},
	google: {
		logSource: 'google-session-refresh',
		billingUrl: 'https://ads.google.com/aw/billing/documents',
		userAgent: CHROME_131_UA,
		getCookies: getDecryptedGoogleCookies,
		getSessionMeta: async (id, t) => {
			const [r] = await db
				.select({ refreshedAt: table.googleAdsIntegration.googleSessionRefreshedAt, hasCookies: sql<number>`length(coalesce(${table.googleAdsIntegration.googleSessionCookies}, ''))` })
				.from(table.googleAdsIntegration)
				.where(and(eq(table.googleAdsIntegration.id, id), eq(table.googleAdsIntegration.tenantId, t)))
				.limit(1);
			return r ? { refreshedAt: r.refreshedAt, hasStoredCookies: r.hasCookies > 0 } : null;
		},
		markExpired: async (id, t) => {
			await db
				.update(table.googleAdsIntegration)
				.set({ googleSessionStatus: 'expired', updatedAt: new Date() })
				.where(and(eq(table.googleAdsIntegration.id, id), eq(table.googleAdsIntegration.tenantId, t)));
		},
		isLoginRedirect: (url) =>
			url.includes('accounts.google.com/signin') ||
			url.includes('accounts.google.com/v3') ||
			url.includes('accounts.google.com/ServiceLogin'),
		isLoggedIn: (url) =>
			url.includes('ads.google.com') &&
			!url.includes('accounts.google.com/signin') &&
			!url.includes('accounts.google.com/v3'),
		hasSession: (names) => anyOf(names, ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID'])
	},
	tiktok: {
		logSource: 'tt-session-refresh',
		billingUrl: 'https://business.tiktok.com/manage/billing/v2',
		userAgent: CHROME_131_UA,
		getCookies: getDecryptedTtCookies,
		getSessionMeta: async (id, t) => {
			const [r] = await db
				.select({ refreshedAt: table.tiktokAdsIntegration.ttSessionRefreshedAt, hasCookies: sql<number>`length(coalesce(${table.tiktokAdsIntegration.ttSessionCookies}, ''))` })
				.from(table.tiktokAdsIntegration)
				.where(and(eq(table.tiktokAdsIntegration.id, id), eq(table.tiktokAdsIntegration.tenantId, t)))
				.limit(1);
			return r ? { refreshedAt: r.refreshedAt, hasStoredCookies: r.hasCookies > 0 } : null;
		},
		markExpired: async (id, t) => {
			await db
				.update(table.tiktokAdsIntegration)
				.set({ ttSessionStatus: 'expired', updatedAt: new Date() })
				.where(and(eq(table.tiktokAdsIntegration.id, id), eq(table.tiktokAdsIntegration.tenantId, t)));
		},
		isLoginRedirect: (url) => url.includes('/login') || url.includes('signin'),
		isLoggedIn: (url) =>
			url.includes('business.tiktok.com/manage') &&
			!url.includes('login') &&
			!url.includes('signin'),
		hasSession: (names) => anyOf(names, ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard'])
	}
};

// In-flight guard per platform+integration (survives HMR via globalThis symbol)
const IN_FLIGHT_SYMBOL = Symbol.for('ads_session_refresh_in_flight');
function getInFlight(): Set<string> {
	if (!(globalThis as any)[IN_FLIGHT_SYMBOL]) {
		(globalThis as any)[IN_FLIGHT_SYMBOL] = new Set<string>();
	}
	return (globalThis as any)[IN_FLIGHT_SYMBOL];
}

async function launchHeadlessBrowser(): Promise<Browser> {
	const chromePath = findChromePath();
	// Fresh browser per run, no persistent profile: identity continuity comes from
	// the injected cookie jar itself, and a separate temp profile avoids lock
	// conflicts with the interactive scraper singleton.
	return puppeteer.launch({
		headless: true, // new headless — faithful SPA rendering
		executablePath: chromePath,
		defaultViewport: { width: 1440, height: 900 },
		ignoreDefaultArgs: ['--enable-automation'],
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--window-size=1440,900',
			'--no-first-run',
			'--disable-background-networking',
			'--disable-blink-features=AutomationControlled'
		]
	});
}

/**
 * Refresh the session for one ad-platform integration, fully headless.
 * Never opens a visible window — safe to run on the server and from cron.
 *
 * opts.skipIfFresherThanMs: skip (status 'skipped_fresh') when the session was
 * already confirmed alive more recently than this. UI-triggered refreshes pass 0.
 */
export async function refreshSessionHeadless(
	platform: ScraperPlatform,
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	// TikTok is validated purely via its billing API (fetch) — no browser at all.
	// TikTok challenges a headless browser from a datacenter IP with 2FA, but the
	// fetch-based download the API accepts the cookies directly, so a browser is
	// both unnecessary and counter-productive here.
	if (platform === 'tiktok') {
		return refreshTtSessionViaApi(tenantId, integrationId, opts);
	}

	const cfg = ADAPTERS[platform];
	const inFlight = getInFlight();
	const flightKey = `${platform}:${integrationId}`;
	if (inFlight.has(flightKey)) {
		return { status: 'busy' };
	}
	inFlight.add(flightKey);

	let browser: Browser | null = null;
	try {
		const meta = await cfg.getSessionMeta(integrationId, tenantId);
		if (!meta) {
			return { status: 'error', error: 'integration_not_found' };
		}

		if (
			opts.skipIfFresherThanMs &&
			meta.refreshedAt &&
			Date.now() - meta.refreshedAt.getTime() < opts.skipIfFresherThanMs
		) {
			return { status: 'skipped_fresh' };
		}

		const cookies = await cfg.getCookies(integrationId, tenantId);
		if (!cookies || cookies.length === 0) {
			// A stored-but-undecryptable blob (Turso truncation / key change) means a
			// dead session that would otherwise keep showing "Active" forever and the
			// keep-alive would silently no-op. Flip it to expired so the UI offers a
			// re-paste and admins get notified. Genuinely-absent cookies stay no_cookies.
			if (meta.hasStoredCookies) {
				await cfg.markExpired(integrationId, tenantId);
				logWarning(cfg.logSource, 'Stored cookies could not be decrypted — marking session expired', {
					tenantId,
					metadata: { integrationId, platform }
				});
				return { status: 'expired' };
			}
			return { status: 'no_cookies' };
		}

		const params = normalizeCookiesForInjection(cookies, platform);
		if (params.length === 0) {
			if (meta.hasStoredCookies) {
				await cfg.markExpired(integrationId, tenantId);
				return { status: 'expired' };
			}
			return { status: 'no_cookies' };
		}

		logInfo(cfg.logSource, `Starting headless session refresh`, {
			tenantId,
			metadata: { integrationId, platform, cookieCount: params.length }
		});

		browser = await launchHeadlessBrowser();
		const page = await browser.newPage();
		await page.setUserAgent(cfg.userAgent);
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'webdriver', { get: () => false });
		});
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
		});

		await page.setCookie(...params);

		try {
			await page.goto(cfg.billingUrl, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
		} catch {
			// Navigation timeout on a heavy SPA is common — judge by the final URL below
		}
		await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));

		const finalUrl = page.url();

		if (cfg.isLoginRedirect(finalUrl)) {
			await cfg.markExpired(integrationId, tenantId);
			logWarning(cfg.logSource, `Session expired (redirected to ${finalUrl.slice(0, 120)})`, {
				tenantId,
				metadata: { integrationId, platform }
			});
			return { status: 'expired' };
		}

		// A 2FA / device-verification challenge means the stored cookies ARE valid
		// (the platform recognized the session) but it won't let a headless browser
		// from this IP through. Don't mark expired — the cookies stay usable for the
		// fetch-based invoice downloads; only the browser rotation is blocked.
		if (/two[-_]step[-_]verification|two[-_]factor|\/verify(\/|\?|$)/i.test(finalUrl)) {
			logWarning(cfg.logSource, `2FA challenge on headless refresh — session left intact`, {
				tenantId,
				metadata: { integrationId, platform }
			});
			return { status: 'two_factor' };
		}

		if (!cfg.isLoggedIn(finalUrl)) {
			// Unknown landing page (interstitial, network error) — don't false-expire
			logWarning(cfg.logSource, `Unexpected landing URL, leaving session status untouched: ${finalUrl.slice(0, 120)}`, {
				tenantId,
				metadata: { integrationId, platform }
			});
			return { status: 'error', error: `unexpected_url: ${finalUrl.slice(0, 200)}` };
		}

		// Logged in — harvest the (possibly rotated) cookies and save them back
		const freshCookies = await extractBrowserCookies(page, platform);
		const names = new Set(freshCookies.map((c) => c.name));

		if (!cfg.hasSession(names)) {
			logWarning(cfg.logSource, 'Landed on billing page but session cookies missing — treating as expired', {
				tenantId,
				metadata: { integrationId, platform, cookieNames: [...names].join(',') }
			});
			await cfg.markExpired(integrationId, tenantId);
			return { status: 'expired' };
		}

		await saveCookiesFromBrowser(platform, integrationId, tenantId, freshCookies);

		logInfo(cfg.logSource, `Session refreshed: ${freshCookies.length} cookies saved`, {
			tenantId,
			metadata: { integrationId, platform, cookieCount: freshCookies.length }
		});
		return { status: 'refreshed', cookieCount: freshCookies.length };
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError(cfg.logSource, `Headless refresh failed: ${message}`, {
			tenantId,
			metadata: { integrationId, platform },
			stackTrace: stack
		});
		return { status: 'error', error: message };
	} finally {
		if (browser) {
			await browser.close().catch(() => {});
		}
		inFlight.delete(flightKey);
	}
}

/** Backward-compatible Meta wrapper. */
export function refreshFbSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionHeadless('meta', tenantId, integrationId, opts);
}

export function refreshGoogleSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionHeadless('google', tenantId, integrationId, opts);
}

export function refreshTtSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionHeadless('tiktok', tenantId, integrationId, opts);
}
