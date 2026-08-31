// Teste pentru procesorul de scanare PageSpeed: 2 măsurători pentru ambele strategii,
// eroare API → rând `failed` fără a bloca restul cozii, pacing ≥ 1 s, progres în Redis.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

await import('$lib/server/db/schema'); // eager-load schema reală înainte de orice mock

const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			then: (resolve: (rows: unknown[]) => void) => resolve(selectQueue.shift() ?? [])
		};
		return chain;
	},
	insert: () => ({
		values: async (v: Record<string, unknown>) => {
			inserted.push(v);
		}
	})
};

const redisStore = new Map<string, string>();
const redisMock = {
	set: async (key: string, value: string, ..._args: unknown[]) => {
		redisStore.set(key, value);
		return 'OK';
	},
	get: async (key: string) => redisStore.get(key) ?? null,
	del: async (key: string) => {
		redisStore.delete(key);
		return 1;
	},
	expire: async () => 1
};

mock.module('$env/dynamic/private', () => ({ env: { PSI_API_KEY: 'k' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/redis', () => ({ getRedis: () => redisMock }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));

const { runPagespeedScan, scanProgressKey } = await import('../scan');

const psiOk = {
	performance: 77,
	accessibility: 90,
	bestPractices: 85,
	seo: 95,
	lcpMs: 2100,
	cls: 0.05,
	tbtMs: 150,
	fcpMs: 1500,
	speedIndexMs: 3000,
	inpMs: 180,
	ttfbMs: 400,
	totalBytes: 1_000_000,
	requestCount: 40,
	fieldLcpMs: 2000,
	fieldInpMs: 150,
	fieldCls: 0.03,
	opportunities: []
};

function site(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		tenantId: 't1',
		domain: `${id}.ro`,
		name: id,
		pages: [{ url: `https://${id}.ro/`, label: 'Homepage' }],
		strategies: ['mobile', 'desktop'],
		active: true,
		alertThreshold: 5,
		...over
	};
}

beforeEach(() => {
	selectQueue.length = 0;
	inserted.length = 0;
	redisStore.clear();
});

describe('runPagespeedScan', () => {
	test('site cu ambele strategii → două măsurători (mobile + desktop)', async () => {
		selectQueue.push([site('alpha')]);
		const calls: string[] = [];
		const result = await runPagespeedScan(
			{ tenantId: 't1' },
			{
				fetchPsi: async (url: string, strategy: string) => {
					calls.push(`${strategy}:${url}`);
					return psiOk;
				},
				sleep: async () => {}
			}
		);
		expect(result.scanned).toBe(2);
		expect(result.failed).toBe(0);
		expect(calls).toEqual(['mobile:https://alpha.ro/', 'desktop:https://alpha.ro/']);
		expect(inserted.length).toBe(2);
		expect(inserted[0]).toMatchObject({ siteId: 'alpha', strategy: 'mobile', status: 'ok', performance: 77 });
		expect(inserted[1]).toMatchObject({ siteId: 'alpha', strategy: 'desktop', status: 'ok' });
		expect(inserted[0].weekKey).toMatch(/^\d{4}-W\d{2}$/);
	});

	test('eroare API → rând failed cu mesaj, restul cozii continuă', async () => {
		selectQueue.push([site('bad'), site('good', { strategies: ['mobile'] })]);
		const result = await runPagespeedScan(
			{ tenantId: 't1' },
			{
				fetchPsi: async (url: string) => {
					if (url.includes('bad')) throw new Error('PSI 500: Lighthouse timeout');
					return psiOk;
				},
				sleep: async () => {}
			}
		);
		// bad are 2 strategii → 2 failed; good are 1 → 1 ok
		expect(result.failed).toBe(2);
		expect(result.scanned).toBe(1);
		const failedRows = inserted.filter((r) => r.status === 'failed');
		expect(failedRows.length).toBe(2);
		expect(String(failedRows[0].errorMessage)).toContain('Lighthouse timeout');
		expect(failedRows[0].performance).toBeNull();
	});

	test('pacing: cel puțin 1000 ms între cereri API', async () => {
		selectQueue.push([site('alpha'), site('beta', { strategies: ['mobile'] })]);
		const delays: number[] = [];
		await runPagespeedScan(
			{ tenantId: 't1' },
			{
				fetchPsi: async () => psiOk,
				sleep: async (ms: number) => {
					delays.push(ms);
				}
			}
		);
		// 3 cereri → 2 pauze de pacing între ele
		expect(delays.filter((d) => d >= 1000).length).toBeGreaterThanOrEqual(2);
	});

	test('progresul se scrie în Redis și cheia rămâne cu stare finală', async () => {
		selectQueue.push([site('alpha', { strategies: ['mobile'] })]);
		await runPagespeedScan(
			{ tenantId: 't1' },
			{ fetchPsi: async () => psiOk, sleep: async () => {} }
		);
		const raw = redisStore.get(scanProgressKey('t1'));
		expect(raw).toBeTruthy();
		const progress = JSON.parse(raw!);
		expect(progress.total).toBe(1);
		expect(progress.done).toBe(1);
		expect(progress.finishedAt).toBeTruthy();
		expect(progress.perSite.alpha).toBe('done');
	});

	test('scan deja activ (cheie Redis fără finishedAt) → skipped, nu scanează', async () => {
		redisStore.set(
			scanProgressKey('t1'),
			JSON.stringify({ scanId: 'x', total: 5, done: 1, perSite: {}, startedAt: new Date().toISOString() })
		);
		const result = await runPagespeedScan(
			{ tenantId: 't1' },
			{ fetchPsi: async () => psiOk, sleep: async () => {} }
		);
		expect(result.skipped).toBe(true);
		expect(inserted.length).toBe(0);
	});

	test('siteIds explicit → scanează doar acele site-uri', async () => {
		selectQueue.push([site('beta', { strategies: ['mobile'] })]);
		const result = await runPagespeedScan(
			{ tenantId: 't1', siteIds: ['beta'] },
			{ fetchPsi: async () => psiOk, sleep: async () => {} }
		);
		expect(result.scanned).toBe(1);
		expect(inserted[0].siteId).toBe('beta');
	});

	test('site fără pagini → sărit fără crash', async () => {
		selectQueue.push([site('empty', { pages: [] })]);
		const result = await runPagespeedScan(
			{ tenantId: 't1' },
			{ fetchPsi: async () => psiOk, sleep: async () => {} }
		);
		expect(result.scanned).toBe(0);
		expect(result.failed).toBe(0);
		expect(inserted.length).toBe(0);
	});
});
