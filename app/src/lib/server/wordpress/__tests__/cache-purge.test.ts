import { describe, test, expect, mock } from 'bun:test';

// connector-release trage după el db + MinIO; aici ne trebuie doar comparația de versiuni.
mock.module('../connector-release', () => ({
	compareConnectorVersions: (a: string, b: string) => {
		const pa = a.split('.').map(Number);
		const pb = b.split('.').map(Number);
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const d = (pa[i] ?? 0) - (pb[i] ?? 0);
			if (d !== 0) return d < 0 ? -1 : 1;
		}
		return 0;
	}
}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })
}));

const { supportsCachePurge, purgeSiteCache } = await import('../cache-purge');
const { WpSiteDownError } = await import('../errors');
type PurgeReply = import('../client').WpCachePurgeResponse;

const site = (connectorVersion: string | null) => ({
	id: 's1',
	tenantId: 't1',
	siteUrl: 'https://exemplu.ro',
	connectorVersion
});

function client(purgeCache: () => Promise<PurgeReply>) {
	let calls = 0;
	let lastScope: string | undefined;
	return {
		get calls() {
			return calls;
		},
		get lastScope() {
			return lastScope;
		},
		purgeCache: async (opts?: { scope?: 'update' | 'restore' }) => {
			calls++;
			lastScope = opts?.scope;
			return purgeCache();
		}
	};
}

describe('supportsCachePurge', () => {
	test('doar conectorul ≥ 0.8.4 are /cache/purge', () => {
		expect(supportsCachePurge('0.8.4')).toBe(true);
		expect(supportsCachePurge('0.9.0')).toBe(true);
		expect(supportsCachePurge('0.8.3')).toBe(false);
		expect(supportsCachePurge(null)).toBe(false);
	});
});

describe('purgeSiteCache', () => {
	test('conector vechi → unsupported, fără cerere către site', async () => {
		const c = client(async () => ({ success: true, purged: [] }));
		const r = await purgeSiteCache({ client: c, site: site('0.8.3'), userId: 'u1' });
		expect(r).toEqual({ status: 'unsupported', connectorVersion: '0.8.3' });
		expect(c.calls).toBe(0);
	});

	test('nimic detectat → nothing', async () => {
		const c = client(async () => ({ success: true, purged: [] }));
		expect(await purgeSiteCache({ client: c, site: site('0.8.4'), userId: 'u1' })).toEqual({
			status: 'nothing'
		});
	});

	test('golite → purged cu lista de la conector', async () => {
		const purged = [
			{ id: 'litespeed', name: 'LiteSpeed Cache', ok: true },
			{ id: 'perfmatters', name: 'Perfmatters (CSS folosit)', ok: false, error: 'x' }
		];
		const c = client(async () => ({ success: true, purged }));
		expect(
			await purgeSiteCache({ client: c, site: site('0.8.4'), userId: 'u1', scope: 'restore' })
		).toEqual({ status: 'purged', items: purged });
		expect(c.lastScope).toBe('restore');
	});

	test('site-ul nu răspunde → failed, nu excepție', async () => {
		const c = client(async () => {
			throw new WpSiteDownError('HTTP 503 de la site');
		});
		const r = await purgeSiteCache({ client: c, site: site('0.8.4'), userId: 'u1' });
		expect(r.status).toBe('failed');
		expect(r.status === 'failed' && r.error).toContain('503');
	});
});
