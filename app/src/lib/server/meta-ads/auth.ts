import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarning, logError } from '$lib/server/logger';

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const SCOPES = 'ads_read,ads_management,business_management,leads_retrieval,pages_read_engagement,pages_show_list,pages_manage_ads';

/**
 * Generate Meta/Facebook OAuth2 authorization URL
 */
export function getOAuthUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: env.META_APP_ID!,
		redirect_uri: env.META_REDIRECT_URI!,
		scope: SCOPES,
		auth_type: 'rerequest',
		state,
		response_type: 'code'
	});

	const url = `https://www.facebook.com/v25.0/dialog/oauth?${params.toString()}`;
	logInfo('meta-ads', 'OAuth: Generated auth URL', { metadata: { redirectUri: env.META_REDIRECT_URI } });
	return url;
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 */
async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
	const params = new URLSearchParams({
		grant_type: 'fb_exchange_token',
		client_id: env.META_APP_ID!,
		client_secret: env.META_APP_SECRET!,
		fb_exchange_token: shortLivedToken
	});

	const res = await fetch(`${META_GRAPH_URL}/oauth/access_token?${params.toString()}`);
	const data = await res.json();

	if (data.error) {
		logError('meta-ads', 'OAuth: Token exchange failed', { metadata: { error: data.error.message } });
		throw new Error(`Meta token exchange failed: ${data.error.message}`);
	}

	return {
		accessToken: data.access_token,
		expiresIn: data.expires_in || 5184000 // Default 60 days
	};
}

/**
 * Handle OAuth2 callback - exchange code for tokens and save to DB
 */
export async function handleCallback(
	code: string,
	tenantId: string,
	integrationId: string
): Promise<{ email: string }> {
	logInfo('meta-ads', 'OAuth: handleCallback started', { tenantId });

	// Exchange code for short-lived token
	const tokenParams = new URLSearchParams({
		client_id: env.META_APP_ID!,
		client_secret: env.META_APP_SECRET!,
		redirect_uri: env.META_REDIRECT_URI!,
		code
	});

	const tokenRes = await fetch(`${META_GRAPH_URL}/oauth/access_token?${tokenParams.toString()}`);
	const tokenData = await tokenRes.json();

	if (tokenData.error) {
		logError('meta-ads', 'OAuth: Failed to exchange code', { tenantId, metadata: { error: tokenData.error.message } });
		throw new Error(`Failed to obtain token from Meta: ${tokenData.error.message}`);
	}

	const shortLivedToken = tokenData.access_token;
	logInfo('meta-ads', 'OAuth: Short-lived token received', { tenantId });

	// Exchange for long-lived token
	const { accessToken, expiresIn } = await exchangeForLongLivedToken(shortLivedToken);
	logInfo('meta-ads', 'OAuth: Long-lived token received', { tenantId, metadata: { expiresIn } });

	// Get user email
	const meRes = await fetch(`${META_GRAPH_URL}/me?fields=email,name&access_token=${accessToken}`);
	const meData = await meRes.json();
	const email = meData.email || meData.name || 'Unknown';
	logInfo('meta-ads', 'OAuth: Got profile', { tenantId, metadata: { email } });

	const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

	// Update the integration record
	await db
		.update(table.metaAdsIntegration)
		.set({
			email,
			accessToken,
			tokenExpiresAt,
			isActive: true,
			updatedAt: new Date()
		})
		.where(eq(table.metaAdsIntegration.id, integrationId));

	logInfo('meta-ads', 'OAuth: Integration updated', { tenantId, metadata: { integrationId } });
	return { email };
}

/**
 * Get a valid access token for a specific integration, auto-refreshing if needed
 */
export async function getAuthenticatedToken(integrationId: string): Promise<{ accessToken: string; integration: table.MetaAdsIntegration } | null> {
	const [integration] = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(and(eq(table.metaAdsIntegration.id, integrationId), eq(table.metaAdsIntegration.isActive, true)))
		.limit(1);

	if (!integration || !integration.accessToken) {
		return null;
	}

	// Check if token needs refresh (< 7 days remaining)
	const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
	if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() < Date.now() + sevenDaysMs) {
		try {
			const { accessToken, expiresIn } = await exchangeForLongLivedToken(integration.accessToken);
			const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

			await db
				.update(table.metaAdsIntegration)
				.set({ accessToken, tokenExpiresAt, updatedAt: new Date() })
				.where(eq(table.metaAdsIntegration.id, integrationId));

			logInfo('meta-ads', 'Token refreshed', { metadata: { integrationId } });
			return { accessToken, integration: { ...integration, accessToken, tokenExpiresAt } };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const isPermanent = message.includes('Error validating access token') ||
				message.includes('has not authorized application') ||
				message.includes('Session has expired');

			if (isPermanent) {
				logWarning('meta-ads', 'Token permanently invalid — deactivating integration', {
					metadata: { integrationId, error: message }
				});
				await db
					.update(table.metaAdsIntegration)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(table.metaAdsIntegration.id, integrationId));
				return null;
			}

			logWarning('meta-ads', 'Token refresh failed, using existing token', {
				metadata: { integrationId, error: message }
			});
		}
	}

	return { accessToken: integration.accessToken, integration };
}

/**
 * Get all Meta Ads integrations for a tenant
 */
export async function getMetaAdsConnections(tenantId: string) {
	const integrations = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(eq(table.metaAdsIntegration.tenantId, tenantId));

	return integrations.map((int) => ({
		id: int.id,
		businessId: int.businessId,
		businessName: int.businessName,
		connected: int.isActive,
		email: int.email,
		tokenExpiresAt: int.tokenExpiresAt,
		lastSyncAt: int.lastSyncAt,
		syncEnabled: int.syncEnabled,
		lastSyncResults: int.lastSyncResults ? JSON.parse(int.lastSyncResults) : null,
		tokenExpiringSoon: int.tokenExpiresAt ? int.tokenExpiresAt.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000 : false,
		tokenExpired: int.tokenExpiresAt ? int.tokenExpiresAt.getTime() < Date.now() : false
	}));
}

/**
 * Disconnect a specific Meta Ads integration
 */
export async function disconnectMetaAds(integrationId: string): Promise<void> {
	logInfo('meta-ads', 'Disconnect: Starting', { metadata: { integrationId } });
	const [integration] = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(eq(table.metaAdsIntegration.id, integrationId))
		.limit(1);

	if (!integration) {
		logInfo('meta-ads', 'Disconnect: No integration found', { metadata: { integrationId } });
		return;
	}

	// Try to revoke the token
	if (integration.accessToken) {
		try {
			await fetch(`${META_GRAPH_URL}/me/permissions?access_token=${integration.accessToken}`, {
				method: 'DELETE'
			});
			logInfo('meta-ads', 'Disconnect: Token revoked successfully', { metadata: { integrationId } });
		} catch (err) {
			logWarning('meta-ads', 'Disconnect: Token revoke failed', {
				metadata: { integrationId, error: err instanceof Error ? err.message : String(err) }
			});
		}
	}

	await db
		.update(table.metaAdsIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.metaAdsIntegration.id, integrationId));
	logInfo('meta-ads', 'Disconnect: DB updated, isActive set to false', { metadata: { integrationId } });
}
