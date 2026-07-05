import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { getDecryptedTtCookies } from './tt-cookies';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import type { HeadlessRefreshResult } from '$lib/server/scraper/headless-session-refresh';

/**
 * TikTok session keep-alive WITHOUT a browser.
 *
 * The invoice download runs server-side via plain fetch against TikTok's billing
 * API using the stored cookies — never a browser. TikTok challenges a headless
 * browser from a datacenter IP with 2FA, but the fetch-based API accepts the
 * cookies directly (verified: query_payment_account returns code 0). So the
 * keep-alive just validates the session the same way the download does: one
 * lightweight API call. No browser, no visible window, no 2FA.
 */

const TIKTOK_ADS_URL = 'https://ads.tiktok.com';
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type CookieLike = { name: string; value: string };

function cookieHeader(cookies: CookieLike[]): string {
	return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Probe the billing API with the session cookies for one advertiser.
 * Returns 'alive' (code 0), 'expired' (redirect to login), or 'error'.
 */
async function probeSession(cookies: CookieLike[], advertiserId: string): Promise<'alive' | 'expired' | 'error'> {
	try {
		const res = await fetch(`${TIKTOK_ADS_URL}/pa/api/spider/query_payment_account`, {
			method: 'POST',
			headers: {
				Cookie: cookieHeader(cookies),
				'User-Agent': USER_AGENT,
				'Content-Type': 'application/json',
				Accept: 'application/json, text/plain, */*',
				'X-Requested-With': 'XMLHttpRequest',
				Referer: `${TIKTOK_ADS_URL}/i18n/account/payment_invoice?aadvid=${advertiserId}`,
				Origin: TIKTOK_ADS_URL
			},
			body: JSON.stringify({ Context: { platform: 1, adv_id: advertiserId, bc_id: '' }, module_list: [0, 3] }),
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000)
		});

		// A redirect on an XHR endpoint means the cookie session is no longer accepted.
		if (res.status >= 300 && res.status < 400) return 'expired';
		if (!res.ok) return 'error';

		const json: any = await res.json().catch(() => null);
		if (!json) return 'error';
		// code 0 = success; TikTok uses specific codes for auth failure (e.g. 40100).
		if (json.code === 0) return 'alive';
		if (json.code === 40100 || json.code === 40101 || /not.*log|unauthor|login/i.test(json.msg || '')) return 'expired';
		return 'error';
	} catch {
		return 'error';
	}
}

/**
 * Refresh (validate + keep alive) the TikTok session for one integration,
 * server-side, using only fetch. Signature-compatible with refreshSessionHeadless.
 */
export async function refreshTtSessionViaApi(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	try {
		const [integration] = await db
			.select({
				refreshedAt: table.tiktokAdsIntegration.ttSessionRefreshedAt,
				hasCookies: table.tiktokAdsIntegration.ttSessionCookies
			})
			.from(table.tiktokAdsIntegration)
			.where(and(eq(table.tiktokAdsIntegration.id, integrationId), eq(table.tiktokAdsIntegration.tenantId, tenantId)))
			.limit(1);

		if (!integration) return { status: 'error', error: 'integration_not_found' };

		if (
			opts.skipIfFresherThanMs &&
			integration.refreshedAt &&
			Date.now() - integration.refreshedAt.getTime() < opts.skipIfFresherThanMs
		) {
			return { status: 'skipped_fresh' };
		}

		const hasStoredCookies = !!integration.hasCookies && integration.hasCookies.length > 0;

		const cookies = await getDecryptedTtCookies(integrationId, tenantId);
		if (!cookies || cookies.length === 0) {
			// Stored-but-undecryptable = dead session; flip to expired so the UI offers a re-paste.
			if (hasStoredCookies) {
				await markExpired(integrationId, tenantId);
				logWarning('tt-session-refresh', 'Stored cookies could not be decrypted — marking session expired', {
					tenantId,
					metadata: { integrationId }
				});
				return { status: 'expired' };
			}
			return { status: 'no_cookies' };
		}

		// Any active advertiser mapped to this integration is enough to probe.
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

		if (!account) {
			// No advertiser to probe — cookies decrypt fine, treat as alive and stamp.
			await touchRefreshedAt(integrationId, tenantId);
			return { status: 'refreshed' };
		}

		const result = await probeSession(cookies, account.advertiserId);

		if (result === 'alive') {
			await touchRefreshedAt(integrationId, tenantId);
			logInfo('tt-session-refresh', 'Session validated via API (no browser)', {
				tenantId,
				metadata: { integrationId, advertiserId: account.advertiserId }
			});
			return { status: 'refreshed', cookieCount: cookies.length };
		}

		if (result === 'expired') {
			await markExpired(integrationId, tenantId);
			logWarning('tt-session-refresh', 'Session rejected by API — marking expired', {
				tenantId,
				metadata: { integrationId }
			});
			return { status: 'expired' };
		}

		// Transient/unknown — leave status untouched.
		return { status: 'error', error: 'api_probe_inconclusive' };
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('tt-session-refresh', `API session refresh failed: ${message}`, {
			tenantId,
			metadata: { integrationId },
			stackTrace: stack
		});
		return { status: 'error', error: message };
	}
}

async function markExpired(integrationId: string, tenantId: string): Promise<void> {
	await db
		.update(table.tiktokAdsIntegration)
		.set({ ttSessionStatus: 'expired', updatedAt: new Date() })
		.where(and(eq(table.tiktokAdsIntegration.id, integrationId), eq(table.tiktokAdsIntegration.tenantId, tenantId)));
}

async function touchRefreshedAt(integrationId: string, tenantId: string): Promise<void> {
	await db
		.update(table.tiktokAdsIntegration)
		.set({ ttSessionStatus: 'active', ttSessionRefreshedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(table.tiktokAdsIntegration.id, integrationId), eq(table.tiktokAdsIntegration.tenantId, tenantId)));
}
