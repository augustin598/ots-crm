import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { sendTelegramMessage } from '$lib/server/telegram/sender';

const META_GRAPH_URL = 'https://graph.facebook.com/v19.0';

async function notifyAdmins(tenantId: string, text: string): Promise<void> {
	const recipients = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenantId));

	for (const r of recipients) {
		try {
			await sendTelegramMessage({ tenantId, userId: r.userId, text });
		} catch (e) {
			logWarning(
				'scheduler',
				`[token-expiry] Telegram failed for user ${r.userId}: ${serializeError(e).message}`
			);
		}
	}
}

interface DebugTokenData {
	data_access_expires_at?: number;
	expires_at?: number;
	is_valid?: boolean;
}

async function fetchTokenExpiry(
	accessToken: string,
	appAccessToken: string
): Promise<Date | null> {
	try {
		const url = `${META_GRAPH_URL}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return null;
		const json = (await res.json()) as { data?: DebugTokenData };
		const data = json.data;
		if (!data) return null;
		const expiresUnix = data.data_access_expires_at ?? data.expires_at;
		if (!expiresUnix || expiresUnix === 0) return null;
		return new Date(expiresUnix * 1000);
	} catch {
		return null;
	}
}

export async function processMetaTokenExpirationMonitor(): Promise<{
	checked: number;
	warnings: number;
	criticals: number;
}> {
	logInfo('scheduler', 'meta-token-expiration-monitor: starting');

	const appId = env.META_APP_ID;
	const appSecret = env.META_APP_SECRET;
	if (!appId || !appSecret) {
		logWarning('scheduler', 'meta-token-expiration-monitor: META_APP_ID or META_APP_SECRET not set — skipping');
		return { checked: 0, warnings: 0, criticals: 0 };
	}
	const appAccessToken = `${appId}|${appSecret}`;

	const integrations = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(eq(table.metaAdsIntegration.isActive, true));

	let warnings = 0;
	let criticals = 0;
	const now = new Date();

	for (const integration of integrations) {
		try {
			if (!integration.accessToken) continue;

			// Try debug_token API for fresh info; fall back to stored tokenExpiresAt
			let expiresAt: Date | null = await fetchTokenExpiry(integration.accessToken, appAccessToken);
			if (!expiresAt && integration.tokenExpiresAt) {
				expiresAt = integration.tokenExpiresAt;
			}

			// Persist last check timestamp
			await db
				.update(table.metaAdsIntegration)
				.set({ lastTokenCheckAt: now })
				.where(eq(table.metaAdsIntegration.id, integration.id));

			if (!expiresAt) {
				logWarning(
					'scheduler',
					`[token-expiry] integration ${integration.id} (${integration.businessName}): no expiry info`
				);
				continue;
			}

			const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

			logInfo('scheduler', `[token-expiry] integration ${integration.id} expires in ${daysUntilExpiry.toFixed(1)} days`);

			if (daysUntilExpiry < 1) {
				criticals++;
				const msg = `🚨 Token Meta Ads EXPIRAT pentru ${integration.businessName} (tenant: ${integration.tenantId}). Reautentifică imediat!`;
				logError('scheduler', `[token-expiry] CRITICAL: ${msg}`);
				await notifyAdmins(integration.tenantId, msg);
			} else if (daysUntilExpiry < 7) {
				criticals++;
				const msg = `🔴 Token Meta Ads expiră în ${Math.ceil(daysUntilExpiry)} zile: ${integration.businessName}. Reautentifică curând!`;
				logWarning('scheduler', `[token-expiry] HIGH: ${msg}`);
				await notifyAdmins(integration.tenantId, msg);
			} else if (daysUntilExpiry < 14) {
				warnings++;
				const msg = `⚠️ Token Meta Ads expiră în ${Math.ceil(daysUntilExpiry)} zile: ${integration.businessName}. Planifică reautentificarea.`;
				logWarning('scheduler', `[token-expiry] WARNING: ${msg}`);
				await notifyAdmins(integration.tenantId, msg);
			}
		} catch (e) {
			logError(
				'scheduler',
				`[token-expiry] integration ${integration.id} failed: ${serializeError(e).message}`
			);
		}
	}

	logInfo('scheduler', 'meta-token-expiration-monitor: done', {
		metadata: { checked: integrations.length, warnings, criticals }
	});

	return { checked: integrations.length, warnings, criticals };
}
