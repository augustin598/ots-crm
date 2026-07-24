import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from './crypto';
import { createClaudeClient, type ClaudeClient } from './client';
import { getPluginRegistry } from '../registry';
import type { ClaudeKeyType } from './key-utils';

export type { ClaudeClient } from './client';

async function readRow(tenantId: string) {
	const [row] = await db
		.select()
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

/**
 * Întoarce un ClaudeClient pentru tenant, sau null dacă:
 *  - plugin-ul „claude" nu e activ pentru tenant, SAU
 *  - nu există rând de credențiale / e inactiv.
 * Decriptarea reîncearcă o dată cu citire proaspătă din DB (Turso transient reads).
 */
export async function getClaudeClient(tenantId: string): Promise<ClaudeClient | null> {
	const registry = getPluginRegistry();
	const active = await registry.isPluginActiveForTenant(tenantId, 'claude');
	if (!active) return null;

	let row = await readRow(tenantId);
	if (!row || !row.isActive) return null;

	let key: string;
	try {
		key = decrypt(tenantId, row.apiKeyEncrypted);
	} catch (e) {
		if (e instanceof DecryptionError) {
			row = await readRow(tenantId);
			if (!row || !row.isActive) return null;
			key = decrypt(tenantId, row.apiKeyEncrypted);
		} else {
			throw e;
		}
	}

	return createClaudeClient({
		apiKey: key,
		keyType: row.keyType as ClaudeKeyType,
		defaultModel: row.defaultModel
	});
}
