import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { getAuthenticatedClient as getGmailAuth } from '$lib/server/gmail/auth';
import { getAuthenticatedClient as getGoogleAdsAuth } from '$lib/server/google-ads/auth';
import { getAuthenticatedToken as getMetaAdsAuth } from '$lib/server/meta-ads/auth';
import { getAuthenticatedToken as getTiktokAdsAuth } from '$lib/server/tiktok-ads/auth';
import { createNotification } from '$lib/server/notifications';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { redis } from 'bun';

// --- Helpers ---

async function withRefreshLock<T>(integrationId: string, fn: () => Promise<T>): Promise<T | { skipped: true }> {
	const lockKey = `token-refresh-lock:${integrationId}`;
	const lockToken = crypto.randomUUID();
	// Atomic SET NX EX — avoids TOCTOU race between get() and setex()
	const acquired = await redis.send('SET', [lockKey, lockToken, 'NX', 'EX', '120']);
	if (!acquired) return { skipped: true };
	try {
		return await fn();
	} finally {
		// Only delete lock if we still own it (prevents deleting another process's lock)
		try {
			const currentToken = await redis.get(lockKey);
			if (currentToken && String(currentToken) === lockToken) {
				await redis.del(lockKey);
			}
		} catch {
			// Redis error during cleanup — lock will expire via TTL
		}
	}
}

const NOTIFICATION_DEDUP_TTL = 86400; // 24 hours

