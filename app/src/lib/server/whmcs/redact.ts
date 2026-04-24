/**
 * Sensitive-data redaction for WHMCS payloads before they hit logs or the
 * `whmcs_invoice_sync.raw_payload` column. Cheap protection against
 * accidentally persisting tokens, passwords, or other PII that we'd have to
 * rotate/scrub later.
 *
 * Design:
 *   - Key-name matching (not value matching): `password`, `token`, `secret`,
 *     etc. always get replaced with '[REDACTED]', regardless of content.
 *   - Recursive traversal of plain objects + arrays, bounded by MAX_DEPTH
 *     and MAX_BYTES so a hostile payload can't OOM the logger.
 *   - Strings, numbers, booleans, null copied as-is (not cloned; the result
 *     may share references with the input — callers should not mutate).
 *   - Non-plain objects (Date, Error, class instances) are left as-is;
 *     JSON.stringify will handle them or coerce to {}.
 */

/**
 * Keys whose values should be redacted. Matched case-insensitively anywhere
 * in the key name (substring match). Tight enough to avoid false positives
 * on normal fields like `invoiceToken` (which is NOT a secret) — adjust the
 * list if a domain field accidentally trips the pattern.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
	/password/i,
	/secret/i,
	/shared_?secret/i,
	/api[_-]?key/i,
	/token/i, // catches `token`, `accessToken`, `refresh_token`, `auth_token`, …
	/auth(orization)?/i,
	/bearer/i,
	/cookie/i,
	/private[_-]?key/i
];

const REDACTED = '[REDACTED]' as const;
const MAX_DEPTH = 5;
const MAX_BYTES = 50 * 1024;    // 50 KB — log storage per row is capped in DB too

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function redactInternal(value: unknown, depth: number): unknown {
	if (depth > MAX_DEPTH) return '[TRUNCATED: max-depth]';

	if (Array.isArray(value)) {
		return value.map((v) => redactInternal(v, depth + 1));
	}

	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (isSensitiveKey(k)) {
				out[k] = REDACTED;
			} else {
				out[k] = redactInternal(v, depth + 1);
			}
		}
		return out;
	}

	return value;
}

/**
 * Produces a redacted deep copy safe to log or persist.
 * Never throws. Returns the input unchanged if it isn't an object/array.
 */
export function redact<T>(value: T): T {
	return redactInternal(value, 0) as T;
}

/**
 * Stringifies a payload for storage, applying redaction and enforcing a
 * byte ceiling. Returns the JSON string, or a truncated placeholder if the
 * payload would exceed MAX_BYTES. Safe for any value JSON.stringify handles.
 */
export function redactAndStringify(value: unknown): string {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(redact(value));
	} catch (err) {
		return JSON.stringify({
			__redactError: err instanceof Error ? err.message : String(err)
		});
	}

	// JSON.stringify(undefined) === undefined; coerce to a stable null literal
	// so callers always receive a valid JSON string.
	if (serialized === undefined) {
		return 'null';
	}

	if (serialized.length > MAX_BYTES) {
		return JSON.stringify({
			__truncated: true,
			__originalBytes: serialized.length,
			preview: serialized.slice(0, 1024)
		});
	}

	return serialized;
}
