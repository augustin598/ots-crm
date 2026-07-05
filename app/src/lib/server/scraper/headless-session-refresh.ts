import type { ScraperPlatform } from './invoice-scraper';
import { refreshSessionViaApi } from './api-session-refresh';
export type { HeadlessRefreshResult, SessionRefreshStatus as HeadlessRefreshStatus } from './api-session-refresh';
import type { HeadlessRefreshResult } from './api-session-refresh';

/**
 * Ad-platform session keep-alive — the server-side replacement for the
 * "Scan cu Browser" laptop ritual.
 *
 * IMPORTANT: this now runs entirely via fetch (see api-session-refresh.ts) —
 * NO browser, headless or otherwise. The invoice download already runs
 * server-side with the stored cookies; the keep-alive validates the session the
 * same way (one lightweight API call per platform). This guarantees nothing ever
 * opens a browser window on anyone's machine, and avoids datacenter-IP 2FA.
 *
 * The `refreshSessionHeadless` name and per-platform wrappers are kept for
 * backward compatibility with existing callers (crons, remote commands).
 */

export function refreshSessionHeadless(
	platform: ScraperPlatform,
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionViaApi(platform, tenantId, integrationId, opts);
}

export function refreshFbSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionViaApi('meta', tenantId, integrationId, opts);
}

export function refreshGoogleSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionViaApi('google', tenantId, integrationId, opts);
}

export function refreshTtSessionHeadless(
	tenantId: string,
	integrationId: string,
	opts: { skipIfFresherThanMs?: number } = {}
): Promise<HeadlessRefreshResult> {
	return refreshSessionViaApi('tiktok', tenantId, integrationId, opts);
}
