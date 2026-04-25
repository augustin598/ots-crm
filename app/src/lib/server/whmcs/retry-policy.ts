/**
 * Pure retry-decision logic for WHMCS auto-push-to-Keez failures.
 *
 * Tuned for *per-invoice* retries (not tenant-level): we expect Keez/WHMCS
 * blips to be brief, and we don't want a single transient 502 to delay the
 * fiscal number arriving back at WHMCS by hours. Cadence:
 *
 *   attempt 1 (initial fail) → retry in  2 min
 *   attempt 2                → retry in 10 min
 *   attempt 3                → retry in 30 min
 *   attempt 4                → retry in  2 h
 *   attempt 5+               → mark FAILED (admin replay) — wall-clock budget ~2h45m
 *
 * Permanent errors (4xx) skip the retry budget and go straight to FAILED.
 */
import { classifyWhmcsPushError } from './error-classification';

export const PUSH_RETRY_DELAYS_MS = [
	2 * 60_000,
	10 * 60_000,
	30 * 60_000,
	2 * 60 * 60_000
];
export const MAX_PUSH_ATTEMPTS = PUSH_RETRY_DELAYS_MS.length + 1; // 5

const JITTER_FRACTION = 0.1;

export type PushFailureAction =
	| { kind: 'schedule_retry'; delayMs: number }
	| { kind: 'mark_failed' };

/**
 * `priorAttempts` — value of `retryCount` BEFORE this failure (0 on first push).
 * On return:
 *   - schedule_retry → caller enqueues a delayed BullMQ job
 *   - mark_failed    → caller updates whmcs_invoice_sync.state (admin replay)
 */
export function decidePushAction(error: unknown, priorAttempts: number): PushFailureAction {
	if (classifyWhmcsPushError(error) === 'permanent') {
		return { kind: 'mark_failed' };
	}
	const nextAttempt = priorAttempts + 1;
	if (nextAttempt >= MAX_PUSH_ATTEMPTS) {
		return { kind: 'mark_failed' };
	}
	const base = PUSH_RETRY_DELAYS_MS[priorAttempts];
	const jitter = base * JITTER_FRACTION * (Math.random() * 2 - 1);
	return { kind: 'schedule_retry', delayMs: Math.round(base + jitter) };
}

export function humanizePushDelay(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${minutes} min`;
	const hours = ms / (60 * 60_000);
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}
