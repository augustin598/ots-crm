import { describe, expect, test } from 'bun:test';
import { decideFailureAction, RETRY_DELAYS_MS, MAX_CONSECUTIVE_FAILURES } from './retry-policy';
import { KeezClientError } from './errors';

describe('retry-policy', () => {
	test('first transient failure schedules retry around 30 min (±10% jitter)', () => {
		const action = decideFailureAction(new Error('502'), 0);
		expect(action.kind).toBe('schedule_retry');
		if (action.kind !== 'schedule_retry') return;
		expect(action.delayMs).toBeGreaterThanOrEqual(27 * 60_000);
		expect(action.delayMs).toBeLessThanOrEqual(33 * 60_000);
	});

	test('second transient failure schedules retry around 2h (±10% jitter)', () => {
		const action = decideFailureAction(new Error('502'), 1);
		expect(action.kind).toBe('schedule_retry');
		if (action.kind !== 'schedule_retry') return;
		expect(action.delayMs).toBeGreaterThanOrEqual(108 * 60_000);
		expect(action.delayMs).toBeLessThanOrEqual(132 * 60_000);
	});

	test('third transient failure schedules retry around 6h (±10% jitter)', () => {
		const action = decideFailureAction(new Error('502'), 2);
		expect(action.kind).toBe('schedule_retry');
		if (action.kind !== 'schedule_retry') return;
		expect(action.delayMs).toBeGreaterThanOrEqual(5.4 * 60 * 60_000);
		expect(action.delayMs).toBeLessThanOrEqual(6.6 * 60 * 60_000);
	});

	test('fourth transient failure marks degraded', () => {
		const action = decideFailureAction(new Error('502'), 3);
		expect(action.kind).toBe('mark_degraded');
	});

	test('permanent error marks degraded immediately regardless of count', () => {
		const action = decideFailureAction(new KeezClientError('bad', 422), 0);
		expect(action.kind).toBe('mark_degraded');
	});

	test('exports the new shape', () => {
		expect(RETRY_DELAYS_MS).toHaveLength(3);
		expect(MAX_CONSECUTIVE_FAILURES).toBe(4);
	});
});
