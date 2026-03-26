import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo, logError } from '$lib/server/logger';

export interface TtCookie {
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
 * Save TikTok session cookies for an integration.
 * Cookies are encrypted with AES-256-GCM before storage.
 */
export async function saveTtSessionCookies(
	integrationId: string,
	tenantId: string,
	cookiesJson: string
): Promise<void> {
	let cookies: TtCookie[];
	try {
		cookies = JSON.parse(cookiesJson);
	} catch {
		throw new Error('Format JSON invalid pentru cookies');
	}

	if (!Array.isArray(cookies) || cookies.length === 0) {
		throw new Error('Array-ul de cookies este gol');
	}

	// Check for required TikTok cookie
	const hasSessionId = cookies.some(c => c.name === 'sessionid');
	if (!hasSessionId) {
		throw new Error('Cookies-urile trebuie să conțină cel puțin sessionid (sesiune TikTok)');
	}

	const encrypted = encrypt(tenantId, JSON.stringify(cookies));

	await db
		.update(table.tiktokAdsIntegration)
		.set({
			ttSessionCookies: encrypted,
			ttSessionStatus: 'active',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(table.tiktokAdsIntegration.id, integrationId),
				eq(table.tiktokAdsIntegration.tenantId, tenantId)
			)
		);

	logInfo('tt-cookies', 'TikTok session cookies saved', {
		tenantId,
		metadata: { integrationId, cookieCount: cookies.length }
	});
}

/**
 * Get decrypted TikTok session cookies for an integration.
 * Returns null if no cookies are stored.
 */
export async function getDecryptedTtCookies(
	integrationId: string,
	tenantId: string
): Promise<TtCookie[] | null> {
	const [integration] = await db
		.select({
			ttSessionCookies: table.tiktokAdsIntegration.ttSessionCookies,
			ttSessionStatus: table.tiktokAdsIntegration.ttSessionStatus
		})
		.from(table.tiktokAdsIntegration)
		.where(
			and(
				eq(table.tiktokAdsIntegration.id, integrationId),
				eq(table.tiktokAdsIntegration.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!integration || !integration.ttSessionCookies) {
		return null;
	}

	try {
		const decrypted = decrypt(tenantId, integration.ttSessionCookies);
		return JSON.parse(decrypted) as TtCookie[];
	} catch (err) {
		logError('tt-cookies', 'Failed to decrypt cookies', {
			tenantId,
			metadata: { integrationId, error: err instanceof Error ? err.message : String(err) }
		});
		return null;
	}
}

/**
 * Clear TikTok session for an integration.
 */
export async function clearTtSession(
	integrationId: string,
	tenantId: string
): Promise<void> {
	await db
		.update(table.tiktokAdsIntegration)
		.set({
			ttSessionCookies: null,
			ttSessionStatus: 'none',
			updatedAt: new Date()
		})
		.where(
			and(
				eq(table.tiktokAdsIntegration.id, integrationId),
				eq(table.tiktokAdsIntegration.tenantId, tenantId)
			)
		);

	logInfo('tt-cookies', 'TikTok session cleared', { tenantId, metadata: { integrationId } });
}
