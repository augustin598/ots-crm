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

/**
 * Raised by the Keez mapper when a non-RON invoice needs an exchange rate
 * but the BNR cache is stale (older than the configured freshness window)
 * and `whmcs_strict_bnr_conversion` is enabled. Treated as TRANSIENT by the
 * push-failure classifier so the BullMQ retry chain waits for the next BNR
 * sync — better than committing an exchangeRate=1 fallback that would emit
 * a fiscal document with sums off by ~5x.
 */
export class BnrRateStaleError extends Error {
	readonly currency: string;
	readonly rateDate: Date | null;
	readonly maxAgeHours: number;
	constructor(currency: string, rateDate: Date | null, maxAgeHours: number) {
		const ageDesc = rateDate
			? `${Math.round((Date.now() - rateDate.getTime()) / 3_600_000)}h old`
			: 'missing';
		super(
			`BNR rate for ${currency} is ${ageDesc} (max ${maxAgeHours}h allowed in strict mode). Aborting push; will retry after next BNR sync.`
		);
		this.name = 'BnrRateStaleError';
		this.currency = currency;
		this.rateDate = rateDate;
		this.maxAgeHours = maxAgeHours;
	}
}
