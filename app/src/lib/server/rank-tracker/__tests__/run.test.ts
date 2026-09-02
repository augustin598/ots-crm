// Teste pentru runner-ul de verificare a pozițiilor. Eager-load schema, apoi mock DB
// (chain + onConflictDoUpdate + update), Redis (Map) și logger; providerii injectați.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

await import('$lib/server/db/schema');
const { rankRun, rankAlert, rankSnapshot } = await import('$lib/server/db/schema');

const selectQueue: unknown[][] = [];
const runInserts: Record<string, unknown>[] = [];
const runUpdates: Record<string, unknown>[] = [];
const snapshotUpserts: { values: Record<string, unknown>; conflict: Record<string, unknown> }[] = [];
const alertInserts: Record<string, unknown>[][] = [];

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
	insert: (table: unknown) => ({
		values: (v: Record<string, unknown> | Record<string, unknown>[]) => ({
			onConflictDoUpdate: (cfg: Record<string, unknown>) => {
				snapshotUpserts.push({ values: v as Record<string, unknown>, conflict: cfg });
				return Promise.resolve();
			},
			then: (resolve: (x: unknown) => void) => {
				if (table === rankRun) runInserts.push(v as Record<string, unknown>);
				else if (table === rankAlert) alertInserts.push(v as Record<string, unknown>[]);
				resolve(undefined);
			}
		})
	}),
	update: () => ({
		set: (v: Record<string, unknown>) => ({
			where: () => {
				runUpdates.push(v);
				return Promise.resolve();
			}
		})
	})
};

const redisStore = new Map<string, string>();
const redisMock = {
	set: async (key: string, value: string) => {
		redisStore.set(key, value);
		return 'OK';
	},
	get: async (key: string) => redisStore.get(key) ?? null
};

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/redis', () => ({ getRedis: () => redisMock }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: (e as Error)?.message ?? String(e) })
}));

const { runRankProjectCheck, rankRunProgressKey, getRankRunProgress } = await import('../run');
const { SerpProviderError } = await import('../providers/types');

const NOW = new Date('2026-09-02T08:00:00Z'); // ziua curentă: 2026-09-02 (Bucharest)

function project(over: Record<string, unknown> = {}) {
	return {
		id: 'p1',
		tenantId: 't1',
		clientId: null,
		domain: 'example.ro',
		name: 'Example',
		locale: 'google.ro|ro',
		locations: ['București'],
		competitors: ['competitor-a.ro'],
		devices: ['desktop', 'mobile'],
		alertThreshold: 5,
		active: true,
		pausedAt: null,
		...over
	};
}

function keyword(id: string, over: Record<string, unknown> = {}) {
	return { id, projectId: 'p1', keyword: `kw ${id}`, location: '', active: true, ...over };
}

/** SerpResult cu ținta example.ro la poziția `pos` (null = negăsită). */
function serp(pos: number | null) {
	const organic = Array.from({ length: 10 }, (_, i) => ({
		position: i + 1,
		url: `https://site${i + 1}.ro/x`,
		domain: `site${i + 1}.ro`,
		title: `t${i + 1}`,
		snippet: `s${i + 1}`
	}));
	if (pos && pos <= 10) {
		organic[pos - 1] = {
			position: pos,
			url: 'https://example.ro/pagina',
			domain: 'example.ro',
			title: 'Example',
			snippet: 'țintă'
		};
	}
	return { organic, features: ['ads'], aiOverview: 'absent' as const, raw: { blocked: false } };
}

function fakeProvider(name: 'scraper' | 'dataforseo', fn: (kw: string) => unknown) {
	return { name, fetchSerp: async (q: { keyword: string }) => fn(q.keyword) as never };
}

beforeEach(() => {
	selectQueue.length = 0;
	runInserts.length = 0;
	runUpdates.length = 0;
	snapshotUpserts.length = 0;
	alertInserts.length = 0;
	redisStore.clear();
});

