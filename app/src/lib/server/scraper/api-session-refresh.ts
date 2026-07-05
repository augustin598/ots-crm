import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { getDecryptedFbCookies } from '$lib/server/meta-ads/fb-cookies';
import { getDecryptedGoogleCookies } from '$lib/server/google-ads/google-cookies';
import { getDecryptedTtCookies } from '$lib/server/tiktok-ads/tt-cookies';
import { FB_USER_AGENT } from '$lib/server/meta-ads/constants';
import { logInfo, logWarning, logError, serializeError, type LogSource } from '$lib/server/logger';
import type { ScraperPlatform, StoredCookie } from './invoice-scraper';

export type SessionRefreshStatus =
	| 'refreshed' // session validated (and refreshedAt stamped)
	| 'expired' // platform rejected the cookies — needs manual re-paste / Scan cu Browser
	| 'two_factor' // (browser-era) 2FA challenge; retained for UI compatibility
	| 'no_cookies' // nothing stored to validate
	| 'skipped_fresh' // refreshedAt newer than opts.skipIfFresherThanMs
	| 'busy' // (browser-era) another refresh in flight; retained for compatibility
	| 'error'; // transient/infra error — session status left untouched

export interface HeadlessRefreshResult {
	status: SessionRefreshStatus;
	cookieCount?: number;
	error?: string;
}

/**
 * Server-side session keep-alive for ALL ad platforms — using plain fetch, NEVER
 * a browser. The invoice download itself already runs server-side via fetch with
 * the stored cookies; this validates the session the exact same way: one
 * lightweight authenticated request per platform.
 *
 * No browser means: no visible window on anyone's machine, no headless Chrome on
 * the server, and no device-fingerprint 2FA challenge. Runs purely where the app
 * runs (the server), using the encrypted cookies in the DB.
 *
 * Validation endpoints (mirror what each download uses):
 *   meta   → business.facebook.com/ads/manage/invoices_generator  (204/PDF = alive)
 *   google → payments.google.com/payments/u/0/w/home              (200 = alive)
 *   tiktok → ads.tiktok.com/pa/api/spider/query_payment_account   (code 0 = alive)
 */

const CHROME_131_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type Probe = 'alive' | 'expired' | 'error';

function cookieHeader(cookies: StoredCookie[]): string {
	return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// ── Per-platform probes (all fetch, no browser) ──────────────────

async function probeMeta(cookies: StoredCookie[], integrationId: string): Promise<Probe> {
	// Hit the real download endpoint for one ad account. 204 (no invoice) / PDF /
	// ZIP all mean the session is accepted; a redirect to login means it's dead.
	const [account] = await db
		.select({ metaAdAccountId: table.metaAdsAccount.metaAdAccountId })
		.from(table.metaAdsAccount)
		.where(and(eq(table.metaAdsAccount.integrationId, integrationId), eq(table.metaAdsAccount.isActive, true)))
		.limit(1);
	if (!account) return 'alive'; // nothing to probe; cookies decrypted fine

	const numericId = account.metaAdAccountId.replace(/^act_/, '');
	const now = Math.floor(Date.now() / 1000);
	const url = `https://business.facebook.com/ads/manage/invoices_generator/?act=${numericId}&ts=${now - 2592000}&time_end=${now}&format=&report=false&tax_invoices_only=false`;
	try {
		const res = await fetch(url, {
			headers: {
				Cookie: cookieHeader(cookies),
				'User-Agent': FB_USER_AGENT,
				Accept: '*/*',
				'Sec-Fetch-Mode': 'navigate',
				Referer: 'https://business.facebook.com/'
			},
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000)
		});
		// Only a POSITIVE login signal means the cookies are dead. A dead Meta
		// session redirects to /login|checkpoint. Anything else — 204 (no invoice),
		// a PDF, or even a 400 (endpoint reached, bad params for that account, but
		// the session WAS accepted) — means the session is alive. This mirrors the
		// download's own logic and avoids false-expiring on Meta's bare-fetch 400s.
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location') || '';
			return /\/login|checkpoint|cookie\/consent/.test(loc) ? 'expired' : 'alive';
		}
		if (res.status >= 500) return 'error'; // transient server error
		if (res.status === 204) return 'alive';
		const ct = res.headers.get('content-type') || '';
		if (res.ok && ct.includes('text/html')) {
			const snippet = (await res.text()).slice(0, 500);
			if (snippet.length > 0 && /\/login|checkpoint|not_logged_in|login_form/.test(snippet)) return 'expired';
		}
		return 'alive';
	} catch {
		return 'error';
	}
}

