import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo, logError } from '$lib/server/logger';

export interface GoogleAdsCookie {
	name: string;
	value: string;
	domain: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: string;
}

/**
 * Save Google session cookies for a Google Ads integration.
 * Cookies are encrypted with AES-256-GCM before storage.
 */
export async function saveGoogleSessionCookies(
	integrationId: string,
	tenantId: string,
	cookiesJson: string
): Promise<void> {
	let cookies: GoogleAdsCookie[];
	try {
		cookies = JSON.parse(cookiesJson);
	} catch {
		throw new Error('Format JSON invalid pentru cookies');
	}

	if (!Array.isArray(cookies) || cookies.length === 0) {
		throw new Error('Array-ul de cookies este gol');
	}

	// Check for required Google cookies
	const hasSID = cookies.some(c => c.name === 'SID');
	const hasSecurePSID = cookies.some(c => c.name === '__Secure-1PSID');
	if (!hasSID || !hasSecurePSID) {
		throw new Error('Cookies-urile trebuie să conțină cel puțin SID și __Secure-1PSID (sesiune Google)');
	}

	const encrypted = encrypt(tenantId, JSON.stringify(cookies));

	await db
		.update(table.googleAdsIntegration)
		.set({
			googleSessionCookies: encrypted,
			googleSessionStatus: 'active',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(table.googleAdsIntegration.id, integrationId),
				eq(table.googleAdsIntegration.tenantId, tenantId)
			)
		);

	logInfo('google-cookies', 'Google session cookies saved', {
		tenantId,
		metadata: { integrationId, cookieCount: cookies.length }
	});
}

/**
 * Get decrypted Google session cookies for an integration.
 * Returns null if no cookies are stored or status is 'none'.
 */
export async function getDecryptedGoogleCookies(
	integrationId: string,
	tenantId: string
): Promise<GoogleAdsCookie[] | null> {
	const [integration] = await db
		.select({
			googleSessionCookies: table.googleAdsIntegration.googleSessionCookies,
			googleSessionStatus: table.googleAdsIntegration.googleSessionStatus
		})
		.from(table.googleAdsIntegration)
		.where(
			and(
				eq(table.googleAdsIntegration.id, integrationId),
				eq(table.googleAdsIntegration.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!integration || !integration.googleSessionCookies || integration.googleSessionStatus === 'none') {
		return null;
	}

	try {
		const decrypted = decrypt(tenantId, integration.googleSessionCookies);
		return JSON.parse(decrypted) as GoogleAdsCookie[];
	} catch (err) {
		logError('google-cookies', 'Failed to decrypt cookies', {
			tenantId,
			metadata: { integrationId, error: err instanceof Error ? err.message : String(err) }
		});
		return null;
	}
}

/**
 * Clear Google session for an integration.
 */
export async function clearGoogleSession(
	integrationId: string,
	tenantId: string
): Promise<void> {
	await db
		.update(table.googleAdsIntegration)
		.set({
			googleSessionCookies: null,
			googleSessionStatus: 'none',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(table.googleAdsIntegration.id, integrationId),
				eq(table.googleAdsIntegration.tenantId, tenantId)
			)
		);

	logInfo('google-cookies', 'Google session cleared', { tenantId, metadata: { integrationId } });
}
