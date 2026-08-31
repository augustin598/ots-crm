import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * Cheltuieli fixe de marketing (KPI Performanță interviuri).
 *
 * Invariante testate:
 *  - scrierea (create/update/delete/reset) e permisă DOAR pentru owner/admin;
 *  - userii de portal (isClientUser) sunt respinși și la citire;
 *  - orice update/delete filtrează pe id ȘI pe tenantul din sesiune (clasa F8);
 *  - sumele primite în lei ajung în DB în cenți.
 */

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
// CRITICAL: eager-load schema reală ÎNAINTE de orice mock (mock.module leak-uiește
// între fișiere în bun; vezi interviuri-client-assoc.test.ts).
await import('$lib/server/db/schema');

let currentEvent: any = null;

mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));
mock.module('$lib/server/get-actor', () => ({
	requireStaff: async () => {
		if (currentEvent?.locals?.isClientUser) throw new Error('Unauthorized');
		return { type: 'staff', user: { id: 'u1' } };
	}
}));
const kpiCalls: unknown[][] = [];
mock.module('$lib/server/interviuri/kpi-data', () => ({
	loadInterviewKpiData: async (...args: unknown[]) => {
		kpiCalls.push(args);
		return { years: [] };
	}
}));
// Flag-urile de acces ale userului de portal (contact secundar) — controlabile per test.
let portalFlags: Record<string, boolean> = {};
mock.module('$lib/server/portal-access', () => ({
	getRequestAccessFlags: async () => portalFlags
}));
mock.module('$lib/server/meta-ads/sync', () => ({ syncMetaAdsInvoicesForTenant: async () => ({}) }));
mock.module('$lib/server/tiktok-ads/sync', () => ({ syncTiktokAdsSpendingForTenant: async () => ({}) }));
mock.module('$lib/server/google-ads/sync', () => ({
	syncGoogleAdsInvoicesForTenant: async () => {
		throw new Error('Google jos');
	}
}));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logInfo: () => {},
	logWarning: () => {}
}));

// Redis fals: lock-ul de sync (SET NX) + ștergerea lui
let lockHeld = false;
const redisCalls: string[] = [];
mock.module('$lib/server/redis', () => ({
	getRedis: () => ({
		set: async (key: string) => {
			redisCalls.push(`set ${key}`);
			if (lockHeld) return null;
			lockHeld = true;
			return 'OK';
		},
		del: async (key: string) => {
			redisCalls.push(`del ${key}`);
			lockHeld = false;
			return 1;
		}
	})
}));

const updateCalls: Array<{ set: any; where: unknown }> = [];
const deleteCalls: Array<{ where: unknown }> = [];
const inserted: any[] = [];
let updateReturns: unknown[] = [{ id: 'fc1' }];

