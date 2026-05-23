import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

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
		daCredentialsEncrypted: 'da_credentials_encrypted',
		status: 'status',
		nextDueDate: 'next_due_date',
		recurringAmount: 'recurring_amount',
		currency: 'currency',
		autoRenew: 'auto_renew'
	},
	hostingEmailEvent: {
		id: 'id',
		tenantId: 'tenant_id',
		hostingAccountId: 'hosting_account_id',
		dedupeKey: 'dedupe_key',
		eventType: 'event_type',
		emailLogId: 'email_log_id',
		sentAt: 'sent_at'
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
	tenant: { id: 'id', slug: 'slug', adminContactEmail: 'admin_contact_email' },
	emailSettings: { id: 'id', tenantId: 'tenant_id', smtpFrom: 'smtp_from', smtpUser: 'smtp_user' },
	invoice: {
		id: 'id',
		tenantId: 'tenant_id',
		invoiceNumber: 'invoice_number',
		issueDate: 'issue_date',
		dueDate: 'due_date',
		totalAmount: 'total_amount',
		currency: 'currency'
	}
}));

// Mock collaborators. The mock invokes buildMail() so the assembled message
// (from / to / subject / html / attachments) is asserted in tests — otherwise
// a missing `from` would slip past silently and only break in production.
const sendWithPersistenceCalls: Array<{ ctx: unknown; mail: unknown; mailError?: unknown }> = [];
let sendWithPersistenceImpl: (ctx: unknown, mail: unknown) => Promise<void> = async () => {};
mock.module('$lib/server/email', () => ({
	sendWithPersistence: async (ctx: unknown, buildMail: () => Promise<unknown>) => {
		let mail: unknown = undefined;
		let mailError: unknown = undefined;
		try {
			mail = await buildMail();
		} catch (e) {
			mailError = e;
		}
		sendWithPersistenceCalls.push({ ctx, mail, mailError });
		await sendWithPersistenceImpl(ctx, mail);
	},
	fetchTenantBrand: async (_tenantId: string) => ({
		tenantName: 'OTS',
		themeColor: '#0ea5e9',
		headerLogoHtml: '',
		logoAttachment: null
	}),
	resolveFromEmail: () => 'noreply@example.ro',
	// Needed so the real email-templates can link (we capture them below for
	// per-file restore; the templates use these via their transitive deps).
	// Templates themselves are mocked with canned data in this file, so these
	// stubs never actually run from inside notifications.test.ts.
	renderBrandedEmail: (_input: unknown) => '',
	renderCtaButton: (_href: string, _label: string, _themeColor: string) => ''
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

// ---------------------------------------------------------------------------
// Capture real exports of the three modules we're about to mock so we can
// restore them in afterAll. Without this, the mocks set below leak across
// test files in the same Bun process — notifications-helpers.test.ts,
// account-created.test.ts, and provisioning-failed.test.ts all see the
// canned values from THIS file's mocks instead of their real implementations.
//
// We capture function values via destructuring (not the namespace object) so
// the captured references survive the later mock.module(...) calls that mutate
// the module namespaces. Restore happens via mock.module() in afterAll —
// `mock.restore()` does NOT undo mock.module() in Bun 1.3.x.
// ---------------------------------------------------------------------------
const realAccountCreated = await import('../email-templates/account-created');
const capturedAccountCreated = { render: realAccountCreated.render };
const realProvisioningFailed = await import('../email-templates/provisioning-failed');
const capturedProvisioningFailed = { render: realProvisioningFailed.render };
const realSuspended = await import('../email-templates/suspended');
const capturedSuspended = { render: realSuspended.render };
const realReactivated = await import('../email-templates/reactivated');
const capturedReactivated = { render: realReactivated.render };
const realRenewalReminder = await import('../email-templates/renewal-reminder');
const capturedRenewalReminder = { render: realRenewalReminder.render };
const realPaymentFailed = await import('../email-templates/payment-failed');
const capturedPaymentFailed = { render: realPaymentFailed.render };
const realNotificationsHelpers = await import('../notifications-helpers');
const capturedNotificationsHelpers = {
	resolveCustomerEmail: realNotificationsHelpers.resolveCustomerEmail,
	resolveAdminRecipients: realNotificationsHelpers.resolveAdminRecipients,
	NoAdminRecipientError: realNotificationsHelpers.NoAdminRecipientError,
	OrphanAccountError: realNotificationsHelpers.OrphanAccountError,
	dayBucketEET: realNotificationsHelpers.dayBucketEET
};

const renderCalls: unknown[] = [];
mock.module('../email-templates/account-created', () => ({
	render: async (input: unknown) => {
		renderCalls.push(input);
		return { subject: 'Hosting activ — example.ro', html: '<p>welcome</p>' };
	}
}));

const renderPFCalls: unknown[] = [];
mock.module('../email-templates/provisioning-failed', () => ({
	render: async (input: unknown) => {
		renderPFCalls.push(input);
		return {
			subject: '🚨 Provisioning DA eșuat — example.ro (ots) — da_username_exists',
			html: '<p>pf body</p>'
		};
	}
}));

const renderSuspendedCalls: unknown[] = [];
mock.module('../email-templates/suspended', () => ({
	render: async (input: unknown) => {
		renderSuspendedCalls.push(input);
		return {
			subject: '\u{26A0}️ Contul de hosting suspendat — factură neachitată (example.ro)',
			html: '<p>suspended body</p>'
		};
	}
}));

const renderReactivatedCalls: unknown[] = [];
mock.module('../email-templates/reactivated', () => ({
	render: async (input: unknown) => {
		renderReactivatedCalls.push(input);
		return {
			subject: '\u{2705} Hosting reactivat — example.ro',
			html: '<p>reactivated body</p>'
		};
	}
}));

const renderRenewalReminderCalls: unknown[] = [];
mock.module('../email-templates/renewal-reminder', () => ({
	render: async (input: unknown) => {
		renderRenewalReminderCalls.push(input);
		return {
			subject: 'Hosting example.ro expiră în 7 zile',
			html: '<p>renewal body</p>'
		};
	}
}));

const renderPaymentFailedCalls: unknown[] = [];
mock.module('../email-templates/payment-failed', () => ({
	render: async (input: unknown) => {
		renderPaymentFailedCalls.push(input);
		return {
			subject: 'Plata pentru hosting example.ro a eșuat — acțiune necesară',
			html: '<p>payment-failed body</p>'
		};
	}
}));

// resolveCustomerEmail + resolveAdminRecipients mocked at module level so tests
// can inject return values directly instead of threading admin-resolver SQL
// (innerJoin on tenant_user) through the chain queue.
let resolveCustomerEmailReturn: { email: string; name: string; source: string } = {
	email: 'client@example.ro',
	name: 'Acme SRL',
	source: 'client'
};
let resolveAdminRecipientsReturn: string[] | Error = ['admin@example.ro'];
mock.module('../notifications-helpers', () => {
	class NoAdminRecipientError extends Error {
		constructor(public readonly tenantId: string) {
			super(`no admin recipient resolvable for tenant ${tenantId}`);
			this.name = 'NoAdminRecipientError';
		}
	}
	class OrphanAccountError extends Error {
		constructor(public readonly accountId: string) {
			super(`hosting account ${accountId} has no client and no inquiry`);
			this.name = 'OrphanAccountError';
		}
	}
	return {
		resolveCustomerEmail: async () => resolveCustomerEmailReturn,
		resolveAdminRecipients: async () => {
			if (resolveAdminRecipientsReturn instanceof Error) {
				throw resolveAdminRecipientsReturn;
			}
			return resolveAdminRecipientsReturn;
		},
		NoAdminRecipientError,
		OrphanAccountError,
		dayBucketEET: () => '2026-05-23'
	};
});

// Now import the function under test
const {
	notifyHostingAccountCreated,
	notifyHostingProvisioningFailed,
	notifyHostingSuspended,
	notifyHostingReactivated,
	notifyHostingRenewalReminder,
	notifyHostingPaymentFailed
} = await import('../notifications');

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
	sendWithPersistenceImpl = async () => {};
	logEmailAttemptCalls.length = 0;
	loggerCalls.info.length = 0;
	loggerCalls.error.length = 0;
	loggerCalls.warning.length = 0;
	renderCalls.length = 0;
	renderPFCalls.length = 0;
	renderSuspendedCalls.length = 0;
	renderReactivatedCalls.length = 0;
	renderRenewalReminderCalls.length = 0;
	renderPaymentFailedCalls.length = 0;
	resolveCustomerEmailReturn = {
		email: 'client@example.ro',
		name: 'Acme SRL',
		source: 'client'
	};
	resolveAdminRecipientsReturn = ['admin@example.ro'];
});

// Restore the modules we replaced via mock.module() so the next test file
// (which loads in the same Bun process) doesn't see our canned values. Bun
// runs test files sequentially in one process — without this, the leak
// breaks notifications-helpers.test.ts and the email-templates test suite.
afterAll(() => {
	mock.module('../email-templates/account-created', () => capturedAccountCreated);
	mock.module('../email-templates/provisioning-failed', () => capturedProvisioningFailed);
	mock.module('../email-templates/suspended', () => capturedSuspended);
	mock.module('../email-templates/reactivated', () => capturedReactivated);
	mock.module('../email-templates/renewal-reminder', () => capturedRenewalReminder);
	mock.module('../email-templates/payment-failed', () => capturedPaymentFailed);
	mock.module('../notifications-helpers', () => capturedNotificationsHelpers);
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
		// 3. daServer lookup (resolveCustomerEmail is mocked at module level)
		pushSelect([{ id: 'da-1', tenantId: 't-1', hostname: 'srv1.example.com' }]);
		// 4. emailSettings lookup inside buildMail
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingAccountCreated('t-1', 'acc-1');

		// One email_log row pre-created
		expect(logEmailAttemptCalls.length).toBe(1);
		const attempt = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(attempt.tenantId).toBe('t-1');
		expect(attempt.toEmail).toBe('client@example.ro');
		expect(attempt.emailType).toBe('hosting-account-created');
		// One-shot welcome — not replay-eligible (no sendFn registry entry).
		expect(attempt.payload).toBeNull();

		// Email sent once with _retryOfLogId set
		expect(sendWithPersistenceCalls.length).toBe(1);
		const sendCtx = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtx._retryOfLogId).toBe('log-id-1');
		expect(sendCtx.toEmail).toBe('client@example.ro');
		expect(sendCtx.emailType).toBe('hosting-account-created');
		// payload: null mirrors sendDailyWorkReminderEmail — scheduler must not replay
		// (welcome is dedupe-blocked at the lifetime grain).
		expect(sendCtx.payload).toBeNull();

		// buildMail() invoked — assert the assembled nodemailer message has the
		// fields nodemailer actually needs (`from` was previously omitted; real
		// sends would have failed with "from: required" or fallen back to a
		// hostname like "user@localhost").
		const mail = sendWithPersistenceCalls[0].mail as Record<string, unknown>;
		expect(mail).toBeDefined();
		expect(mail.from).toBeDefined();
		expect(mail.from as string).toContain('@');
		expect(mail.from as string).toContain('OTS');
		expect(mail.from as string).toContain('noreply@example.ro');
		expect(mail.to).toBe('client@example.ro');
		expect(mail.subject).toBeDefined();
		expect(mail.html).toBeDefined();

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

		await expect(notifyHostingAccountCreated('t-attacker', 'acc-victim')).rejects.toThrow();

		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		expect(renderCalls.length).toBe(0);
		expect(updateCalls).toBe(0);
	});

	test('throws and leaves dedupe row unlinked if sendWithPersistence fails', async () => {
		// Setup the same happy-path queue (account → dedupe insert → client lookup
		// → daServer lookup → emailSettings lookup inside buildMail), but make
		// sendWithPersistence itself throw AFTER buildMail has run.
		// This proves: when SMTP send fails, the dedupe row is NOT backfilled
		// with an emailLogId — leaving it as a "stuck" sentinel an admin can
		// spot (or a retry tool can pick up by querying for emailLogId IS NULL).
		sendWithPersistenceImpl = async () => {
			throw new Error('SMTP transport error');
		};

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
		// 3. daServer lookup (resolveCustomerEmail is mocked at module level)
		pushSelect([{ id: 'da-1', tenantId: 't-1', hostname: 'srv1.example.com' }]);
		// 4. emailSettings lookup inside buildMail
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await expect(notifyHostingAccountCreated('t-1', 'acc-1')).rejects.toThrow(
			'SMTP transport error'
		);

		// Pre-create email_log row DID happen (we want the audit trail).
		expect(logEmailAttemptCalls.length).toBe(1);
		// sendWithPersistence was called (and threw).
		expect(sendWithPersistenceCalls.length).toBe(1);
		// CRITICAL: no emailLogId backfill on send failure — the dedupe row stays
		// unlinked so it surfaces as a stuck welcome.
		expect(updateCalls).toBe(0);
		// Error logged for ops visibility.
		expect(loggerCalls.error.length).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// notifyHostingProvisioningFailed (admin alert with 5-min rolling dedupe)
// ---------------------------------------------------------------------------
describe('notifyHostingProvisioningFailed', () => {
	test('sends to all owner/admin users (multi-recipient send)', async () => {
		resolveAdminRecipientsReturn = ['a@example.ro', 'b@example.ro'];

		// 1. Rolling dedupe query → no prior alerts in 5-min window
		pushSelect([]);
		// 2. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// 3. Tenant lookup (for slug)
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 4. Dedupe row insert (rolling — straight INSERT, returns row)
		pushInsert([{ id: 'evt-pf-1' }]);
		// 5+6. emailSettings lookup inside each buildMail (2 sends)
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingProvisioningFailed('t-1', 'acc-1', 'da_username_exists', 2);

		// Template rendered ONCE (reused across recipients)
		expect(renderPFCalls.length).toBe(1);
		const renderInput = renderPFCalls[0] as Record<string, unknown>;
		expect(renderInput.tenantId).toBe('t-1');
		expect(renderInput.tenantSlug).toBe('ots');
		expect(renderInput.accountId).toBe('acc-1');
		expect(renderInput.reason).toBe('da_username_exists');
		expect(renderInput.attemptNumber).toBe(2);
		expect(renderInput.adminCrmUrl).toContain('/ots/hosting/accounts/acc-1');

		// Two email_log rows pre-created (one per recipient)
		expect(logEmailAttemptCalls.length).toBe(2);
		const first = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(first.toEmail).toBe('a@example.ro');
		expect(first.emailType).toBe('hosting-provisioning-failed');
		expect(first.payload).toBeNull();
		const second = logEmailAttemptCalls[1] as Record<string, unknown>;
		expect(second.toEmail).toBe('b@example.ro');

		// Two sends with _retryOfLogId
		expect(sendWithPersistenceCalls.length).toBe(2);
		const sendCtxA = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtxA._retryOfLogId).toBe('log-id-1');
		expect(sendCtxA.payload).toBeNull();
		const mailA = sendWithPersistenceCalls[0].mail as Record<string, unknown>;
		expect(mailA.from).toBeDefined();
		expect(mailA.from as string).toContain('@');
		expect(mailA.to).toBe('a@example.ro');
		const mailB = sendWithPersistenceCalls[1].mail as Record<string, unknown>;
		expect(mailB.to).toBe('b@example.ro');
	});

	test('rolling 5-min dedupe blocks same reason within window', async () => {
		// Rolling dedupe query returns a prior alert → early return
		pushSelect([{ id: 'existing-evt' }]);

		await notifyHostingProvisioningFailed('t-1', 'acc-1', 'da_create_failed', 1);

		// No template render, no email_log creation, no send
		expect(renderPFCalls.length).toBe(0);
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		// Info log for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
	});

	test('different reasons within 5-min window both send (dedupe key differs)', async () => {
		resolveAdminRecipientsReturn = ['admin@example.ro'];

		// FIRST CALL (reason A)
		pushSelect([]); // rolling dedupe → empty
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		pushInsert([{ id: 'evt-A' }]);
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingProvisioningFailed('t-1', 'acc-1', 'da_username_exists', 1);

		// SECOND CALL (reason B) within the same 5-min window — dedupe LIKE clause
		// scopes by reason, so this also queries empty and sends.
		pushSelect([]);
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		pushInsert([{ id: 'evt-B' }]);
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingProvisioningFailed('t-1', 'acc-1', 'da_unreachable', 1);

		// Both calls rendered + sent
		expect(renderPFCalls.length).toBe(2);
		expect(logEmailAttemptCalls.length).toBe(2);
		expect(sendWithPersistenceCalls.length).toBe(2);
	});

	test('throws and propagates when resolveAdminRecipients fails', async () => {
		const { NoAdminRecipientError } = await import('../notifications-helpers');
		resolveAdminRecipientsReturn = new NoAdminRecipientError('t-1');

		// Rolling dedupe query → empty (we go past it)
		pushSelect([]);
		// Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// Tenant lookup
		pushSelect([{ id: 't-1', slug: 'ots' }]);

		await expect(
			notifyHostingProvisioningFailed('t-1', 'acc-1', 'da_create_failed', 1)
		).rejects.toBeInstanceOf(NoAdminRecipientError);

		// No template render, no log, no send
		expect(renderPFCalls.length).toBe(0);
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		// Error logged for ops visibility
		expect(loggerCalls.error.length).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// notifyHostingSuspended (per-invoice 24h day-bucket dedupe)
// ---------------------------------------------------------------------------
describe('notifyHostingSuspended', () => {
	test('sends suspension email with invoice details on first call', async () => {
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// 2. Invoice lookup
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				invoiceNumber: 'INV-2026-0123',
				issueDate: new Date('2026-05-15T00:00:00Z'),
				dueDate: new Date('2026-05-15T00:00:00Z'),
				totalAmount: 9950,
				currency: 'RON'
			}
		]);
		// 3. daServer lookup (resolveCustomerEmail is mocked at module level)
		pushSelect([{ id: 'da-1', tenantId: 't-1', hostname: 'srv1.example.com' }]);
		// 4. Tenant lookup (for slug → payUrl)
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 5. Atomic dedupe insert → returns row (insert succeeded)
		pushInsert([{ id: 'evt-susp-1' }]);
		// 6. emailSettings lookup inside buildMail
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingSuspended('t-1', 'acc-1', 'inv-1');

		// Template rendered once with the right fields
		expect(renderSuspendedCalls.length).toBe(1);
		const renderInput = renderSuspendedCalls[0] as Record<string, unknown>;
		expect(renderInput.tenantId).toBe('t-1');
		expect(renderInput.domain).toBe('example.ro');
		expect(renderInput.clientName).toBe('Acme SRL');
		expect(renderInput.invoiceNumber).toBe('INV-2026-0123');
		expect(renderInput.amountDue).toBe(9950);
		expect(renderInput.currency).toBe('RON');
		expect(renderInput.payUrl).toContain('/ots/invoices/inv-1/pay');

		// One email_log row pre-created
		expect(logEmailAttemptCalls.length).toBe(1);
		const attempt = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(attempt.tenantId).toBe('t-1');
		expect(attempt.toEmail).toBe('client@example.ro');
		expect(attempt.emailType).toBe('hosting-suspended');
		// Day-bucket dedupe → scheduler replay no-ops → payload: null
		expect(attempt.payload).toBeNull();

		// Email sent once with _retryOfLogId set
		expect(sendWithPersistenceCalls.length).toBe(1);
		const sendCtx = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtx._retryOfLogId).toBe('log-id-1');
		expect(sendCtx.toEmail).toBe('client@example.ro');
		expect(sendCtx.emailType).toBe('hosting-suspended');
		expect(sendCtx.payload).toBeNull();

		// buildMail() result asserted — `from` must be set
		const mail = sendWithPersistenceCalls[0].mail as Record<string, unknown>;
		expect(mail).toBeDefined();
		expect(mail.from).toBeDefined();
		expect(mail.from as string).toContain('@');
		expect(mail.from as string).toContain('OTS');
		expect(mail.to).toBe('client@example.ro');
		expect(mail.subject).toBeDefined();
		expect(mail.html).toBeDefined();

		// Dedupe row updated with the emailLogId
		expect(updateCalls).toBe(1);
	});

	test('same-day second call is dedupe no-op', async () => {
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// 2. Invoice lookup
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				invoiceNumber: 'INV-2026-0123',
				issueDate: new Date('2026-05-15T00:00:00Z'),
				dueDate: new Date('2026-05-15T00:00:00Z'),
				totalAmount: 9950,
				currency: 'RON'
			}
		]);
		// 3. daServer lookup
		pushSelect([{ id: 'da-1', tenantId: 't-1', hostname: 'srv1.example.com' }]);
		// 4. Tenant lookup
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 5. onConflictDoNothing returns [] → dedupe hit
		pushInsert([]);

		await notifyHostingSuspended('t-1', 'acc-1', 'inv-1');

		// No template render past dedupe, no log, no send, no update
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		expect(updateCalls).toBe(0);
		// Info log for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// notifyHostingReactivated (per-invoice lifetime dedupe + multi-invoice safety)
// ---------------------------------------------------------------------------
describe('notifyHostingReactivated', () => {
	test('sends reactivation email with payment details on first call', async () => {
		// 1. Multi-invoice safety check → no other unpaid invoices for this account
		pushSelect([]);
		// 2. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// 3. Invoice lookup
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				invoiceNumber: 'INV-2026-0123',
				issueDate: new Date('2026-05-15T00:00:00Z'),
				dueDate: new Date('2026-05-15T00:00:00Z'),
				totalAmount: 9950,
				currency: 'RON'
			}
		]);
		// 4. daServer lookup (resolveCustomerEmail is mocked at module level)
		pushSelect([{ id: 'da-1', tenantId: 't-1', hostname: 'srv1.example.com' }]);
		// 5. Atomic dedupe insert → returns row (insert succeeded)
		pushInsert([{ id: 'evt-react-1' }]);
		// 6. emailSettings lookup inside buildMail
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingReactivated('t-1', 'acc-1', 'inv-1');

		// Template rendered once with the right fields
		expect(renderReactivatedCalls.length).toBe(1);
		const renderInput = renderReactivatedCalls[0] as Record<string, unknown>;
		expect(renderInput.tenantId).toBe('t-1');
		expect(renderInput.domain).toBe('example.ro');
		expect(renderInput.clientName).toBe('Acme SRL');
		expect(renderInput.invoiceNumber).toBe('INV-2026-0123');
		expect(renderInput.amountPaid).toBe(9950);
		expect(renderInput.currency).toBe('RON');
		expect(renderInput.daPanelUrl).toBe('https://srv1.example.com:2222');

		// One email_log row pre-created
		expect(logEmailAttemptCalls.length).toBe(1);
		const attempt = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(attempt.tenantId).toBe('t-1');
		expect(attempt.toEmail).toBe('client@example.ro');
		expect(attempt.emailType).toBe('hosting-reactivated');
		// Lifetime dedupe per invoice → scheduler replay no-ops → payload: null
		expect(attempt.payload).toBeNull();

		// Email sent once with _retryOfLogId set
		expect(sendWithPersistenceCalls.length).toBe(1);
		const sendCtx = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtx._retryOfLogId).toBe('log-id-1');
		expect(sendCtx.toEmail).toBe('client@example.ro');
		expect(sendCtx.emailType).toBe('hosting-reactivated');
		expect(sendCtx.payload).toBeNull();

		// buildMail() result asserted — `from` must be set
		const mail = sendWithPersistenceCalls[0].mail as Record<string, unknown>;
		expect(mail).toBeDefined();
		expect(mail.from).toBeDefined();
		expect(mail.from as string).toContain('@');
		expect(mail.from as string).toContain('OTS');
		expect(mail.to).toBe('client@example.ro');
		expect(mail.subject).toBeDefined();
		expect(mail.html).toBeDefined();

		// Dedupe row updated with the emailLogId
		expect(updateCalls).toBe(1);
	});

	test('skips email when another hosting invoice is still unpaid (safety check)', async () => {
		// 1. Multi-invoice safety check → another unpaid invoice exists → skip
		pushSelect([{ id: 'other-inv' }]);

		await notifyHostingReactivated('t-1', 'acc-1', 'inv-1');

		// No template render, no email_log, no send, no update
		expect(renderReactivatedCalls.length).toBe(0);
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		expect(updateCalls).toBe(0);
		// Info log for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// notifyHostingRenewalReminder (per-(dueDate, window) dedupe — multiple windows
// fire over the renewal cycle but each window only sends once per due date)
// ---------------------------------------------------------------------------
describe('notifyHostingRenewalReminder', () => {
	test('sends once per (dueDate, window); second call deduplicates', async () => {
		// ----- First call: full happy-path queue -----
		// 1. Account lookup (must include nextDueDate, autoRenew, recurringAmount, currency)
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				nextDueDate: '2026-06-01',
				recurringAmount: 9950,
				currency: 'RON',
				autoRenew: true
			}
		]);
		// 2. Tenant lookup (for slug → payUrl)
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 3. Atomic dedupe insert → returns row (insert succeeded)
		pushInsert([{ id: 'evt-rr-1' }]);
		// 4. emailSettings lookup inside buildMail
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingRenewalReminder('t-1', 'acc-1', 7);

		// Template rendered once with the right fields
		expect(renderRenewalReminderCalls.length).toBe(1);
		const renderInput = renderRenewalReminderCalls[0] as Record<string, unknown>;
		expect(renderInput.tenantId).toBe('t-1');
		expect(renderInput.domain).toBe('example.ro');
		expect(renderInput.clientName).toBe('Acme SRL');
		expect(renderInput.daysUntilDue).toBe(7);
		expect(renderInput.autoRenew).toBe(true);
		expect(renderInput.amountDue).toBe(9950);
		expect(renderInput.currency).toBe('RON');
		expect(renderInput.payUrl).toContain('/ots/hosting/accounts/acc-1/renew');
		// Romanian formatted due date 2026-06-01 → 01.06.2026
		expect(renderInput.dueDate).toBe('01.06.2026');

		// One email_log row pre-created
		expect(logEmailAttemptCalls.length).toBe(1);
		const attempt = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(attempt.tenantId).toBe('t-1');
		expect(attempt.toEmail).toBe('client@example.ro');
		expect(attempt.emailType).toBe('hosting-renewal-reminder');
		// Per-(dueDate, window) dedupe → scheduler replay no-ops → payload: null
		expect(attempt.payload).toBeNull();

		// Email sent once with _retryOfLogId set
		expect(sendWithPersistenceCalls.length).toBe(1);
		const sendCtx = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtx._retryOfLogId).toBe('log-id-1');
		expect(sendCtx.toEmail).toBe('client@example.ro');
		expect(sendCtx.emailType).toBe('hosting-renewal-reminder');
		expect(sendCtx.payload).toBeNull();

		// buildMail() result asserted — `from` must be set
		const mail = sendWithPersistenceCalls[0].mail as Record<string, unknown>;
		expect(mail).toBeDefined();
		expect(mail.from).toBeDefined();
		expect(mail.from as string).toContain('@');
		expect(mail.from as string).toContain('OTS');
		expect(mail.to).toBe('client@example.ro');
		expect(mail.subject).toBeDefined();
		expect(mail.html).toBeDefined();

		// Dedupe row updated with the emailLogId
		expect(updateCalls).toBe(1);

		// ----- Second call: same (dueDate, window) — onConflictDoNothing returns [] → skip -----
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				nextDueDate: '2026-06-01',
				recurringAmount: 9950,
				currency: 'RON',
				autoRenew: true
			}
		]);
		// 2. Tenant lookup
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 3. onConflictDoNothing returns [] → dedupe hit
		pushInsert([]);

		await notifyHostingRenewalReminder('t-1', 'acc-1', 7);

		// Template rendered for the second call (before dedupe insert — order matters,
		// expensive work runs first to avoid leaking a dedupe row on transient errors)
		expect(renderRenewalReminderCalls.length).toBe(2);
		// But NO new email_log row, NO new send, NO new update
		expect(logEmailAttemptCalls.length).toBe(1);
		expect(sendWithPersistenceCalls.length).toBe(1);
		expect(updateCalls).toBe(1);
		// Info log for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
	});

	test('throws when account.nextDueDate is null', async () => {
		// Account lookup returns row with nextDueDate=null
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				nextDueDate: null,
				recurringAmount: 9950,
				currency: 'RON',
				autoRenew: true
			}
		]);

		await expect(notifyHostingRenewalReminder('t-1', 'acc-1', 14)).rejects.toThrow();

		// No template render, no log, no send
		expect(renderRenewalReminderCalls.length).toBe(0);
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		expect(updateCalls).toBe(0);
		// Error logged for ops visibility
		expect(loggerCalls.error.length).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// notifyHostingPaymentFailed (per-invoice LIFETIME dedupe — Stripe may retry
