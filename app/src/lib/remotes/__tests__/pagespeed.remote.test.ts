// Teste pentru remote-urile PageSpeed: validări, scoping pe tenant (orice citire/
// mutație filtrează pe tenantul din sesiune), upsert setări, refuz dublă scanare.
import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ATENȚIE: eager-load pe schema reală înainte de orice mock — mock.module e global în Bun.
await import('$lib/server/db/schema');

const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];
let deleteCalls = 0;

const dbMock = {
	select: (..._cols: unknown[]) => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			leftJoin: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			then: (resolve: (rows: unknown[]) => void) => resolve(selectQueue.shift() ?? [])
		};
		return chain;
	},
	insert: () => ({
		values: async (val: Record<string, unknown>) => {
			inserted.push(val);
		}
	}),
	update: () => ({
		set: (val: Record<string, unknown>) => ({
			where: async () => {
				updated.push(val);
			}
		})
	}),
	delete: () => ({
		where: async () => {
			deleteCalls++;
		}
	})
};

const redisStore = new Map<string, string>();
const redisMock = {
	get: async (key: string) => redisStore.get(key) ?? null,
	set: async (key: string, value: string) => {
		redisStore.set(key, value);
		return 'OK';
	},
	del: async (key: string) => redisStore.delete(key)
};

const queueAdds: { name: string; data: unknown }[] = [];

let currentEvent: Record<string, unknown> | null = {
	locals: { user: { id: 'u1' }, tenant: { id: 't1' } }
};

// wrapper-ele reale validează inputul cu valibot — mock-ul păstrează acest comportament
const withSchema =
	(schemaOrFn: unknown, fn?: unknown) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async (arg?: any) => {
		if (typeof fn !== 'function') return (schemaOrFn as (a?: unknown) => unknown)(arg);
		const vlib = await import('valibot');
		const parsed = vlib.parse(schemaOrFn as never, arg);
		return (fn as (a: unknown) => unknown)(parsed);
	};
mock.module('$app/server', () => ({
	query: withSchema,
	command: withSchema,
	getRequestEvent: () => currentEvent
}));
mock.module('$env/dynamic/private', () => ({ env: { PSI_API_KEY: 'k' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/redis', () => ({ getRedis: () => redisMock }));
mock.module('$lib/server/get-actor', () => ({ requireStaff: async () => ({ id: 'u1' }) }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));
mock.module('$lib/server/scheduler', () => ({
	getSchedulerQueue: () => ({
		add: async (name: string, data: unknown) => {
			queueAdds.push({ name, data });
		}
	})
}));

const remote = await import('../pagespeed.remote');

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
		await expect(remote.getPagespeedSites()).rejects.toThrow();
	});
});

describe('savePagespeedSite', () => {
	const valid = {
		name: 'Site Test',
		clientId: null,
		cms: 'WordPress',
		alertThreshold: 5,
		active: true,
		strategies: ['mobile', 'desktop'] as ('mobile' | 'desktop')[],
		pages: [{ url: 'exemplu.ro', label: 'Homepage' }]
	};

	test('normalizează URL-ul (https://) și derivă domeniul', async () => {
		const result = await remote.savePagespeedSite(valid);
		expect(result.created).toBe(true);
		expect(inserted.length).toBe(1);
		expect(inserted[0]).toMatchObject({ tenantId: 't1', domain: 'exemplu.ro' });
		expect((inserted[0].pages as { url: string }[])[0].url).toBe('https://exemplu.ro/');
	});

	test('URL invalid → eroare, nu inserează', async () => {
		await expect(
			remote.savePagespeedSite({ ...valid, pages: [{ url: 'ht!tp://%%%', label: 'x' }] })
		).rejects.toThrow();
		expect(inserted.length).toBe(0);
	});

	test('fără nicio strategie → eroare de validare', async () => {
		await expect(remote.savePagespeedSite({ ...valid, strategies: [] })).rejects.toThrow();
		expect(inserted.length).toBe(0);
	});

	test('editare: site inexistent pe tenant → 404, fără update', async () => {
		selectQueue.push([]); // căutarea site-ului pe tenant nu găsește nimic
		await expect(remote.savePagespeedSite({ ...valid, id: 'strain' })).rejects.toThrow();
		expect(updated.length).toBe(0);
	});

	test('editare validă → update, nu insert', async () => {
		selectQueue.push([{ id: 's1' }]);
		const result = await remote.savePagespeedSite({ ...valid, id: 's1' });
		expect(result.created).toBe(false);
		expect(updated.length).toBe(1);
		expect(inserted.length).toBe(0);
	});
});

