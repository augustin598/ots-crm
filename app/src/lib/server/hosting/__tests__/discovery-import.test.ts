import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';

// --- SvelteKit virtual modules ---
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// --- Capture buffers for the db mock ---
type Rows = unknown[];
let selectQueue: Rows[] = [];
const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

// Count DA-client constructions — the discovery import MUST NEVER touch DirectAdmin.
let daClientConstructions = 0;

function tableName(t: unknown): string {
	return (t as { _name?: string })?._name ?? 'unknown';
}

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.where = () => chain;
	chain.limit = () => chain;
	chain.then = (resolve: (rows: Rows) => void) => resolve(selectQueue.shift() ?? []);
	return chain;
}
function makeInsertChain(t: unknown) {
	let vals: Record<string, unknown> = {};
	const chain: Record<string, unknown> = {};
	chain.values = (v: Record<string, unknown>) => {
		vals = v;
		return chain;
	};
	chain.onConflictDoNothing = () => chain;
	chain.returning = () => chain;
	chain.catch = () => chain;
	chain.then = (resolve: (rows: Rows) => void) => {
		inserts.push({ table: tableName(t), values: vals });
		resolve([]);
	};
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		insert: (t: unknown) => makeInsertChain(t)
	}
}));

// Neutralise the heavy imports create-account.ts pulls at module load so the unit
// under test (createHostingAccountFromDiscovery) exercises pure db logic.
mock.module('$lib/server/plugins/directadmin/factory', () => ({
	createDAClient: () => {
		daClientConstructions++;
		return {};
	}
}));
mock.module('$lib/server/plugins/directadmin/audit', () => ({
	runWithAudit: async (_ctx: unknown, fn: () => unknown) => fn(),
	withAccountLock: async (_key: string, fn: () => unknown) => fn()
}));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({ encrypt: () => 'enc' }));
mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: async (fn: () => unknown) => fn()
}));
mock.module('../notifications', () => ({
	notifyHostingAccountCreated: async () => {},
	notifyHostingProvisioningFailed: async () => {}
}));
mock.module('$lib/server/logger', () => ({
	logWarning: () => {},
	logError: () => {}
}));

// Spread the REAL schema so exports we don't override stay resolvable, and stub the
// tables the helper reads/writes with a `_name` marker for the insert capture.
const realSchema = await import('$lib/server/db/schema');
mock.module('$lib/server/db/schema', () => ({
	...realSchema,
	daServer: { _name: 'daServer', id: 'id', tenantId: 'tenant_id' },
	daPackage: {
		_name: 'daPackage',
		id: 'id',
		tenantId: 'tenant_id',
		daServerId: 'da_server_id',
		daName: 'da_name'
	},
	hostingProduct: {
		_name: 'hostingProduct',
		id: 'id',
		tenantId: 'tenant_id',
		daPackageId: 'da_package_id',
		price: 'price',
		currency: 'currency',
		billingCycle: 'billing_cycle',
		isActive: 'is_active'
	},
	hostingAccount: {
		_name: 'hostingAccount',
		id: 'id',
		tenantId: 'tenant_id',
		daServerId: 'da_server_id',
		daUsername: 'da_username'
	},
	daAuditLog: { _name: 'daAuditLog' }
}));

const { createHostingAccountFromDiscovery } = await import('../create-account');

afterAll(() => {
	mock.module('$lib/server/db/schema', () => realSchema);
});

beforeEach(() => {
	selectQueue = [];
	inserts.length = 0;
	daClientConstructions = 0;
});

const TENANT = 'ots';
const SERVER = 'srv-1';