// charge attempts multiple times; one customer email per invoice forever).
// ---------------------------------------------------------------------------
describe('notifyHostingPaymentFailed', () => {
	test('sends payment-failed email with failure reason on first call', async () => {
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// 2. Invoice lookup
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				invoiceNumber: 'INV-2026-0123',
				issueDate: new Date('2026-05-15T00:00:00Z'),
				dueDate: new Date('2026-05-15T00:00:00Z'),
				totalAmount: 9950,
				currency: 'RON'
			}
		]);
		// 3. Tenant lookup (for slug → manualPayUrl)
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 4. Atomic dedupe insert → returns row (insert succeeded)
		pushInsert([{ id: 'evt-pf-1' }]);
		// 5. emailSettings lookup inside buildMail
		pushSelect([{ smtpFrom: 'noreply@example.ro', smtpUser: 'noreply@example.ro' }]);

		await notifyHostingPaymentFailed(
			't-1',
			'acc-1',
			'inv-1',
			'Card expired',
			'https://invoice.stripe.com/i/acct/pi'
		);

		// Template rendered once with the right fields
		expect(renderPaymentFailedCalls.length).toBe(1);
		const renderInput = renderPaymentFailedCalls[0] as Record<string, unknown>;
		expect(renderInput.tenantId).toBe('t-1');
		expect(renderInput.domain).toBe('example.ro');
		expect(renderInput.clientName).toBe('Acme SRL');
		expect(renderInput.invoiceNumber).toBe('INV-2026-0123');
		expect(renderInput.amountDue).toBe(9950);
		expect(renderInput.currency).toBe('RON');
		expect(renderInput.failureReason).toBe('Card expired');
		// updateMethodUrl uses the Stripe hosted URL passed in
		expect(renderInput.updateMethodUrl).toBe('https://invoice.stripe.com/i/acct/pi');
		// manualPayUrl points to the CRM invoice pay page
		expect(renderInput.manualPayUrl).toContain('/ots/invoices/inv-1/pay');
		// 10-day suspension grace surfaced
		expect(renderInput.daysUntilSuspend).toBe(10);

		// One email_log row pre-created
		expect(logEmailAttemptCalls.length).toBe(1);
		const attempt = logEmailAttemptCalls[0] as Record<string, unknown>;
		expect(attempt.tenantId).toBe('t-1');
		expect(attempt.toEmail).toBe('client@example.ro');
		expect(attempt.emailType).toBe('hosting-payment-failed');
		// Lifetime dedupe per invoice → scheduler replay no-ops → payload: null
		expect(attempt.payload).toBeNull();

		// Email sent once with _retryOfLogId set
		expect(sendWithPersistenceCalls.length).toBe(1);
		const sendCtx = sendWithPersistenceCalls[0].ctx as Record<string, unknown>;
		expect(sendCtx._retryOfLogId).toBe('log-id-1');
		expect(sendCtx.toEmail).toBe('client@example.ro');
		expect(sendCtx.emailType).toBe('hosting-payment-failed');
		expect(sendCtx.payload).toBeNull();

		// buildMail() result asserted — `from` must be set
		const mail = sendWithPersistenceCalls[0].mail as Record<string, unknown>;
		expect(mail).toBeDefined();
		expect(mail.from).toBeDefined();
		expect(mail.from as string).toContain('@');
		expect(mail.from as string).toContain('OTS');
		expect(mail.to).toBe('client@example.ro');
		expect(mail.subject).toBeDefined();
		expect(mail.html).toBeDefined();

		// Dedupe row updated with the emailLogId
		expect(updateCalls).toBe(1);
	});

	test('same-invoice second call is dedupe no-op (lifetime)', async () => {
		// 1. Account lookup
		pushSelect([
			{
				id: 'acc-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				daServerId: 'da-1',
				daUsername: 'da-user',
				domain: 'example.ro',
				daCredentialsEncrypted: null
			}
		]);
		// 2. Invoice lookup
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				invoiceNumber: 'INV-2026-0123',
				issueDate: new Date('2026-05-15T00:00:00Z'),
				dueDate: new Date('2026-05-15T00:00:00Z'),
				totalAmount: 9950,
				currency: 'RON'
			}
		]);
		// 3. Tenant lookup
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		// 4. onConflictDoNothing returns [] → dedupe hit (lifetime per invoice)
		pushInsert([]);

		await notifyHostingPaymentFailed('t-1', 'acc-1', 'inv-1', 'Insufficient funds');

		// Template was rendered before the dedupe insert (expensive-work-first
		// pattern — see comment in notifications.ts about resolve-then-dedupe)
		expect(renderPaymentFailedCalls.length).toBe(1);
		// But NO email_log row created, NO send, NO update
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);
		expect(updateCalls).toBe(0);
		// Info log for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
	});
});
