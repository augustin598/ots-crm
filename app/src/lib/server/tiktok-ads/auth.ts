import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarning, logError } from '$lib/server/logger';

const TIKTOK_AUTH_URL = 'https://business-api.tiktok.com/portal/auth';
const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3';

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
 * Refresh an expired access_token using a refresh_token
 */
async function refreshAccessToken(refreshToken: string): Promise<{
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
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		})
	});

	const json = await res.json();
	const data = json.data;

	if (json.code !== 0 || !data?.access_token) {
		throw new Error(`TikTok token refresh failed: ${json.message || 'Unknown error'}`);
	}

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token || refreshToken,
		accessTokenExpiresIn: data.access_token_expires_in || 86400,
		refreshTokenExpiresIn: data.refresh_token_expires_in || 31536000
	};
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

		// Check if refresh token itself is still valid
		if (integration.refreshTokenExpiresAt && integration.refreshTokenExpiresAt.getTime() < Date.now()) {
			logWarning('tiktok-ads', 'Refresh token also expired', { metadata: { integrationId } });
			await db
				.update(table.tiktokAdsIntegration)
				.set({ isActive: false, updatedAt: new Date() })
				.where(eq(table.tiktokAdsIntegration.id, integrationId));
			return null;
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
			logWarning('tiktok-ads', 'Token refresh failed, using existing token', {
				metadata: { integrationId, error: err instanceof Error ? err.message : String(err) }
			});
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
		tokenExpiringSoon: int.tokenExpiresAt ? int.tokenExpiresAt.getTime() < Date.now() + 60 * 60 * 1000 : false,
		tokenExpired: int.tokenExpiresAt ? int.tokenExpiresAt.getTime() < Date.now() : false,
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
