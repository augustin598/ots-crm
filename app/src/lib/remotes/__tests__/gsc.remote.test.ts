// Teste pentru remote-urile Search Console: autorizare, scoping pe tenant și faptul
// că starea integrării NU întoarce niciodată tokenii.
// Harnessul de mockuri e copiat din `rank-tracker.remote.test.ts` — eager-load pe
// schema reală ÎNAINTE de orice mock (`mock.module` e global în Bun).
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

const remote = await import('../gsc.remote');

beforeEach(() => {
	selectQueue.length = 0;
	inserted.length = 0;
	updated.length = 0;
	deleteCalls = 0;
	queueAdds.length = 0;
	redisStore.clear();
	currentEvent = { locals: { user: { id: 'u1' }, tenant: { id: 't1' } } };
});

describe('getGscStatus', () => {
	test('fără sesiune → 401', async () => {
		currentEvent = null;
		await expect(remote.getGscStatus()).rejects.toThrow();
	});

	test('fără integrare → connected false', async () => {
		selectQueue.push([]);
		expect(await remote.getGscStatus()).toMatchObject({ connected: false });
	});

	test('NU întoarce niciodată tokenii', async () => {
		selectQueue.push([
			{
				email: 'x@y.ro',
				isActive: true,
				accessTokenEncrypted: 'SECRET',
				refreshTokenEncrypted: 'SECRET',
				lastSyncAt: null,
				lastError: null
			}
		]);
		const status = await remote.getGscStatus();
		expect(JSON.stringify(status)).not.toContain('SECRET');
	});
});

describe('setGscProperty', () => {
	test('proiect din alt tenant → 404', async () => {
		selectQueue.push([]); // proiectul nu se găsește sub tenantId-ul sesiunii
		await expect(
			remote.setGscProperty({ projectId: 'p-strain', property: 'sc-domain:x.ro' })
		).rejects.toThrow();
	});
});
