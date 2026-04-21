import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { encryptVerified, decrypt } from '$lib/server/plugins/smartbill/crypto';

function getOAuth2Client() {
	return new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		env.GOOGLE_REDIRECT_URI
	);
}

const SCOPES = [
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/gmail.send',
	'https://www.googleapis.com/auth/gmail.modify'
];

/**
 * Generate Google OAuth2 authorization URL
 */
export function getOAuthUrl(tenantId: string): string {
	const oauth2Client = getOAuth2Client();
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent',
		state: tenantId,
		include_granted_scopes: true
	});
	logInfo('gmail', 'OAuth: Generated auth URL', { tenantId, metadata: { redirectUri: env.GOOGLE_REDIRECT_URI } });
	return url;
}

/**
 * Read Gmail tokens, preferring encrypted columns.
 * Self-heals: if encrypted column is null but plain text exists, encrypts and backfills.
 */
async function readGmailTokens(
	integration: typeof table.gmailIntegration.$inferSelect
): Promise<{ accessToken: string; refreshToken: string }> {
	const tenantId = integration.tenantId;
	let accessToken: string;
	let refreshToken: string;

	if (integration.accessTokenEncrypted) {
		try {
			accessToken = decrypt(tenantId, integration.accessTokenEncrypted);
		} catch (err) {
			// Decryption failed (corrupt data, key rotation) — fall back to plain text
			logWarning('gmail', 'accessToken decrypt failed, falling back to plain text', { tenantId });
			accessToken = integration.accessToken;
		}
	} else {
		accessToken = integration.accessToken;
		if (accessToken) {
			try {
				await db
					.update(table.gmailIntegration)
					.set({ accessTokenEncrypted: encryptVerified(tenantId, accessToken) })
					.where(eq(table.gmailIntegration.id, integration.id));
			} catch { /* ignore backfill failure */ }
		}
	}

	if (integration.refreshTokenEncrypted) {
		try {
			refreshToken = decrypt(tenantId, integration.refreshTokenEncrypted);
		} catch (err) {
			logWarning('gmail', 'refreshToken decrypt failed, falling back to plain text', { tenantId });
			refreshToken = integration.refreshToken;
		}
	} else {
		refreshToken = integration.refreshToken;
		if (refreshToken) {
			try {
				await db
					.update(table.gmailIntegration)
					.set({ refreshTokenEncrypted: encryptVerified(tenantId, refreshToken) })
					.where(eq(table.gmailIntegration.id, integration.id));
			} catch { /* ignore backfill failure */ }
		}
	}

	return { accessToken, refreshToken };
}

/**
 * Check if the stored granted scopes include gmail.send
 */
export function hasGmailSendScope(grantedScopes: string | null): boolean {
	if (!grantedScopes) return false;
	try {
		const scopes: string[] = JSON.parse(grantedScopes);
		return scopes.some(s => s.includes('gmail.send'));
	} catch {
		return false;
	}
}

/**
 * Check if the stored granted scopes include gmail.modify
 * Required to remove INBOX label from sent messages (keeps them only in Sent).
 */
export function hasGmailModifyScope(grantedScopes: string | null): boolean {
	if (!grantedScopes) return false;
	try {
		const scopes: string[] = JSON.parse(grantedScopes);
		return scopes.some(s => s.includes('gmail.modify'));
	} catch {
		return false;
	}
}

/**
 * Handle OAuth2 callback - exchange code for tokens and save to DB
 */
