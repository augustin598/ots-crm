/**
 * Shared WHMCS error types. WHMCS itself is the producer (PHP addon → webhook),
 * so most failures we see post-receive happen during the *downstream* push to
 * Keez. We therefore model errors at three boundaries:
 *
 *   - WhmcsWebhookError       — verify/parse failures on the inbound webhook
 *   - WhmcsPushBackError      — POST-back to WHMCS callback.php failed
 *   - WhmcsKeezPushAbortedError — push chain to Keez aborted by retry handler
 *
 * Status-based classification mirrors KeezClientError: 4xx = permanent, 5xx =
 * transient. Used by error-classification.ts.
 */

export class WhmcsWebhookError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'WhmcsWebhookError';
		this.status = status;
	}
}

export class WhmcsPushBackError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'WhmcsPushBackError';
		this.status = status;
	}
}

/**
 * Raised when the auto-push-to-Keez chain for a WHMCS-sourced invoice is
 * aborted because a transient failure exhausted its in-run retry budget OR
 * an integration-level circuit-breaker is open. The caller logs and lets the
 * scheduled retry task pick the work back up later — never re-thrown.
 */
export class WhmcsKeezPushAbortedError extends Error {
	readonly retryAt: Date | null;
	readonly attempt: number;
	constructor(message: string, attempt: number, retryAt: Date | null) {
		super(message);
		this.name = 'WhmcsKeezPushAbortedError';
		this.attempt = attempt;
		this.retryAt = retryAt;
	}
}
