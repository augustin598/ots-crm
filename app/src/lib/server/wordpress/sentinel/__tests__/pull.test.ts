import { describe, test, expect, mock, beforeEach } from 'bun:test';

type Row = Record<string, unknown>;
const inserted: Row[][] = [];
const updated: Row[] = [];
let existingUids: string[] = [];
let siteRow: Row = {};
let pages: Array<unknown> = [];
let calls: Array<{ since: string | null; skip: number }> = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { id: {}, tenantId: {}, sentinelLastPullAt: {}, sentinelLastPullStatus: {}, sentinelFailures: {}, sentinelState: {}, updatedAt: {} },
	wordpressSecurityEvent: { id: {}, siteId: {}, eventUid: {} }
}));
mock.module('$lib/server/db', () => ({
	db: {
		select: () => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				then: (r: (rows: Row[]) => unknown) => r(existingUids.map((eventUid) => ({ eventUid })))
			};
			return c;
		},
		insert: () => ({ values: (rows: Row[]) => ({ onConflictDoNothing: async () => { inserted.push(rows); } }) }),
		update: () => ({ set: (s: Row) => ({ where: async () => { updated.push(s); } }) })
	}
}));
mock.module('../../sync', () => ({
	loadSiteAndClient: async () => ({
		site: siteRow,
		client: {
			sentinel: async (args: { since: string | null; skip: number }) => {
				calls.push(args);
				const p = pages.shift();
				if (p instanceof Error) throw p;
				return p;
			}
		}
	})
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

const { pullSite, supportsSentinel } = await import('../pull');

const NOW = new Date('2026-09-28T09:00:00Z');
const fail = (id: string, t: string, ip = '1.1.1.1') => ({ id, t, sev: 'INFO', ev: 'login_esuat', user: '-', uid: 0, ip, uri: '/wp-login.php', ua: '', date: { login: 'adm', exista: true } });
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
	calls = [];
	pages = [];
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
});
