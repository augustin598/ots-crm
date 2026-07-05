import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { findChromePath } from './find-chrome';
import {
	normalizeCookiesForInjection,
	extractBrowserCookies,
	saveCookiesFromBrowser
} from './invoice-scraper';
import { getDecryptedFbCookies } from '$lib/server/meta-ads/fb-cookies';
import { FB_USER_AGENT } from '$lib/server/meta-ads/constants';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';

/**
 * Headless Facebook session refresh — the server-side replacement for the
 * "Scan cu Browser" laptop ritual.
 *
 * Injects the DB-stored session cookies into a fresh ALWAYS-headless browser,
 * visits the Billing Hub, and — if the session is still alive — saves back the
 * cookies Facebook rotated during the visit. Regular runs keep the session
 * alive indefinitely; the visible-browser flow is only needed for the first
 * login (bootstrap) or after a Facebook checkpoint.
 */

export type HeadlessRefreshStatus =
	| 'refreshed' // session alive, rotated cookies saved back to DB
	| 'expired' // Facebook redirected to login/checkpoint — needs manual bootstrap
	| 'no_cookies' // nothing stored to refresh
	| 'skipped_fresh' // fbSessionRefreshedAt newer than opts.skipIfFresherThanMs
	| 'busy' // another refresh for this integration is in flight
	| 'error'; // navigation/infra error — session status left untouched

export interface HeadlessRefreshResult {
	status: HeadlessRefreshStatus;
	cookieCount?: number;
	error?: string;
}

const BILLING_HUB_URL = 'https://business.facebook.com/billing_hub/accounts';
const NAV_TIMEOUT_MS = 45_000;
const SETTLE_DELAY_MS = 3_000;

function isLoginOrCheckpointUrl(url: string): boolean {
	return (
		url.includes('/login') ||
		url.includes('checkpoint') ||
		url.includes('cookie/consent') ||
		url.includes('two_step_verification')
	);
}

function isLoggedInUrl(url: string): boolean {
	return url.includes('billing_hub') && !isLoginOrCheckpointUrl(url);
}

// In-flight guard per integration (survives HMR via globalThis symbol)
const IN_FLIGHT_SYMBOL = Symbol.for('fb_session_refresh_in_flight');
function getInFlight(): Set<string> {
	if (!(globalThis as any)[IN_FLIGHT_SYMBOL]) {
		(globalThis as any)[IN_FLIGHT_SYMBOL] = new Set<string>();
	}
	return (globalThis as any)[IN_FLIGHT_SYMBOL];
}

async function launchHeadlessBrowser(): Promise<Browser> {
	const chromePath = findChromePath();
	// Fresh browser per run, no persistent profile: identity continuity comes from
	// the injected cookie jar itself (datr/sb), and a separate temp profile avoids
	// lock conflicts with the interactive scraper singleton.
	return puppeteer.launch({
		headless: true, // new headless — faithful SPA rendering on business.facebook.com
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
 * Refresh the Facebook session for one Meta Ads integration, fully headless.
 * Never opens a visible window — safe to run on the server and from cron.
 *
 * opts.skipIfFresherThanMs: skip (status 'skipped_fresh') when the session was
 * already confirmed alive more recently than this. UI-triggered refreshes pass 0.
 */
export async function refreshFbSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	const inFlight = getInFlight();
	if (inFlight.has(integrationId)) {
		return { status: 'busy' };
	}
	inFlight.add(integrationId);

	let browser: Browser | null = null;
	try {
		const [integration] = await db
			.select({
				fbSessionStatus: table.metaAdsIntegration.fbSessionStatus,
				fbSessionRefreshedAt: table.metaAdsIntegration.fbSessionRefreshedAt
			})
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.id, integrationId),
					eq(table.metaAdsIntegration.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!integration) {
			return { status: 'error', error: 'integration_not_found' };
		}

		if (
			opts.skipIfFresherThanMs &&
			integration.fbSessionRefreshedAt &&
			Date.now() - integration.fbSessionRefreshedAt.getTime() < opts.skipIfFresherThanMs
		) {
			return { status: 'skipped_fresh' };
		}

		const cookies = await getDecryptedFbCookies(integrationId, tenantId);
		if (!cookies || cookies.length === 0) {
			return { status: 'no_cookies' };
		}

		const params = normalizeCookiesForInjection(cookies, 'meta');
		if (params.length === 0) {
			return { status: 'no_cookies' };
		}

		logInfo('fb-session-refresh', `Starting headless session refresh`, {
			tenantId,
			metadata: { integrationId, cookieCount: params.length }
		});

		browser = await launchHeadlessBrowser();
		const page = await browser.newPage();
		await page.setUserAgent(FB_USER_AGENT);
		await page.evaluateOnNewDocument(() => {
			Object.defineProperty(navigator, 'webdriver', { get: () => false });
		});
		await page.setExtraHTTPHeaders({
			'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7'
		});

		await page.setCookie(...params);

		try {
			await page.goto(BILLING_HUB_URL, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
		} catch {
			// Navigation timeout on a heavy SPA is common — judge by the final URL below
		}
		await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));

		const finalUrl = page.url();

		if (isLoginOrCheckpointUrl(finalUrl)) {
			await db
				.update(table.metaAdsIntegration)
				.set({ fbSessionStatus: 'expired', updatedAt: new Date() })
				.where(
					and(
						eq(table.metaAdsIntegration.id, integrationId),
						eq(table.metaAdsIntegration.tenantId, tenantId)
					)
				);
			logWarning('fb-session-refresh', `FB session expired (redirected to ${finalUrl.slice(0, 120)})`, {
				tenantId,
				metadata: { integrationId }
			});
			return { status: 'expired' };
		}

		if (!isLoggedInUrl(finalUrl)) {
			// Unknown landing page (interstitial, network error page) — don't false-expire
			logWarning('fb-session-refresh', `Unexpected landing URL, leaving session status untouched: ${finalUrl.slice(0, 120)}`, {
				tenantId,
				metadata: { integrationId }
			});
			return { status: 'error', error: `unexpected_url: ${finalUrl.slice(0, 200)}` };
		}

		// Logged in — harvest the (possibly rotated) cookies and save them back
		const freshCookies = await extractBrowserCookies(page, 'meta');
		const hasSession =
			freshCookies.some((c) => c.name === 'c_user') && freshCookies.some((c) => c.name === 'xs');

		if (!hasSession) {
			logWarning('fb-session-refresh', 'Landed on billing hub but c_user/xs missing — treating as expired', {
				tenantId,
				metadata: { integrationId, cookieNames: freshCookies.map((c) => c.name).join(',') }
			});
			await db
				.update(table.metaAdsIntegration)
				.set({ fbSessionStatus: 'expired', updatedAt: new Date() })
				.where(
					and(
						eq(table.metaAdsIntegration.id, integrationId),
						eq(table.metaAdsIntegration.tenantId, tenantId)
					)
				);
			return { status: 'expired' };
		}

		await saveCookiesFromBrowser('meta', integrationId, tenantId, freshCookies);

		logInfo('fb-session-refresh', `Session refreshed: ${freshCookies.length} cookies saved`, {
			tenantId,
			metadata: { integrationId, cookieCount: freshCookies.length }
		});
		return { status: 'refreshed', cookieCount: freshCookies.length };
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('fb-session-refresh', `Headless refresh failed: ${message}`, {
			tenantId,
			metadata: { integrationId },
			stackTrace: stack
		});
		return { status: 'error', error: message };
	} finally {
		if (browser) {
			await browser.close().catch(() => {});
		}
		inFlight.delete(integrationId);
	}
}
