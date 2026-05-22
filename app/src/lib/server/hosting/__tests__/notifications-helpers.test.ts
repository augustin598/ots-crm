import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock SvelteKit virtual modules BEFORE importing the helpers (which transitively
// import $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// We mutate this from individual tests to control query results. Each query in
// resolveCustomerEmail / resolveAdminRecipients calls .select().from(table).where()
// (optionally .innerJoin() and .limit()) and finally awaits the chain. We model
// that chain as a thenable returning whatever the test queued.
interface Queued {
	rows: unknown[];
}
let queue: Queued[] = [];

function makeChain() {
	// Each .from()/.innerJoin()/.where()/.limit() returns the same chain object.
	// Awaiting the chain (via .then) pops the next queued result.
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.innerJoin = () => chain;
	chain.where = () => chain;
	chain.limit = () => chain;
	chain.then = (resolve: (val: unknown[]) => void, reject?: (e: unknown) => void) => {
		try {
			const next = queue.shift();
			if (!next) {
				throw new Error(
					'no queued result for db.select() — test forgot to push() or function made an extra query',
				);
			}
			resolve(next.rows);
		} catch (e) {
			if (reject) reject(e);
			else throw e;
		}
	};
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(),
	},
}));

mock.module('$lib/server/db/schema', () => ({
	client: { id: 'id', tenantId: 'tenant_id', email: 'email', name: 'name', businessName: 'business_name' },
	hostingInquiry: { id: 'id', tenantId: 'tenant_id', hostingAccountId: 'hosting_account_id', contactEmail: 'contact_email', contactName: 'contact_name' },
	tenantUser: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', role: 'role', status: 'status' },
	user: { id: 'id', email: 'email' },
	tenant: { id: 'id', adminContactEmail: 'admin_contact_email' },
}));

const {
	dayBucketEET,
	resolveCustomerEmail,
	resolveAdminRecipients,
	OrphanAccountError,
	NoAdminRecipientError,
} = await import('../notifications-helpers');

function push(rows: unknown[]) {
	queue.push({ rows });
}

beforeEach(() => {
	queue = [];
	// Reset env in case a previous test mutated it
	delete process.env.OPS_FALLBACK_EMAIL;
});

