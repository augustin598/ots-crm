import { describe, test, expect, mock, beforeEach } from 'bun:test';

type Row = Record<string, unknown>;
const inserted: Row[][] = [];
const updated: Row[] = [];
let existingUids: string[] = [];
let siteRow: Row = {};
let siteRowQueryResult: Row | undefined;
let pages: Array<unknown> = [];
let calls: Array<{ since: string | null; skip: number }> = [];
let loadSiteAndClientThrows: Error | null = null;
const redisStore = new Map<string, string>();
let redisThrows = false;

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: {
		id: {},
		tenantId: {},
		name: {},
		sentinelLastPullAt: {},
		sentinelLastPullStatus: {},
		sentinelFailures: {},
		sentinelState: {},
		updatedAt: {}
	},
	wordpressSecurityEvent: { id: {}, siteId: {}, eventUid: {} }
}));
mock.module('$lib/server/db', () => ({
	db: {
		select: (cols?: Record<string, unknown>) => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				then: (r: (rows: Row[]) => unknown) => {
					if (cols && 'eventUid' in cols) {
						return r(existingUids.map((eventUid) => ({ eventUid })));
					}
					// selectSiteRow / handleLoadFailure — lookup direct al rândului de site
					return r(siteRowQueryResult ? [siteRowQueryResult] : []);
				}
			};
			return c;
		},
		insert: () => ({ values: (rows: Row[]) => ({ onConflictDoNothing: async () => { inserted.push(rows); } }) }),
		update: () => ({ set: (s: Row) => ({ where: async () => { updated.push(s); } }) })
	}
}));
mock.module('../../sync', () => ({
	loadSiteAndClient: async () => {
		if (loadSiteAndClientThrows) throw loadSiteAndClientThrows;
		return {
			site: siteRow,
			client: {
				sentinel: async (args: { since: string | null; skip: number }) => {
					calls.push(args);
					const p = pages.shift();
					if (p instanceof Error) throw p;
					return p;
				}
			}
		};
	}
}));
mock.module('../../connector-release', () => ({
	compareConnectorVersions: (a: string, b: string) => {
		const pa = a.split('.').map(Number);
		const pb = b.split('.').map(Number);
		for (let i = 0; i < 3; i++) {
			const d = (pa[i] ?? 0) - (pb[i] ?? 0);
			if (d) return d < 0 ? -1 : 1;
		}
		return 0;
	}
}));
mock.module('$lib/server/redis', () => ({
	getRedis: () => ({
		get: async (key: string) => {
			if (redisThrows) throw new Error('redis indisponibil');
			return redisStore.get(key) ?? null;
		},
		set: async (key: string, value: string, ...flags: string[]) => {
			if (redisThrows) throw new Error('redis indisponibil');
			if (flags.includes('NX') && redisStore.has(key)) return null;
			redisStore.set(key, value);
			return 'OK';
		},
		del: async (key: string) => {
			if (redisThrows) throw new Error('redis indisponibil');
			redisStore.delete(key);
		}
	})
}));

const { pullSite, supportsSentinel, withSiteLock, SiteBusyError, SENTINEL_RETENTION_DAYS } = await import('../pull');

const NOW = new Date('2026-09-28T09:00:00Z');
// admin:true — de la I4 (rules.ts), un eșec cu exista:true dar fără `admin` explicit nu mai
// contează spre pragul de admin decât dacă userul e deja cunoscut ca admin; aici simulăm un
// conector nou care trimite ambele câmpuri.
const fail = (id: string, t: string, ip = '1.1.1.1') => ({ id, t, sev: 'INFO', ev: 'login_esuat', user: '-', uid: 0, ip, uri: '/wp-login.php', ua: '', date: { login: 'adm', exista: true, admin: true } });
const scan = { files: [], scannedFiles: 0, truncated: false, durationMs: 1 };
const page = (events: unknown[], hasMore = false, legacy = false, withScan = true) => ({
	sentinel: { version: '0.9.0', legacyMuPlugin: legacy, logBytes: 10 },
	events,
	hasMore,
	scan: withScan ? scan : null,
	errors: []
});
const lastState = () => JSON.parse(updated[updated.length - 1].sentinelState as string);

beforeEach(() => {
	inserted.length = 0;
	updated.length = 0;
	existingUids = [];
	siteRowQueryResult = undefined;
	calls = [];
	pages = [];
	loadSiteAndClientThrows = null;
	redisStore.clear();
	redisThrows = false;
	siteRow = { id: 's1', tenantId: 't1', name: 'nevada', siteUrl: 'https://x.ro', connectorVersion: '0.9.0', sentinelLastPullAt: null, sentinelFailures: 0, sentinelState: null };
});

