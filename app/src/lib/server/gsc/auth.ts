// OAuth Google Search Console per tenant. Tiparul e cel din `google-ads/auth.ts`,
// cu o singură diferență: tokenii se scriu DOAR criptați (tabel nou, fără istoric
// în clar de migrat). Scope-ul e readonly — nu scriem nimic în contul clientului.
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { encryptVerified, decrypt } from '$lib/server/plugins/smartbill/crypto';

const CALLBACK_PATH = '/api/gsc/callback';

/** Doar citire: nu adăugăm și nu ștergem nimic din Search Console-ul clientului. */
const SCOPES = [
	'https://www.googleapis.com/auth/webmasters.readonly',
	'https://www.googleapis.com/auth/userinfo.email'
];

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function getAppOrigin(requestOrigin: string): string {
	return env.PUBLIC_APP_URL || requestOrigin;
}

function getOAuth2Client(redirectUri: string) {
	return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

/** `state` = „tenantId:tenantSlug", ca la Google Ads. */
export function getOAuthUrl(state: string, origin: string): string {
	const redirectUri = `${getAppOrigin(origin)}${CALLBACK_PATH}`;
	const url = getOAuth2Client(redirectUri).generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES,
		prompt: 'consent',
		state
	});
	logInfo('gsc', 'OAuth: URL generat', { metadata: { redirectUri } });
	return url;
}

/** Schimbă codul pe tokeni și salvează integrarea (upsert pe tenant). */
export async function handleCallback(
	code: string,
	tenantId: string,
	origin: string
): Promise<{ email: string }> {
	const redirectUri = `${getAppOrigin(origin)}${CALLBACK_PATH}`;
	const client = getOAuth2Client(redirectUri);
	const { tokens } = await client.getToken(code);

	if (!tokens.access_token || !tokens.refresh_token) {
		// Fără refresh_token nu putem trage zilnic. Se întâmplă când userul a mai dat
		// consimțământ o dată; `prompt: 'consent'` de mai sus îl forțează să reapară.
		throw new Error('Google nu a întors refresh_token — reîncearcă autorizarea');
	}

	client.setCredentials(tokens);
	const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
	const email = data.email ?? '';
	const now = new Date();
	const expiresAt = new Date(tokens.expiry_date ?? now.getTime() + 3600_000);

	const values = {
		email,
		accessTokenEncrypted: encryptVerified(tenantId, tokens.access_token),
		refreshTokenEncrypted: encryptVerified(tenantId, tokens.refresh_token),
		tokenExpiresAt: expiresAt,
		isActive: true,
		lastError: null,
		updatedAt: now
	};

	const [existing] = await db
		.select({ id: table.gscIntegration.id })
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);

	if (existing) {
		await db
			.update(table.gscIntegration)
			.set(values)
			.where(eq(table.gscIntegration.id, existing.id));
	} else {
		await db
			.insert(table.gscIntegration)
			.values({ id: generateId(), tenantId, ...values, createdAt: now });
	}

	logInfo('gsc', 'OAuth: integrare salvată', { tenantId, metadata: { email } });
	return { email };
}

/**
 * Client OAuth gata de folosit, cu tokenii tenantului. `googleapis` reîmprospătează
 * singur access_token-ul din refresh_token; ascultăm evenimentul ca să persistăm
 * tokenul nou, altfel l-am reface la fiecare apel.
 */
export async function getAuthenticatedClient(tenantId: string) {
	const [integration] = await db
		.select()
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.tenantId, tenantId))
		.limit(1);

	if (!integration || !integration.isActive) {
		throw new Error('Search Console nu este conectat pentru acest cont');
	}

	const client = getOAuth2Client(`${getAppOrigin('')}${CALLBACK_PATH}`);
	client.setCredentials({
		access_token: decrypt(tenantId, integration.accessTokenEncrypted),
		refresh_token: decrypt(tenantId, integration.refreshTokenEncrypted),
		expiry_date: integration.tokenExpiresAt.getTime()
	});

	client.on('tokens', (fresh) => {
		if (!fresh.access_token) return;
		db.update(table.gscIntegration)
			.set({
				accessTokenEncrypted: encryptVerified(tenantId, fresh.access_token),
				tokenExpiresAt: new Date(fresh.expiry_date ?? Date.now() + 3600_000),
				updatedAt: new Date()
			})
			.where(eq(table.gscIntegration.id, integration.id))
			.catch((err) => {
				logWarning('gsc', 'Nu am putut salva access_token-ul reîmprospătat', {
					tenantId,
					metadata: serializeError(err)
				});
			});
	});

	return client;
}
