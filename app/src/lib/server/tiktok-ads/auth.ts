import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarning, logError } from '$lib/server/logger';

const TIKTOK_AUTH_URL = 'https://business-api.tiktok.com/portal/auth';
const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3';

/**
 * Classify a TikTok API error as transient (retry-able) or permanent (stop retrying).
 * Defaults to transient to avoid premature deactivation.
 */
function classifyRefreshError(err: unknown): 'transient' | 'permanent' {
	const message = err instanceof Error ? err.message : String(err);

	const permanentPatterns = [
		/invalid_grant/i,
		/unauthorized|401/i,
		/invalid_request|400/i,
		/forbidden|403/i,
		/revoked/i,
		/client_id.*not.*exist/i
	];

	if (permanentPatterns.some((p) => p.test(message))) {
		return 'permanent';
	}

	return 'transient';
}

/**
 * Sleep with jitter to avoid thundering herd on concurrent refresh attempts.
 */
function sleepWithJitter(baseMs: number): Promise<void> {
	const jitter = Math.floor(Math.random() * 500);
	return new Promise((r) => setTimeout(r, baseMs + jitter));
}

/**
 * Generate TikTok OAuth2 authorization URL
 */
export function getOAuthUrl(state: string): string {
	const params = new URLSearchParams({
		app_id: env.TIKTOK_APP_ID!,
		redirect_uri: env.TIKTOK_REDIRECT_URI!,
		state
	});

	const url = `${TIKTOK_AUTH_URL}?${params.toString()}`;
	logInfo('tiktok-ads', 'OAuth: Generated auth URL', { metadata: { redirectUri: env.TIKTOK_REDIRECT_URI } });
	return url;
}

/**
 * Exchange auth_code for access_token + refresh_token via TikTok API
 */
async function exchangeCodeForTokens(authCode: string): Promise<{
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresIn: number;
	refreshTokenExpiresIn: number;
}> {
	const res = await fetch(`${TIKTOK_API_URL}/oauth2/access_token/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			app_id: env.TIKTOK_APP_ID!,
			secret: env.TIKTOK_APP_SECRET!,
			auth_code: authCode
		})
	});

	const json = await res.json();
	const data = json.data;

	if (json.code !== 0 || !data?.access_token) {
		throw new Error(`TikTok token exchange failed: ${json.message || 'Unknown error'}`);
	}

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token || '',
		accessTokenExpiresIn: data.access_token_expires_in || 86400, // default 24h
		refreshTokenExpiresIn: data.refresh_token_expires_in || 31536000 // default 365 days
	};
}

/**
 * Refresh an expired access_token using a refresh_token.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s + jitter)
 * for transient errors. Permanent errors (token revoked) fail immediately.
 */
async function refreshAccessToken(refreshToken: string): Promise<{
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresIn: number;
	refreshTokenExpiresIn: number;
}> {
	const MAX_RETRIES = 3;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(`${TIKTOK_API_URL}/oauth2/access_token/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: AbortSignal.timeout(10_000),
				body: JSON.stringify({
					app_id: env.TIKTOK_APP_ID!,
					secret: env.TIKTOK_APP_SECRET!,
					grant_type: 'refresh_token',
					refresh_token: refreshToken
				})
			});

			const json = await res.json();
			const data = json.data;

			if (json.code !== 0 || !data?.access_token) {
				const error = new Error(`TikTok token refresh failed: ${json.message || 'Unknown error'}`);
				if (classifyRefreshError(error) === 'permanent') throw error;
				lastError = error;
				if (attempt < MAX_RETRIES) {
					await sleepWithJitter(1000 * Math.pow(2, attempt));
					continue;
				}
				throw error;
			}

			return {
				accessToken: data.access_token,
				refreshToken: data.refresh_token || refreshToken,
				accessTokenExpiresIn: data.access_token_expires_in || 86400,
				refreshTokenExpiresIn: data.refresh_token_expires_in || 31536000
			};
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (classifyRefreshError(err) === 'permanent') throw lastError;
			if (attempt < MAX_RETRIES) {
				await sleepWithJitter(1000 * Math.pow(2, attempt));
				continue;
			}
			throw lastError;
		}
	}

	throw lastError || new Error('Token refresh failed after all retries');
}

/**
 * Handle OAuth2 callback — exchange auth_code for tokens and save to DB
 */
export async function handleCallback(
	authCode: string,
	tenantId: string,
	integrationId: string
): Promise<{ email: string }> {
	logInfo('tiktok-ads', 'OAuth: handleCallback started', { tenantId });

	const tokens = await exchangeCodeForTokens(authCode);

	const tokenExpiresAt = new Date(Date.now() + tokens.accessTokenExpiresIn * 1000);
	const refreshTokenExpiresAt = new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000);

	// Update the integration record
	await db
		.update(table.tiktokAdsIntegration)
		.set({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			tokenExpiresAt,
			refreshTokenExpiresAt,
			isActive: true,
			updatedAt: new Date()
		})
		.where(eq(table.tiktokAdsIntegration.id, integrationId));

	logInfo('tiktok-ads', 'OAuth: Integration updated with tokens', { tenantId, metadata: { integrationId } });
	return { email: '' };
}

