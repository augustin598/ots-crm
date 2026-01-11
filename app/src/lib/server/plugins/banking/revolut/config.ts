/**
 * Internal utility functions for Revolut integration
 * Server-side only - not exposed as remote functions
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decryptToken } from '../shared/crypto';

/**
 * Get Revolut configuration for use by RevolutClient (internal use)
 * Returns decrypted private key
 */
export async function getRevolutConfigForClient(tenantId: string): Promise<{
	clientId: string;
	privateKey: string;
	redirectUri: string;
} | null> {
	const [config] = await db
		.select()
		.from(table.revolutIntegration)
		.where(eq(table.revolutIntegration.tenantId, tenantId))
		.limit(1);

	if (!config || !config.isActive) {
		return null;
	}

	if (!config.clientId || !config.redirectUri) {
		return null; // Configuration incomplete
	}

	try {
		const privateKey = decryptToken(tenantId, config.privateKey);
		return {
			clientId: config.clientId,
			privateKey: privateKey,
			redirectUri: config.redirectUri
		};
	} catch (error) {
		throw new Error('Failed to decrypt Revolut private key');
	}
}
