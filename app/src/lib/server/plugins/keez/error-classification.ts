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

/**
 * Detect Keez's "this invoice doesn't exist" signal across the two HTTP
 * shapes the API actually returns:
 *   1. HTTP 404 with plain `Error('Not found')` thrown by client.ts:308.
 *   2. HTTP 400 with body `{"Code":"VALIDATION_ERROR","Message":"...nu exista..."}`
 *      thrown as KeezClientError(400, "Keez API client error 400: {...}").
 *      This is the common case — Keez does NOT pick 404 for missing records.
 *      See memory/project_keez_400_for_missing_invoice.md.
 *
 * Used by the sync reconcile pass and the _debug-keez-invoice endpoint.
 */
export function isMissingOnKeez(err: unknown): boolean {
	if (err instanceof Error && err.message === 'Not found') return true;
	if (err instanceof KeezClientError) {
		if (err.status === 404) return true;
		if (err.status === 400) {
			const msg = err.message || '';
			if (/VALIDATION_ERROR/.test(msg) && /nu exista|Not Found/i.test(msg)) {
				return true;
			}
		}
	}
	return false;
}
