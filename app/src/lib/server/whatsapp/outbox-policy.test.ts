import { describe, expect, it } from 'bun:test';
import {
	COALESCE_WINDOW_MS,
	HOURLY_TENANT_LIMIT,
	MAX_AGE_MS,
	MAX_ATTEMPTS,
	STALE_SENDING_MS,
	nextAttemptDelayMs,
	planEnqueue,
	planFailure,
	statusDedupeKey
} from './outbox-policy';

const now = new Date('2026-08-21T10:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('coalescerea la punerea în coadă', () => {
	it('fără istoric: rând nou, trimis imediat', () => {
		expect(planEnqueue({ queued: null, lastSentAt: null }, now)).toEqual({
			action: 'insert',
			nextAttemptAt: now
		});
	});

	it('un rând încă netrimis pentru același task + grup se înlocuiește', () => {
		const plan = planEnqueue(
			{ queued: { id: 'q1', nextAttemptAt: ago(-5000) }, lastSentAt: null },
			now
		);
		expect(plan).toEqual({ action: 'replace', id: 'q1' });
	});

	it('după un mesaj trimis de curând, următorul se amână până la capătul ferestrei', () => {
		const lastSentAt = ago(30_000);
		const plan = planEnqueue({ queued: null, lastSentAt }, now);
		expect(plan.action).toBe('insert');
		if (plan.action === 'insert') {
			expect(plan.nextAttemptAt.getTime()).toBe(lastSentAt.getTime() + COALESCE_WINDOW_MS);
		}
	});

	it('un mesaj trimis demult nu mai amână nimic', () => {
		const plan = planEnqueue({ queued: null, lastSentAt: ago(COALESCE_WINDOW_MS + 1) }, now);
		expect(plan).toEqual({ action: 'insert', nextAttemptAt: now });
	});

	it('cheia de coalescere e pe task + grup, nu pe status', () => {
		expect(statusDedupeKey('t1', '123@g.us')).toBe(statusDedupeKey('t1', '123@g.us'));
		expect(statusDedupeKey('t1', '123@g.us')).not.toBe(statusDedupeKey('t2', '123@g.us'));
		expect(statusDedupeKey('t1', '123@g.us')).not.toBe(statusDedupeKey('t1', '999@g.us'));
	});
});

describe('reîncercarea după eșec', () => {
	it('backoff exponențial de la 30 s, plafonat la 10 minute', () => {
		expect(nextAttemptDelayMs(1)).toBe(30_000);
		expect(nextAttemptDelayMs(2)).toBe(60_000);
		expect(nextAttemptDelayMs(3)).toBe(120_000);
		expect(nextAttemptDelayMs(20)).toBe(10 * 60_000);
	});

	it('după prea multe încercări rândul pică definitiv', () => {
		const plan = planFailure({ attempts: MAX_ATTEMPTS, createdAt: ago(60_000) }, now);
		expect(plan.status).toBe('failed');
	});

	it('un rând mai vechi de șase ore expiră în loc să se reîncerce', () => {
		const plan = planFailure({ attempts: 1, createdAt: ago(MAX_AGE_MS + 1) }, now);
		expect(plan.status).toBe('expired');
	});

	it('altfel se reprogramează', () => {
		const plan = planFailure({ attempts: 2, createdAt: ago(60_000) }, now);
		expect(plan.status).toBe('queued');
		expect(plan.nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000);
	});

	it('constantele au valorile din design', () => {
		expect(COALESCE_WINDOW_MS).toBe(120_000);
		expect(HOURLY_TENANT_LIMIT).toBe(60);
		expect(MAX_AGE_MS).toBe(6 * 3_600_000);
		expect(STALE_SENDING_MS).toBe(5 * 60_000);
	});
});
