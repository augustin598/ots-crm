import { classifyKeezError } from './error-classification';

/**
 * Pure retry-decision logic for Keez sync failures.
 * No DB, no queue — just the math. Kept separate from failure-handler.ts
 * so the decision can be unit-tested without SvelteKit's $lib alias graph.
 */

// Spacing tuned for multi-hour upstream outages (e.g. Keez nginx 502 storms).
// Total wall-clock budget before degraded: ~8.5 h.
export const RETRY_DELAYS_MS = [30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
export const MAX_CONSECUTIVE_FAILURES = 4;

const JITTER_FRACTION = 0.1; // ±10%

export type FailureAction =
	| { kind: 'schedule_retry'; delayMs: number }
	| { kind: 'mark_degraded' };

/**
 * Decide what to do after a sync failure.
 * `priorCount` is the value of `consecutiveFailures` BEFORE this failure.
 *
 * Permanent errors (4xx, 401 post-refresh) → degraded immediately.
 * Transient errors → retry with jittered backoff while
 *   `priorCount + 1 < MAX_CONSECUTIVE_FAILURES`, otherwise degraded.
 *
 * Jitter prevents many tenants whose retries align (e.g. all triggered by
 * the same 4 AM cron failure) from hitting Keez at the exact same wall-clock.
 */
export function decideFailureAction(error: unknown, priorCount: number): FailureAction {
	const kind = classifyKeezError(error);
	if (kind === 'permanent') {
		return { kind: 'mark_degraded' };
	}
	const nextCount = priorCount + 1;
	if (nextCount >= MAX_CONSECUTIVE_FAILURES) {
		return { kind: 'mark_degraded' };
	}
	const base = RETRY_DELAYS_MS[priorCount];
	const jitter = base * JITTER_FRACTION * (Math.random() * 2 - 1);
	return { kind: 'schedule_retry', delayMs: Math.round(base + jitter) };
}
