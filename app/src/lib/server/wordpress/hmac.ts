import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Canonical payload shape signed by both CRM (sender) and the OTS Connector
 * WordPress plugin (receiver). Keep in sync with the PHP side.
 */
function canonicalPayload(
	timestamp: number,
	method: string,
	path: string,
	body: string
): string {
	return `${timestamp}\n${method.toUpperCase()}\n${path}\n${body}`;
}

/**
 * Signs a request with HMAC-SHA256 using the provided secret.
 * Returns hex-encoded signature.
 */
export function signRequest(
	secret: string,
	timestamp: number,
	method: string,
	path: string,
	body: string
): string {
	return createHmac('sha256', secret)
		.update(canonicalPayload(timestamp, method, path, body))
		.digest('hex');
}

/**
 * Builds headers to attach to a request so the OTS Connector plugin can
 * verify authenticity. Timestamp is set to `now` (seconds since epoch).
 */
export function buildSignedHeaders(
	secret: string,
	method: string,
	path: string,
	body: string
): Record<string, string> {
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = signRequest(secret, timestamp, method, path, body);

	return {
		'X-OTS-Timestamp': timestamp.toString(),
		'X-OTS-Signature': signature,
		'Content-Type': 'application/json'
	};
}

/**
 * Verifies a signature using constant-time comparison. Returns false on any
 * error (length mismatch, bad hex, internal error). Never throws.
 */
export function verifySignature(
	secret: string,
	timestamp: number,
	method: string,
	path: string,
	body: string,
	received: string
): boolean {
	try {
		const expected = signRequest(secret, timestamp, method, path, body);
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
 * Used both when provisioning a new site and when rotating its secret.
 */
export function generateSecret(): string {
	return randomBytes(32).toString('hex');
}
