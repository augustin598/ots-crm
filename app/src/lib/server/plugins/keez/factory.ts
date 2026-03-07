import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { KeezClient } from './client';
import { decrypt, encrypt } from './crypto';
import { logInfo } from '$lib/server/logger';

interface IntegrationCredentials {
	clientEid: string;
	applicationId: string;
	secret: string; // encrypted
	accessToken?: string | null; // encrypted, may be absent
	tokenExpiresAt?: Date | null;
}

/**
 * Creates a KeezClient with DB-backed token caching.
 * - Loads cached token from DB (if present and valid) to avoid extra auth requests
 * - Persists new tokens back to DB after refresh
 */
export async function createKeezClientForTenant(
	tenantId: string,
	integration: IntegrationCredentials
): Promise<KeezClient> {
	const secret = decrypt(tenantId, integration.secret);

	// Try to load cached token from DB
	let cachedTokenData: { token: string; expiresAt: Date } | undefined;
	if (integration.accessToken && integration.tokenExpiresAt) {
		try {
			const decryptedToken = decrypt(tenantId, integration.accessToken);
			cachedTokenData = { token: decryptedToken, expiresAt: integration.tokenExpiresAt };
		} catch {
			// Cached token is invalid, will fetch fresh one
		}
	}

	return new KeezClient({
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		secret,
		cachedTokenData,
		onTokenRefreshed: async (token: string, expiresAt: Date) => {
			const encryptedToken = encrypt(tenantId, token);
			await db
				.update(table.keezIntegration)
				.set({ accessToken: encryptedToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
				.where(eq(table.keezIntegration.tenantId, tenantId));
			logInfo('keez', `Token refreshed and persisted to DB`, { tenantId });
		}
	});
}
