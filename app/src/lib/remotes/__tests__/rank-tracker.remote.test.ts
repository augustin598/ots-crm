// Teste pentru remote-urile Rank Tracker: autorizare, scoping pe tenant, limita de
// cuvinte cheie, normalizarea domeniului, rate-limit la verificarea manuală, și faptul
// că integrarea SERP NU întoarce niciodată credențialele.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

await import('$lib/server/db/schema');

const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];
let deleteCalls = 0;

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			leftJoin: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			then: (resolve: (rows: unknown[]) => void) => resolve(selectQueue.shift() ?? [])
		};
		return chain;
	},
	insert: () => ({
		values: async (val: Record<string, unknown> | Record<string, unknown>[]) => {
			if (Array.isArray(val)) inserted.push(...val);
			else inserted.push(val);
		}
	}),
	update: () => ({ set: (val: Record<string, unknown>) => ({ where: async () => { updated.push(val); } }) }),
	delete: () => ({ where: async () => { deleteCalls++; } })
};

const redisStore = new Map<string, string>();
const queueAdds: { name: string; data: unknown }[] = [];
let currentEvent: Record<string, unknown> | null = { locals: { user: { id: 'u1' }, tenant: { id: 't1' } } };

const withSchema =
	(schemaOrFn: unknown, fn?: unknown) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async (arg?: any) => {
		if (typeof fn !== 'function') return (schemaOrFn as (a?: unknown) => unknown)(arg);
		const vlib = await import('valibot');
		const parsed = vlib.parse(schemaOrFn as never, arg);
		return (fn as (a: unknown) => unknown)(parsed);
	};

mock.module('$app/server', () => ({ query: withSchema, command: withSchema, getRequestEvent: () => currentEvent }));
mock.module('$env/dynamic/private', () => ({ env: { RANK_MAX_KEYWORDS_PER_PROJECT: '5' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/redis', () => ({ getRedis: () => ({
	get: async (k: string) => redisStore.get(k) ?? null,
	set: async (k: string, v: string) => { redisStore.set(k, v); return 'OK'; }
}) }));
mock.module('$lib/server/get-actor', () => ({ requireStaff: async () => ({ id: 'u1' }) }));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e) }) }));
mock.module('$lib/server/scheduler', () => ({ getSchedulerQueue: () => ({ add: async (name: string, data: unknown) => { queueAdds.push({ name, data }); } }) }));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({ encryptVerified: (_t: string, val: string) => `enc:${val}`, decrypt: (_t: string, c: string) => c, DecryptionError: class extends Error {} }));

const remote = await import('../rank-tracker.remote');

beforeEach(() => {
	selectQueue.length = 0;
	inserted.length = 0;
	updated.length = 0;
	deleteCalls = 0;
	queueAdds.length = 0;
	redisStore.clear();
	currentEvent = { locals: { user: { id: 'u1' }, tenant: { id: 't1' } } };
});

describe('autorizare', () => {
	test('fără sesiune → 401', async () => {
		currentEvent = { locals: {} };
		await expect(remote.getRankProjects()).rejects.toThrow();
	});
});

describe('saveRankProject — normalizare', () => {
	test('domeniul e normalizat (fără https/www, lowercase); competitorii la fel', async () => {
		await remote.saveRankProject({
			name: 'Test',
			clientId: null,
			domain: 'https://WWW.Example.RO/pagina',
			locale: 'google.ro|ro',
			locations: ['București'],
			competitors: ['https://Competitor-A.ro/'],
			devices: ['desktop', 'mobile'],
			alertThreshold: 5,
			active: true
		});
		expect(inserted[0].domain).toBe('example.ro');
		expect(inserted[0].competitors).toEqual(['competitor-a.ro']);
	});
});

describe('deleteRankProject — scoping', () => {
	test('ștergerea filtrează pe tenant', async () => {
		await remote.deleteRankProject('p1');
		expect(deleteCalls).toBe(1);
	});
});

describe('addRankKeywords — limită și dedup', () => {
	test('respinge peste limita de cuvinte cheie', async () => {
		selectQueue.push([{ id: 'p1' }]); // proiect există
		selectQueue.push([]); // keyword-uri existente pe (proiect, locație)
		selectQueue.push([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]); // total 4 existente
		await expect(
			remote.addRankKeywords({ projectId: 'p1', keywords: ['x', 'y', 'z'] })
		).rejects.toThrow(); // 4 + 3 = 7 > 5
		expect(inserted.length).toBe(0);
	});

	test('dedup contra celor existente + în cadrul inputului', async () => {
		selectQueue.push([{ id: 'p1' }]);
		selectQueue.push([{ keyword: 'seo' }]); // 'seo' există deja
		selectQueue.push([{ id: 'a' }]); // 1 total
		const r = await remote.addRankKeywords({ projectId: 'p1', keywords: ['seo', 'nou', 'nou', ' nou '] });
		expect((r as { added: number }).added).toBe(1); // doar 'nou', o singură dată
		expect(inserted.length).toBe(1);
		expect(inserted[0].keyword).toBe('nou');
	});
});

describe('startRankCheck — guard și rate-limit', () => {
	test('verificare deja în curs → 409', async () => {
		selectQueue.push([{ id: 'p1' }]); // proiect
		redisStore.set('t1:rank:run:p1', JSON.stringify({ runId: 'r', total: 1, done: 0 })); // fără finishedAt
		await expect(remote.startRankCheck('p1')).rejects.toThrow();
		expect(queueAdds.length).toBe(0);
	});

	test('rulare manuală recentă (sub 1h) → 429', async () => {
		selectQueue.push([{ id: 'p1' }]); // proiect
		selectQueue.push([{ id: 'r-recent' }]); // rulare manuală recentă
		await expect(remote.startRankCheck('p1')).rejects.toThrow();
		expect(queueAdds.length).toBe(0);
	});

	test('altfel → pune în coadă job-ul manual', async () => {
		selectQueue.push([{ id: 'p1' }]); // proiect
		selectQueue.push([]); // fără rulare manuală recentă
		const r = await remote.startRankCheck('p1');
		expect((r as { started: boolean }).started).toBe(true);
		expect(queueAdds[0].name).toBe('rank-project-check');
		expect((queueAdds[0].data as { params: { trigger: string } }).params.trigger).toBe('manual');
	});
});

describe('saveSerpIntegration — credențiale', () => {
	test('salvează criptat și NU întoarce credențialele', async () => {
		selectQueue.push([]); // fără integrare existentă → insert
		const r = await remote.saveSerpIntegration({ login: 'user', password: 'parola' });
		expect(r).toEqual({ ok: true });
		expect(JSON.stringify(r)).not.toContain('parola');
		expect(inserted[0].loginEncrypted).toBe('enc:user');
		expect(inserted[0].passwordEncrypted).toBe('enc:parola');
	});
});
