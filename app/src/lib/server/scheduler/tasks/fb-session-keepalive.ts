import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, isNotNull } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { refreshFbSessionHeadless } from '$lib/server/scraper/headless-session-refresh';
import { createNotification } from '$lib/server/notifications';

/**
 * Facebook session keep-alive.
 * Runs every 3 days at 5:00 AM (and thus also on the 1st, two hours before the
 * monthly invoice sync). Touches business.facebook.com with a headless browser
 * for every active Meta integration and saves back the rotated cookies, so the
 * session never goes stale between monthly invoice runs.
 *
 * Only integrations with fbSessionStatus='active' are touched — an expired
 * session needs a manual bootstrap (cookie paste / Scan cu Browser) anyway,
 * and hammering dead cookies at Facebook would only look suspicious.
 */

// Skip integrations whose session was already confirmed within the last 24h
// (e.g. a manual refresh from the UI just ran).
const SKIP_IF_FRESHER_THAN_MS = 24 * 60 * 60 * 1000;
const DELAY_BETWEEN_INTEGRATIONS_MS = 2_000;

type RefreshFn = typeof refreshFbSessionHeadless;

async function notifySessionExpired(tenantId: string, businessName: string | null): Promise<void> {
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
				title: 'Sesiune Facebook expirată',
				message: `Sesiunea Facebook (${businessName || 'BM'}) a expirat — keep-alive-ul de pe server nu o mai poate reîmprospăta. Lipește cookie-uri noi în Settings → Meta Ads sau rulează „Scan cu Browser".`,
				link: `invoices/meta-ads`
			});
		}
	} catch {
		// Notification failure must not fail the keep-alive run
	}
}

/**
 * Process the FB session keep-alive across all tenants.
 * `deps.refresh` is injectable for tests.
 */
export async function processFbSessionKeepalive(
	_params: Record<string, unknown> = {},
	deps: { refresh?: RefreshFn; delayMs?: number } = {}
) {
	const refresh = deps.refresh ?? refreshFbSessionHeadless;
	const delayMs = deps.delayMs ?? DELAY_BETWEEN_INTEGRATIONS_MS;

	const integrations = await db
		.select({
			id: table.metaAdsIntegration.id,
			tenantId: table.metaAdsIntegration.tenantId,
			businessName: table.metaAdsIntegration.businessName
		})
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.isActive, true),
				eq(table.metaAdsIntegration.fbSessionStatus, 'active'),
				isNotNull(table.metaAdsIntegration.fbSessionCookies)
			)
		);

	logInfo('scheduler', `FB session keep-alive: ${integrations.length} active integration(s)`, {
		metadata: { integrationCount: integrations.length }
	});

	let refreshed = 0;
	let expired = 0;
	let skipped = 0;
	let errors = 0;

	for (const integration of integrations) {
		try {
			const result = await refresh(integration.tenantId, integration.id, {
				skipIfFresherThanMs: SKIP_IF_FRESHER_THAN_MS
			});

			switch (result.status) {
				case 'refreshed':
					refreshed++;
					break;
				case 'skipped_fresh':
				case 'busy':
					skipped++;
					break;
				case 'expired':
					expired++;
					// These integrations were 'active' when selected → this is the
					// active→expired transition, notify exactly once.
					await notifySessionExpired(integration.tenantId, integration.businessName);
					break;
				case 'no_cookies':
				case 'error':
					errors++;
					break;
			}
		} catch (err) {
			errors++;
			logError('scheduler', `FB keep-alive failed for integration ${integration.id}`, {
				tenantId: integration.tenantId,
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
		}

		if (delayMs > 0) {
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}

	logInfo('scheduler', 'FB session keep-alive completed', {
		metadata: { refreshed, expired, skipped, errors, total: integrations.length }
	});

	return { refreshed, expired, skipped, errors, total: integrations.length };
}
