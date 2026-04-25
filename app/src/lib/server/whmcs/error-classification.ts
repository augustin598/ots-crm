/**
 * Classify failures from the WHMCS auto-push pipeline.
 *
 * The pipeline crosses two upstreams:
 *   - Keez (createInvoice / validateInvoice during auto-push chain)
 *   - WHMCS callback.php (push-number-back step)
 *
 * Both are HTTP, both follow the same convention: 5xx + network = transient,
 * 4xx = permanent. We delegate Keez classification to the Keez classifier so
 * the two stay aligned (e.g. recognising 400+VALIDATION_ERROR+"nu exista" as a
 * permanent missing-resource signal — see project_keez_400_for_missing_invoice).
 */
import { classifyKeezError } from '$lib/server/plugins/keez/error-classification';
import { KeezClientError, KeezCredentialsCorruptError } from '$lib/server/plugins/keez/errors';
import { WhmcsKeezPushAbortedError, WhmcsPushBackError } from './errors';

export type FailureKind = 'transient' | 'permanent';

const TRANSIENT_STATUS_PATTERN = /\b(502|503|504)\b/;
const TRANSIENT_NETWORK_PATTERN =
	/timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed|AbortError|aborted|EAI_AGAIN/i;

export function classifyWhmcsPushError(error: unknown): FailureKind {
	if (error instanceof WhmcsKeezPushAbortedError) {
		// Already classified upstream — the abort itself isn't "the cause", we
		// just want the caller to keep treating it as transient so the retry
		// budget keeps draining. The underlying error was logged separately.
		return 'transient';
	}

	// Keez-shaped errors: defer to the Keez classifier (handles 400 VALIDATION_ERROR etc.)
	if (error instanceof KeezClientError || error instanceof KeezCredentialsCorruptError) {
		return classifyKeezError(error);
	}

	// WHMCS push-back: same status convention.
	if (error instanceof WhmcsPushBackError) {
		if (error.status >= 400 && error.status < 500) return 'permanent';
		return 'transient';
	}

	if (error instanceof Error) {
		if (error.name === 'AbortError') return 'transient';
		const msg = error.message || '';
		if (TRANSIENT_STATUS_PATTERN.test(msg)) return 'transient';
		if (TRANSIENT_NETWORK_PATTERN.test(msg)) return 'transient';
	}

	// Unknown error → optimistic transient. Worst case we waste a few retry
	// hops; opposite default would silently dead-letter recoverable cases.
	return 'transient';
}
