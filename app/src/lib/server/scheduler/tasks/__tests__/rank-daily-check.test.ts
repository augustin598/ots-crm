// Teste pentru joburile scheduler Rank Tracker: potrivirea orei per tenant +
// delegarea one-shot cu trimiterea alertelor.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

await import('$lib/server/db/schema');

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/redis', () => ({ getRedis: () => ({ get: async () => null, set: async () => 'OK' }) }));
mock.module('$lib/server/scheduler', () => ({ getSchedulerQueue: () => ({ add: async () => {} }) }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: (e as Error)?.message ?? String(e) })
}));

const { processRankDailyCheck } = await import('../rank-daily-check');
const { processRankProjectCheck } = await import('../rank-project-check');

// 2026-09-02T03:00:00Z = vara (EEST, UTC+3) → ora 06 în București.
const NOW_6AM = new Date('2026-09-02T03:00:00Z');

describe('processRankDailyCheck — potrivirea orei', () => {
	test('ora potrivită → pune în coadă câte un proiect activ care n-a rulat azi', async () => {
		const enqueued: { jobId: string; params: Record<string, unknown> }[] = [];
		const r = await processRankDailyCheck(NOW_6AM, {
			loadEnabledSettings: async () => [{ tenantId: 't1', checkHour: '06:00' }],
			loadActiveProjects: async () => [{ id: 'p1' }, { id: 'p2' }],
			hasRunToday: async () => false,
			enqueue: async (jobId, params) => {
				enqueued.push({ jobId, params });
			}
		});
		expect(r.enqueued).toBe(2);
		expect(enqueued[0].jobId).toContain('rank-project-check-p1-2026-09-02');
		expect(enqueued[0].params).toMatchObject({ tenantId: 't1', projectId: 'p1', trigger: 'cron' });
	});

	test('ora nepotrivită → nu pune nimic în coadă', async () => {
		const r = await processRankDailyCheck(NOW_6AM, {
			loadEnabledSettings: async () => [{ tenantId: 't1', checkHour: '09:00' }],
			loadActiveProjects: async () => [{ id: 'p1' }],
			hasRunToday: async () => false,
			enqueue: async () => {}
		});
		expect(r.enqueued).toBe(0);
		expect(r.checkedTenants).toBe(0);
	});

	test('proiect care a rulat deja azi → sărit', async () => {
		let enq = 0;
		const r = await processRankDailyCheck(NOW_6AM, {
			loadEnabledSettings: async () => [{ tenantId: 't1', checkHour: '06:00' }],
			loadActiveProjects: async () => [{ id: 'p1' }],
			hasRunToday: async () => true,
			enqueue: async () => {
				enq++;
			}
		});
		expect(r.enqueued).toBe(0);
		expect(enq).toBe(0);
	});
});

describe('processRankProjectCheck — delegare + alerte', () => {
	const summaryWithAlerts = {
		runId: 'run1',
		checked: 3,
		failed: 0,
		up: 1,
		down: 1,
		flat: 1,
		alerts: 2,
		status: 'ok' as const,
		skipped: false
	};

	test('parametri lipsă → skip fără rulare', async () => {
		const r = await processRankProjectCheck({});
		expect(r).toMatchObject({ skipped: true });
	});

	test('deleagă la runner și trimite alerte când alerts>0 și sunt activate', async () => {
		let sent = false;
		const r = await processRankProjectCheck(
			{ tenantId: 't1', projectId: 'p1', trigger: 'cron' },
			{
				run: async () => summaryWithAlerts,
				alertsEnabled: async () => true,
				sendAlerts: async () => {
					sent = true;
				}
			}
		);
		expect((r as typeof summaryWithAlerts).checked).toBe(3);
		expect(sent).toBe(true);
	});

	test('nu trimite alerte dacă sunt dezactivate', async () => {
		let sent = false;
		await processRankProjectCheck(
			{ tenantId: 't1', projectId: 'p1' },
			{
				run: async () => summaryWithAlerts,
				alertsEnabled: async () => false,
				sendAlerts: async () => {
					sent = true;
				}
			}
		);
		expect(sent).toBe(false);
	});

	test('eroarea de la trimiterea alertelor nu pică verificarea', async () => {
		const r = await processRankProjectCheck(
			{ tenantId: 't1', projectId: 'p1' },
			{
				run: async () => summaryWithAlerts,
				alertsEnabled: async () => true,
				sendAlerts: async () => {
					throw new Error('SMTP down');
				}
			}
		);
		expect((r as typeof summaryWithAlerts).status).toBe('ok');
	});
});

/* Catch-up (3 sep. 2026): pe un laptop adormit la ora setată, primul tick după trezire
 * pica pe „oră diferită" și scanarea zilei era sărită complet. */
describe('processRankDailyCheck — catch-up după ora setată', () => {
	test('tick la 09:00 pentru checkHour 06:00 → tot enqueue (dacă n-a rulat azi)', async () => {
		const enqueued: string[] = [];
		const r = await processRankDailyCheck(new Date('2026-09-02T06:00:00Z'), { // 09:00 EEST
			loadEnabledSettings: async () => [{ tenantId: 't1', checkHour: '06:00' }],
			loadActiveProjects: async () => [{ id: 'p1', queries: 26 }],
			hasRunToday: async () => false,
			enqueue: async (jobId) => {
				enqueued.push(jobId);
			}
		});
		expect(r.enqueued).toBe(1);
		expect(enqueued.length).toBe(1);
	});

	test('tick ÎNAINTE de ora setată (05:00 pentru 06:00) → nimic', async () => {
		const r = await processRankDailyCheck(new Date('2026-09-02T02:00:00Z'), { // 05:00 EEST
			loadEnabledSettings: async () => [{ tenantId: 't1', checkHour: '06:00' }],
			loadActiveProjects: async () => [{ id: 'p1', queries: 26 }],
			hasRunToday: async () => false,
			enqueue: async () => {}
		});
		expect(r.enqueued).toBe(0);
	});
});
