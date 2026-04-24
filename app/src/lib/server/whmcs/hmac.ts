import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'crypto';

/**
 * HMAC signing + verification for WHMCS ↔ OTS CRM webhooks.
 *
 * Canonical payload — MUST match the PHP side of `ots_crm_connector`:
 *
 *     `${timestamp}\n${METHOD}\n${urlPath}\n${tenantId}\n${nonce}\n${body}`
 *
 * Differences vs `src/lib/server/wordpress/hmac.ts`:
 *   - `tenantId` is baked into the signature → an attacker flipping the
 *     `X-OTS-Tenant` header to replay Tenant A's request against Tenant B
 *     causes signature mismatch (closes Gemini-identified cross-tenant gap).
 *   - `nonce` blocks replay within the 60-second timestamp window; the
 *     receiver tracks nonces in Redis for 5 min before forgetting them.
 *
 * Headers the sender attaches (and the receiver reads):
 *   X-OTS-Timestamp  — unix seconds
 *   X-OTS-Signature  — hex-encoded HMAC-SHA256
 *   X-OTS-Tenant     — tenant slug (routing) — MUST match the tenantId in the signature
 *   X-OTS-Nonce      — UUID per request
 */

/**
 * Canonical payload that the HMAC is computed over. Kept as a private helper
 * so sign/verify cannot drift apart, and so there is exactly one serialization
 * contract shared with the PHP module.
 */
function canonicalPayload(
	timestamp: number,
	method: string,
	path: string,
	tenantId: string,
	nonce: string,
	body: string
): string {
	return `${timestamp}\n${method.toUpperCase()}\n${path}\n${tenantId}\n${nonce}\n${body}`;
}

/**
 * Signs a request with HMAC-SHA256 using the shared secret.
 * Returns hex-encoded signature (64 chars).
 */
export function signRequest(
	secret: string,
	timestamp: number,
	method: string,
	path: string,
	tenantId: string,
	nonce: string,
	body: string
): string {
	return createHmac('sha256', secret)
		.update(canonicalPayload(timestamp, method, path, tenantId, nonce, body))
		.digest('hex');
}

/**
 * Builds headers to attach to an outgoing request so the receiver can verify
 * authenticity. Timestamp is set to `now` (seconds since epoch); nonce is a
 * fresh UUID. Used mainly in tests + the health-check probe.
 */
export function buildSignedHeaders(
	secret: string,
	method: string,
	path: string,
	tenantId: string,
	body: string
): Record<string, string> {
	const timestamp = Math.floor(Date.now() / 1000);
	const nonce = randomUUID();
	const signature = signRequest(secret, timestamp, method, path, tenantId, nonce, body);

	return {
		'X-OTS-Timestamp': timestamp.toString(),
		'X-OTS-Signature': signature,
		'X-OTS-Tenant': tenantId,
		'X-OTS-Nonce': nonce,
		'Content-Type': 'application/json'
	};
}

/**
 * Constant-time signature verification. Returns false on any error
 * (bad hex, length mismatch, internal). Never throws.
 */
export function verifySignature(
	secret: string,
	timestamp: number,
	method: string,
	path: string,
	tenantId: string,
	nonce: string,
	body: string,
	received: string
): boolean {
	try {
		const expected = signRequest(secret, timestamp, method, path, tenantId, nonce, body);
		const expectedBuffer = Buffer.from(expected, 'hex');
		const receivedBuffer = Buffer.from(received, 'hex');

		if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
			return false;
		}

		return timingSafeEqual(expectedBuffer, receivedBuffer);
	} catch {
		return false;
	}
}

/**
 * Generates a cryptographically-random 32-byte secret, hex-encoded (64 chars).
 * Used when provisioning a new WHMCS integration or rotating its secret.
 * Matches `ots_connector_generate_secret()` on the WordPress side.
 */
export function generateSecret(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Tolerance window (seconds) around the current time in which a request's
 * timestamp is considered fresh. 60 s matches the WordPress connector;
 * extra 5 s accommodates Turso roundtrip + clock drift.
 */
export const TIMESTAMP_WINDOW_SECONDS = 65;

/**
 * TTL (seconds) for the nonce-seen Redis key. Must exceed
 * TIMESTAMP_WINDOW_SECONDS to guarantee replay protection holds across
 * any retry inside that window.
 */
export const NONCE_TTL_SECONDS = 300;
