import { describe, test, expect, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Stare partajată cu modulele mock-uite mai jos. Fiecare `test()` își începe
// tura cu `reset()`, deci ordinea testelor nu contează.
// ---------------------------------------------------------------------------
const selectQueue: unknown[][] = [];
const selectCalls: { cols: unknown; where?: unknown }[] = [];
const updateCalls: { values: Record<string, unknown> }[] = [];
const deleteCalls: unknown[] = [];
const redisStore = new Map<string, string>();
const redisSetCalls: unknown[][] = [];
const telegramCalls: { tenantId: string; userId: string; text: string }[] = [];
const pullSiteCalls: { siteId: string; opts: unknown }[] = [];
const pullResultsById = new Map<string, unknown>();
const throwForSiteIds = new Set<string>();
const busySiteIds = new Set<string>(); // withSiteLock aruncă SiteBusyError pentru aceste site-uri
let telegramResultFor: (userId: string) => { ok: boolean; reason?: string } = () => ({ ok: true });
let redisGetThrows = false;
let redisSetThrows = false;

/** Aceeași clasă e exportată de mock-ul `$lib/server/wordpress/sentinel/pull` — instanceof funcționează în cod ca-n producție. */
class SiteBusyErrorForTest extends Error {
	constructor(message = 'Citire în curs pentru acest site') {
		super(message);
		this.name = 'SiteBusyError';
	}
}

function reset() {
	selectQueue.length = 0;
	selectCalls.length = 0;
	updateCalls.length = 0;
	deleteCalls.length = 0;
	redisStore.clear();
	redisSetCalls.length = 0;
	telegramCalls.length = 0;
	pullSiteCalls.length = 0;
	pullResultsById.clear();
	throwForSiteIds.clear();
	busySiteIds.clear();
	telegramResultFor = () => ({ ok: true });
	redisGetThrows = false;
	redisSetThrows = false;
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
	tenantUser: { tenantId: {}, userId: {}, status: {}, role: {} }
}));