async function probeGoogle(cookies: StoredCookie[]): Promise<Probe> {
	// payments.google.com is the domain the Google invoice PDF download uses.
	try {
		const res = await fetch('https://payments.google.com/payments/u/0/w/home', {
			headers: {
				Cookie: cookieHeader(cookies),
				'User-Agent': CHROME_131_UA,
				Accept: 'text/html,application/xhtml+xml,*/*',
				Referer: 'https://payments.google.com/'
			},
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location') || '';
			return /ServiceLogin|accounts\.google\.com\/(signin|v3)/.test(loc) ? 'expired' : 'error';
		}
		return res.ok ? 'alive' : 'error';
	} catch {
		return 'error';
	}
}

async function probeTiktok(cookies: StoredCookie[], integrationId: string): Promise<Probe> {
	const [account] = await db
		.select({ advertiserId: table.tiktokAdsAccount.tiktokAdvertiserId })
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.integrationId, integrationId),
				eq(table.tiktokAdsAccount.isActive, true),
				isNotNull(table.tiktokAdsAccount.clientId)
			)
		)
		.limit(1);
	if (!account) return 'alive';

	try {
		const res = await fetch('https://ads.tiktok.com/pa/api/spider/query_payment_account', {
			method: 'POST',
			headers: {
				Cookie: cookieHeader(cookies),
				'User-Agent': CHROME_131_UA,
				'Content-Type': 'application/json',
				Accept: 'application/json, text/plain, */*',
				'X-Requested-With': 'XMLHttpRequest',
				Referer: `https://ads.tiktok.com/i18n/account/payment_invoice?aadvid=${account.advertiserId}`,
				Origin: 'https://ads.tiktok.com'
			},
			body: JSON.stringify({ Context: { platform: 1, adv_id: account.advertiserId, bc_id: '' }, module_list: [0, 3] }),
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status >= 300 && res.status < 400) return 'expired';
		if (!res.ok) return 'error';
		const json: any = await res.json().catch(() => null);
		if (!json) return 'error';
		if (json.code === 0) return 'alive';
		if (json.code === 40100 || json.code === 40101 || /not.*log|unauthor|login/i.test(json.msg || '')) return 'expired';
		return 'error';
	} catch {
		return 'error';
	}
}

// ── Per-platform DB adapter ──────────────────────────────────────

interface ApiAdapter {
	logSource: LogSource;
	getCookies: (integrationId: string, tenantId: string) => Promise<StoredCookie[] | null>;
	getMeta: (integrationId: string, tenantId: string) => Promise<{ refreshedAt: Date | null; hasStoredCookies: boolean } | null>;
	markExpired: (integrationId: string, tenantId: string) => Promise<void>;
	touchAlive: (integrationId: string, tenantId: string) => Promise<void>;
	probe: (cookies: StoredCookie[], integrationId: string) => Promise<Probe>;
}

