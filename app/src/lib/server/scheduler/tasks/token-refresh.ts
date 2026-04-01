import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { getAuthenticatedClient as getGmailAuth } from '$lib/server/gmail/auth';
import { getAuthenticatedClient as getGoogleAdsAuth } from '$lib/server/google-ads/auth';
import { getAuthenticatedToken as getMetaAdsAuth } from '$lib/server/meta-ads/auth';
import { getAuthenticatedToken as getTiktokAdsAuth } from '$lib/server/tiktok-ads/auth';
import { createNotification } from '$lib/server/notifications';
import { logInfo, logError } from '$lib/server/logger';
import { redis } from 'bun';

// --- Helpers ---

async function withRefreshLock<T>(integrationId: string, fn: () => Promise<T>): Promise<T | { skipped: true }> {
	const lockKey = `token-refresh-lock:${integrationId}`;
	const existing = await redis.get(lockKey);
	if (existing) return { skipped: true };
	await redis.setex(lockKey, 120, 'locked');
	try {
		return await fn();
	} finally {
		await redis.del(lockKey);
	}
}

async function notifyTenantAdmins(tenantId: string, platform: string, link: string): Promise<void> {
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
				type: 'integration.auth_expired',
				title: `Token ${platform} expirat`,
				message: `Token-ul de acces pentru ${platform} a expirat sau a fost revocat. Reconectați integrarea.`,
				link
			});
		}
	} catch {
		// Never fail refresh loop for notification errors
	}
}

async function updateRefreshStatus(
	schemaTable: typeof table.gmailIntegration | typeof table.googleAdsIntegration | typeof table.metaAdsIntegration | typeof table.tiktokAdsIntegration,
	integrationId: string,
	success: boolean,
	error?: string
) {
	try {
		if (success) {
			await db
				.update(schemaTable)
				.set({
					lastRefreshAttemptAt: new Date(),
					lastRefreshError: null,
					consecutiveRefreshFailures: 0,
					updatedAt: new Date()
				})
				.where(eq(schemaTable.id, integrationId));
		} else {
			await db
				.update(schemaTable)
				.set({
					lastRefreshAttemptAt: new Date(),
					lastRefreshError: error?.substring(0, 500) || 'Unknown error',
					consecutiveRefreshFailures: sql`coalesce(${schemaTable.consecutiveRefreshFailures}, 0) + 1`,
					updatedAt: new Date()
				})
				.where(eq(schemaTable.id, integrationId));
		}
	} catch {
		// Don't fail refresh for status update errors
	}
}

async function getConsecutiveFailures(
	schemaTable: typeof table.gmailIntegration | typeof table.googleAdsIntegration | typeof table.metaAdsIntegration | typeof table.tiktokAdsIntegration,
	integrationId: string
): Promise<number> {
	try {
		const [row] = await db
			.select({ failures: schemaTable.consecutiveRefreshFailures })
			.from(schemaTable)
			.where(eq(schemaTable.id, integrationId));
		return row?.failures ?? 0;
	} catch {
		return 0;
	}
}

// --- Platform refresh functions ---

type RefreshResults = { refreshed: number; failed: number; deactivated: number; skipped: number };

async function refreshGmailTokens(results: RefreshResults) {
	const integrations = await db
		.select({ id: table.gmailIntegration.id, tenantId: table.gmailIntegration.tenantId })
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.isActive, true));

	for (const integration of integrations) {
		try {
			const result = await withRefreshLock(integration.id, async () => {
				return await getGmailAuth(integration.tenantId);
			});
			if (result && 'skipped' in result) {
				results.skipped++;
				continue;
			}
			if (result === null) {
				results.deactivated++;
				await updateRefreshStatus(table.gmailIntegration, integration.id, false, 'Token revoked');
				await notifyTenantAdmins(integration.tenantId, 'Gmail', 'facturi-furnizori?tab=gmail');
			} else {
				results.refreshed++;
				await updateRefreshStatus(table.gmailIntegration, integration.id, true);
			}
		} catch (err) {
			results.failed++;
			const msg = err instanceof Error ? err.message : String(err);
			logError('token-refresh', `Gmail refresh failed for ${integration.tenantId}`, {
				metadata: { error: msg }
			});
			await updateRefreshStatus(table.gmailIntegration, integration.id, false, msg);
			const failures = await getConsecutiveFailures(table.gmailIntegration, integration.id);
			if (failures >= 3) {
				await notifyTenantAdmins(integration.tenantId, 'Gmail', 'facturi-furnizori?tab=gmail');
			}
		}
	}
}

async function refreshGoogleAdsTokens(results: RefreshResults) {
	const integrations = await db
		.select({ id: table.googleAdsIntegration.id, tenantId: table.googleAdsIntegration.tenantId })
		.from(table.googleAdsIntegration)
		.where(eq(table.googleAdsIntegration.isActive, true));

	for (const integration of integrations) {
		try {
			const result = await withRefreshLock(integration.id, async () => {
				return await getGoogleAdsAuth(integration.tenantId);
			});
			if (result && 'skipped' in result) {
				results.skipped++;
				continue;
			}
			if (result === null) {
				results.deactivated++;
				await updateRefreshStatus(table.googleAdsIntegration, integration.id, false, 'Token revoked');
				await notifyTenantAdmins(integration.tenantId, 'Google Ads', 'invoices/google-ads');
			} else {
				results.refreshed++;
				await updateRefreshStatus(table.googleAdsIntegration, integration.id, true);
			}
		} catch (err) {
			results.failed++;
			const msg = err instanceof Error ? err.message : String(err);
			logError('token-refresh', `Google Ads refresh failed for ${integration.tenantId}`, {
				metadata: { error: msg }
			});
			await updateRefreshStatus(table.googleAdsIntegration, integration.id, false, msg);
			const failures = await getConsecutiveFailures(table.googleAdsIntegration, integration.id);
			if (failures >= 3) {
				await notifyTenantAdmins(integration.tenantId, 'Google Ads', 'invoices/google-ads');
			}
		}
	}
}

