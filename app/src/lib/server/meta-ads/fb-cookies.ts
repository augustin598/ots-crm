import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo, logError } from '$lib/server/logger';

export interface FbCookie {
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
 * Save Facebook session cookies for a Meta Ads integration.
 * Cookies are encrypted with AES-256-GCM before storage.
 */
export async function saveFbSessionCookies(
	integrationId: string,
	tenantId: string,
	cookiesJson: string
): Promise<void> {
	// Validate JSON
	let cookies: FbCookie[];
	try {
		cookies = JSON.parse(cookiesJson);
	} catch {
		throw new Error('Format JSON invalid pentru cookies');
	}

	if (!Array.isArray(cookies) || cookies.length === 0) {
		throw new Error('Array-ul de cookies este gol');
	}

	// Check for required Facebook cookies
	const hasCUser = cookies.some(c => c.name === 'c_user');
	const hasXsToken = cookies.some(c => c.name === 'xs');
	if (!hasCUser || !hasXsToken) {
		throw new Error('Cookies-urile trebuie să conțină cel puțin c_user și xs (sesiune Facebook)');
	}

	const encrypted = encrypt(tenantId, JSON.stringify(cookies));

	await db
		.update(table.metaAdsIntegration)
		.set({
			fbSessionCookies: encrypted,
			fbSessionStatus: 'active',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(table.metaAdsIntegration.id, integrationId),
				eq(table.metaAdsIntegration.tenantId, tenantId)
			)
		);

	logInfo('fb-cookies', 'Facebook session cookies saved', {
		tenantId,
		metadata: { integrationId, cookieCount: cookies.length }
	});
}

/**
 * Get decrypted Facebook session cookies for an integration.
 * Returns null if no cookies are stored or status is 'none'.
 */
export async function getDecryptedFbCookies(
	integrationId: string,
	tenantId: string
): Promise<FbCookie[] | null> {
	const [integration] = await db
		.select({
			fbSessionCookies: table.metaAdsIntegration.fbSessionCookies,
			fbSessionStatus: table.metaAdsIntegration.fbSessionStatus
		})
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.id, integrationId),
				eq(table.metaAdsIntegration.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!integration || !integration.fbSessionCookies || integration.fbSessionStatus === 'none') {
		return null;
	}

	try {
		const decrypted = decrypt(tenantId, integration.fbSessionCookies);
		return JSON.parse(decrypted) as FbCookie[];
	} catch (err) {
		logError('fb-cookies', 'Failed to decrypt cookies', {
			tenantId,
			metadata: { integrationId, error: err instanceof Error ? err.message : String(err) }
		});
		return null;
	}
}

/**
 * Clear Facebook session for an integration.
 */
export async function clearFbSession(
	integrationId: string,
	tenantId: string
): Promise<void> {
	await db
		.update(table.metaAdsIntegration)
		.set({
			fbSessionCookies: null,
			fbSessionStatus: 'none',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(table.metaAdsIntegration.id, integrationId),
				eq(table.metaAdsIntegration.tenantId, tenantId)
			)
		);

	logInfo('fb-cookies', 'Facebook session cleared', { tenantId, metadata: { integrationId } });
}
