import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, isNotNull } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import {
	refreshSessionHeadless,
	type HeadlessRefreshResult
} from '$lib/server/scraper/headless-session-refresh';
import type { ScraperPlatform } from '$lib/server/scraper/invoice-scraper';
import { createNotification } from '$lib/server/notifications';

/**
 * Ad-platform session keep-alive (Meta + Google + TikTok).
 * Runs every 3 days at 5:00 AM (and thus also on the 1st, before the monthly
 * invoice syncs). Touches each platform's billing page with a headless browser
 * for every active integration and saves back the rotated cookies, so the
 * session never goes stale between monthly runs.
 *
 * Only integrations with status='active' are touched — an expired session needs
 * a manual bootstrap (cookie paste / Scan cu Browser) anyway, and hammering dead
 * cookies at the platform would only look suspicious.
 */

const SKIP_IF_FRESHER_THAN_MS = 24 * 60 * 60 * 1000;
const DELAY_BETWEEN_INTEGRATIONS_MS = 2_000;

type RefreshFn = typeof refreshSessionHeadless;

interface IntegrationRow {
	id: string;
	tenantId: string;
	label: string | null;
}

interface PlatformDescriptor {
	platform: ScraperPlatform;
	label: string; // human name for the platform, used in notifications
	selectActive: () => Promise<IntegrationRow[]>;
}

const PLATFORMS: PlatformDescriptor[] = [
	{
		platform: 'meta',
		label: 'Facebook',
		selectActive: () =>
			db
				.select({ id: table.metaAdsIntegration.id, tenantId: table.metaAdsIntegration.tenantId, label: table.metaAdsIntegration.businessName })
				.from(table.metaAdsIntegration)
				.where(
					and(
						eq(table.metaAdsIntegration.isActive, true),
						eq(table.metaAdsIntegration.fbSessionStatus, 'active'),
						isNotNull(table.metaAdsIntegration.fbSessionCookies)
					)
				)
	},
	{
		platform: 'google',
		label: 'Google Ads',
		selectActive: () =>
			db
				.select({ id: table.googleAdsIntegration.id, tenantId: table.googleAdsIntegration.tenantId, label: table.googleAdsIntegration.email })
				.from(table.googleAdsIntegration)
				.where(
					and(
						eq(table.googleAdsIntegration.isActive, true),
						eq(table.googleAdsIntegration.googleSessionStatus, 'active'),
						isNotNull(table.googleAdsIntegration.googleSessionCookies)
					)
				)
	},
	{
		platform: 'tiktok',
		label: 'TikTok',
		selectActive: () =>
			db
				.select({ id: table.tiktokAdsIntegration.id, tenantId: table.tiktokAdsIntegration.tenantId, label: table.tiktokAdsIntegration.email })
				.from(table.tiktokAdsIntegration)
				.where(
					and(
						eq(table.tiktokAdsIntegration.isActive, true),
						eq(table.tiktokAdsIntegration.ttSessionStatus, 'active'),
						isNotNull(table.tiktokAdsIntegration.ttSessionCookies)
					)
				)
	}
];

async function notifySessionExpired(tenantId: string, platformLabel: string, integrationLabel: string | null, link: string): Promise<void> {
	try {
		const admins = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.tenantId, tenantId),
					or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
				)
			);

		for (const admin of admins) {
			await createNotification({
				tenantId,
				userId: admin.userId,
				type: 'sync.error',
				title: `Sesiune ${platformLabel} expirată`,
				message: `Sesiunea ${platformLabel} (${integrationLabel || 'cont'}) a expirat — keep-alive-ul de pe server nu o mai poate reîmprospăta. Lipește cookie-uri noi în Settings sau rulează „Scan cu Browser".`,
				link
			});
		}
	} catch {
		// Notification failure must not fail the keep-alive run
	}
}

const LINKS: Record<ScraperPlatform, string> = {
	meta: 'invoices/meta-ads',
	google: 'invoices/google-ads',
	tiktok: 'invoices/tiktok-ads'
};

/**
 * Process the ad-platform session keep-alive across all tenants and platforms.
 * `deps.refresh` is injectable for tests.
 */
export async function processAdsSessionKeepalive(
	_params: Record<string, unknown> = {},
	deps: { refresh?: RefreshFn; delayMs?: number } = {}
) {
	const refresh = deps.refresh ?? refreshSessionHeadless;
	const delayMs = deps.delayMs ?? DELAY_BETWEEN_INTEGRATIONS_MS;

	const totals = { refreshed: 0, expired: 0, skipped: 0, errors: 0, total: 0 };

	for (const p of PLATFORMS) {
		let integrations: IntegrationRow[];
		try {
			integrations = await p.selectActive();
		} catch (err) {
			logError('scheduler', `Ads keep-alive: failed to list ${p.platform} integrations`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			continue;
		}

		totals.total += integrations.length;
		logInfo('scheduler', `Ads session keep-alive: ${integrations.length} active ${p.platform} integration(s)`, {
			metadata: { platform: p.platform, count: integrations.length }
		});

		for (const integration of integrations) {
			let result: HeadlessRefreshResult;
			try {
				result = await refresh(p.platform, integration.tenantId, integration.id, {
					skipIfFresherThanMs: SKIP_IF_FRESHER_THAN_MS
				});
			} catch (err) {
				totals.errors++;
				logError('scheduler', `Ads keep-alive failed for ${p.platform} integration ${integration.id}`, {
					tenantId: integration.tenantId,
					metadata: { error: err instanceof Error ? err.message : String(err) }
				});
				continue;
			}

			switch (result.status) {
				case 'refreshed':
					totals.refreshed++;
					break;
				case 'skipped_fresh':
				case 'busy':
					totals.skipped++;
					break;
				case 'expired':
					totals.expired++;
					// Selected as 'active' → this is the active→expired transition; notify once.
					await notifySessionExpired(integration.tenantId, p.label, integration.label, LINKS[p.platform]);
					break;
				case 'no_cookies':
				case 'error':
					totals.errors++;
					break;
			}

			if (delayMs > 0) {
				await new Promise((r) => setTimeout(r, delayMs));
			}
		}
	}

	logInfo('scheduler', 'Ads session keep-alive completed', { metadata: totals });
	return totals;
}
