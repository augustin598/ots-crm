/**
 * High-level verification pipeline for incoming WHMCS webhooks.
 *
 * Ties together the low-level hmac.ts primitives + DB lookups + Redis
 * anti-replay + decrypt retry on Turso transient reads. Endpoint handlers
 * call this once at the top and dispatch to business logic only on `ok`.
 *
 * Tenant context: webhook endpoints DO NOT have `locals.tenant` populated
 * (those requests are unauthenticated by design — the HMAC signature IS the
 * auth). This helper parses the tenant slug from the URL and header, and
 * guarantees they match before loading the DB row.
 *
 * Order of checks is security-critical. See comments inline.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { redis } from 'bun';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { logError, logWarning } from '$lib/server/logger';

import {
	verifySignature,
	TIMESTAMP_WINDOW_SECONDS,
	NONCE_TTL_SECONDS
} from './hmac';

// --- Types ---

export type Tenant = typeof table.tenant.$inferSelect;
export type WhmcsIntegration = typeof table.whmcsIntegration.$inferSelect;

/** Reason codes — logged + optionally surfaced to admin UI. Keep stable. */
export type VerifyFailReason =
	| 'missing_signature_headers'
	| 'invalid_timestamp'
	| 'stale_timestamp'
	| 'tenant_slug_mismatch'
	| 'tenant_not_found'
	| 'whmcs_integration_not_configured'
	| 'whmcs_integration_inactive'
	| 'circuit_breaker_open'
	| 'shared_secret_decrypt_failed'
	| 'signature_mismatch'
	| 'nonce_replay'
	| 'integration_disappeared_during_retry';

export type VerifyResult =
	| { ok: true; tenant: Tenant; integration: WhmcsIntegration; nonce: string; timestamp: number }
	| { ok: false; statusCode: number; reason: VerifyFailReason };

// --- Internal helpers ---

const DECRYPT_RETRY_ATTEMPTS = 2;

/**
 * Redis key for nonce anti-replay. Namespaced by tenant slug so a nonce
 * collision between tenants is impossible and so Redis scans stay scoped.
 */
function nonceKey(tenantSlug: string, nonce: string): string {
	return `${tenantSlug}:whmcs:nonce:${nonce}`;
}

/**
 * Decrypt the integration's shared secret with ONE retry on DecryptionError.
 * Turso occasionally returns truncated/partial reads that look like ciphertext
 * corruption; a fresh DB read usually resolves it (pattern from email.ts,
 * smartbill/crypto.ts, keez/factory.ts).
 */
async function decryptSecretWithRetry(
	tenantId: string,
	integrationId: string,
	firstCiphertext: string
): Promise<string> {
	let ciphertext = firstCiphertext;

	for (let attempt = 0; attempt < DECRYPT_RETRY_ATTEMPTS; attempt++) {
		try {
			return decrypt(tenantId, ciphertext);
		} catch (error) {
			if (!(error instanceof DecryptionError)) {
				throw error; // non-transient: do not retry
			}

			if (attempt === DECRYPT_RETRY_ATTEMPTS - 1) {
				throw error; // out of retries
			}

			logWarning(
				'whmcs',
				'Shared secret decrypt failed, retrying with fresh DB read (possible Turso transient)',
				{ tenantId, metadata: { attempt, integrationId } }
			);

			const fresh = await db
				.select({ sharedSecret: table.whmcsIntegration.sharedSecret })
				.from(table.whmcsIntegration)
				.where(eq(table.whmcsIntegration.id, integrationId))
				.get();

			if (!fresh) {
				// Row disappeared mid-request; surface as permanent failure.
				throw new Error('integration_disappeared_during_retry');
			}

			ciphertext = fresh.sharedSecret;
		}
	}

	// Unreachable — loop either returns or throws.
	throw new Error('decryptSecretWithRetry: exhausted loop without outcome');
}

/**
 * Claim the nonce atomically (`SET key 1 NX EX ttl`). Returns true if we
 * are the first to see this nonce within the TTL window, false if it was
 * already claimed (= replay). Swallows Redis errors: if Redis is down we
 * fail open on the nonce check (HMAC still holds), but log loudly.
 */