describe('runRankProjectCheck — parcurgere de bază', () => {
	test('2 keywords × 2 devices → 4 upsert-uri de snapshot, run ok', async () => {
		selectQueue.push([project()], [keyword('k1'), keyword('k2')], []);
		const providers = {
			mode: 'scraper' as const,
			primary: fakeProvider('scraper', () => serp(4)),
			fallback: null
		};
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.checked).toBe(4);
		expect(r.failed).toBe(0);
		expect(r.status).toBe('ok');
		expect(snapshotUpserts.length).toBe(4);
		expect(runInserts.length).toBe(1);
		expect(runInserts[0].status).toBe('running');
		expect(runUpdates.length).toBe(1);
		expect(runUpdates[0].status).toBe('ok');
	});

	test('snapshot: poziția, pagina și dayKey pe ziua Bucharest', async () => {
		selectQueue.push([project({ devices: ['desktop'] })], [keyword('k1')], []);
		const providers = { mode: 'scraper' as const, primary: fakeProvider('scraper', () => serp(4)), fallback: null };
		await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		const snap = snapshotUpserts[0].values;
		expect(snap.position).toBe(4);
		expect(snap.page).toBe(1);
		expect(snap.dayKey).toBe('2026-09-02');
		expect(snap.provider).toBe('scraper');
		// upsert pe cheia (keyword, device, day)
		expect((snapshotUpserts[0].conflict.target as unknown[]).length).toBe(3);
	});

	test('poziție negăsită (peste 100) → position null, page null', async () => {
		selectQueue.push([project({ devices: ['desktop'] })], [keyword('k1')], []);
		const providers = { mode: 'scraper' as const, primary: fakeProvider('scraper', () => serp(null)), fallback: null };
		await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(snapshotUpserts[0].values.position).toBeNull();
		expect(snapshotUpserts[0].values.page).toBeNull();
	});
});

describe('runRankProjectCheck — erori și status', () => {
	test('eroare pe un keyword → fără snapshot, restul continuă, status partial', async () => {
		selectQueue.push([project({ devices: ['desktop'] })], [keyword('k1'), keyword('k2')], []);
		const providers = {
			mode: 'scraper' as const,
			primary: fakeProvider('scraper', (kw) => {
				if (kw === 'kw k1') throw new SerpProviderError('timeout', 'timeout', true);
				return serp(5);
			}),
			fallback: null
		};
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.checked).toBe(1);
		expect(r.failed).toBe(1);
		expect(r.status).toBe('partial');
		expect(snapshotUpserts.length).toBe(1);
	});

	test('blocare Google → oprește rularea imediat, status partial', async () => {
		selectQueue.push([project({ devices: ['desktop'] })], [keyword('k1'), keyword('k2')], []);
		const providers = {
			mode: 'scraper' as const,
			primary: fakeProvider('scraper', () => {
				throw new SerpProviderError('captcha', 'blocked', false);
			}),
			fallback: null
		};
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.status).toBe('partial');
		expect(snapshotUpserts.length).toBe(0);
		expect(String(runUpdates[0].errorNote)).toContain('blocat');
	});
});

describe('runRankProjectCheck — failover auto', () => {
	test('scraper care eșuează la toate cererile (non-blocked) → failover pe rată după prag', async () => {
		// 12 keywords desktop; scraperul dă timeout la toate → după 10+ încercări (rată >20%)
		// runner-ul trebuie să comute pe DataForSEO pentru restul (bug: numitorul era doar succesele).
		const kws = Array.from({ length: 12 }, (_, i) => keyword(`k${i}`));
		selectQueue.push([project({ devices: ['desktop'] })], kws, []);
		const providers = {
			mode: 'auto' as const,
			primary: fakeProvider('scraper', () => {
				throw new SerpProviderError('timeout', 'timeout', true);
			}),
			fallback: fakeProvider('dataforseo', () => serp(4))
		};
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.failed).toBeGreaterThanOrEqual(10);
		// failover-ul s-a produs: cel puțin un snapshot scris cu providerul de rezervă
		expect(snapshotUpserts.some((s) => s.values.provider === 'dataforseo')).toBe(true);
	});

	test('blocare pe scraper → comută pe DataForSEO și continuă', async () => {
		selectQueue.push([project({ devices: ['desktop'] })], [keyword('k1')], []);
		const providers = {
			mode: 'auto' as const,
			primary: fakeProvider('scraper', () => {
				throw new SerpProviderError('captcha', 'blocked', false);
			}),
			fallback: fakeProvider('dataforseo', () => serp(6))
		};
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.checked).toBe(1);
		expect(snapshotUpserts[0].values.provider).toBe('dataforseo');
	});
});

