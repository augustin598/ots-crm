/**
 * Regression tests for the "39 accounts dead, panel says online" incident.
 *
 * From 2026-09-09 DA rejected Server1's credential (2FA turned on for `admin` →
 * the API only accepts Login Keys). Every 6h the cron hit DA 78 times with the
 * dead password, DA's `.catch(() => null)` pair made each account look merely
 * "missing", the branch `return`ed, the account counted as `synced`, the audit
 * row said success, and `da_server.last_error` was wiped to null — so the
 * servers page kept a green "ONLINE" pill for 19 days while LFD logged the
 * failed logins as a brute-force attempt.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';

type Rows = unknown[];
const selectQueue: Rows[] = [];
const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
const audits: Array<{ action: string; success: boolean; error?: string }> = [];

const tableMock = {
	tenant: { __name: 'tenant', id: 'tenant.id', slug: 'tenant.slug' },
	daServer: { __name: 'daServer', id: 'id', tenantId: 't', isActive: 'a' },
	hostingAccount: {
		__name: 'hostingAccount',
		id: 'id',
		tenantId: 't',
		daServerId: 's',
		status: 'st',
		daUsername: 'u',
		domain: 'd'
	},
	daPackage: { __name: 'daPackage', id: 'id', daServerId: 's', daName: 'n' }
};

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (resolve: (rows: Rows) => unknown) => resolve(selectQueue.shift() ?? [])
		};
		return chain;
	},
	update: (t: { __name: string }) => ({
		set: (values: Record<string, unknown>) => ({
			where: async () => {
				updates.push({ table: t.__name, values });
			}
		})
	})
};

type FakeClient = {
	ping: ReturnType<typeof mock>;
	getUserConfig: ReturnType<typeof mock>;
	getUserUsage: ReturnType<typeof mock>;
};
let fakeClient: FakeClient;

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => tableMock);
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));
mock.module('$lib/server/plugins/registry', () => ({
	getPluginRegistry: () => ({ isPluginActiveForTenant: async () => true })
}));
mock.module('$lib/server/plugins/directadmin/factory', () => ({
	createDAClient: () => fakeClient
}));
mock.module('$lib/server/plugins/directadmin/audit', () => ({
	runWithAudit: async (entry: { action: string }, op: () => Promise<unknown>) => {
		try {
			const r = await op();
			audits.push({ action: entry.action, success: true });
			return r;
		} catch (e) {
			audits.push({ action: entry.action, success: false, error: (e as Error).message });
			throw e;
		}
	}
}));

const { processDirectAdminSyncAccounts } = await import('../directadmin-sync-accounts');
const { DirectAdminApiError } = await import('$lib/server/plugins/directadmin/client');

const SERVER = {
	id: 'srv1',
	tenantId: 'tnt',
	hostname: '46.4.159.108',
	port: 2222,
	usernameEncrypted: 'x',
	passwordEncrypted: 'y',
	useHttps: true,
	lastError: null,
	lastCheckedAt: null
};
const ACCOUNTS = [
	{ id: 'acc_yards', daUsername: 'yardsro', domain: 'yards.ro' },
	{ id: 'acc_solx', daUsername: 'solxro', domain: 'solx.ro' }
];

function queueServerWithAccounts() {
	selectQueue.push([{ id: 'tnt', slug: 'ots' }], [SERVER], ACCOUNTS);
}

function serverUpdate() {
	return updates.filter((u) => u.table === 'daServer').at(-1)?.values;
}

describe('processDirectAdminSyncAccounts', () => {
	beforeEach(() => {
		selectQueue.length = 0;
		updates.length = 0;
		audits.length = 0;
		fakeClient = {
			ping: mock(async () => ({ online: true, responseMs: 5 })),
			getUserConfig: mock(async () => ({ package: null, domains: null })),
			getUserUsage: mock(async () => ({}))
		};
	});

	test('credențial respins la ping → nu mai lovește DA per cont și păstrează last_error', async () => {
		fakeClient.ping = mock(async () => ({
			online: false,
			responseMs: 9,
			error: 'Not logged in',
			kind: 'not_authenticated'
		}));
		queueServerWithAccounts();

		const r = await processDirectAdminSyncAccounts();

		expect(fakeClient.getUserConfig).not.toHaveBeenCalled();
		expect(fakeClient.getUserUsage).not.toHaveBeenCalled();
		expect(r.totalSynced).toBe(0);
		expect(r.results[0]).toMatchObject({ synced: 0, failed: 0, skipped: 2 });
		const lastError = serverUpdate()?.lastError as string;
		expect(lastError).toContain('Not logged in');
		expect(lastError).toContain('Login Key');
	});

	test('ambele citiri pică → contul e eșuat (nu synced), audit cu eroarea DA, last_error rămâne', async () => {
		const denied = () => Promise.reject(new DirectAdminApiError('DirectAdmin API error: 401 Unauthorized', 401, 'UNAUTHORIZED'));
		fakeClient.getUserConfig = mock(denied);
		fakeClient.getUserUsage = mock(denied);
		queueServerWithAccounts();

		const r = await processDirectAdminSyncAccounts();

		expect(r.totalSynced).toBe(0);
		expect(r.totalFailed).toBe(2);
		expect(audits.every((a) => a.success === false)).toBe(true);
		expect(audits[0].error).toContain('401');
		expect(serverUpdate()?.lastError).toBeTruthy();
		// Nicio scriere pe hosting_account: statusul contului rămâne neatins.
		expect(updates.filter((u) => u.table === 'hostingAccount')).toHaveLength(0);
	});

	test('o citire merge → cont sincronizat, last_error golit', async () => {
		fakeClient.getUserUsage = mock(() => Promise.reject(new Error('timeout')));
		queueServerWithAccounts();

		const r = await processDirectAdminSyncAccounts();

		expect(r.totalSynced).toBe(2);
		expect(r.totalFailed).toBe(0);
		expect(serverUpdate()?.lastError).toBeNull();
	});
});