async function claimNonce(tenantSlug: string, nonce: string): Promise<boolean> {
	const key = nonceKey(tenantSlug, nonce);
	try {
		const result = await redis.send('SET', [key, '1', 'NX', 'EX', String(NONCE_TTL_SECONDS)]);
		// Bun's redis returns "OK" on success, null when NX condition fails.
		return result === 'OK';
	} catch (err) {
		logError('whmcs', 'Redis nonce claim failed — allowing request (HMAC still enforced)', {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		return true;
	}
}

// --- Public API ---

/**
 * Run the full verification pipeline. Returns a discriminated union so the
 * caller can `if (!result.ok) return new Response(..., { status: result.statusCode })`.
 *
 * IMPORTANT: the `rawBody` argument MUST be the exact bytes the client sent
 * (e.g. `await event.request.text()`), NOT a re-serialization of the parsed
 * JSON object. Any whitespace difference breaks the HMAC.
 */
export async function verifyWhmcsWebhook(
	event: RequestEvent,
	rawBody: string
): Promise<VerifyResult> {
	// 1. Required headers present?
	const timestampStr = event.request.headers.get('X-OTS-Timestamp');
	const signature = event.request.headers.get('X-OTS-Signature');
	const tenantSlug = event.request.headers.get('X-OTS-Tenant');
	const nonce = event.request.headers.get('X-OTS-Nonce');

	if (!timestampStr || !signature || !tenantSlug || !nonce) {
		return { ok: false, statusCode: 401, reason: 'missing_signature_headers' };
	}

	// 2. Timestamp is a fresh integer within the tolerance window?
	const timestamp = parseInt(timestampStr, 10);
	if (!Number.isFinite(timestamp)) {
		return { ok: false, statusCode: 401, reason: 'invalid_timestamp' };
	}

	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - timestamp) > TIMESTAMP_WINDOW_SECONDS) {
		return { ok: false, statusCode: 401, reason: 'stale_timestamp' };
	}

	// 3. Belt + suspenders: URL path tenant MUST match header tenant.
	//    The tenantId is also cryptographically bound via the signature canonical
	//    payload, but checking here lets us reject mismatches before hitting DB.
	const urlSlug = event.params.tenant;
	if (!urlSlug || urlSlug !== tenantSlug) {
		return { ok: false, statusCode: 401, reason: 'tenant_slug_mismatch' };
	}

	// 4. Resolve tenant by slug.
	const tenantRow = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.get();

	if (!tenantRow) {
		return { ok: false, statusCode: 401, reason: 'tenant_not_found' };
	}

	// 5. WHMCS integration configured + active + breaker closed?
	const integration = await db
		.select()
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantRow.id))
		.get();

	if (!integration) {
		return { ok: false, statusCode: 401, reason: 'whmcs_integration_not_configured' };
	}

	if (!integration.isActive) {
		return { ok: false, statusCode: 401, reason: 'whmcs_integration_inactive' };
	}

	if (
		integration.circuitBreakerUntil &&
		integration.circuitBreakerUntil.getTime() > Date.now()
	) {
		return { ok: false, statusCode: 503, reason: 'circuit_breaker_open' };
	}

	// 6. Decrypt shared secret with retry on Turso transients.
	let sharedSecret: string;
	try {
		sharedSecret = await decryptSecretWithRetry(
			tenantRow.id,
			integration.id,
			integration.sharedSecret
		);
	} catch (error) {
		if (error instanceof Error && error.message === 'integration_disappeared_during_retry') {
			return { ok: false, statusCode: 500, reason: 'integration_disappeared_during_retry' };
		}
		logError('whmcs', 'Shared secret decryption failed permanently', {
			tenantId: tenantRow.id,
			metadata: {
				integrationId: integration.id,
				error: error instanceof Error ? error.message : String(error)
			}
		});
		return { ok: false, statusCode: 500, reason: 'shared_secret_decrypt_failed' };
	}

	// 7. HMAC signature verify. Done BEFORE nonce claim so a forged request
	//    cannot burn through nonces for a tenant (forcing false replays on
	//    legitimate requests).
	const signatureOk = verifySignature(
		sharedSecret,
		timestamp,
		event.request.method,
		event.url.pathname,
		tenantSlug,
		nonce,
		rawBody,
		signature
	);

	if (!signatureOk) {
		return { ok: false, statusCode: 401, reason: 'signature_mismatch' };
	}

	// 8. Anti-replay: claim the nonce. This is the last gate — a request that
	//    reaches here has a valid signature, so "already claimed" means the
	//    sender is retrying or an attacker captured a legitimate request.
	const claimed = await claimNonce(tenantSlug, nonce);
	if (!claimed) {
		return { ok: false, statusCode: 401, reason: 'nonce_replay' };
	}

	return { ok: true, tenant: tenantRow, integration, nonce, timestamp };
}