async function notifyTenantAdmins(tenantId: string, platform: string, link: string): Promise<void> {
	// Dedup: only notify once per 24h per tenant+platform
	const dedupKey = `token-refresh-notif:${tenantId}:${platform}`;
	try {
		const lastNotif = await redis.get(dedupKey);
		if (lastNotif) return; // Already notified recently
		await redis.send('SET', [dedupKey, String(Date.now()), 'EX', String(NOTIFICATION_DEDUP_TTL)]);
	} catch {
		// Redis error — proceed with notification to be safe
	}

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
	} catch (err) {
		logWarning('token-refresh', `Failed to notify admins for ${tenantId}/${platform}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
	}
}

type IntegrationTable = typeof table.gmailIntegration | typeof table.googleAdsIntegration | typeof table.metaAdsIntegration | typeof table.tiktokAdsIntegration;

/**
 * Update refresh tracking columns and return the new consecutive failure count.
 * On success, resets failures to 0. On failure, increments by 1.
 */
async function updateRefreshStatus(
	schemaTable: IntegrationTable,
	integrationId: string,
	success: boolean,
	error?: string
): Promise<number> {
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
			return 0;
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
			// Read back the new value
			const [row] = await db
				.select({ failures: schemaTable.consecutiveRefreshFailures })
				.from(schemaTable)
				.where(eq(schemaTable.id, integrationId));
			return row?.failures ?? 1;
		}
	} catch {
		// Don't fail refresh for status update errors
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
			const failures = await updateRefreshStatus(table.gmailIntegration, integration.id, false, msg);
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
				const failures = await updateRefreshStatus(table.googleAdsIntegration, integration.id, false, 'Refresh failed');
				if (failures >= 5) {
					results.deactivated++;
					await db
						.update(table.googleAdsIntegration)
						.set({ isActive: false, updatedAt: new Date() })
						.where(eq(table.googleAdsIntegration.id, integration.id));
					await notifyTenantAdmins(integration.tenantId, 'Google Ads', 'settings/google-ads');
				} else if (failures >= 3) {
					results.failed++;
					await notifyTenantAdmins(integration.tenantId, 'Google Ads', 'settings/google-ads');
				} else {
					results.failed++;
				}
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
			const failures = await updateRefreshStatus(table.googleAdsIntegration, integration.id, false, msg);
			if (failures >= 5) {
				await db
					.update(table.googleAdsIntegration)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(table.googleAdsIntegration.id, integration.id));
				await notifyTenantAdmins(integration.tenantId, 'Google Ads', 'settings/google-ads');
			} else if (failures >= 3) {
				await notifyTenantAdmins(integration.tenantId, 'Google Ads', 'settings/google-ads');
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
				const failures = await updateRefreshStatus(table.metaAdsIntegration, integration.id, false, 'Token exchange failed');
				if (failures >= 5) {
					results.deactivated++;
					await db
						.update(table.metaAdsIntegration)
						.set({ isActive: false, updatedAt: new Date() })
						.where(eq(table.metaAdsIntegration.id, integration.id));
					await notifyTenantAdmins(integration.tenantId, 'Meta Ads', 'settings/meta-ads');
				} else if (failures >= 3) {
					results.failed++;
					await notifyTenantAdmins(integration.tenantId, 'Meta Ads', 'settings/meta-ads');
				} else {
					results.failed++;
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
			const failures = await updateRefreshStatus(table.metaAdsIntegration, integration.id, false, msg);
			if (failures >= 5) {
				await db
					.update(table.metaAdsIntegration)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(table.metaAdsIntegration.id, integration.id));
				await notifyTenantAdmins(integration.tenantId, 'Meta Ads', 'settings/meta-ads');
			} else if (failures >= 3) {
				await notifyTenantAdmins(integration.tenantId, 'Meta Ads', 'settings/meta-ads');
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
				// null = refresh failed (permanent or transient + expired token)
				// Don't deactivate immediately — use consecutiveRefreshFailures threshold
				const failures = await updateRefreshStatus(table.tiktokAdsIntegration, integration.id, false, 'Refresh failed');
				if (failures >= 5) {
					results.deactivated++;
					// Deactivate only after 5 consecutive failures (≈30h at 6h intervals)
					await db
						.update(table.tiktokAdsIntegration)
						.set({ isActive: false, updatedAt: new Date() })
						.where(eq(table.tiktokAdsIntegration.id, integration.id));
					await notifyTenantAdmins(integration.tenantId, 'TikTok Ads', 'settings/tiktok-ads');
				} else if (failures >= 3) {
					results.failed++;
					// Warn admins early so they can reconnect proactively
					await notifyTenantAdmins(integration.tenantId, 'TikTok Ads', 'settings/tiktok-ads');
				} else {
					results.failed++;
				}
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
			const failures = await updateRefreshStatus(table.tiktokAdsIntegration, integration.id, false, msg);
			if (failures >= 5) {
				await db
					.update(table.tiktokAdsIntegration)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(table.tiktokAdsIntegration.id, integration.id));
				await notifyTenantAdmins(integration.tenantId, 'TikTok Ads', 'settings/tiktok-ads');
			} else if (failures >= 3) {
				await notifyTenantAdmins(integration.tenantId, 'TikTok Ads', 'settings/tiktok-ads');
			}
		}
	}
}

// --- Expiry warnings ---

async function checkTokenExpiryWarnings(): Promise<number> {
	let warned = 0;
	const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	try {
		// Check Meta Ads tokens expiring within 7 days
		const expiringMeta = await db
			.select({
				id: table.metaAdsIntegration.id,
				tenantId: table.metaAdsIntegration.tenantId,
				tokenExpiresAt: table.metaAdsIntegration.tokenExpiresAt,
			})
			.from(table.metaAdsIntegration)
			.where(
				and(
					eq(table.metaAdsIntegration.isActive, true),
					sql`${table.metaAdsIntegration.tokenExpiresAt} IS NOT NULL`,
					sql`${table.metaAdsIntegration.tokenExpiresAt} <= ${sevenDaysFromNow.toISOString()}`,
					sql`${table.metaAdsIntegration.tokenExpiresAt} > datetime('now')`
				)
			);

		for (const integration of expiringMeta) {
			const dedupKey = `token-expiring-notif:${integration.tenantId}:meta_ads`;
			const already = await redis.get(dedupKey);
			if (already) continue;
			await redis.send('SET', [dedupKey, String(Date.now()), 'EX', String(NOTIFICATION_DEDUP_TTL)]);

			const admins = await db
				.select({ userId: table.tenantUser.userId })
				.from(table.tenantUser)
				.where(
					and(
						eq(table.tenantUser.tenantId, integration.tenantId),
						or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
					)
				);

			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, integration.tenantId))
				.limit(1);

			const expiryDate = integration.tokenExpiresAt
				? new Date(integration.tokenExpiresAt).toLocaleDateString('ro-RO')
				: 'curand';

			for (const admin of admins) {
				await createNotification({
					tenantId: integration.tenantId,
					userId: admin.userId,
					type: 'integration.auth_expiring',
					title: 'Token Meta Ads expira curand',
					message: `Token-ul de acces Meta Ads expira pe ${expiryDate}. Reconectati integrarea.`,
					link: tenant ? `/${tenant.slug}/settings/meta-ads` : undefined,
					priority: 'high',
				});
			}
			warned++;
		}

		// Check TikTok tokens similarly
		const expiringTiktok = await db
			.select({
				id: table.tiktokAdsIntegration.id,
				tenantId: table.tiktokAdsIntegration.tenantId,
				tokenExpiresAt: table.tiktokAdsIntegration.tokenExpiresAt,
			})
			.from(table.tiktokAdsIntegration)
			.where(
				and(
					eq(table.tiktokAdsIntegration.isActive, true),
					sql`${table.tiktokAdsIntegration.tokenExpiresAt} IS NOT NULL`,
					sql`${table.tiktokAdsIntegration.tokenExpiresAt} <= ${sevenDaysFromNow.toISOString()}`,
					sql`${table.tiktokAdsIntegration.tokenExpiresAt} > datetime('now')`
				)
			);

		for (const integration of expiringTiktok) {
			const dedupKey = `token-expiring-notif:${integration.tenantId}:tiktok_ads`;
			const already = await redis.get(dedupKey);
			if (already) continue;
			await redis.send('SET', [dedupKey, String(Date.now()), 'EX', String(NOTIFICATION_DEDUP_TTL)]);

			const admins = await db
				.select({ userId: table.tenantUser.userId })
				.from(table.tenantUser)
				.where(
					and(
						eq(table.tenantUser.tenantId, integration.tenantId),
						or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
					)
				);

			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, integration.tenantId))
				.limit(1);

			const expiryDate = integration.tokenExpiresAt
				? new Date(integration.tokenExpiresAt).toLocaleDateString('ro-RO')
				: 'curand';

			for (const admin of admins) {
				await createNotification({
					tenantId: integration.tenantId,
					userId: admin.userId,
					type: 'integration.auth_expiring',
					title: 'Token TikTok Ads expira curand',
					message: `Token-ul de acces TikTok Ads expira pe ${expiryDate}. Reconectati integrarea.`,
					link: tenant ? `/${tenant.slug}/settings/tiktok-ads` : undefined,
					priority: 'high',
				});
			}
			warned++;
		}
	} catch (err) {
		logWarning('token-refresh', `Token expiry warning check failed`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
	}

	return warned;
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
	logInfo('scheduler', `Starting proactive token refresh for: ${platforms.join(', ')}`, { metadata: { platforms } });

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

	// Check for tokens expiring within 7 days (only on daily runs to avoid spam)
	let expiryWarnings = 0;
	if (platforms.includes('meta_ads') || platforms.includes('tiktok_ads')) {
		expiryWarnings = await checkTokenExpiryWarnings();
	}

	logInfo('scheduler', 'Proactive token refresh completed', { metadata: { ...results, expiryWarnings } });
	return { ...results, expiryWarnings };
}
