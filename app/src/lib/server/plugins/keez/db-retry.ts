// Intentionally avoids importing the structured logger so this module stays
// loadable in unit tests without resolving SvelteKit virtual modules. The
// buffered logger writes everything to console anyway (logger.ts:152-159),
// so a direct console.warn here is consistent with the rest of the system.

const BUSY_PATTERNS = [
	'SQLITE_BUSY',
	'database is locked',
	'cannot start a transaction within a transaction',
	'STREAM_EXPIRED',
	'HRANA_WEBSOCKET_ERROR',
	'write timeout',
	'WRITE_TIMEOUT'
];

function isTursoBusyError(err: unknown): boolean {
	let current: unknown = err;
	for (let depth = 0; current && depth < 4; depth++) {
		if (current instanceof Error) {
			const msg = current.message || '';
			const code = (current as { code?: string }).code || '';
			if (BUSY_PATTERNS.some((p) => msg.includes(p) || code.includes(p))) return true;
			current = (current as { cause?: unknown }).cause;
		} else {
			break;
		}
	}
	return false;
}

/**
 * Wraps a DB operation with retry on transient libSQL/Turso busy errors.
 * Retries up to 2 times with 500ms → 1500ms backoff. Non-busy errors propagate immediately.
 */
export async function withTursoBusyRetry<T>(
	op: () => Promise<T>,
	context: { tenantId?: string; label: string }
): Promise<T> {
	const delays = [500, 1500];
	let lastErr: unknown;
	for (let attempt = 0; attempt <= delays.length; attempt++) {
		try {
			return await op();
		} catch (err) {
			lastErr = err;
			if (attempt >= delays.length || !isTursoBusyError(err)) throw err;
			console.warn(
				`[KEEZ][db-retry] Turso busy on ${context.label} (attempt ${attempt + 1}/${delays.length + 1}); retrying in ${delays[attempt]}ms${context.tenantId ? ` tenant=${context.tenantId}` : ''}`
			);
			await new Promise((r) => setTimeout(r, delays[attempt]));
		}
	}
	throw lastErr;
}
