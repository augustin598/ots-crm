import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock SvelteKit virtual modules BEFORE importing the module under test
// (which transitively imports $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// ---------------------------------------------------------------------------
// SELECT chain mocking (same pattern as notifications-helpers.test.ts)
// Each .select().from().where().limit() (and .innerJoin()) awaits a queued result.
// ---------------------------------------------------------------------------
interface Queued {
	rows: unknown[];
}
let selectQueue: Queued[] = [];

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.innerJoin = () => chain;
	chain.where = () => chain;
	chain.limit = () => chain;
	chain.then = (resolve: (val: unknown[]) => void, reject?: (e: unknown) => void) => {
		try {
			const next = selectQueue.shift();
			if (!next) {
				throw new Error(
					'no queued result for db.select() — test forgot to pushSelect() or function made an extra query'
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

// ---------------------------------------------------------------------------
// INSERT chain mocking — supports:
//   db.insert(table).values(...).onConflictDoNothing({ target: [...] }).returning()
// Each terminal await pops insertQueue.
// ---------------------------------------------------------------------------
let insertQueue: Queued[] = [];

function makeInsertChain() {
	const chain: Record<string, unknown> = {};
	chain.values = () => chain;
	chain.onConflictDoNothing = () => chain;
	chain.returning = () => chain;
	chain.then = (resolve: (val: unknown[]) => void, reject?: (e: unknown) => void) => {
		try {
			const next = insertQueue.shift();
			if (!next) {
				throw new Error(
					'no queued result for db.insert() — test forgot to pushInsert() or function made an extra insert'
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

// ---------------------------------------------------------------------------
// UPDATE chain mocking — db.update(table).set({...}).where(...)
// Terminal await returns whatever updateQueue holds (rows[] or any sentinel).
// ---------------------------------------------------------------------------
let updateQueue: Queued[] = [];
let updateCalls: number = 0;

function makeUpdateChain() {
	const chain: Record<string, unknown> = {};
	chain.set = () => chain;
	chain.where = () => {
		updateCalls++;
		return chain;
	};
	chain.then = (resolve: (val: unknown[]) => void, reject?: (e: unknown) => void) => {
		try {
			const next = updateQueue.shift() ?? { rows: [] };
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
		select: () => makeSelectChain(),
		insert: () => makeInsertChain(),
		update: () => makeUpdateChain()
	}
}));

mock.module('$lib/server/db/schema', () => ({
	hostingAccount: {
		id: 'id',
		tenantId: 'tenant_id',
		clientId: 'client_id',
		daServerId: 'da_server_id',
		daUsername: 'da_username',
		domain: 'domain',
		daCredentialsEncrypted: 'da_credentials_encrypted'
	},
	hostingEmailEvent: {
		id: 'id',
		tenantId: 'tenant_id',
		hostingAccountId: 'hosting_account_id',
		dedupeKey: 'dedupe_key',
		eventType: 'event_type',
		emailLogId: 'email_log_id'
	},
	daServer: {
		id: 'id',
		tenantId: 'tenant_id',
		hostname: 'hostname'
	},
	client: { id: 'id', tenantId: 'tenant_id', email: 'email', name: 'name', businessName: 'business_name' },
	hostingInquiry: {
		id: 'id',
		tenantId: 'tenant_id',
		hostingAccountId: 'hosting_account_id',
		contactEmail: 'contact_email',
		contactName: 'contact_name'
	},
	tenantUser: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', role: 'role', status: 'status' },
	user: { id: 'id', email: 'email' },
	tenant: { id: 'id', adminContactEmail: 'admin_contact_email' }
}));

// Mock collaborators
const sendWithPersistenceCalls: Array<{ ctx: unknown }> = [];
mock.module('$lib/server/email', () => ({
	sendWithPersistence: async (ctx: unknown) => {
		sendWithPersistenceCalls.push({ ctx });
	}
}));

const logEmailAttemptCalls: Array<unknown> = [];
mock.module('$lib/server/email-logger', () => ({
	logEmailAttempt: async (params: unknown) => {
		logEmailAttemptCalls.push(params);
		return 'log-id-1';
	}
}));

mock.module('$lib/server/plugins/smartbill/crypto', () => ({
	decrypt: () => JSON.stringify({ username: 'da-user', password: 'da-pass' }),
	DecryptionError: class DecryptionError extends Error {}
}));

const loggerCalls = { info: [] as unknown[], error: [] as unknown[], warning: [] as unknown[] };
mock.module('$lib/server/logger', () => ({
	logInfo: (source: string, message: string, opts?: unknown) =>
		loggerCalls.info.push({ source, message, opts }),
	logError: (source: string, message: string, opts?: unknown) =>
		loggerCalls.error.push({ source, message, opts }),
	logWarning: (source: string, message: string, opts?: unknown) =>
		loggerCalls.warning.push({ source, message, opts })
}));

const renderCalls: unknown[] = [];
mock.module('../email-templates/account-created', () => ({
	render: async (input: unknown) => {
		renderCalls.push(input);
		return { subject: 'Hosting activ — example.ro', html: '<p>welcome</p>' };
	}
}));

// Now import the function under test
const { notifyHostingAccountCreated } = await import('../notifications');

function pushSelect(rows: unknown[]) {
	selectQueue.push({ rows });
}
function pushInsert(rows: unknown[]) {
	insertQueue.push({ rows });
}

beforeEach(() => {
	selectQueue = [];
	insertQueue = [];
	updateQueue = [];
	updateCalls = 0;
	sendWithPersistenceCalls.length = 0;
	logEmailAttemptCalls.length = 0;
	loggerCalls.info.length = 0;
	loggerCalls.error.length = 0;
	loggerCalls.warning.length = 0;
	renderCalls.length = 0;
});

describe('notifyHostingAccountCreated', () => {
	test('success path: inserts dedupe row, sends email, updates row with emailLogId', async () => {
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: 'encrypted-blob'
			}
		]);
		// 2. Atomic dedupe insert → returning a row (insert succeeded)
		pushInsert([{ id: 'evt-1' }]);
		// 3. resolveCustomerEmail → client lookup
		pushSelect([
			{ email: 'client@example.ro', name: 'Display', businessName: 'Acme SRL' }
		]);
		// 4. daServer lookup
		pushSelect([{ id: 'da-1', tenantId: 't-1', hostname: 'srv1.example.com' }]);

		await notifyHostingAccountCreated('t-1', 'acc-1');

		// One email_log row pre-created
		expect(logEmailAttemptCalls.length).toBe(1);
		const attempt = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(attempt.tenantId).toBe('t-1');
		expect(attempt.toEmail).toBe('client@example.ro');
		expect(attempt.emailType).toBe('hosting-account-created');

		// Email sent once with _retryOfLogId set
		expect(sendWithPersistenceCalls.length).toBe(1);
		const sendCtx = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtx._retryOfLogId).toBe('log-id-1');
		expect(sendCtx.toEmail).toBe('client@example.ro');
		expect(sendCtx.emailType).toBe('hosting-account-created');

		// Template was rendered with the right input
		expect(renderCalls.length).toBe(1);
		const renderInput = renderCalls[0] as Record<string, unknown>;
		expect(renderInput.tenantId).toBe('t-1');
		expect(renderInput.domain).toBe('example.ro');
		expect(renderInput.daUsername).toBe('da-user');
		expect(renderInput.daPassword).toBe('da-pass');
		expect(renderInput.daServerHost).toBe('srv1.example.com');
		expect(renderInput.serverIp).toBe('srv1.example.com');
		expect(renderInput.clientName).toBe('Acme SRL');

		// Dedupe row updated with the emailLogId
		expect(updateCalls).toBe(1);
	});

	test('dedupe path: second call is a no-op when onConflictDoNothing returns []', async () => {
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: 'encrypted-blob'
			}
		]);
		// 2. onConflictDoNothing returns empty array → dedupe hit
		pushInsert([]);

		await notifyHostingAccountCreated('t-1', 'acc-1');

		// No email_log row should be created
		expect(logEmailAttemptCalls.length).toBe(0);
		// No email sent
		expect(sendWithPersistenceCalls.length).toBe(0);
		// No update issued (no log id to attach)
		expect(updateCalls).toBe(0);
		// Info log emitted for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
	});

	test('cross-tenant: account belongs to different tenant → throws', async () => {
		// Account lookup returns nothing (WHERE tenantId=requested AND id=accountId fails)
		pushSelect([]);

		expect(notifyHostingAccountCreated('t-attacker', 'acc-victim')).rejects.toThrow();

		// No insert / email / update should happen
		// (Allow a microtask for rejects.toThrow to settle, then verify counts)
	});
});