export async function handleCallback(code: string, tenantId: string): Promise<{ email: string }> {
	logInfo('gmail', 'OAuth: handleCallback started', { tenantId });
	const oauth2Client = getOAuth2Client();

	logInfo('gmail', 'OAuth: Exchanging code for tokens', { tenantId });
	const { tokens } = await oauth2Client.getToken(code);
	logInfo('gmail', 'OAuth: Tokens received', { tenantId, metadata: { hasAccessToken: !!tokens.access_token, hasRefreshToken: !!tokens.refresh_token } });

	if (!tokens.access_token || !tokens.refresh_token) {
		logError('gmail', 'OAuth: Missing tokens', { tenantId, metadata: { hasAccessToken: !!tokens.access_token, hasRefreshToken: !!tokens.refresh_token } });
		throw new Error('Failed to obtain tokens from Google');
	}

	// Get user email from the token
	oauth2Client.setCredentials(tokens);
	const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
	const profile = await gmail.users.getProfile({ userId: 'me' });
	const email = profile.data.emailAddress;
	logInfo('gmail', 'OAuth: Got email from profile', { tenantId, metadata: { email } });

	if (!email) {
		throw new Error('Failed to get email from Google profile');
	}

	// Extract granted scopes
	const grantedScopes = tokens.scope
		? JSON.stringify(tokens.scope.split(' '))
		: JSON.stringify(SCOPES);

	// Check if integration already exists for this tenant
	const [existing] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	const tokenExpiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

	if (existing) {
		logInfo('gmail', 'OAuth: Updating existing integration', { tenantId, metadata: { integrationId: existing.id, wasActive: existing.isActive } });
		await db
			.update(table.gmailIntegration)
			.set({
				email,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				accessTokenEncrypted: encryptVerified(tenantId, tokens.access_token),
				refreshTokenEncrypted: encryptVerified(tenantId, tokens.refresh_token),
				grantedScopes,
				tokenExpiresAt,
				isActive: true,
				updatedAt: new Date()
			})
			.where(eq(table.gmailIntegration.id, existing.id));
		logInfo('gmail', 'OAuth: Integration updated, isActive set to true', { tenantId });
	} else {
		logInfo('gmail', 'OAuth: Creating new integration', { tenantId });
		await db.insert(table.gmailIntegration).values({
			id: crypto.randomUUID(),
			tenantId,
			email,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			accessTokenEncrypted: encryptVerified(tenantId, tokens.access_token),
			refreshTokenEncrypted: encryptVerified(tenantId, tokens.refresh_token),
			grantedScopes,
			tokenExpiresAt,
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
		logInfo('gmail', 'OAuth: New integration created', { tenantId });
	}

	// Clear cached transporter so the new grantedScopes (e.g. gmail.modify after re-auth)
	// are picked up immediately instead of being masked by the 30-min TTL snapshot.
	const { clearTenantTransporterCache } = await import('$lib/server/email');
	clearTenantTransporterCache(tenantId);

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

	const { accessToken, refreshToken } = await readGmailTokens(integration);

	const oauth2Client = getOAuth2Client();
	oauth2Client.setCredentials({
		access_token: accessToken,
		refresh_token: refreshToken,
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	// Auto-refresh if token is expired or about to expire (5 min buffer)
	if (integration.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
		try {
			const { credentials } = await oauth2Client.refreshAccessToken();
			await db
				.update(table.gmailIntegration)
				.set({
					accessToken: credentials.access_token!,
					accessTokenEncrypted: encryptVerified(integration.tenantId, credentials.access_token!),
					tokenExpiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
					updatedAt: new Date()
				})
				.where(eq(table.gmailIntegration.id, integration.id));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const isInvalidGrant = message.includes('invalid_grant') || message.includes('Token has been expired or revoked');

			if (isInvalidGrant) {
				logWarning('gmail', 'OAuth: Refresh token invalid/revoked — deactivating integration', { tenantId, metadata: { email: integration.email } });
				await db
					.update(table.gmailIntegration)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(table.gmailIntegration.id, integration.id));
				return null;
			}

			// Transient error — rethrow so caller can retry
			throw err;
		}
	}

	return oauth2Client;
}

/**
 * Get Gmail integration status for a tenant
 */
export async function getGmailStatus(tenantId: string) {
	logInfo('gmail', 'Checking status', { tenantId });
	const [integration] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		logInfo('gmail', 'No integration found', { tenantId });
		return { connected: false, email: null, lastSyncAt: null, isActive: false, syncEnabled: false, syncInterval: 'daily', syncParserIds: null, syncDateRangeDays: 7, lastSyncResults: null, customMonitoredEmails: null, monitoredSupplierIds: null, excludeEmails: null, hasSendScope: false };
	}

	logInfo('gmail', 'Integration found', { tenantId, metadata: { isActive: integration.isActive, email: integration.email } });
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
		excludeEmails: integration.excludeEmails ? JSON.parse(integration.excludeEmails) : null,
		hasSendScope: hasGmailSendScope(integration.grantedScopes)
	};
}

/**
 * Disconnect Gmail integration
 */
export async function disconnectGmail(tenantId: string): Promise<void> {
	logInfo('gmail', 'Disconnect: Starting', { tenantId });
	const [integration] = await db
		.select()
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration) {
		logInfo('gmail', 'Disconnect: No integration found', { tenantId });
		return;
	}

	logInfo('gmail', 'Disconnect: Found integration', { tenantId, metadata: { integrationId: integration.id, isActive: integration.isActive } });

	// Try to revoke the token
	try {
		const oauth2Client = getOAuth2Client();
		const { accessToken } = await readGmailTokens(integration);
		oauth2Client.setCredentials({ access_token: accessToken });
		await oauth2Client.revokeCredentials();
		logInfo('gmail', 'Disconnect: Token revoked successfully', { tenantId });
	} catch (err) {
		logWarning('gmail', 'Disconnect: Token revoke failed (might already be invalid)', { tenantId, stackTrace: err instanceof Error ? err.stack : undefined });
	}

	await db
		.update(table.gmailIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.gmailIntegration.id, integration.id));
	logInfo('gmail', 'Disconnect: DB updated, isActive set to false', { tenantId });

	// Auto-switch email provider back to SMTP if Gmail was the primary sender
	const [emailSettings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, tenantId))
		.limit(1);

	if (emailSettings?.emailProvider === 'gmail') {
		await db
			.update(table.emailSettings)
			.set({ emailProvider: 'smtp', updatedAt: new Date() })
			.where(eq(table.emailSettings.tenantId, tenantId));
		logInfo('gmail', 'Disconnect: auto-switched email provider from Gmail to SMTP', { tenantId });
	}

	// Clear transporter cache
	const { clearTenantTransporterCache } = await import('$lib/server/email');
	clearTenantTransporterCache(tenantId);
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
