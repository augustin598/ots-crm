import { logWarning, logInfo } from '$lib/server/logger';

type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Simple in-memory circuit breaker for external API calls.
 *
 * - closed: requests flow normally
 * - open: requests rejected immediately (after threshold consecutive failures)
 * - half-open: one probe request allowed after resetTimeout; success → closed, failure → open
 */
export class CircuitBreaker {
	private failures = 0;
	private lastFailureTime = 0;
	private state: CircuitState = 'closed';

	constructor(
		private readonly name: string,
		private readonly threshold: number = 5,
		private readonly resetTimeoutMs: number = 60_000
	) {}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
		if (this.state === 'open') {
			if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
				this.state = 'half-open';
				logInfo('scheduler', `Circuit breaker ${this.name}: half-open, allowing probe request`);
			} else {
				throw new CircuitBreakerOpenError(this.name, this.resetTimeoutMs - (Date.now() - this.lastFailureTime));
			}
		}

		try {
			const result = await fn();
			this.onSuccess();
			return result;
		} catch (err) {
			this.onFailure();
			throw err;
		}
	}

	private onSuccess(): void {
		if (this.state === 'half-open') {
			logInfo('scheduler', `Circuit breaker ${this.name}: recovered, closing circuit`);
		}
		this.failures = 0;
		this.state = 'closed';
	}

	private onFailure(): void {
		this.failures++;
		this.lastFailureTime = Date.now();

		if (this.failures >= this.threshold) {
			this.state = 'open';
			logWarning('scheduler', `Circuit breaker ${this.name}: OPEN after ${this.failures} consecutive failures. Blocking for ${this.resetTimeoutMs / 1000}s`);
		}
	}

	getState(): CircuitState {
		return this.state;
	}

	getFailures(): number {
		return this.failures;
	}

	/** Force reset (for admin use or testing) */
	reset(): void {
		this.failures = 0;
		this.state = 'closed';
	}
}

export class CircuitBreakerOpenError extends Error {
	constructor(name: string, retryAfterMs: number) {
		super(`Circuit breaker ${name} is open. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
		this.name = 'CircuitBreakerOpenError';
	}
}

/**
 * Registry of circuit breakers by name (singleton per provider+tenant).
 * Key format: `{provider}:{tenantId}` or just `{provider}` for global services.
 */
const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
	name: string,
	threshold = 5,
	resetTimeoutMs = 60_000
): CircuitBreaker {
	if (!breakers.has(name)) {
		breakers.set(name, new CircuitBreaker(name, threshold, resetTimeoutMs));
	}
	return breakers.get(name)!;
}