describe('supportsSentinel', () => {
	test('doar ≥ 0.9.0', () => {
		expect(supportsSentinel('0.9.0')).toBe(true);
		expect(supportsSentinel('0.10.1')).toBe(true);
		expect(supportsSentinel('0.8.5')).toBe(false);
		expect(supportsSentinel(null)).toBe(false);
	});
});

describe('pullSite', () => {
	test('conector vechi → unsupported, fără cerere', async () => {
		siteRow.connectorVersion = '0.8.5';
		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(r.status).toBe('unsupported');
		expect(calls).toHaveLength(0);
		expect(updated[0].sentinelLastPullStatus).toBe('unsupported');
	});

	test('prima citire: fără since, paginează cu skip, salvează tot, starea marcată baseline', async () => {
		pages = [page([fail('a', '2026-09-27T10:00:00Z'), fail('b', '2026-09-27T11:00:00Z')], true), page([fail('c', '2026-09-27T12:00:00Z', '2.2.2.2')], false, false, false)];
		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(calls).toEqual([{ since: null, skip: 0 }, { since: null, skip: 2 }]);
		expect(inserted.flat().map((x) => x.eventUid)).toEqual(['a', 'b', 'c']);
		expect(r.status).toBe('ok');
		expect(r.inserted).toBe(3);
		expect(r.findings.map((f) => f.kind)).toEqual(['brute_force']);
		expect(updated[0].sentinelFailures).toBe(0);
		expect(updated[0].sentinelLastPullAt).toEqual(NOW);
		const st = lastState();
		expect(st.baselineDone).toBe(true);
		expect(st.pendingFindings.map((f: { kind: string }) => f.kind)).toEqual(['brute_force']);
	});

	test('a doua citire: since = ultima citire − 1h; evenimentele deja salvate nu mai ajung la reguli', async () => {
		siteRow.sentinelLastPullAt = new Date('2026-09-28T06:00:00Z');
		siteRow.sentinelState = JSON.stringify({
			baselineDone: true, uploadsBaseline: {}, adminIps: {},
			failedLogins: { adm: [{ t: '2026-09-27T10:00:00Z', ip: '1.1.1.1' }, { t: '2026-09-27T11:00:00Z', ip: '1.1.1.1' }, { t: '2026-09-27T12:00:00Z', ip: '2.2.2.2' }] },
			pendingFindings: [], lastError: null
		});
		existingUids = ['c'];
		pages = [page([fail('c', '2026-09-27T12:00:00Z', '2.2.2.2')])];
		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(calls[0].since).toBe('2026-09-28T05:00:00.000Z');
		expect(inserted).toHaveLength(0);
		expect(r.inserted).toBe(0);
		expect(r.findings).toHaveLength(0); // același eșec retrimis nu re-declanșează brute-force
	});

	test('findings noi se adaugă la pendingFindings existente', async () => {
		siteRow.sentinelState = JSON.stringify({
			baselineDone: true, uploadsBaseline: {}, adminIps: {}, failedLogins: {},
			pendingFindings: [{ level: 'critical', kind: 'php_in_uploads', text: 'vechi' }], lastError: null
		});
		pages = [page([{ id: 'p', t: '2026-09-28T08:00:00Z', sev: 'WARN', ev: 'plugin_activated', user: 'x', uid: 1, ip: '5.5.5.5', ip_remote: '5.5.5.5', uri: '/', ua: '', date: { plugin: 'akismet/akismet.php' } }])];
		await pullSite('s1', { now: NOW, trigger: 'manual' });
		expect(lastState().pendingFindings.map((f: { text: string }) => f.text)).toEqual(['vechi', expect.stringContaining('akismet')]);
	});

	test('mu-plugin vechi prezent → status legacy', async () => {
		pages = [page([], false, true)];
		expect((await pullSite('s1', { now: NOW, trigger: 'daily' })).status).toBe('legacy');
	});

	test('eveniment cu t invalid nu se salvează și nu oprește citirea', async () => {
		pages = [page([fail('ok', '2026-09-27T10:00:00Z'), fail('rau', 'nu-e-data')])];
		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(r.status).toBe('ok');
		expect(inserted.flat().map((x) => x.eventUid)).toEqual(['ok']);
	});

	test('eroare la jobul zilnic: error, failures++, pendingFindings păstrate', async () => {
		siteRow.sentinelFailures = 1;
		siteRow.sentinelState = JSON.stringify({ baselineDone: true, uploadsBaseline: {}, adminIps: {}, failedLogins: {}, pendingFindings: [{ level: 'important', kind: 'plugin_change', text: 'p' }], lastError: null });
		pages = [new Error('HTTP 503')];
		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(r.status).toBe('error');
		expect(r.failures).toBe(2);
		expect(updated[0].sentinelFailures).toBe(2);
		expect(updated[0].sentinelLastPullStatus).toBe('error');
		const st = lastState();
		expect(st.lastError).toContain('503');
		expect(st.pendingFindings).toHaveLength(1);
	});

	test('eroare la citirea manuală: status error, dar contorul de zile nu crește', async () => {
		siteRow.sentinelFailures = 1;
		pages = [new Error('timeout')];
		const r = await pullSite('s1', { now: NOW, trigger: 'manual' });
		expect(r.status).toBe('error');
		expect(updated[0].sentinelFailures).toBeUndefined();
		expect(r.failures).toBe(1);
	});

	// --- Fix 1: trunchiere la MAX_PAGES -------------------------------------
	test('trunchiere la MAX_PAGES (20 pagini, toate hasMore=true): sentinelLastPullAt = t-ul ultimului eveniment, lastError menționează', async () => {
		const base = Date.parse('2026-09-20T00:00:00Z');
		pages = Array.from({ length: 20 }, (_, i) =>
			page([fail(`e${i}`, new Date(base + i * 3600_000).toISOString())], true, false, i === 0)
		);
		const lastT = new Date(base + 19 * 3600_000);

		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });

		expect(calls).toHaveLength(20);
		expect(r.status).toBe('ok'); // trunchierea nu e o eroare
		expect(updated[0].sentinelLastPullAt).toEqual(lastT);
		const st = lastState();
		expect(st.lastError).toContain('incompletă');
	});

	// --- Fix 2: retenție 7 zile ----------------------------------------------
	test('retenție 7 zile: eveniment vechi nu se inserează, dar IP-ul de admin intră în baseline', async () => {
		const oldT = '2026-09-19T08:00:00Z'; // > 7 zile înainte de NOW (28 sept, 09:00)
		pages = [
			page([{ id: 'old1', t: oldT, sev: 'INFO', ev: 'login_ok', user: 'adm', uid: 1, ip: '9.9.9.9', uri: '/wp-admin/', ua: '', date: { roluri: ['administrator'] } }])
		];
		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(r.status).toBe('ok');
		expect(r.inserted).toBe(0);
		expect(inserted.flat().map((x) => x.eventUid)).not.toContain('old1');
		const st = lastState();
		expect(st.adminIps.adm['9.9.9.9']).toBe(oldT);
	});

	// --- Fix 3: lock per site -------------------------------------------------
	test('citire manuală: lock ocupat de altă citire → SiteBusyError se propagă imediat (waitMs 0), fără scriere', async () => {
		redisStore.set('sentinel:pull:s1', 'alt-token');
		await expect(pullSite('s1', { now: NOW, trigger: 'manual' })).rejects.toBeInstanceOf(SiteBusyError);
		expect(updated).toHaveLength(0);
		expect(calls).toHaveLength(0);
	});

	test('job zilnic: lock ocupat pe toată durata așteptării → status error „citire în curs”, fără scriere în DB', async () => {
		redisStore.set('sentinel:pull:s1', 'alt-token'); // nimeni nu-l eliberează
		siteRowQueryResult = { id: 's1', tenantId: 't1', name: 'nevada', sentinelFailures: 0, sentinelState: null };

		const realDateNow = Date.now;
		const realSetTimeout = globalThis.setTimeout;
		let fakeNow = realDateNow();
		Date.now = () => fakeNow;
		// @ts-expect-error stub minimal pentru ceas virtual în test
		globalThis.setTimeout = (cb: () => void, ms?: number) => {
			fakeNow += ms ?? 0;
			cb();
			return 0 as unknown as ReturnType<typeof setTimeout>;
		};
		try {
			const r = await pullSite('s1', { now: NOW, trigger: 'daily' });
			expect(r.status).toBe('error');
			expect(r.error).toBe('citire în curs');
			expect(r.failures).toBe(0);
			expect(updated).toHaveLength(0);
			expect(calls).toHaveLength(0);
		} finally {
			Date.now = realDateNow;
			globalThis.setTimeout = realSetTimeout;
		}
	});

	// --- Fix 4: contor eșecuri o dată pe zi (ora României) --------------------
	test('două eșecuri zilnice în aceeași zi (ora României) → contorul crește o singură dată', async () => {
		pages = [new Error('boom1')];
		const r1 = await pullSite('s1', { now: NOW, trigger: 'daily' });
		expect(r1.failures).toBe(1);

		// simulăm persistarea scrierii anterioare înainte de a doua rulare
		siteRow.sentinelFailures = updated[updated.length - 1].sentinelFailures;
		siteRow.sentinelState = updated[updated.length - 1].sentinelState;

		pages = [new Error('boom2')];
		const r2 = await pullSite('s1', { now: NOW, trigger: 'daily' }); // aceeași zi
		expect(r2.failures).toBe(1);
		expect(updated[updated.length - 1].sentinelFailures).toBe(1);
	});

	test('a treia zi de eșec (zi calendaristică nouă) → contorul crește din nou', async () => {
		pages = [new Error('boom1')];
		await pullSite('s1', { now: NOW, trigger: 'daily' });
		siteRow.sentinelFailures = updated[updated.length - 1].sentinelFailures;
		siteRow.sentinelState = updated[updated.length - 1].sentinelState;

		const nextDay = new Date('2026-09-29T09:00:00Z');
		pages = [new Error('boom2')];
		const r = await pullSite('s1', { now: nextDay, trigger: 'daily' });
		expect(r.failures).toBe(2);
	});

	// --- Fix 5: loadSiteAndClient aruncă (decrypt/DB) --------------------------
	test('loadSiteAndClient aruncă (decrypt/DB) → status error, actualizare persistată direct din rândul de site', async () => {
		loadSiteAndClientThrows = new Error('decrypt failed');
		siteRowQueryResult = { id: 's1', tenantId: 't1', name: 'nevada', sentinelFailures: 1, sentinelState: null };

		const r = await pullSite('s1', { now: NOW, trigger: 'daily' });

		expect(r.status).toBe('error');
		expect(r.error).toContain('decrypt failed');
		expect(r.siteName).toBe('nevada');
		expect(updated).toHaveLength(1);
		expect(updated[0].sentinelLastPullStatus).toBe('error');
		expect(updated[0].sentinelFailures).toBe(2);
	});

	test('loadSiteAndClient aruncă la citire manuală → status error, contorul de zile nu crește', async () => {
		loadSiteAndClientThrows = new Error('timeout DB');
		siteRowQueryResult = { id: 's1', tenantId: 't1', name: 'nevada', sentinelFailures: 1, sentinelState: null };

		const r = await pullSite('s1', { now: NOW, trigger: 'manual' });

		expect(r.status).toBe('error');
		expect(updated[0].sentinelFailures).toBeUndefined();
		expect(r.failures).toBe(1);
	});
});

