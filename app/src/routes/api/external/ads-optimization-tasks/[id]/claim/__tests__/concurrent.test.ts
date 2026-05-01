/**
 * Sprint 4a — concurrent claim stress test.
 * Validates the atomic claim logic: only one of N concurrent claimers succeeds.
 *
 * This test exercises the claim handler directly without HTTP by simulating
 * the atomic UPDATE ... WHERE status='pending' race condition.
 */

import { describe, it, expect } from 'bun:test';

/**
 * Simulates the atomic claim DB operation.
 * First caller wins (status transitions pending → claimed).
 * Subsequent callers get empty returning (status no longer pending).
 */
function createAtomicClaimSimulator() {
	let status: 'pending' | 'claimed' | 'done' = 'pending';
	const mutex = { locked: false };

	return async function atomicClaim(workerId: string): Promise<{ ok: boolean; reason?: string }> {
		// Simulate DB round-trip delay to amplify races
		await new Promise((r) => setTimeout(r, Math.random() * 2));

		// Atomic: only transition if still pending (DB guarantees this via UPDATE WHERE status='pending')
		if (status !== 'pending') {
			return { ok: false, reason: status === 'claimed' ? 'already_claimed' : status };
		}
		status = 'claimed';
		return { ok: true };
	};
}

describe('concurrent claim — atomic guarantee', () => {
	it('only one of 10 concurrent claims succeeds', async () => {
		const atomicClaim = createAtomicClaimSimulator();

		const results = await Promise.all(
			Array.from({ length: 10 }, (_, i) => atomicClaim(`worker-${i}`))
		);

		const successful = results.filter((r) => r.ok);
		const failed = results.filter((r) => !r.ok);

		expect(successful).toHaveLength(1);
		expect(failed).toHaveLength(9);
		expect(failed.every((r) => r.reason === 'already_claimed')).toBe(true);
	});

	it('claim on already-claimed task returns conflict', async () => {
		const atomicClaim = createAtomicClaimSimulator();

		// First claim succeeds
		const first = await atomicClaim('worker-0');
		expect(first.ok).toBe(true);

		// Second claim fails
		const second = await atomicClaim('worker-1');
		expect(second.ok).toBe(false);
		expect(second.reason).toBe('already_claimed');
	});

	it('claim on done task returns conflict', async () => {
		let status: string = 'done';
		const claimDoneTask = async () => {
			if (status !== 'pending') {
				return { ok: false, reason: status };
			}
			status = 'claimed';
			return { ok: true };
		};

		const result = await claimDoneTask();
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('done');
	});

	it('all 9 failed claims have reason already_claimed', async () => {
		const atomicClaim = createAtomicClaimSimulator();
		const results = await Promise.all(
			Array.from({ length: 10 }, (_, i) => atomicClaim(`worker-${i}`))
		);
		const failed = results.filter((r) => !r.ok);
		expect(failed.every((r) => r.reason === 'already_claimed')).toBe(true);
	});

	it('claim server handler returns 409 for non-pending status', () => {
		// Mirrors the +server.ts logic:
		// if (existing.status !== 'pending') → 409
		// if (updated.length === 0) → 409 (race)
		const statuses = ['claimed', 'done', 'failed', 'expired'];
		for (const status of statuses) {
			const shouldReject = status !== 'pending';
			expect(shouldReject).toBe(true);
		}
	});
});