async function refreshMetaAdsTokens(results: RefreshResults) {
	const integrations = await db
		.select({ id: table.metaAdsIntegration.id, tenantId: table.metaAdsIntegration.tenantId })
		.from(table.metaAdsIntegration)
		.where(eq(table.metaAdsIntegration.isActive, true));

	for (const integration of integrations) {
		try {
			const result = await withRefreshLock(integration.id, async () => {
				return await getMetaAdsAuth(integration.id);
			});
			if (result && 'skipped' in result) {
				results.skipped++;
				continue;
			}
			if (result === null) {
				results.deactivated++;
				await updateRefreshStatus(table.metaAdsIntegration, integration.id, false, 'Token exchange failed');
				// Meta: notify only after 5+ failures (no refresh token, more tolerance needed)
				const failures = await getConsecutiveFailures(table.metaAdsIntegration, integration.id);
				if (failures >= 5) {
					await notifyTenantAdmins(integration.tenantId, 'Meta Ads', 'invoices/meta-ads');
				}
			} else {
				results.refreshed++;
				await updateRefreshStatus(table.metaAdsIntegration, integration.id, true);
			}
		} catch (err) {
			results.failed++;
			const msg = err instanceof Error ? err.message : String(err);
			logError('token-refresh', `Meta Ads refresh failed for ${integration.tenantId}`, {
				metadata: { error: msg }
			});
			await updateRefreshStatus(table.metaAdsIntegration, integration.id, false, msg);
			const failures = await getConsecutiveFailures(table.metaAdsIntegration, integration.id);
			if (failures >= 5) {
				await notifyTenantAdmins(integration.tenantId, 'Meta Ads', 'invoices/meta-ads');
			}
		}
	}
}

async function refreshTiktokAdsTokens(results: RefreshResults) {
	const integrations = await db
		.select({ id: table.tiktokAdsIntegration.id, tenantId: table.tiktokAdsIntegration.tenantId })
		.from(table.tiktokAdsIntegration)
		.where(eq(table.tiktokAdsIntegration.isActive, true));

	for (const integration of integrations) {
		try {
			const result = await withRefreshLock(integration.id, async () => {
				return await getTiktokAdsAuth(integration.id);
			});
			if (result && 'skipped' in result) {
				results.skipped++;
				continue;
			}
			if (result === null) {
				results.deactivated++;
				await updateRefreshStatus(table.tiktokAdsIntegration, integration.id, false, 'Token revoked');
				await notifyTenantAdmins(integration.tenantId, 'TikTok Ads', 'invoices/tiktok-ads');
			} else {
				results.refreshed++;
				await updateRefreshStatus(table.tiktokAdsIntegration, integration.id, true);
			}
		} catch (err) {
			results.failed++;
			const msg = err instanceof Error ? err.message : String(err);
			logError('token-refresh', `TikTok Ads refresh failed for ${integration.tenantId}`, {
				metadata: { error: msg }
			});
			await updateRefreshStatus(table.tiktokAdsIntegration, integration.id, false, msg);
			const failures = await getConsecutiveFailures(table.tiktokAdsIntegration, integration.id);
			if (failures >= 3) {
				await notifyTenantAdmins(integration.tenantId, 'TikTok Ads', 'invoices/tiktok-ads');
			}
		}
	}
}

// --- Main handler ---

const PLATFORM_HANDLERS: Record<string, (results: RefreshResults) => Promise<void>> = {
	gmail: refreshGmailTokens,
	google_ads: refreshGoogleAdsTokens,
	meta_ads: refreshMetaAdsTokens,
	tiktok_ads: refreshTiktokAdsTokens
};

/**
 * Proactive token refresh for all OAuth integrations.
 * Runs on two schedules:
 *   - Frequent (every 45 min): Gmail + Google Ads (1h token lifetime)
 *   - Daily (every 6 hours): Meta Ads + TikTok Ads (24h-60d token lifetime)
 *
 * Accepts params.platforms to filter which platforms to refresh.
 */
export async function processTokenRefresh(params: Record<string, any> = {}) {
	const platforms: string[] = params.platforms || Object.keys(PLATFORM_HANDLERS);
	logInfo('scheduler', `Starting proactive token refresh for: ${platforms.join(', ')}`);

	const results: RefreshResults = { refreshed: 0, failed: 0, deactivated: 0, skipped: 0 };

	for (const platform of platforms) {
		const handler = PLATFORM_HANDLERS[platform];
		if (!handler) continue;
		try {
			await handler(results);
		} catch (err) {
			logError('token-refresh', `Failed to process ${platform} integrations`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
		}
	}

	logInfo('scheduler', 'Proactive token refresh completed', { metadata: results });
	return results;
}
