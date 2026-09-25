import { describe, test, expect, mock, beforeEach } from 'bun:test';

// mock.module e GLOBAL în bun; oferim setul complet de operatori drizzle (vezi sync-scope.test.ts).
const passthrough = () => ({});
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
	and: (...conds: unknown[]) => ({ kind: 'and', conds }),
	lte: passthrough,
	gte: passthrough,
	lt: passthrough,
	gt: passthrough,
	or: passthrough,
	ne: passthrough,
	isNull: passthrough,
	isNotNull: passthrough,
	inArray: passthrough,
	desc: passthrough,
	asc: passthrough,
	sql: passthrough
}));
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { _: 'wordpress_site', id: 'id', tenantId: 'tenant_id', paused: 'paused' },
	clientWebsite: { _: 'client_website', wpSiteId: 'wp_site_id', tenantId: 'tenant_id' },
	contentArticle: { _: 'content_article', targetWpSiteId: 'target_wp_site_id', tenantId: 'tenant_id' }
}));

type Row = Record<string, unknown>;
type Tbl = { _: string };
let selectRows: Row[] = [];
const ops: Array<{ op: 'update' | 'delete'; table: string; set?: Row }> = [];
const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (r: (rows: Row[]) => unknown) => r(selectRows)
		};
		return chain;
	},
	update: (t: Tbl) => ({
		set: (s: Row) => ({
			where: async () => {
				ops.push({ op: 'update', table: t._, set: s });
			}
		})
	}),
	delete: (t: Tbl) => ({
		where: async () => {
			ops.push({ op: 'delete', table: t._ });
		}
	})
};
mock.module('$lib/server/db', () => ({ db: dbMock }));

const healthCalls: string[] = [];
let healthImpl: (id: string) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: true });
mock.module('../sync', () => ({
	syncHealth: (id: string) => {
		healthCalls.push(id);
		return healthImpl(id);
	}
}));

const { deleteWordpressSite, checkTenantSitesHealth } = await import('../site-admin');

beforeEach(() => {
	ops.length = 0;
	healthCalls.length = 0;
	selectRows = [];
	healthImpl = async () => ({ ok: true });
});

describe('deleteWordpressSite', () => {
	test('site inexistent în tenant → false, nu atinge nimic', async () => {
		selectRows = [];
		expect(await deleteWordpressSite('tn', 's1')).toBe(false);
		expect(ops).toEqual([]);
	});

	test('dezleagă website-urile și articolele (fără FK în DB), apoi șterge site-ul', async () => {
		selectRows = [{ id: 's1' }];
		expect(await deleteWordpressSite('tn', 's1')).toBe(true);
		expect(ops).toEqual([
			{ op: 'update', table: 'client_website', set: expect.objectContaining({ wpSiteId: null }) },
			{ op: 'update', table: 'content_article', set: expect.objectContaining({ targetWpSiteId: null }) },
			{ op: 'delete', table: 'wordpress_site' }
		]);
	});
});

describe('checkTenantSitesHealth', () => {
	test('rulează /health pe fiecare site nepauzat și numără rezultatele', async () => {
		selectRows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
		healthImpl = async (id) => (id === 'b' ? { ok: false, error: 'HMAC rejected' } : { ok: true });
		const r = await checkTenantSitesHealth('tn');
		expect(healthCalls.sort()).toEqual(['a', 'b', 'c']);
		expect(r).toEqual({ checked: 3, ok: 2, failed: 1 });
	});

	test('o excepție pe un site nu oprește restul', async () => {
		selectRows = [{ id: 'a' }, { id: 'b' }];
		healthImpl = async (id) => {
			if (id === 'a') throw new Error('decrypt failed');
			return { ok: true };
		};
		const r = await checkTenantSitesHealth('tn');
		expect(r).toEqual({ checked: 2, ok: 1, failed: 1 });
	});

	test('fără site-uri → zero, fără apeluri', async () => {
		expect(await checkTenantSitesHealth('tn')).toEqual({ checked: 0, ok: 0, failed: 0 });
		expect(healthCalls).toEqual([]);
	});
});