mock.module('$lib/server/db', () => ({
	db: {
		select: (cols?: unknown) => {
			const rec: { cols: unknown; where?: unknown } = { cols };
			selectCalls.push(rec);
			const c: Record<string, unknown> = {
				from: () => c,
				where: (cond: unknown) => {
					rec.where = cond;
					return c;
				},
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
		get: async (key: string) => {
			if (redisGetThrows) throw new Error('redis indisponibil (get)');
			return redisStore.get(key) ?? null;
		},
		set: async (...args: unknown[]) => {
			if (redisSetThrows) throw new Error('redis indisponibil (set)');
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
	},
	SENTINEL_RETENTION_DAYS: 7,
	SiteBusyError: SiteBusyErrorForTest,
	// Simulăm doar orchestrarea din daily.ts (skip la SiteBusyError) — lock-ul Redis real e testat în pull.test.ts.
	withSiteLock: async <T>(siteId: string, fn: () => Promise<T>): Promise<T> => {
		if (busySiteIds.has(siteId)) throw new SiteBusyErrorForTest();
		return fn();
	}
}));

const { processWordpressSentinelDaily, SENTINEL_RETENTION_DAYS } = await import('../wordpress-sentinel-daily');
const table = await import('$lib/server/db/schema');

function pending(level: 'critical' | 'important', text: string) {
	return [{ level, kind: 'admin_new_ip' as const, text }];
}

/** Caută recursiv o referință exactă (`===`) în graful drizzle SQL produs de `eq`/`and` — folosit ca să verificăm ce coloană a intrat în `.where()` fără a depinde de mock-uirea drizzle-orm. */
function referencesColumn(cond: unknown, col: unknown, depth = 0, seen = new Set<unknown>()): boolean {
	if (depth > 12 || cond == null || typeof cond !== 'object' || seen.has(cond)) return false;
	seen.add(cond);
	if (cond === col) return true;
	for (const k of Object.keys(cond as Record<string, unknown>)) {
		try {
			if (referencesColumn((cond as Record<string, unknown>)[k], col, depth + 1, seen)) return true;
		} catch {
			// proprietăți getter care aruncă — ignorăm
		}
	}
	return false;
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

	// --- Fix 6: golire pe identitate, sub lock ----------------------------------
	test('golirea pending e pe identitate: un finding adăugat concurent după citire rămâne', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([{ id: 's-nevada', tenantId: 't1', name: 'nevada' }]);
		selectQueue.push([{ id: 't1', slug: 'ots' }]);
		selectQueue.push([{ userId: 'u1' }]);
		selectQueue.push([
			{
				sentinelState: JSON.stringify({
					baselineDone: true,
					uploadsBaseline: {},
					adminIps: {},
					failedLogins: {},
					pendingFindings: [
						{ level: 'important', kind: 'admin_new_ip', text: 'trimis1' },
						{ level: 'critical', kind: 'php_in_uploads', text: 'trimis2' },
						{ level: 'important', kind: 'plugin_change', text: 'adăugat concurent' }
					],
					lastError: null
				})
			}
		]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: [],
			pending: [
				{ level: 'important', kind: 'admin_new_ip', text: 'trimis1' },
				{ level: 'critical', kind: 'php_in_uploads', text: 'trimis2' }
			],
			failures: 0
		});

		await processWordpressSentinelDaily({}, now);

		expect(updateCalls).toHaveLength(1);
		const state = JSON.parse(updateCalls[0].values.sentinelState as string);
		expect(state.pendingFindings).toEqual([{ level: 'important', kind: 'plugin_change', text: 'adăugat concurent' }]);
	});

	test('golirea pending e omisă dacă lock-ul de site e ocupat (SiteBusyError) — nu aruncă, digestul tot pleacă', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');
		busySiteIds.add('s-nevada');

		selectQueue.push([{ id: 's-nevada', tenantId: 't1', name: 'nevada' }]);
		selectQueue.push([{ id: 't1', slug: 'ots' }]);
		selectQueue.push([{ userId: 'u1' }]);
		// fără al 4-lea select — clear-ul e omis înainte de a citi starea

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'x'),
			pending: pending('important', 'x'),
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(1); // digestul tot pleacă
		expect(res.sent).toBe(1);
		expect(updateCalls).toHaveLength(0); // dar nimic scris pentru golirea pending-ului
	});

	// --- Fix 7: tenant cu toate site-urile unsupported --------------------------
	test('tenant cu toate site-urile unsupported → nu trimite nimic, nu atinge Redis', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([{ id: 's-legacy', tenantId: 't9', name: 'legacysite' }]);
		selectQueue.push([{ id: 't9', slug: 'legacy9' }]);
		// niciun select de tenantUser — nu trebuie ajuns

		pullResultsById.set('s-legacy', {
			siteId: 's-legacy',
			siteName: 'legacysite',
			status: 'unsupported',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(0);
		expect(redisSetCalls).toHaveLength(0);
		expect(updateCalls).toHaveLength(0);
		expect(res.sent).toBe(0);
	});

	// --- Fix 8: destinatari doar tenantUser.status = 'active' -------------------
	test('destinatarii digestului: interogarea filtrează pe tenantUser.status', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([{ id: 's-nevada', tenantId: 't1', name: 'nevada' }]);
		selectQueue.push([{ id: 't1', slug: 'ots' }]);
		selectQueue.push([{ userId: 'u1' }]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'x'),
			pending: pending('important', 'x'),
			failures: 0
		});

		await processWordpressSentinelDaily({}, now);

		const usersCall = selectCalls.find(
			(c) => c.cols && typeof c.cols === 'object' && 'userId' in (c.cols as object) && !('id' in (c.cols as object))
		);
		expect(usersCall).toBeDefined();
		expect(referencesColumn(usersCall!.where, table.tenantUser.status)).toBe(true);
		// Rezumatul conține username-uri de admin și IP-uri → doar owner-ul tenantului îl primește.
		expect(referencesColumn(usersCall!.where, table.tenantUser.role)).toBe(true);
	});

	// --- Fix 9: Redis aruncă la verificarea/setarea idempotenței ----------------
	test('Redis GET aruncă la verificarea idempotenței → trimite oricum', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');
		redisGetThrows = true;

		selectQueue.push([{ id: 's-nevada', tenantId: 't1', name: 'nevada' }]);
		selectQueue.push([{ id: 't1', slug: 'ots' }]);
		selectQueue.push([{ userId: 'u1' }]);
		selectQueue.push([
			{
				sentinelState: JSON.stringify({
					baselineDone: true,
					uploadsBaseline: {},
					adminIps: {},
					failedLogins: {},
					pendingFindings: pending('important', 'x'),
					lastError: null
				})
			}
		]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'x'),
			pending: pending('important', 'x'),
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(1);
		expect(res.sent).toBe(1);
	});

	test('Redis SET aruncă la marcarea idempotenței → mesajele tot au fost trimise, golirea pending tot are loc', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');
		redisSetThrows = true;

		selectQueue.push([{ id: 's-nevada', tenantId: 't1', name: 'nevada' }]);
		selectQueue.push([{ id: 't1', slug: 'ots' }]);
		selectQueue.push([{ userId: 'u1' }]);
		selectQueue.push([
			{
				sentinelState: JSON.stringify({
					baselineDone: true,
					uploadsBaseline: {},
					adminIps: {},
					failedLogins: {},
					pendingFindings: pending('important', 'x'),
					lastError: null
				})
			}
		]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'x'),
			pending: pending('important', 'x'),
			failures: 0
		});

		const res = await processWordpressSentinelDaily({}, now);

		expect(telegramCalls).toHaveLength(1);
		expect(res.sent).toBe(1);
		expect(redisSetCalls).toHaveLength(0); // a aruncat, dar nu a blocat restul
		expect(updateCalls).toHaveLength(1); // golirea pending tot a avut loc
	});

	// --- M1: lastFailureDay e parte din SentinelState — golirea trece prin parseState și-l păstrează ---
	test('golirea pending-ului păstrează lastFailureDay (parte din SentinelState, nu se pierde la round-trip)', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([{ id: 's-nevada', tenantId: 't1', name: 'nevada' }]);
		selectQueue.push([{ id: 't1', slug: 'ots' }]);
		selectQueue.push([{ userId: 'u1' }]);
		selectQueue.push([
			{
				sentinelState: JSON.stringify({
					baselineDone: true,
					uploadsBaseline: {},
					adminIps: {},
					failedLogins: {},
					pendingFindings: pending('important', 'x'),
					recentFindings: [],
					lastScan: null,
					lastFailureDay: '2026-09-27',
					lastError: null
				})
			}
		]);

		pullResultsById.set('s-nevada', {
			siteId: 's-nevada',
			siteName: 'nevada',
			status: 'ok',
			inserted: 0,
			findings: pending('important', 'x'),
			pending: pending('important', 'x'),
			failures: 0
		});

		await processWordpressSentinelDaily({}, now);

		expect(updateCalls).toHaveLength(1);
		const state = JSON.parse(updateCalls[0].values.sentinelState as string);
		expect(state.lastFailureDay).toBe('2026-09-27');
		expect(state.pendingFindings).toEqual([]);
	});

	// --- M3: site 'busy' (lock ocupat) — findings pending intră în digest, fără „nu răspunde”, nu se numără liniștit ---
	test('site busy cu pending: intră în digest cu findings-urile deja în așteptare, fără linie „nu răspunde”', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([
			{ id: 's-busy', tenantId: 't10', name: 'busysite' },
			{ id: 's-quiet', tenantId: 't10', name: 'quietsite' }
		]);
		selectQueue.push([{ id: 't10', slug: 'ots10' }]);
		selectQueue.push([{ userId: 'u10' }]);
		selectQueue.push([{ sentinelState: JSON.stringify({ baselineDone: true, uploadsBaseline: {}, adminIps: {}, failedLogins: {}, pendingFindings: pending('important', 'ceva găsit înainte de blocare'), lastError: null }) }]); // clear pentru busysite

		pullResultsById.set('s-busy', {
			siteId: 's-busy',
			siteName: 'busysite',
			status: 'busy',
			inserted: 0,
			findings: [],
			pending: pending('important', 'ceva găsit înainte de blocare'),
			failures: 0,
			error: 'citire în curs'
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

		expect(telegramCalls).toHaveLength(1);
		expect(telegramCalls[0].text).toContain('busysite: ceva găsit înainte de blocare');
		expect(telegramCalls[0].text).not.toContain('nu răspunde');
		expect(telegramCalls[0].text).toContain('✅ 1 site-uri liniștite'); // doar quietsite
		expect(res.sent).toBe(1);
	});

	test('site busy fără pending: nu apare în digest și NU se numără liniștit', async () => {
		reset();
		const now = new Date('2026-09-28T06:00:00Z');

		selectQueue.push([
			{ id: 's-busy', tenantId: 't11', name: 'busysite' },
			{ id: 's-quiet', tenantId: 't11', name: 'quietsite' }
		]);
		selectQueue.push([{ id: 't11', slug: 'ots11' }]);
		selectQueue.push([{ userId: 'u11' }]);

		pullResultsById.set('s-busy', {
			siteId: 's-busy',
			siteName: 'busysite',
			status: 'busy',
			inserted: 0,
			findings: [],
			pending: [],
			failures: 0,
			error: 'citire în curs'
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

		expect(telegramCalls).toHaveLength(1);
		expect(telegramCalls[0].text).not.toContain('busysite');
		expect(telegramCalls[0].text).toContain('✅ 1 site-uri liniștite'); // NU 2 — busysite nu se numără liniștit
		expect(res.sent).toBe(1);
	});
});