describe('dayBucketEET', () => {
	test('returns YYYY-MM-DD format for current date in Europe/Bucharest', () => {
		const result = dayBucketEET(new Date('2026-05-22T10:00:00Z'));
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test('returns same bucket for dates within same EET calendar day', () => {
		// 2026-05-22 01:00 EET = 2026-05-21 23:00 UTC (EET = UTC+3 in May)
		const a = dayBucketEET(new Date('2026-05-21T23:00:00Z'));
		// 2026-05-22 22:00 EET = 2026-05-22 19:00 UTC
		const b = dayBucketEET(new Date('2026-05-22T19:00:00Z'));
		expect(a).toBe('2026-05-22');
		expect(b).toBe('2026-05-22');
	});

	test('handles DST transition correctly', () => {
		// Romania uses Europe/Bucharest: EET (UTC+2) winter, EEST (UTC+3) summer
		const summer = dayBucketEET(new Date('2026-07-15T22:00:00Z'));
		expect(summer).toBe('2026-07-16'); // already next day in EEST
	});
});

describe('resolveCustomerEmail', () => {
	test('prefers client.email + businessName when clientId is present and has email', async () => {
		// Queued: client query returns one row with businessName set
		push([
			{
				email: 'client@example.ro',
				name: 'Display Alias',
				businessName: 'Acme SRL Official',
			},
		]);
		const result = await resolveCustomerEmail({
			id: 'acc-1',
			tenantId: 't-1',
			clientId: 'cli-1',
		});
		expect(result.email).toBe('client@example.ro');
		expect(result.name).toBe('Acme SRL Official'); // businessName preferred
		expect(result.source).toBe('client');
	});

	test('falls back to display name when businessName is null', async () => {
		push([
			{
				email: 'client@example.ro',
				name: 'Display Alias Only',
				businessName: null,
			},
		]);
		const result = await resolveCustomerEmail({
			id: 'acc-1',
			tenantId: 't-1',
			clientId: 'cli-1',
		});
		expect(result.name).toBe('Display Alias Only');
		expect(result.email).toBe('client@example.ro');
		expect(result.source).toBe('client');
	});

	test('falls back to inquiry.contactEmail when client has no email', async () => {
		// First query (client) → empty (no clientId path skipped)
		// We pass clientId=null so only the inquiry query runs.
		push([
			{
				email: 'ion@example.ro',
				name: 'Ion Popescu',
			},
		]);
		const result = await resolveCustomerEmail({
			id: 'acc-2',
			tenantId: 't-1',
			clientId: null,
		});
		expect(result.email).toBe('ion@example.ro');
		expect(result.name).toBe('Ion Popescu');
		expect(result.source).toBe('inquiry');
	});

	test('falls back to inquiry when client row exists but email is null', async () => {
		// First push: client with null email → falls through
		push([{ email: null, name: 'X', businessName: null }]);
		// Second push: inquiry with email
		push([{ email: 'inquiry@example.ro', name: 'Inquiry Name' }]);
		const result = await resolveCustomerEmail({
			id: 'acc-3',
			tenantId: 't-1',
			clientId: 'cli-3',
		});
		expect(result.email).toBe('inquiry@example.ro');
		expect(result.source).toBe('inquiry');
	});

	test('throws OrphanAccountError when no client and no inquiry', async () => {
		// clientId=null skips client query → only inquiry runs, returns []
		push([]);
		expect(
			resolveCustomerEmail({
				id: 'acc-orphan',
				tenantId: 't-1',
				clientId: null,
			}),
		).rejects.toThrow(OrphanAccountError);
	});

	test('OrphanAccountError carries the accountId for logging', async () => {
		push([]); // empty inquiry
		try {
			await resolveCustomerEmail({ id: 'acc-orphan-id', tenantId: 't-1', clientId: null });
			throw new Error('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(OrphanAccountError);
			const err = e as Error & { accountId: string };
			expect(err.accountId).toBe('acc-orphan-id');
			expect(err.name).toBe('OrphanAccountError');
		}
	});
});

describe('resolveAdminRecipients', () => {
	test('returns emails of owner/admin users', async () => {
		// Level 1 query returns one owner
		push([{ email: 'owner@example.ro' }]);
		const result = await resolveAdminRecipients('t-1');
		expect(result).toContain('owner@example.ro');
		expect(result).toEqual(['owner@example.ro']);
	});

	test('returns multiple emails when multiple owners/admins exist', async () => {
		push([{ email: 'owner@example.ro' }, { email: 'admin@example.ro' }]);
		const result = await resolveAdminRecipients('t-1');
		expect(result).toEqual(['owner@example.ro', 'admin@example.ro']);
	});

	test('falls back to tenant.adminContactEmail when no owner/admin users exist', async () => {
		// Level 1 returns empty
		push([]);
		// Level 2 returns tenant with adminContactEmail
		push([{ email: 'fallback@example.ro' }]);
		const result = await resolveAdminRecipients('t-1');
		expect(result).toEqual(['fallback@example.ro']);
	});

	test('skips suspended users (only active ones returned by Level 1)', async () => {
		// We model this by Level 1 returning empty (since the WHERE clause excludes
		// suspended), then Level 2 providing the fallback. The implementation's
		// filter is inside the SQL; we verify the function honors empty results.
		push([]); // Level 1 (suspended user excluded by query filter)
		push([{ email: 'fallback@example.ro' }]); // Level 2: tenant.adminContactEmail
		const result = await resolveAdminRecipients('t-1');
		expect(result).toEqual(['fallback@example.ro']);
	});

	test('falls back to OPS_FALLBACK_EMAIL env when no owners and no column', async () => {
		// Inject the env var the helper reads from $env/dynamic/private. The mock
		// above returns an empty `env` object; we mutate it for this test.
		const envMod = await import('$env/dynamic/private');
		(envMod as { env: Record<string, string | undefined> }).env.OPS_FALLBACK_EMAIL =
			'ops@example.ro';
		push([]); // Level 1: no users
		push([{ email: null }]); // Level 2: tenant row exists but null column
		const result = await resolveAdminRecipients('t-1');
		expect(result).toEqual(['ops@example.ro']);
		delete (envMod as { env: Record<string, string | undefined> }).env.OPS_FALLBACK_EMAIL;
	});

	test('throws NoAdminRecipientError when all fallbacks empty', async () => {
		const envMod = await import('$env/dynamic/private');
		delete (envMod as { env: Record<string, string | undefined> }).env.OPS_FALLBACK_EMAIL;
		push([]); // Level 1: no users
		push([]); // Level 2: no tenant row
		expect(resolveAdminRecipients('t-1')).rejects.toThrow(NoAdminRecipientError);
	});

	test('NoAdminRecipientError carries the tenantId for logging', async () => {
		const envMod = await import('$env/dynamic/private');
		delete (envMod as { env: Record<string, string | undefined> }).env.OPS_FALLBACK_EMAIL;
		push([]); // Level 1 empty
		push([]); // Level 2 empty
		try {
			await resolveAdminRecipients('t-xyz');
			throw new Error('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(NoAdminRecipientError);
			const err = e as Error & { tenantId: string };
			expect(err.tenantId).toBe('t-xyz');
			expect(err.name).toBe('NoAdminRecipientError');
		}
	});

	test('filters out users with null email from Level 1', async () => {
		// Level 1 returns mix of valid + null emails — implementation must filter
		push([{ email: 'owner@example.ro' }, { email: null }]);
		const result = await resolveAdminRecipients('t-1');
		expect(result).toEqual(['owner@example.ro']);
	});
});