describe('runRankProjectCheck — delte și alerte', () => {
	test('scădere sub prag → alertă drop persistată; up/down din baseline', async () => {
		// baseline: k1 desktop era pe poziția 3 ieri → azi 9 = scădere de 6 (prag 5)
		selectQueue.push(
			[project({ devices: ['desktop'] })],
			[keyword('k1')],
			[{ keywordId: 'k1', device: 'desktop', dayKey: '2026-09-01', position: 3 }]
		);
		const providers = { mode: 'scraper' as const, primary: fakeProvider('scraper', () => serp(9)), fallback: null };
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.down).toBe(1);
		expect(r.up).toBe(0);
		expect(r.alerts).toBe(1);
		expect(alertInserts[0][0].type).toBe('drop');
		expect(runUpdates[0].alerts).toBe(1);
	});

	test('baseline din ziua curentă e ignorat (re-rulare) — fără delta falsă', async () => {
		selectQueue.push(
			[project({ devices: ['desktop'] })],
			[keyword('k1')],
			[{ keywordId: 'k1', device: 'desktop', dayKey: '2026-09-02', position: 3 }] // chiar azi
		);
		const providers = { mode: 'scraper' as const, primary: fakeProvider('scraper', () => serp(9)), fallback: null };
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers, sleep: async () => {}, now: () => NOW });
		expect(r.down).toBe(0); // fără baseline valabil (ziua curentă ignorată)
		expect(r.alerts).toBe(0);
	});
});

describe('getRankRunProgress — rulări moarte', () => {
	test('rulare fără semn de viață de peste 5 minute → null (nu „în curs")', async () => {
		redisStore.set(
			rankRunProgressKey('t1', 'p1'),
			JSON.stringify({
				runId: 'x',
				total: 26,
				done: 0,
				currentKeyword: 'a',
				startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
				updatedAt: new Date(Date.now() - 10 * 60_000).toISOString()
			})
		);
		expect(await getRankRunProgress('t1', 'p1')).toBeNull();
	});

	test('rulare actualizată recent → rămâne activă', async () => {
		redisStore.set(
			rankRunProgressKey('t1', 'p1'),
			JSON.stringify({
				runId: 'x',
				total: 2,
				done: 1,
				currentKeyword: 'a',
				startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
				updatedAt: new Date(Date.now() - 5_000).toISOString()
			})
		);
		expect((await getRankRunProgress('t1', 'p1'))?.total).toBe(2);
	});

	test('rulare terminată se întoarce indiferent de vechime', async () => {
		redisStore.set(
			rankRunProgressKey('t1', 'p1'),
			JSON.stringify({
				runId: 'x',
				total: 5,
				done: 5,
				currentKeyword: null,
				startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
				finishedAt: new Date(Date.now() - 59 * 60_000).toISOString()
			})
		);
		expect((await getRankRunProgress('t1', 'p1'))?.finishedAt).toBeTruthy();
	});

	test('fără `updatedAt` (cheie veche) cade pe `startedAt`', async () => {
		redisStore.set(
			rankRunProgressKey('t1', 'p1'),
			JSON.stringify({
				runId: 'x',
				total: 26,
				done: 0,
				currentKeyword: 'a',
				startedAt: new Date(Date.now() - 30 * 60_000).toISOString()
			})
		);
		expect(await getRankRunProgress('t1', 'p1')).toBeNull();
	});
});

describe('runRankProjectCheck — guard și skip', () => {
	test('rulare deja activă (cheie Redis fără finishedAt) → skip', async () => {
		redisStore.set(
			rankRunProgressKey('t1', 'p1'),
			JSON.stringify({
				runId: 'x',
				total: 1,
				done: 0,
				currentKeyword: 'a',
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
		);
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers: { mode: 'scraper', primary: fakeProvider('scraper', () => serp(1)), fallback: null }, now: () => NOW });
		expect(r.skipped).toBe(true);
		expect(snapshotUpserts.length).toBe(0);
	});

	test('proiect în pauză → skip fără rulare', async () => {
		selectQueue.push([project({ pausedAt: '2026-09-01T00:00:00Z' })]);
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers: { mode: 'scraper', primary: fakeProvider('scraper', () => serp(1)), fallback: null }, now: () => NOW });
		expect(r.skipped).toBe(true);
		expect(runInserts.length).toBe(0);
	});

	test('fără keywords active → skip', async () => {
		selectQueue.push([project()], []);
		const r = await runRankProjectCheck({ tenantId: 't1', projectId: 'p1' }, { providers: { mode: 'scraper', primary: fakeProvider('scraper', () => serp(1)), fallback: null }, now: () => NOW });
		expect(r.skipped).toBe(true);
	});
});