function paramValues(node: unknown, out: unknown[] = []): unknown[] {
	if (!node || typeof node !== 'object') return out;
	const n = node as Record<string, unknown>;
	if (Array.isArray(n.queryChunks)) n.queryChunks.forEach((c) => paramValues(c, out));
	else if ('value' in n && !Array.isArray(n.value)) out.push(n.value);
	return out;
}
function chain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => chain(rows),
		where: () => chain(rows),
		orderBy: () => chain(rows),
		limit: () => chain(rows),
		returning: () => chain(rows)
	});
}
mock.module('$lib/server/db', () => ({
	db: {
		select: () => chain([{ id: 'fc1' }]),
		insert: () => ({
			values: (v: unknown) => {
				inserted.push(v);
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (set: unknown) => ({
				where: (where: unknown) => {
					updateCalls.push({ set, where });
					return chain(updateReturns);
				}
			})
		}),
		delete: () => ({
			where: (where: unknown) => {
				deleteCalls.push({ where });
				return chain([{ id: 'fc1' }]);
			}
		})
	}
}));

const remote = await import('$lib/remotes/interviuri-kpi.remote');

function ev(role: string, extra: Record<string, unknown> = {}) {
	return {
		locals: {
			user: { id: 'u1', email: 'a@b.c' },
			tenant: { id: 't1' },
			tenantUser: { role },
			...extra
		}
	};
}
beforeEach(() => {
	updateCalls.length = 0;
	deleteCalls.length = 0;
	inserted.length = 0;
	updateReturns = [{ id: 'fc1' }];
});

describe('gating rol pe cheltuieli fixe', () => {
	test('member nu poate scrie (create/update/delete/reset)', async () => {
		currentEvent = ev('member');
		await expect(remote.createMarketingFixedCost({})).rejects.toThrow(/Owner\/Admin/);
		await expect(remote.updateMarketingFixedCost({ id: 'fc1', name: 'x' })).rejects.toThrow(/Owner\/Admin/);
		await expect(remote.deleteMarketingFixedCost('fc1')).rejects.toThrow(/Owner\/Admin/);
		await expect(remote.resetMarketingFixedCosts()).rejects.toThrow(/Owner\/Admin/);
		expect(updateCalls.length + deleteCalls.length + inserted.length).toBe(0);
	});
	test('portal FĂRĂ flag-ul interviuri → respins la citire', async () => {
		currentEvent = ev('owner', { isClientUser: true, client: { id: 'c1' } });
		portalFlags = { interviuri: false };
		await expect(remote.getMarketingFixedCosts()).rejects.toThrow(/Nu ai acces/);
		await expect(remote.getInterviewKpiData(undefined)).rejects.toThrow(/Nu ai acces/);
	});
	test('portal CU flag: citire scopată pe clientul din sesiune, read-only, fără seed', async () => {
		currentEvent = ev('owner', { isClientUser: true, client: { id: 'c1' } });
		portalFlags = { interviuri: true };
		kpiCalls.length = 0;
		const kpi = await remote.getInterviewKpiData({ year: 2026 });
		expect(kpi).toEqual({ years: [] });
		// tenant, an, clientScopeId din SESIUNE (nu din payload)
		expect(kpiCalls[0]).toEqual(['t1', 2026, 'c1']);
		const fc = await remote.getMarketingFixedCosts();
		expect(fc.canEdit).toBe(false);
		expect(inserted.length).toBe(0); // niciun seed din portal
	});
	test('portal: scrierile rămân respinse chiar cu flag', async () => {
		currentEvent = ev('owner', { isClientUser: true, client: { id: 'c1' } });
		portalFlags = { interviuri: true };
		await expect(remote.updateMarketingFixedCost({ id: 'fc1', name: 'x' })).rejects.toThrow(/Unauthorized/);
		await expect(remote.resetMarketingFixedCosts()).rejects.toThrow(/Unauthorized/);
		await expect(remote.syncInterviewAdsBudgets()).rejects.toThrow(/Unauthorized/);
	});
	test('owner: update-ul filtrează pe id ȘI tenant; sumele ajung în cenți', async () => {
		currentEvent = ev('owner');
		const res = await remote.updateMarketingFixedCost({ id: 'fc1', unitAmount: 8000.5, qty: 4 });
		expect(res).toEqual({ success: true });
		expect(updateCalls.length).toBe(1);
		expect(paramValues(updateCalls[0].where)).toEqual(expect.arrayContaining(['fc1', 't1']));
		expect(updateCalls[0].set.unitAmountCents).toBe(800050);
		expect(updateCalls[0].set.qty).toBe(4);
	});
	test('update pe rând inexistent/al altui tenant → eroare', async () => {
		currentEvent = ev('admin');
		updateReturns = [];
		await expect(remote.updateMarketingFixedCost({ id: 'zzz', name: 'x' })).rejects.toThrow(/nu a fost găsit/);
	});
	test('valid_from după valid_to → eroare, fără scriere', async () => {
		currentEvent = ev('admin');
		await expect(
			remote.updateMarketingFixedCost({ id: 'fc1', validFrom: '2026-05', validTo: '2026-03' })
		).rejects.toThrow();
		expect(updateCalls.length).toBe(0);
	});
	test('delete filtrează pe tenant', async () => {
		currentEvent = ev('admin');
		await remote.deleteMarketingFixedCost('fc1');
		expect(paramValues(deleteCalls[0].where)).toEqual(expect.arrayContaining(['fc1', 't1']));
	});
	test('create: rând gol implicit, cu tenant și created_by din sesiune', async () => {
		currentEvent = ev('owner');
		const res = await remote.createMarketingFixedCost(undefined);
		expect(res.success).toBe(true);
		expect(inserted.length).toBe(1);
		expect(inserted[0].tenantId).toBe('t1');
		expect(inserted[0].createdBy).toBe('u1');
		expect(inserted[0].active).toBe(true);
	});
	test('canEdit reflectă rolul', async () => {
		currentEvent = ev('member');
		const r = await remote.getMarketingFixedCosts();
		expect(r.canEdit).toBe(false);
		currentEvent = ev('owner');
		expect((await remote.getMarketingFixedCosts()).canEdit).toBe(true);
	});
});

describe('sincronizare bugete', () => {
	test('o platformă picată nu blochează restul; rezultat per platformă; lock-ul e eliberat', async () => {
		currentEvent = ev('member');
		redisCalls.length = 0;
		const r = await remote.syncInterviewAdsBudgets();
		expect(r.results.map((x: any) => [x.id, x.ok])).toEqual([
			['tiktok', true],
			['google', false],
			['meta', true]
		]);
		expect(r.results.find((x: any) => x.id === 'google')!.error).toMatch(/Google jos/);
		expect(typeof r.syncedAt).toBe('string');
		expect(redisCalls).toEqual(['set t1:interviuri-kpi:sync-lock', 'del t1:interviuri-kpi:sync-lock']);
		expect(lockHeld).toBe(false);
	});
	test('lock deja ținut (alt click / alt pod) → eroare, fără sync', async () => {
		currentEvent = ev('member');
		lockHeld = true;
		redisCalls.length = 0;
		await expect(remote.syncInterviewAdsBudgets()).rejects.toThrow(/deja în curs/);
		expect(redisCalls).toEqual(['set t1:interviuri-kpi:sync-lock']);
		lockHeld = false;
	});
});
