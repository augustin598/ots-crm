import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { and, eq } from 'drizzle-orm';
import type { ApiKeyScope } from '$lib/server/db/schema';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function generateSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return encodeHexLowerCase(bytes); // 48 hex chars
}

function hashSecret(secret: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(secret)));
}

export interface CreateApiKeyInput {
	tenantId: string;
	tenantSlug: string;
	name: string;
	scopes: ApiKeyScope[];
	createdByUserId: string;
	expiresAt?: Date;
}

export interface CreateApiKeyResult {
	id: string;
	plaintext: string; // shown ONCE; never stored
	prefix: string;
}

/**
 * Create a new API key for a tenant. Returns the plaintext key — caller
 * MUST surface it to the user immediately and never store it server-side.
 *
 * Format: ots_<tenantSlug>_<48hex>
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
	const id = generateId();
	const secret = generateSecret();
	const slugPart = input.tenantSlug
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.slice(0, 24);
	const plaintext = `ots_${slugPart}_${secret}`;
	const keyHash = hashSecret(plaintext);
	const keyPrefix = plaintext.slice(0, 12); // e.g. "ots_acme_a1b" — display only

	await db.insert(table.apiKey).values({
		id,
		tenantId: input.tenantId,
		name: input.name,
		keyPrefix,
		keyHash,
		scopes: JSON.stringify(input.scopes),
		createdByUserId: input.createdByUserId,
		expiresAt: input.expiresAt ?? null
	});

	return { id, plaintext, prefix: keyPrefix };
}

/**
 * Soft-revoke an API key. Subsequent auth attempts return 401 'revoked'.
 */
export async function revokeApiKey(id: string, tenantId: string): Promise<void> {
	await db
		.update(table.apiKey)
		.set({ revokedAt: new Date() })
		.where(and(eq(table.apiKey.id, id), eq(table.apiKey.tenantId, tenantId)));
}

export interface ApiKeyListItem {
	id: string;
	name: string;
	keyPrefix: string;
	scopes: ApiKeyScope[];
	lastUsedAt: Date | null;
	createdAt: Date;
	revokedAt: Date | null;
	expiresAt: Date | null;
}

/**
 * List all API keys for a tenant (active and revoked). Plaintext is never returned.
 */
export async function listApiKeys(tenantId: string): Promise<ApiKeyListItem[]> {
	const rows = await db
		.select()
		.from(table.apiKey)
		.where(eq(table.apiKey.tenantId, tenantId))
		.orderBy(table.apiKey.createdAt);

	return rows.map((r) => {
		let scopes: ApiKeyScope[];
		try {
			const parsed = JSON.parse(r.scopes);
			scopes = Array.isArray(parsed) ? (parsed as ApiKeyScope[]) : [];
		} catch {
			scopes = [];
		}
		return {
			id: r.id,
			name: r.name,
			keyPrefix: r.keyPrefix,
			scopes,
			lastUsedAt: r.lastUsedAt,
			createdAt: r.createdAt,
			revokedAt: r.revokedAt,
			expiresAt: r.expiresAt
		};
	});
}
