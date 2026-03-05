import { google } from 'googleapis';
import { env } from '$env/dynamic/private';

const SCOPES = ['openid', 'email', 'profile'];

function getOAuth2Client() {
	return new google.auth.OAuth2(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		env.GOOGLE_CLIENT_LOGIN_REDIRECT_URI
	);
}

/**
 * Generate Google OAuth2 login URL for client portal
 */
export function generateGoogleLoginUrl(tenantSlug: string): { url: string; nonce: string } {
	const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
	const nonce = btoa(String.fromCharCode(...nonceBytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

	const statePayload = JSON.stringify({ tenantSlug, nonce });
	const state = btoa(statePayload)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

	const oauth2Client = getOAuth2Client();
	const url = oauth2Client.generateAuthUrl({
		access_type: 'online',
		scope: SCOPES,
		state,
		prompt: 'select_account'
	});

	return { url, nonce };
}

/**
 * Exchange OAuth code for user email
 */
export async function exchangeCodeForEmail(code: string): Promise<{ email: string; name?: string }> {
	const oauth2Client = getOAuth2Client();
	const { tokens } = await oauth2Client.getToken(code);
	oauth2Client.setCredentials(tokens);

	const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
	const { data } = await oauth2.userinfo.get();

	if (!data.email) {
		throw new Error('Google account has no email');
	}

	if (data.verified_email === false) {
		throw new Error('Google email is not verified');
	}

	return { email: data.email, name: data.name || undefined };
}

/**
 * Parse and decode the state parameter from Google callback
 */
export function parseState(stateParam: string): { tenantSlug: string; nonce: string } {
	const base64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
	const decoded = atob(padded);
	const parsed = JSON.parse(decoded);

	if (typeof parsed.tenantSlug !== 'string' || typeof parsed.nonce !== 'string') {
		throw new Error('Invalid state: missing tenantSlug or nonce');
	}

	return { tenantSlug: parsed.tenantSlug, nonce: parsed.nonce };
}
