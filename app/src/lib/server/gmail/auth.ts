import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

function getOAuth2Client() {
	return new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		env.GOOGLE_REDIRECT_URI
	);
}

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * Generate Google OAuth2 authorization URL
 */
export function getOAuthUrl(tenantId: string): string {
	const oauth2Client = getOAuth2Client();
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent',
		state: tenantId
	});
	console.log('[Gmail OAuth] Generated auth URL for tenant state:', tenantId);
	console.log('[Gmail OAuth] Redirect URI configured:', env.GOOGLE_REDIRECT_URI);
	return url;
}

/**
 * Handle OAuth2 callback - exchange code for tokens and save to DB
 */
export async function handleCallback(code: string, tenantId: string): Promise<{ email: string }> {
	console.log('[Gmail OAuth] handleCallback started, tenantId:', tenantId);
	const oauth2Client = getOAuth2Client();

	console.log('[Gmail OAuth] Exchanging code for tokens...');
	const { tokens } = await oauth2Client.getToken(code);
	console.log('[Gmail OAuth] Tokens received - access_token:', !!tokens.access_token, 'refresh_token:', !!tokens.refresh_token, 'expiry_date:', tokens.expiry_date);

	if (!tokens.access_token || !tokens.refresh_token) {
		console.error('[Gmail OAuth] Missing tokens! access_token:', !!tokens.access_token, 'refresh_token:', !!tokens.refresh_token);
		throw new Error('Failed to obtain tokens from Google');
	}

	// Get user email from the token
	oauth2Client.setCredentials(tokens);
	const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
	const profile = await gmail.users.getProfile({ userId: 'me' });
	const email = profile.data.emailAddress;
	console.log('[Gmail OAuth] Got email from profile:', email);

	if (!email) {
		throw new Error('Failed to get email from Google profile');
	}

	// Check if integration already exists for this tenant
	const [existing] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	const tokenExpiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

	if (existing) {
		console.log('[Gmail OAuth] Updating existing integration, id:', existing.id, 'wasActive:', existing.isActive);
		await db
			.update(table.gmailIntegration)
			.set({
				email,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				tokenExpiresAt,
				isActive: true,
				updatedAt: new Date()
			})
			.where(eq(table.gmailIntegration.id, existing.id));
		console.log('[Gmail OAuth] Integration updated, isActive set to true');
	} else {
		console.log('[Gmail OAuth] Creating new integration for tenant:', tenantId);
		await db.insert(table.gmailIntegration).values({
			id: crypto.randomUUID(),
			tenantId,
			email,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			tokenExpiresAt,
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
		console.log('[Gmail OAuth] New integration created');
	}

	return { email };
}

/**
 * Get a valid OAuth2 client with auto-refreshed tokens
 */
export async function getAuthenticatedClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.gmailIntegration)
		.where(and(eq(table.gmailIntegration.tenantId, tenantId), eq(table.gmailIntegration.isActive, true)))
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
		const { credentials } = await oauth2Client.refreshAccessToken();
		await db
			.update(table.gmailIntegration)
			.set({
				accessToken: credentials.access_token!,
				tokenExpiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
				updatedAt: new Date()
			})
			.where(eq(table.gmailIntegration.id, integration.id));
	}

	return oauth2Client;
}

/**
 * Get Gmail integration status for a tenant
 */
export async function getGmailStatus(tenantId: string) {
	console.log('[Gmail Status] Checking status for tenant:', tenantId);
	const [integration] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		console.log('[Gmail Status] No integration found for tenant:', tenantId);
		return { connected: false, email: null, lastSyncAt: null, isActive: false, syncEnabled: false, syncInterval: 'daily', syncParserIds: null, syncDateRangeDays: 7, lastSyncResults: null, customMonitoredEmails: null, monitoredSupplierIds: null, excludeEmails: null };
	}

	console.log('[Gmail Status] Integration found - isActive:', integration.isActive, 'email:', integration.email);
	return {
		connected: integration.isActive,
		email: integration.email,
		lastSyncAt: integration.lastSyncAt,
		isActive: integration.isActive,
		syncEnabled: integration.syncEnabled,
		syncInterval: integration.syncInterval,
		syncParserIds: integration.syncParserIds ? JSON.parse(integration.syncParserIds) : null,
		syncDateRangeDays: integration.syncDateRangeDays,
		lastSyncResults: integration.lastSyncResults ? JSON.parse(integration.lastSyncResults) : null,
		customMonitoredEmails: integration.customMonitoredEmails ? JSON.parse(integration.customMonitoredEmails) : null,
		monitoredSupplierIds: integration.monitoredSupplierIds ? JSON.parse(integration.monitoredSupplierIds) : null,
		excludeEmails: integration.excludeEmails ? JSON.parse(integration.excludeEmails) : null
	};
}

/**
 * Disconnect Gmail integration
 */
export async function disconnectGmail(tenantId: string): Promise<void> {
	console.log('[Gmail Disconnect] Starting disconnect for tenant:', tenantId);
	const [integration] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		console.log('[Gmail Disconnect] No integration found for tenant:', tenantId);
		return;
	}

	console.log('[Gmail Disconnect] Found integration id:', integration.id, 'isActive:', integration.isActive);

	// Try to revoke the token
	try {
		const oauth2Client = getOAuth2Client();
		oauth2Client.setCredentials({ access_token: integration.accessToken });
		await oauth2Client.revokeCredentials();
		console.log('[Gmail Disconnect] Token revoked successfully');
	} catch (err) {
		console.warn('[Gmail Disconnect] Token revoke failed (might already be invalid):', err instanceof Error ? err.message : err);
	}

	await db
		.update(table.gmailIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.gmailIntegration.id, integration.id));
	console.log('[Gmail Disconnect] DB updated, isActive set to false');
}

/**
 * Update lastSyncAt timestamp
 */
export async function updateLastSyncAt(tenantId: string): Promise<void> {
	await db
		.update(table.gmailIntegration)
		.set({ lastSyncAt: new Date(), updatedAt: new Date() })
		.where(and(eq(table.gmailIntegration.tenantId, tenantId), eq(table.gmailIntegration.isActive, true)));
}
