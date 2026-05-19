import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { encryptVerified, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SCOPES = [SCOPE];

export class CalendarNotConnected extends Error {
	constructor(tenantId: string) {
		super(`Tenant ${tenantId} has no active Google Calendar integration`);
		this.name = 'CalendarNotConnected';
	}
}

export type CalendarStatus = {
	connected: boolean;
	email: string | null;
};

/**
 * Resolve the Calendar OAuth callback URL.
 *
 * Priority:
 *  1. Explicit `GOOGLE_REDIRECT_URI_CALENDAR` env var (set this in production)
 *  2. Auto-derived from `GOOGLE_REDIRECT_URI` (Gmail's URI) — replaces the path
 *     so origin stays the same. Avoids the fallback bug where Calendar OAuth
 *     accidentally redirects to Gmail's callback.
 *
 * Both URIs (Gmail's + Calendar's) must be registered in Google Cloud Console
 * → APIs & Services → Credentials → OAuth Client → Authorized redirect URIs.
 */
function getCalendarRedirectUri(): string {
	const explicit = env.GOOGLE_REDIRECT_URI_CALENDAR;
	if (explicit) return explicit;

	const gmail = env.GOOGLE_REDIRECT_URI;
	if (!gmail) {
		throw new Error(
			'GOOGLE_REDIRECT_URI_CALENDAR or GOOGLE_REDIRECT_URI must be set for Calendar OAuth'
		);
	}

	try {
		const u = new URL(gmail);
		return `${u.origin}/api/integrations/google-calendar/callback`;
	} catch {
		throw new Error(`GOOGLE_REDIRECT_URI is not a valid URL: ${gmail}`);
	}
}

function getOAuth2Client() {
	return new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		getCalendarRedirectUri()
	);
}

function generateId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Cheap status check — used by UI to decide which banner to show. Never throws.
 */
export async function getCalendarStatus(tenantId: string): Promise<CalendarStatus> {
	const [integration] = await db
		.select({
			email: table.googleCalendarIntegration.email,
			isActive: table.googleCalendarIntegration.isActive
		})
		.from(table.googleCalendarIntegration)
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		return { connected: false, email: null };
	}
	return { connected: true, email: integration.email };
}

/**
 * Build an authenticated Calendar API client for a tenant.
 * Throws CalendarNotConnected if no active integration.
 */
export async function getCalendarClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.googleCalendarIntegration)
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		throw new CalendarNotConnected(tenantId);
	}

	let accessToken: string;
	let refreshToken: string;

	try {
		accessToken = decrypt(tenantId, integration.accessTokenEncrypted);
	} catch (err) {
		logWarning('google-calendar', 'accessToken decrypt failed', {
			tenantId,
			metadata: { error: serializeError(err) }
		});
		throw new Error('Calendar token decrypt failed; reconnect required');
	}

	try {
		refreshToken = decrypt(tenantId, integration.refreshTokenEncrypted);
	} catch (err) {
		logWarning('google-calendar', 'refreshToken decrypt failed', {
			tenantId,
			metadata: { error: serializeError(err) }
		});
		throw new Error('Calendar token decrypt failed; reconnect required');
	}

	const oauth2Client = getOAuth2Client();
	oauth2Client.setCredentials({
		access_token: accessToken,
		refresh_token: refreshToken,
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	logInfo('google-calendar', 'Calendar client built', {
		tenantId,
		metadata: { email: integration.email }
	});

	return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Build the Google OAuth consent URL for connecting Calendar.
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
	logInfo('google-calendar', 'OAuth: Generated auth URL', { tenantId });
	return url;
}

/**
 * Exchange authorization code for tokens and persist as integration row.
 * Upserts: deletes any existing row for this tenant first.
 */
export async function exchangeCodeAndSave(
	tenantId: string,
	code: string
): Promise<{ email: string }> {
	const oauth2Client = getOAuth2Client();
	const { tokens } = await oauth2Client.getToken(code);

	if (!tokens.access_token || !tokens.refresh_token) {
		throw new Error('Google did not return tokens (missing access_token or refresh_token)');
	}

	oauth2Client.setCredentials(tokens);

	// Fetch user info to get email
	const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
	const userInfo = await oauth2.userinfo.get();
	const email = userInfo.data.email;
	if (!email) throw new Error('Google did not return user email');

	const accessTokenEnc = encryptVerified(tenantId, tokens.access_token);
	const refreshTokenEnc = encryptVerified(tenantId, tokens.refresh_token);
	const tokenExpiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);
	const grantedScopes = JSON.stringify(tokens.scope?.split(' ') ?? SCOPES);

	// Delete-then-insert (one integration per tenant)
	await db
		.delete(table.googleCalendarIntegration)
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId));

	await db.insert(table.googleCalendarIntegration).values({
		id: generateId(),
		tenantId,
		email,
		accessTokenEncrypted: accessTokenEnc,
		refreshTokenEncrypted: refreshTokenEnc,
		tokenExpiresAt,
		isActive: true,
		grantedScopes
	});

	logInfo('google-calendar', 'OAuth: Integration saved', { tenantId, metadata: { email } });
	return { email };
}

/**
 * Soft-delete the Calendar integration for a tenant.
 */
export async function disconnectCalendar(tenantId: string): Promise<void> {
	await db
		.update(table.googleCalendarIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.googleCalendarIntegration.tenantId, tenantId));

	logInfo('google-calendar', 'Calendar integration disconnected', { tenantId });
}
