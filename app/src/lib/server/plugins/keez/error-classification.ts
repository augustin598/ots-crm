import { KeezClientError, KeezCredentialsCorruptError } from './errors';

export type FailureKind = 'transient' | 'permanent';

const TRANSIENT_STATUS_PATTERN = /\b(502|503|504)\b/;
const TRANSIENT_NETWORK_PATTERN = /timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed|AbortError|aborted/i;

/**
 * Classify a Keez sync error as transient (retry) or permanent (stop).
 *
 * Transient:
 *   - 5xx HTTP errors from upstream (502/503/504 in error message, or KeezClientError.status >= 500)
 *   - Network-layer errors (timeout, ECONNRESET, ENOTFOUND, fetch failed, AbortError)
 *   - KeezCredentialsCorruptError — DB re-read may yield fresh ciphertext next run
 *   - Unknown errors — optimistic default
 *
 * Permanent:
 *   - 4xx HTTP from Keez (400, 401 post-refresh, 403, 404, 409, 422...): won't self-heal
 */
export function classifyKeezError(error: unknown): FailureKind {
	if (error instanceof KeezCredentialsCorruptError) {
		return 'transient';
	}

	if (error instanceof KeezClientError) {
		if (error.status >= 400 && error.status < 500) {
			return 'permanent';
		}
		return 'transient';
	}

	if (error instanceof Error) {
		if (error.name === 'AbortError') return 'transient';
		const msg = error.message || '';
		if (TRANSIENT_STATUS_PATTERN.test(msg)) return 'transient';
		if (TRANSIENT_NETWORK_PATTERN.test(msg)) return 'transient';
	}

	return 'transient';
}
