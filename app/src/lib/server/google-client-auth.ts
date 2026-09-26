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
 * 'login' (implicit): emailul trebuie să fie deja al unui client — altfel
 * callback-ul trimite la /signup. 'signup': la „no-match" callback-ul creează
 * contul de hosting (vezi portal-signup.ts) și deschide sesiunea pe el.
 */
export type GoogleLoginMode = 'login' | 'signup';

/** Ce ducem prin `state` la Google și înapoi. Nu e semnat — nonce-ul din cookie e CSRF-ul. */
export type GoogleState = {
	tenantSlug: string;
	nonce: string;
	mode: GoogleLoginMode;
	returnTo: string | null;
};

const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s: string) => {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	return b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
};

export function encodeState(state: GoogleState): string {
	return toUrlSafe(btoa(JSON.stringify(state)));
}

/**
 * Decode + validare de formă. State-urile vechi (doar tenantSlug + nonce) rămân
 * valide: mode 'login', fără returnTo.
 */
export function decodeState(raw: string): GoogleState {
	const parsed = JSON.parse(atob(fromUrlSafe(raw)));
	if (typeof parsed.tenantSlug !== 'string' || typeof parsed.nonce !== 'string') {
		throw new Error('Invalid state: missing tenantSlug or nonce');
	}
	return {
		tenantSlug: parsed.tenantSlug,
		nonce: parsed.nonce,
		mode: parsed.mode === 'signup' ? 'signup' : 'login',
		returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : null
	};
}

/** Alias păstrat pentru callback-ul existent. */
export const parseState = decodeState;

/**
 * Unde trimitem clientul după login: doar căi din portalul tenantului curent —
 * fără scheme, fără `//host`, fără alt tenant (anti open-redirect).
 */
export function safePortalReturnTo(tenantSlug: string, raw: string | null | undefined): string | null {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
	return raw.startsWith(`/client/${tenantSlug}/`) ? raw : null;
}

/**
 * Generate Google OAuth2 login URL for client portal
 */
export function generateGoogleLoginUrl(
	tenantSlug: string,
	opts: { mode?: GoogleLoginMode; returnTo?: string | null } = {}
): { url: string; nonce: string } {
	const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
	const nonce = toUrlSafe(btoa(String.fromCharCode(...nonceBytes)));

	const state = encodeState({
		tenantSlug,
		nonce,
		mode: opts.mode ?? 'login',
		returnTo: safePortalReturnTo(tenantSlug, opts.returnTo)
	});

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