// --- withSiteLock: teste directe -------------------------------------------
describe('withSiteLock', () => {
	test('a doua achiziție concurentă (waitMs 0) aruncă SiteBusyError imediat', async () => {
		redisStore.set('sentinel:pull:siteX', 'other-token');
		await expect(withSiteLock('siteX', async () => 'ok', { waitMs: 0 })).rejects.toBeInstanceOf(SiteBusyError);
	});

	test('release șterge doar propriul token — nu-l atinge pe al altcuiva', async () => {
		let sawTokenDuringFn = false;
		const result = await withSiteLock(
			'siteY',
			async () => {
				sawTokenDuringFn = redisStore.has('sentinel:pull:siteY');
				// simulăm un alt proces care preia cheia înainte de eliberare (ex. TTL expirat + reachiziție)
				redisStore.set('sentinel:pull:siteY', 'someone-elses-token');
				return 'done';
			},
			{ waitMs: 0 }
		);
		expect(result).toBe('done');
		expect(sawTokenDuringFn).toBe(true);
		expect(redisStore.get('sentinel:pull:siteY')).toBe('someone-elses-token'); // nu s-a șters tokenul altcuiva
	});

	test('Redis aruncă la achiziție → rulează fără lock (disponibilitate > strictețe)', async () => {
		redisThrows = true;
		const result = await withSiteLock('siteZ', async () => 'ran-unlocked', { waitMs: 0 });
		expect(result).toBe('ran-unlocked');
	});
});

// SENTINEL_RETENTION_DAYS trebuie exportat din pull.ts (jobul zilnic îl importă de aici, nu-și mai definește propria copie).
test('SENTINEL_RETENTION_DAYS = 7', () => {
	expect(SENTINEL_RETENTION_DAYS).toBe(7);
});
