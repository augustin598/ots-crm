import { describe, test, expect, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Stare partajată cu modulele mock-uite mai jos. Fiecare `test()` își începe
// tura cu `reset()`, deci ordinea testelor nu contează.
// ---------------------------------------------------------------------------
const selectQueue: unknown[][] = [];
const updateCalls: { values: Record<string, unknown> }[] = [];
const deleteCalls: unknown[] = [];
const redisStore = new Map<string, string>();
const redisSetCalls: unknown[][] = [];
const telegramCalls: { tenantId: string; userId: string; text: string }[] = [];
const pullSiteCalls: { siteId: string; opts: unknown }[] = [];
const pullResultsById = new Map<string, unknown>();
const throwForSiteIds = new Set<string>();
let telegramResultFor: (userId: string) => { ok: boolean; reason?: string } = () => ({ ok: true });

function reset() {
	selectQueue.length = 0;
	updateCalls.length = 0;
	deleteCalls.length = 0;
	redisStore.clear();
	redisSetCalls.length = 0;
	telegramCalls.length = 0;
	pullSiteCalls.length = 0;
	pullResultsById.clear();
	throwForSiteIds.clear();
	telegramResultFor = () => ({ ok: true });
}

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://crm.test' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/static/public', () => ({}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));

// NU mock-uim drizzle-orm (convenție repo: operatorii reali sunt puri, iar db mock ignoră .where).
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { id: {}, tenantId: {}, name: {}, paused: {}, sentinelState: {}, updatedAt: {} },
	wordpressSecurityEvent: { occurredAt: {} },
	tenant: { id: {}, slug: {} },
	tenantUser: { tenantId: {}, userId: {} }
}));

mock.module('$lib/server/db', () => ({
	db: {
		select: () => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				innerJoin: () => c,
				then: (resolve: (v: unknown[]) => unknown) => resolve(selectQueue.shift() ?? [])
			};
			return c;
		},
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					updateCalls.push({ values });
				}
			})
		}),
		delete: () => ({
			where: async () => {
				deleteCalls.push({});
				return { rowsAffected: 0 };
			}
		})
	}
}));

mock.module('$lib/server/redis', () => ({
	getRedis: () => ({
		get: async (key: string) => redisStore.get(key) ?? null,
		set: async (...args: unknown[]) => {
			redisSetCalls.push(args);
			const [key, value] = args as [string, string];
			redisStore.set(key, value);
			return 'OK';
		}
	})
}));

mock.module('$lib/server/telegram/sender', () => ({
	sendTelegramMessage: async (args: { tenantId: string; userId: string; text: string }) => {
		telegramCalls.push(args);
		return telegramResultFor(args.userId);
	}
}));

mock.module('$lib/server/wordpress/sentinel/pull', () => ({
	pullSite: async (siteId: string, opts: unknown) => {
		pullSiteCalls.push({ siteId, opts });
		if (throwForSiteIds.has(siteId)) throw new Error('conector picat');
		const cfg = pullResultsById.get(siteId);
		if (!cfg) throw new Error(`test setup: no pull result configured for ${siteId}`);
		return cfg;
	}
}));

const { processWordpressSentinelDaily, SENTINEL_RETENTION_DAYS } = await import('../wordpress-sentinel-daily');

function pending(level: 'critical' | 'important', text: string) {
	return [{ level, kind: 'admin_new_ip' as const, text }];
}