describe('createHostingAccountFromDiscovery', () => {
	test('creates an active row and auto-prices from package → catalog product', async () => {
		selectQueue = [
			[{ id: SERVER }], // daServer exists
			[], // no existing hosting_account
			[{ id: 'pkg-1' }], // daPackage by name
			[{ id: 'prod-1', price: 5000, currency: 'ron', billingCycle: 'annually' }] // one active product
		];

		const res = await createHostingAccountFromDiscovery(TENANT, {
			daServerId: SERVER,
			daUsername: 'gradinitamaginca',
			domain: 'gradinitamagicaradauti.ro',
			additionalDomains: ['gradinitamagicaradauti.ro', 'addon.ro'],
			daPackageName: 'Wordpress_Standard',
			suspended: false,
			daEmail: 'contact@example.ro'
		});

		expect(res.action).toBe('created');
		expect(res.priced).toBe(true);
		expect(res.recurringAmount).toBe(5000);
		expect(res.currency).toBe('RON');
		expect(res.billingCycle).toBe('annually');
		expect(res.daPackageId).toBe('pkg-1');
		expect(res.hostingProductId).toBe('prod-1');

		const acct = inserts.find((i) => i.table === 'hostingAccount');
		expect(acct).toBeDefined();
		expect(acct!.values.clientId).toBeNull();
		expect(acct!.values.status).toBe('active');
		expect(acct!.values.daSyncStatus).toBe('da_only');
		expect(acct!.values.daCredentialsEncrypted).toBeNull();
		expect(acct!.values.recurringAmount).toBe(5000);
		// Primary domain filtered out of additionalDomains; addon kept.
		expect(acct!.values.additionalDomains).toEqual(['addon.ro']);
		expect(acct!.values.suspendedAt).toBeNull();

		// An audit row is written too.
		expect(inserts.some((i) => i.table === 'daAuditLog')).toBe(true);

		// The whole point: NO DirectAdmin client is ever constructed → no DA write.
		expect(daClientConstructions).toBe(0);
	});

	test('is idempotent — an existing row for the same (tenant, server, username) is skipped', async () => {
		selectQueue = [
			[{ id: SERVER }], // daServer exists
			[{ id: 'existing-acct' }] // hosting_account already present
		];

		const res = await createHostingAccountFromDiscovery(TENANT, {
			daServerId: SERVER,
			daUsername: 'gradinitamaginca',
			domain: 'gradinitamagicaradauti.ro',
			daPackageName: 'Wordpress_Standard'
		});

		expect(res.action).toBe('skipped_exists');
		expect(res.id).toBe('existing-acct');
		// No hosting_account insert happened.
		expect(inserts.some((i) => i.table === 'hostingAccount')).toBe(false);
		expect(daClientConstructions).toBe(0);
	});

	test('imports a DA-suspended user as suspended, at 0 when no product maps', async () => {
		selectQueue = [
			[{ id: SERVER }], // daServer exists
			[], // no existing
			[{ id: 'pkg-1' }], // daPackage by name
			[] // no catalog product linked → unpriced
		];

		const res = await createHostingAccountFromDiscovery(TENANT, {
			daServerId: SERVER,
			daUsername: 'suspendeduser',
			domain: 'suspended.ro',
			daPackageName: 'Wordpress_Standard',
			suspended: true
		});

		expect(res.action).toBe('created');
		expect(res.priced).toBe(false);
		expect(res.recurringAmount).toBe(0);

		const acct = inserts.find((i) => i.table === 'hostingAccount');
		expect(acct!.values.status).toBe('suspended');
		expect(acct!.values.suspendedAt).toBeInstanceOf(Date);
		expect(acct!.values.hostingProductId).toBeNull();
		expect(daClientConstructions).toBe(0);
	});

	test('throws when the DA server does not belong to the tenant', async () => {
		selectQueue = [[]]; // daServer lookup returns nothing

		await expect(
			createHostingAccountFromDiscovery(TENANT, {
				daServerId: 'foreign-server',
				daUsername: 'x',
				domain: 'x.ro'
			})
		).rejects.toThrow(/inexistent/);
		expect(inserts.length).toBe(0);
	});
});