/**
 * Get a valid access token for a specific integration, auto-refreshing if needed.
 * TikTok access tokens last 24h, refresh tokens last 365 days.
 */
export async function getAuthenticatedToken(integrationId: string): Promise<{ accessToken: string; integration: table.TiktokAdsIntegration } | null> {
	const [integration] = await db
		.select()
		.from(table.tiktokAdsIntegration)
		.where(and(eq(table.tiktokAdsIntegration.id, integrationId), eq(table.tiktokAdsIntegration.isActive, true)))
		.limit(1);

	if (!integration || !integration.accessToken) {
		return null;
	}

	// Check if token needs refresh (< 1 hour remaining)
	const oneHourMs = 60 * 60 * 1000;
	if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() < Date.now() + oneHourMs) {
		if (!integration.refreshToken) {
			logWarning('tiktok-ads', 'Token expired and no refresh token available', { metadata: { integrationId } });
			return null;
		}

		// Warn if refresh token looks expired, but still attempt refresh —
		// TikTok API is the source of truth (user may have re-authorized externally)
		if (integration.refreshTokenExpiresAt && integration.refreshTokenExpiresAt.getTime() < Date.now()) {
			logWarning('tiktok-ads', 'Refresh token appears expired — attempting refresh anyway', { metadata: { integrationId } });
		}

		try {
			const tokens = await refreshAccessToken(integration.refreshToken);
			const tokenExpiresAt = new Date(Date.now() + tokens.accessTokenExpiresIn * 1000);
			const refreshTokenExpiresAt = new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000);

			await db
				.update(table.tiktokAdsIntegration)
				.set({
					accessToken: tokens.accessToken,
					refreshToken: tokens.refreshToken,
					tokenExpiresAt,
					refreshTokenExpiresAt,
					updatedAt: new Date()
				})
				.where(eq(table.tiktokAdsIntegration.id, integrationId));

			logInfo('tiktok-ads', 'Token refreshed', { metadata: { integrationId } });
			return {
				accessToken: tokens.accessToken,
				integration: {
					...integration,
					accessToken: tokens.accessToken,
					refreshToken: tokens.refreshToken,
					tokenExpiresAt,
					refreshTokenExpiresAt
				}
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const errorType = classifyRefreshError(err);
			const isExpired = integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() < Date.now();

			// Permanent error (token revoked) — return null, scheduler handles deactivation via consecutiveRefreshFailures
			if (errorType === 'permanent') {
				logWarning('tiktok-ads', 'Permanent refresh failure — token likely revoked', {
					metadata: { integrationId, error: message }
				});
				return null;
			}

			// Transient error — use old token if still valid
			if (!isExpired) {
				logWarning('tiktok-ads', 'Token refresh failed (transient), using existing token', {
					metadata: { integrationId, error: message }
				});
				return { accessToken: integration.accessToken, integration };
			}

			// Transient error + token expired — return null, scheduler will retry next cycle
			logWarning('tiktok-ads', 'Token refresh failed (transient) and access token already expired', {
				metadata: { integrationId, error: message }
			});
			return null;
		}
	}

	return { accessToken: integration.accessToken, integration };
}

/**
 * Get all TikTok Ads integrations for a tenant
 */
export async function getTiktokAdsConnections(tenantId: string) {
	const integrations = await db
		.select()
		.from(table.tiktokAdsIntegration)
		.where(eq(table.tiktokAdsIntegration.tenantId, tenantId));

	return integrations.map((int) => ({
		id: int.id,
		orgId: int.orgId,
		email: int.email,
		connected: int.isActive,
		tokenExpiresAt: int.tokenExpiresAt,
		refreshTokenExpiresAt: int.refreshTokenExpiresAt,
		lastSyncAt: int.lastSyncAt,
		syncEnabled: int.syncEnabled,
		lastSyncResults: int.lastSyncResults ? JSON.parse(int.lastSyncResults) : null,
		// Access tokens (24h) are auto-refreshed — don't alarm on those.
		// Only flag as "expiring/expired" when the refresh token (365d) is at risk,
		// because that requires manual re-authorization.
		tokenExpiringSoon: int.refreshTokenExpiresAt ? int.refreshTokenExpiresAt.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000 : false,
		tokenExpired: int.refreshTokenExpiresAt ? int.refreshTokenExpiresAt.getTime() < Date.now() : false,
		refreshTokenExpired: int.refreshTokenExpiresAt ? int.refreshTokenExpiresAt.getTime() < Date.now() : false,
		ttSessionStatus: int.ttSessionStatus,
		paymentAccountId: int.paymentAccountId
	}));
}

/**
 * Disconnect a specific TikTok Ads integration
 */
export async function disconnectTiktokAds(integrationId: string): Promise<void> {
	logInfo('tiktok-ads', 'Disconnect: Starting', { metadata: { integrationId } });

	await db
		.update(table.tiktokAdsIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.tiktokAdsIntegration.id, integrationId));

	logInfo('tiktok-ads', 'Disconnect: DB updated, isActive set to false', { metadata: { integrationId } });
}
