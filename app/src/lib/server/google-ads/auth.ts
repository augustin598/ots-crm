import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

const CALLBACK_PATH = '/api/google-ads/callback';

function getAppOrigin(requestOrigin: string): string {
	return env.PUBLIC_APP_URL || env.GOOGLE_ADS_REDIRECT_URI?.replace(CALLBACK_PATH, '') || requestOrigin;
}

function getOAuth2Client(redirectUri?: string) {
	return new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		redirectUri || env.GOOGLE_ADS_REDIRECT_URI
	);
}

const SCOPES = [
	'https://www.googleapis.com/auth/adwords',
	'https://www.googleapis.com/auth/userinfo.email'
];

/**
 * Generate Google Ads OAuth2 authorization URL
 */
export function getOAuthUrl(state: string, origin: string): string {
	const redirectUri = `${getAppOrigin(origin)}${CALLBACK_PATH}`;
	const oauth2Client = getOAuth2Client(redirectUri);
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent',
		state
	});
	logInfo('google-ads', 'OAuth: Generated auth URL', { metadata: { redirectUri } });
	return url;
}

/**
 * Handle OAuth2 callback - exchange code for tokens and save to DB
 */
export async function handleCallback(
	code: string,
	tenantId: string,
	mccAccountId: string,
	developerToken: string,
	origin: string
): Promise<{ email: string }> {
	logInfo('google-ads', 'OAuth: handleCallback started', { tenantId });
	const redirectUri = `${getAppOrigin(origin)}${CALLBACK_PATH}`;
	const oauth2Client = getOAuth2Client(redirectUri);

	const { tokens } = await oauth2Client.getToken(code);
	logInfo('google-ads', 'OAuth: Tokens received', { tenantId, metadata: { hasAccessToken: !!tokens.access_token, hasRefreshToken: !!tokens.refresh_token } });

	if (!tokens.access_token || !tokens.refresh_token) {
		logError('google-ads', 'OAuth: Missing tokens', { tenantId });
		throw new Error('Failed to obtain tokens from Google');
	}

	// Get user email from the token
	oauth2Client.setCredentials(tokens);
	const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
	const userInfo = await oauth2.userinfo.get();
	const email = userInfo.data.email;
	logInfo('google-ads', 'OAuth: Got email from profile', { tenantId, metadata: { email } });

	if (!email) {
		throw new Error('Failed to get email from Google profile');
	}

	// Check if integration already exists for this tenant
	const [existing] = await db
		.select()
		.from(table.googleAdsIntegration)
		.where(eq(table.googleAdsIntegration.tenantId, tenantId))
		.limit(1);

	const tokenExpiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

	if (existing) {
		logInfo('google-ads', 'OAuth: Updating existing integration', { tenantId });
		await db
			.update(table.googleAdsIntegration)
			.set({
				email,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				tokenExpiresAt,
				mccAccountId,
				developerToken,
				isActive: true,
				updatedAt: new Date()
			})
			.where(eq(table.googleAdsIntegration.id, existing.id));
	} else {
		logInfo('google-ads', 'OAuth: Creating new integration', { tenantId });
		await db.insert(table.googleAdsIntegration).values({
			id: crypto.randomUUID(),
			tenantId,
			email,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			tokenExpiresAt,
			mccAccountId,
			developerToken,
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}

	return { email };
}

/**
 * Get a valid OAuth2 client with auto-refreshed tokens
 */
export async function getAuthenticatedClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.googleAdsIntegration)
		.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)))
		.limit(1);

	if (!integration) {
		return null;
	}

	const oauth2Client = getOAuth2Client();
	oauth2Client.setCredentials({
		access_token: integration.accessToken,
		refresh_token: integration.refreshToken,
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	// Auto-refresh if token is expired or about to expire (5 min buffer)
	if (integration.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
		try {
			const { credentials } = await oauth2Client.refreshAccessToken();
			await db
				.update(table.googleAdsIntegration)
				.set({
					accessToken: credentials.access_token!,
					tokenExpiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
					updatedAt: new Date()
				})
				.where(eq(table.googleAdsIntegration.id, integration.id));
			logInfo('google-ads', 'Token refreshed', { tenantId });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const isInvalidGrant = message.includes('invalid_grant') || message.includes('Token has been expired or revoked');

			if (isInvalidGrant) {
				logWarning('google-ads', 'OAuth: Refresh token invalid/revoked — deactivating integration', { tenantId, metadata: { email: integration.email } });
				await db
					.update(table.googleAdsIntegration)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(table.googleAdsIntegration.id, integration.id));
				return null;
			}

			// Transient error — rethrow so caller can retry
			throw err;
		}
	}

	return { oauth2Client, integration };
}

/**
 * Get Google Ads integration status for a tenant
 */
export async function getGoogleAdsStatus(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.googleAdsIntegration)
		.where(eq(table.googleAdsIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		return {
			connected: false,
			email: null,
			mccAccountId: null,
			developerToken: null,
			lastSyncAt: null,
			isActive: false,
			syncEnabled: false,
			lastSyncResults: null,
			integrationId: null,
			googleSessionStatus: 'none' as const
		};
	}

	return {
		connected: integration.isActive,
		email: integration.email,
		mccAccountId: integration.mccAccountId,
		developerToken: integration.developerToken,
		lastSyncAt: integration.lastSyncAt,
		isActive: integration.isActive,
		syncEnabled: integration.syncEnabled,
		lastSyncResults: integration.lastSyncResults ? JSON.parse(integration.lastSyncResults) : null,
		integrationId: integration.id,
		googleSessionStatus: integration.googleSessionStatus
	};
}

/**
 * Disconnect Google Ads integration
 */
export async function disconnectGoogleAds(tenantId: string): Promise<void> {
	logInfo('google-ads', 'Disconnect: Starting', { tenantId });
	const [integration] = await db
		.select()
		.from(table.googleAdsIntegration)
		.where(eq(table.googleAdsIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		logInfo('google-ads', 'Disconnect: No integration found', { tenantId });
		return;
	}

	// Try to revoke the token
	try {
		const oauth2Client = getOAuth2Client();
		oauth2Client.setCredentials({ access_token: integration.accessToken });
		await oauth2Client.revokeCredentials();
		logInfo('google-ads', 'Disconnect: Token revoked successfully', { tenantId });
	} catch (err) {
		logWarning('google-ads', 'Disconnect: Token revoke failed (might already be invalid)', { tenantId, stackTrace: err instanceof Error ? err.stack : undefined });
	}

	await db
		.update(table.googleAdsIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.googleAdsIntegration.id, integration.id));
	logInfo('google-ads', 'Disconnect: DB updated, isActive set to false', { tenantId });
}

/**
 * Update lastSyncAt timestamp
 */
export async function updateLastSyncAt(tenantId: string): Promise<void> {
	await db
		.update(table.googleAdsIntegration)
		.set({ lastSyncAt: new Date(), updatedAt: new Date() })
		.where(and(eq(table.googleAdsIntegration.tenantId, tenantId), eq(table.googleAdsIntegration.isActive, true)));
}
