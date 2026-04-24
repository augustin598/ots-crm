import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Bun's mock.module() must be set up BEFORE the module under test loads.
// Stub the SvelteKit env module first so the transitive db import succeeds,
// then capture every db.update().set(...) call and every logError() message
// so we can assert control flow without a real DB connection.
mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

const updateCalls: Array<Record<string, unknown>> = [];
const errorLogs: string[] = [];
const enqueueCalls: Array<{ tenantId: string; delayMs: number; attempt: number }> = [];

const fakeDb = {
	select: () => ({
		from: () => ({
			where: () => ({
				limit: () => Promise.resolve([{ consecutiveFailures: 0 }]),
			}),
		}),
	}),
	update: () => ({
		set: (values: Record<string, unknown>) => {
			updateCalls.push(values);
			return { where: () => Promise.resolve() };
		},
	}),
};

mock.module('../../db', () => ({ db: fakeDb }));
mock.module('$lib/server/db', () => ({ db: fakeDb }));
mock.module('$lib/server/notifications', () => ({
	createNotification: () => Promise.resolve(),
	// Other modules in the keez test suite (e.g. sync.ts) also import from
	// this module — keep the surface complete so cross-file mocks don't break.
	clearNotificationsByType: () => Promise.resolve(),
}));
mock.module('$lib/server/logger', () => ({
	serializeError: (e: any) => ({ message: e?.message ?? String(e), stack: '' }),
	logInfo: () => {},
	logWarning: () => {},
	logError: (_src: string, msg: string) => {
		errorLogs.push(msg);
	},
}));

const { handleKeezSyncFailure, humanizeDelay } = await import('./failure-handler');

describe('humanizeDelay', () => {
	test('< 1h → "N min"', () => {
		expect(humanizeDelay(30 * 60_000)).toBe('30 min');
		expect(humanizeDelay(45 * 60_000)).toBe('45 min');
	});
	test('integer hours → "N h"', () => {
		expect(humanizeDelay(2 * 60 * 60_000)).toBe('2 h');
		expect(humanizeDelay(6 * 60 * 60_000)).toBe('6 h');
	});
	test('fractional hours → "N.M h"', () => {
		expect(humanizeDelay(90 * 60_000)).toBe('1.5 h');
	});
});

describe('handleKeezSyncFailure', () => {
	beforeEach(() => {
		updateCalls.length = 0;
		errorLogs.length = 0;
		enqueueCalls.length = 0;
	});

	test('passes (tenantId, delayMs, attempt) triple to enqueueRetry', async () => {
		const enqueueRetry = (tenantId: string, delayMs: number, attempt: number) => {
			enqueueCalls.push({ tenantId, delayMs, attempt });
			return Promise.resolve();
		};
		await handleKeezSyncFailure('t1', new Error('Keez API error: 502'), { enqueueRetry });

		expect(enqueueCalls).toHaveLength(1);
		expect(enqueueCalls[0].tenantId).toBe('t1');
		expect(enqueueCalls[0].attempt).toBe(1); // priorCount=0 + 1
		// First hop in the [30min, 2h, 6h] schedule, allowing for ±10% jitter.
		expect(enqueueCalls[0].delayMs).toBeGreaterThanOrEqual(27 * 60_000);
		expect(enqueueCalls[0].delayMs).toBeLessThanOrEqual(33 * 60_000);
	});

	test('when enqueueRetry throws, force-marks integration degraded', async () => {
		const enqueueRetry = () => Promise.reject(new Error('Custom Id cannot contain :'));
		const transientErr = new Error('Keez API error: 502 nginx');

		await handleKeezSyncFailure('t1', transientErr, { enqueueRetry });

		// Two updates expected: (1) the initial failure-state update, (2) the
		// force-degrade update after enqueue failure. The second must include
		// isDegraded: true.
		const degradedUpdate = updateCalls.find((u) => u.isDegraded === true);
		expect(degradedUpdate).toBeTruthy();

		// And the escalation reason must have been logged.
		expect(errorLogs.some((m) => m.includes('escalating to degraded'))).toBe(true);
	});

	test('when enqueueRetry succeeds, does NOT force degraded', async () => {
		const enqueueRetry = () => Promise.resolve();
		const transientErr = new Error('Keez API error: 502 nginx');

		await handleKeezSyncFailure('t1', transientErr, { enqueueRetry });

		// Only the initial failure-state update; no degraded escalation.
		const degradedEscalation = updateCalls.filter((u) => u.isDegraded === true);
		expect(degradedEscalation).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('escalating'))).toBe(false);
	});
});