describe('deletePagespeedSite', () => {
	test('site al altui tenant → 404, fără delete', async () => {
		selectQueue.push([]);
		await expect(remote.deletePagespeedSite('s-strain')).rejects.toThrow();
		expect(deleteCalls).toBe(0);
	});

	test('site propriu → delete', async () => {
		selectQueue.push([{ id: 's1' }]);
		await remote.deletePagespeedSite('s1');
		expect(deleteCalls).toBe(1);
	});
});

describe('getPagespeedSites — trend pe aceeași strategie', () => {
	test('delta = ultima − precedenta măsurătoare ok, per site + strategie', async () => {
		selectQueue.push([
			{
				id: 's1',
				tenantId: 't1',
				clientId: null,
				clientName: null,
				domain: 'a.ro',
				name: 'A',
				cms: 'WordPress',
				pages: [{ url: 'https://a.ro/', label: 'Homepage' }],
				strategies: ['mobile'],
				alertThreshold: 5,
				active: true,
				pausedAt: null,
				createdAt: new Date('2026-08-01')
			}
		]);
		const m = (perf: number, at: string, extra: Record<string, unknown> = {}) => ({
			id: `m${perf}`,
			siteId: 's1',
			strategy: 'mobile',
			measuredAt: new Date(at),
			weekKey: '2026-W35',
			status: 'ok',
			errorMessage: null,
			performance: perf,
			accessibility: 90,
			bestPractices: 90,
			seo: 90,
			lcpMs: 2000,
			cls: 0.05,
			tbtMs: 100,
			fcpMs: 1200,
			speedIndexMs: 3000,
			inpMs: 150,
			ttfbMs: 300,
			totalBytes: 1000,
			requestCount: 10,
			fieldLcpMs: 2100,
			fieldInpMs: 160,
			fieldCls: 0.04,
			fieldSampleCount: null,
			opportunities: [],
			...extra
		});
		// interogarea vine sortată descrescător după measuredAt
		selectQueue.push([m(72, '2026-08-31T07:00:00Z'), m(64, '2026-08-24T07:00:00Z')]);
		const result = await remote.getPagespeedSites();
		const siteRow = result.sites[0];
		expect(siteRow.data.mobile?.last?.performance).toBe(72);
		expect(siteRow.data.mobile?.delta).toBe(8);
		expect(siteRow.data.mobile?.spark).toEqual([64, 72]);
		expect(siteRow.cwv).toBe(true); // 2100 ≤ 2500, 160 ≤ 200, 0.04 ≤ 0.1
	});
});

describe('savePagespeedSettings', () => {
	const valid = {
		dayOfWeek: 1,
		hour: '07:00',
		strategies: ['mobile', 'desktop'] as ('mobile' | 'desktop')[],
		recipients: ['seo@onetopsolution.ro'],
		alertThreshold: 5,
		onlyOnDrop: false,
		includeOpportunities: true,
		attachPdf: false,
		sendToClient: false,
		isEnabled: true
	};

	test('fără rând existent → insert cu tenantId', async () => {
		selectQueue.push([]);
		await remote.savePagespeedSettings(valid);
		expect(inserted.length).toBe(1);
		expect(inserted[0]).toMatchObject({ tenantId: 't1', hour: '07:00' });
	});

	test('rând existent → update', async () => {
		selectQueue.push([{ id: 'set1' }]);
		await remote.savePagespeedSettings({ ...valid, hour: '09:00' });
		expect(updated.length).toBe(1);
		expect(inserted.length).toBe(0);
	});

	test('email invalid în destinatari → eroare', async () => {
		await expect(
			remote.savePagespeedSettings({ ...valid, recipients: ['nu-e-email'] })
		).rejects.toThrow();
	});

	test('oră în afara listei → eroare', async () => {
		await expect(remote.savePagespeedSettings({ ...valid, hour: '03:33' })).rejects.toThrow();
	});
});

describe('startPagespeedScan', () => {
	test('pune jobul în coadă cu tenantId', async () => {
		const result = await remote.startPagespeedScan(undefined);
		expect(result.started).toBe(true);
		expect(queueAdds.length).toBe(1);
		expect(queueAdds[0].data).toMatchObject({
			type: 'pagespeed_scan',
			params: { tenantId: 't1' }
		});
	});

	test('scan activ → refuză (fără dublare)', async () => {
		redisStore.set(
			't1:pagespeed:scan',
			JSON.stringify({ scanId: 'x', total: 3, done: 0, perSite: {}, startedAt: 'now' })
		);
		await expect(remote.startPagespeedScan(undefined)).rejects.toThrow();
		expect(queueAdds.length).toBe(0);
	});
});