const ADAPTERS: Record<ScraperPlatform, ApiAdapter> = {
	meta: {
		logSource: 'fb-session-refresh',
		getCookies: getDecryptedFbCookies,
		getMeta: async (id, t) => {
			const [r] = await db
				.select({ refreshedAt: table.metaAdsIntegration.fbSessionRefreshedAt, cookies: table.metaAdsIntegration.fbSessionCookies })
				.from(table.metaAdsIntegration)
				.where(and(eq(table.metaAdsIntegration.id, id), eq(table.metaAdsIntegration.tenantId, t)))
				.limit(1);
			return r ? { refreshedAt: r.refreshedAt, hasStoredCookies: !!r.cookies && r.cookies.length > 0 } : null;
		},
		markExpired: async (id, t) =>
			void (await db
				.update(table.metaAdsIntegration)
				.set({ fbSessionStatus: 'expired', updatedAt: new Date() })
				.where(and(eq(table.metaAdsIntegration.id, id), eq(table.metaAdsIntegration.tenantId, t)))),
		touchAlive: async (id, t) =>
			void (await db
				.update(table.metaAdsIntegration)
				.set({ fbSessionStatus: 'active', fbSessionRefreshedAt: new Date(), updatedAt: new Date() })
				.where(and(eq(table.metaAdsIntegration.id, id), eq(table.metaAdsIntegration.tenantId, t)))),
		probe: probeMeta
	},
	google: {
		logSource: 'google-session-refresh',
		getCookies: getDecryptedGoogleCookies,
		getMeta: async (id, t) => {
			const [r] = await db
				.select({ refreshedAt: table.googleAdsIntegration.googleSessionRefreshedAt, cookies: table.googleAdsIntegration.googleSessionCookies })
				.from(table.googleAdsIntegration)
				.where(and(eq(table.googleAdsIntegration.id, id), eq(table.googleAdsIntegration.tenantId, t)))
				.limit(1);
			return r ? { refreshedAt: r.refreshedAt, hasStoredCookies: !!r.cookies && r.cookies.length > 0 } : null;
		},
		markExpired: async (id, t) =>
			void (await db
				.update(table.googleAdsIntegration)
				.set({ googleSessionStatus: 'expired', updatedAt: new Date() })
				.where(and(eq(table.googleAdsIntegration.id, id), eq(table.googleAdsIntegration.tenantId, t)))),
		touchAlive: async (id, t) =>
			void (await db
				.update(table.googleAdsIntegration)
				.set({ googleSessionStatus: 'active', googleSessionRefreshedAt: new Date(), updatedAt: new Date() })
				.where(and(eq(table.googleAdsIntegration.id, id), eq(table.googleAdsIntegration.tenantId, t)))),
		probe: (cookies) => probeGoogle(cookies)
	},
	tiktok: {
		logSource: 'tt-session-refresh',
		getCookies: getDecryptedTtCookies,
		getMeta: async (id, t) => {
			const [r] = await db
				.select({ refreshedAt: table.tiktokAdsIntegration.ttSessionRefreshedAt, cookies: table.tiktokAdsIntegration.ttSessionCookies })
				.from(table.tiktokAdsIntegration)
				.where(and(eq(table.tiktokAdsIntegration.id, id), eq(table.tiktokAdsIntegration.tenantId, t)))
				.limit(1);
			return r ? { refreshedAt: r.refreshedAt, hasStoredCookies: !!r.cookies && r.cookies.length > 0 } : null;
		},
		markExpired: async (id, t) =>
			void (await db
				.update(table.tiktokAdsIntegration)
				.set({ ttSessionStatus: 'expired', updatedAt: new Date() })
				.where(and(eq(table.tiktokAdsIntegration.id, id), eq(table.tiktokAdsIntegration.tenantId, t)))),
		touchAlive: async (id, t) =>
			void (await db
				.update(table.tiktokAdsIntegration)
				.set({ ttSessionStatus: 'active', ttSessionRefreshedAt: new Date(), updatedAt: new Date() })
				.where(and(eq(table.tiktokAdsIntegration.id, id), eq(table.tiktokAdsIntegration.tenantId, t)))),
		probe: probeTiktok
	}
};

/**
 * Validate + keep alive a platform session, server-side, using only fetch.
 * Signature-compatible with the old browser-based refreshSessionHeadless.
 */
export async function refreshSessionViaApi(
	platform: ScraperPlatform,
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	const cfg = ADAPTERS[platform];
	try {
		const meta = await cfg.getMeta(integrationId, tenantId);
		if (!meta) return { status: 'error', error: 'integration_not_found' };

		if (opts.skipIfFresherThanMs && meta.refreshedAt && Date.now() - meta.refreshedAt.getTime() < opts.skipIfFresherThanMs) {
			return { status: 'skipped_fresh' };
		}

		const cookies = await cfg.getCookies(integrationId, tenantId);
		if (!cookies || cookies.length === 0) {
			// Stored-but-undecryptable = dead session; flip to expired so the UI offers a re-paste.
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

		const probe = await cfg.probe(cookies, integrationId);

		if (probe === 'alive') {
			await cfg.touchAlive(integrationId, tenantId);
			logInfo(cfg.logSource, 'Session validated via API (no browser)', { tenantId, metadata: { integrationId, platform } });
			return { status: 'refreshed', cookieCount: cookies.length };
		}
		if (probe === 'expired') {
			await cfg.markExpired(integrationId, tenantId);
			logWarning(cfg.logSource, 'Session rejected by API — marking expired', { tenantId, metadata: { integrationId, platform } });
			return { status: 'expired' };
		}
		// Transient/unknown — leave status untouched (don't false-expire).
		return { status: 'error', error: 'api_probe_inconclusive' };
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError(cfg.logSource, `API session refresh failed: ${message}`, { tenantId, metadata: { integrationId, platform }, stackTrace: stack });
		return { status: 'error', error: message };
	}
}
