import { classifyKeezError } from './error-classification';

/**
 * Pure retry-decision logic for Keez sync failures.
 * No DB, no queue — just the math. Kept separate from failure-handler.ts
 * so the decision can be unit-tested without SvelteKit's $lib alias graph.
 */

export const RETRY_DELAYS_MS = [10 * 60_000, 60 * 60_000]; // +10 min, +1 h
export const MAX_CONSECUTIVE_FAILURES = 3;

export type FailureAction =
	| { kind: 'schedule_retry'; delayMs: number }
	| { kind: 'mark_degraded' };

/**
 * Decide what to do after a sync failure.
 * `priorCount` is the value of `consecutiveFailures` BEFORE this failure.
 *
 * Permanent errors (4xx, 401 after refresh) → degraded immediately.
 * Transient errors → retry while `priorCount + 1 < MAX_CONSECUTIVE_FAILURES`,
 * otherwise degraded.
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
	return { kind: 'schedule_retry', delayMs: RETRY_DELAYS_MS[priorCount] };
}
