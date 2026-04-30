import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { and, eq, isNull, gt, or } from 'drizzle-orm';
import type { ApiKeyScope } from '$lib/server/db/schema';

export interface ApiKeyContext {
	tenantId: string;
	apiKeyId: string;
	scopes: Set<ApiKeyScope>;
}

export class ApiKeyAuthError extends Error {
	constructor(
		public status: 401 | 403,
		public code: 'missing_key' | 'invalid_key' | 'revoked' | 'expired' | 'scope_denied',
		message: string
	) {
		super(message);
		this.name = 'ApiKeyAuthError';
	}
}

export function hashApiKey(plaintext: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(plaintext)));
}

/**
 * Verify an API key from the X-API-Key header and check it has the required scope.
 * Updates lastUsedAt asynchronously (fire-and-forget).
 *
 * @throws ApiKeyAuthError on any auth failure (401 or 403).
 */
export async function authenticateApiKey(
	headerValue: string | null | undefined,
	requiredScope: ApiKeyScope
): Promise<ApiKeyContext> {
	if (!headerValue || typeof headerValue !== 'string' || headerValue.length < 16) {
		throw new ApiKeyAuthError(401, 'missing_key', 'Missing or malformed X-API-Key header');
	}

	const keyHash = hashApiKey(headerValue.trim());
	const now = new Date();

	const [row] = await db
		.select()
		.from(table.apiKey)
		.where(eq(table.apiKey.keyHash, keyHash))
		.limit(1);

	if (!row) {
		throw new ApiKeyAuthError(401, 'invalid_key', 'Invalid API key');
	}
	if (row.revokedAt) {
		throw new ApiKeyAuthError(401, 'revoked', 'API key has been revoked');
	}
	if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) {
		throw new ApiKeyAuthError(401, 'expired', 'API key has expired');
	}

	let scopes: ApiKeyScope[];
	try {
		const parsed = JSON.parse(row.scopes);
		scopes = Array.isArray(parsed) ? (parsed as ApiKeyScope[]) : [];
	} catch {
		scopes = [];
	}
	const scopeSet = new Set(scopes);

	if (!scopeSet.has(requiredScope)) {
		throw new ApiKeyAuthError(
			403,
			'scope_denied',
			`API key missing required scope: ${requiredScope}`
		);
	}

	void db
		.update(table.apiKey)
		.set({ lastUsedAt: now })
		.where(eq(table.apiKey.id, row.id))
		.execute()
		.catch(() => {});

	return {
		tenantId: row.tenantId,
		apiKeyId: row.id,
		scopes: scopeSet
	};
}

/**
 * Build a JSON Response from an ApiKeyAuthError.
 */
export function apiKeyAuthErrorResponse(err: ApiKeyAuthError): Response {
	return new Response(
		JSON.stringify({
			error: err.code,
			message: err.message
		}),
		{
			status: err.status,
			headers: { 'Content-Type': 'application/json' }
		}
	);
}

void or;
void and;
void isNull;
void gt;