describe('processWordpressSentinelDaily', () => {
	test('2 site-uri cu findings + 1 site cu eroare (failures 1) + 1 site liniștit → un digest per tenant, pending golit doar la site-ul cu findings', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([
			{ id: 's-nevada', tenantId: 't1', name: 'nevada' },
			{ id: 's-topderma', tenantId: 't1', name: 'topderma' },
			{ id: 's-quiet', tenantId: 't1', name: 'quietsite' }
		]); // 1) sites
		selectQueue.push([{ id: 't1', slug: 'ots' }]); // 2) tenants
		selectQueue.push([{ userId: 'u1' }, { userId: 'u2' }]); // 3) tenantUser
		selectQueue.push([
			{
				sentinelState: JSON.stringify({
					baselineDone: true,
					uploadsBaseline: {},
					adminIps: {},
					failedLogins: {},
					pendingFindings: pending('important', '3 logări eșuate'),
					lastError: null
				})
			}
		]); // 4) citirea sentinelState pentru nevada, înainte de golire

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 1,
			findings: pending('important', '3 logări eșuate'),
			pending: pending('important', '3 logări eșuate'),
			failures: 0
		});
		pullResultsById.set('s-topderma', {
			siteId: 's-topderma',
			siteName: 'topderma',
			status: 'error',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 1,
			error: 'timeout'
		});
		pullResultsById.set('s-quiet', {
			siteId: 's-quiet',
			siteName: 'quietsite',
			status: 'ok',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(res.success).toBe(true);
		expect(res.tenants).toBe(1);
		expect(res.pulled).toBe(3);
		expect(res.sent).toBe(1);

		// pullSite chemat cu { now, trigger: 'daily' } pentru fiecare site
		expect(pullSiteCalls).toHaveLength(3);
		for (const call of pullSiteCalls) {
			expect(call.opts).toEqual({ now, trigger: 'daily' });
		}

		// fiecare din cei 2 utilizatori a primit un mesaj cu conținutul așteptat
		expect(telegramCalls).toHaveLength(2);
		for (const call of telegramCalls) {
			expect(call.text).toContain('🟠 nevada: 3 logări eșuate');
			expect(call.text).toContain('🟠 topderma: nu răspunde (prima zi)');
			expect(call.text).toContain('✅ 1 site-uri liniștite');
			expect(call.text).toContain('https://crm.test/ots/wordpress/security');
		}

		// cheia Redis setată o dată, idempotent 36h
		expect(redisSetCalls).toHaveLength(1);
		expect(redisSetCalls[0]).toEqual(['sentinel:digest:t1:2026-09-28', '1', 'EX', 129600, 'NX']);

		// pending golit doar pentru nevada
		expect(updateCalls).toHaveLength(1);
		const state = JSON.parse(updateCalls[0].values.sentinelState as string);
		expect(state.pendingFindings).toEqual([]);
	});

	test('failures >= 2 → mesaj critic "nu răspunde de N zile"', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([{ id: 's-topderma', tenantId: 't2', name: 'topderma' }]);
		selectQueue.push([{ id: 't2', slug: 'acme' }]);
		selectQueue.push([{ userId: 'u3' }]);

		pullResultsById.set('s-topderma', {
			siteId: 's-topderma',
			siteName: 'topderma',
			status: 'error',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 2,
			error: 'timeout'
		});

		await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(1);
		expect(telegramCalls[0].text).toContain('🔴 topderma: nu răspunde de 2 zile');
		// niciun pending de golit (status error, pending gol)
		expect(updateCalls).toHaveLength(0);
	});

	test('cheia Redis deja setată → nu trimite nimic, dar tot citește site-urile', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');
		redisStore.set('sentinel:digest:t3:2026-09-28', '1');

		selectQueue.push([{ id: 's-x', tenantId: 't3', name: 'siteX' }]);
		selectQueue.push([{ id: 't3', slug: 'demo' }]);

		pullResultsById.set('s-x', {
			siteId: 's-x',
			siteName: 'siteX',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'ceva'),
			pending: pending('important', 'ceva'),
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(pullSiteCalls).toHaveLength(1); // pull-ul tot are loc
		expect(telegramCalls).toHaveLength(0);
		expect(redisSetCalls).toHaveLength(0);
		expect(updateCalls).toHaveLength(0);
		expect(res.sent).toBe(0);
	});

	test('site unsupported: absent din mesaj, nu se numără liniștit', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([
			{ id: 's-legacy', tenantId: 't4', name: 'legacysite' },
			{ id: 's-quiet', tenantId: 't4', name: 'quietsite' }
		]);
		selectQueue.push([{ id: 't4', slug: 'legacy' }]);
		selectQueue.push([{ userId: 'u4' }]);

		pullResultsById.set('s-legacy', {
			siteId: 's-legacy',
			siteName: 'legacysite',
			status: 'unsupported',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 0
		});
		pullResultsById.set('s-quiet', {
			siteId: 's-quiet',
			siteName: 'quietsite',
			status: 'ok',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 0
		});

		await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(1);
		expect(telegramCalls[0].text).not.toContain('legacysite');
		expect(telegramCalls[0].text).toContain('✅ 1 site-uri liniștite');
	});

	test('toți utilizatorii not_linked → nu setează cheia, nu golește pending', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');
		telegramResultFor = () => ({ ok: false, reason: 'not_linked' });

		selectQueue.push([{ id: 's-nevada', tenantId: 't5', name: 'nevada' }]);
		selectQueue.push([{ id: 't5', slug: 'ots5' }]);
		selectQueue.push([{ userId: 'u5' }, { userId: 'u6' }]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'ceva'),
			pending: pending('important', 'ceva'),
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(2); // s-a încercat trimiterea
		expect(redisSetCalls).toHaveLength(0);
		expect(updateCalls).toHaveLength(0);
		expect(res.sent).toBe(0);
	});

	test('ziua calendaristică se calculează în ora României', async () => {
		reset();
		const now = new Date('2026-09-28T22:30:00Z'); // 01:30 la București → 29 sept.

		selectQueue.push([{ id: 's-nevada', tenantId: 't6', name: 'nevada' }]);
		selectQueue.push([{ id: 't6', slug: 'ots6' }]);
		selectQueue.push([{ userId: 'u7' }]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'ceva'),
			pending: pending('important', 'ceva'),
			failures: 0
		});

		await processWordpressSentinelDaily({}, now);

		expect(redisSetCalls).toHaveLength(1);
		expect((redisSetCalls[0][0] as string)).toBe('sentinel:digest:t6:2026-09-29');
	});

	test('retenția (7 zile) rulează exact o dată, indiferent de câți tenanți', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([]); // niciun site nepauzat

		const res = await processWordpressSentinelDaily({}, now);

		expect(deleteCalls).toHaveLength(1);
		expect(res.tenants).toBe(0);
		expect(SENTINEL_RETENTION_DAYS).toBe(7);
	});

	test('pullSite aruncă pentru un site → restul tot se citesc, digestul include site-ul picat ca "nu răspunde (prima zi)"', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([
			{ id: 's-broken', tenantId: 't7', name: 'brokensite' },
			{ id: 's-ok', tenantId: 't7', name: 'oksite' }
		]);
		selectQueue.push([{ id: 't7', slug: 'ots7' }]);
		selectQueue.push([{ userId: 'u8' }]);

		throwForSiteIds.add('s-broken');
		pullResultsById.set('s-ok', {
			siteId: 's-ok',
			siteName: 'oksite',
			status: 'ok',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(pullSiteCalls).toHaveLength(2);
		expect(res.pulled).toBe(2);
		expect(telegramCalls).toHaveLength(1);
		expect(telegramCalls[0].text).toContain('🟠 brokensite: nu răspunde (prima zi)');
		expect(telegramCalls[0].text).toContain('✅ 1 site-uri liniștite');
	});
});
