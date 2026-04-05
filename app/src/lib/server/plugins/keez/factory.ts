import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { KeezClient } from './client';
import { decrypt, encryptVerified, DecryptionError } from './crypto';
import { logInfo, logError } from '$lib/server/logger';

/**
 * Thrown when stored Keez credentials cannot be decrypted.
 * Callers should catch this to show a user-friendly re-auth prompt instead of a 500.
 */
export class KeezCredentialsCorruptError extends Error {
	public readonly requiresReauth = true;

	constructor(tenantId: string, cause?: unknown) {
		super(
			`Keez credentials for tenant ${tenantId} are corrupted or were encrypted with a different key. ` +
			`Please re-save your Keez integration in Settings.`
		);
		this.name = 'KeezCredentialsCorruptError';
		this.cause = cause;
	}
}

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
	let secret: string;
	try {
		secret = decrypt(tenantId, integration.secret);
	} catch (error) {
		if (error instanceof DecryptionError) {
			throw new KeezCredentialsCorruptError(tenantId, error);
		}
		throw new Error(
			`Failed to decrypt Keez secret for tenant ${tenantId}. ` +
			`Original: ${error instanceof Error ? error.message : error}`
		);
	}

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
			try {
				const encryptedToken = encryptVerified(tenantId, token);
				await db
					.update(table.keezIntegration)
					.set({ accessToken: encryptedToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
					.where(eq(table.keezIntegration.tenantId, tenantId));
				logInfo('keez', `Token refreshed and persisted to DB`, { tenantId });
			} catch (error) {
				logError('keez', 'Failed to persist refreshed token to DB', {
					tenantId,
					metadata: { error: error instanceof Error ? error.message : String(error) }
				});
			}
		}
	});
}
