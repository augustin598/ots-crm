import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

// Mock SvelteKit virtual modules BEFORE importing the module under test
// (which transitively imports $lib/server/db → $env/dynamic/private). We
// also need $env/dynamic/public because the eager-capture of $lib/server/email
// below pulls in that virtual module transitively.
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ---------------------------------------------------------------------------
// SELECT chain mocking (same pattern as hosting/__tests__/notifications.test.ts)
// Each .select().from().where().limit() awaits a queued result.
// ---------------------------------------------------------------------------
interface Queued {
	rows: unknown[];
}
let selectQueue: Queued[] = [];

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
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
// ---------------------------------------------------------------------------
let insertQueue: Queued[] = [];
const insertCalls: Array<{ table: unknown; values: unknown }> = [];

function makeInsertChain(table: unknown) {
	const chain: Record<string, unknown> = {};
	chain.values = (v: unknown) => {
		insertCalls.push({ table, values: v });
		return chain;
	};
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
// UPDATE chain mocking — supports:
//   db.update(table).set(...).where(...)
// Resolves to an empty array because the notify path never inspects the
// return value. We track calls so tests can verify the dedupe-row patch.
// ---------------------------------------------------------------------------
const updateCalls: Array<{ table: unknown; set: unknown }> = [];

function makeUpdateChain(table: unknown) {
	const chain: Record<string, unknown> = {};
	chain.set = (v: unknown) => {
		updateCalls.push({ table, set: v });
		return chain;
	};
	chain.where = () => chain;
	chain.then = (resolve: (val: unknown[]) => void) => {
		resolve([]);
	};
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		insert: (t: unknown) => makeInsertChain(t),
		update: (t: unknown) => makeUpdateChain(t)
	}
}));

mock.module('$lib/server/db/schema', () => ({
	paymentEmailEvent: {
		id: 'id',
		tenantId: 'tenant_id',
		invoiceId: 'invoice_id',
		eventType: 'event_type',
		dedupeKey: 'dedupe_key',
		emailLogId: 'email_log_id',
		sentAt: 'sent_at'
	},
	invoice: {
		id: 'id',
		tenantId: 'tenant_id',
		clientId: 'client_id',
		invoiceNumber: 'invoice_number',
		totalAmount: 'total_amount',
		currency: 'currency'
	},
	invoiceLineItem: {
		id: 'id',
		invoiceId: 'invoice_id',
		description: 'description'
	},
	invoiceSettings: {
		id: 'id',
		tenantId: 'tenant_id',
		invoiceEmailsEnabled: 'invoice_emails_enabled',
		paidConfirmationEmailEnabled: 'paid_confirmation_email_enabled'
	},
	tenant: {
		id: 'id',
		slug: 'slug'
	},
	client: {
		id: 'id',
		tenantId: 'tenant_id',
		name: 'name',
		businessName: 'business_name',
		email: 'email'
	},
	emailSettings: {
		id: 'id',
		tenantId: 'tenant_id'
	}
}));

// ---------------------------------------------------------------------------
// CRITICAL: capture the REAL $lib/server/email exports BEFORE any
// mock.module('$lib/server/email', ...) call in THIS file.
//
// Why: Bun's `mock.module()` is sticky — once installed in the registry, it
// persists for the remainder of the process even across test-file boundaries
// (Bun's `mock.restore()` does NOT undo mock.module on Bun 1.3.x). And Bun
// treats `mock.module(name, factory)` as an OVERLAY only if the real module
// is already in the import cache; otherwise downstream `import { X } from
// name` will fail at link time with "Export named X not found" for any name
// not in the factory's returned object.
//
// Our capture below uses the alias path ('$lib/server/email') to share the
// same cache key as the production code under test. If we used the relative
// path '../../email', Bun would treat it as a distinct module — and the
// mock we install at line 156 would never land on the binding the production
// code sees. Verified empirically on Bun 1.3.10.
//
// We capture function values via destructuring (not the namespace object) so
// the captured references survive the later mock.module call that mutates
// the module namespace. The afterAll then restores via mock.module() — a
// second overlay that re-installs the original implementations for the two
// names we stubbed. Other email exports already in the cache stay untouched.
// ---------------------------------------------------------------------------
const realEmail = await import('$lib/server/email');
const capturedEmail = {
	sendInvoicePaidEmail: realEmail.sendInvoicePaidEmail,
	getNotificationRecipients: realEmail.getNotificationRecipients,
	sendWithPersistence: realEmail.sendWithPersistence,
	fetchTenantBrand: realEmail.fetchTenantBrand,
	resolveFromEmail: realEmail.resolveFromEmail,
	renderCtaButton: realEmail.renderCtaButton,
	renderBrandedEmail: realEmail.renderBrandedEmail
};
const realEmailLogger = await import('$lib/server/email-logger');
const capturedEmailLogger = {
	logEmailAttempt: realEmailLogger.logEmailAttempt,
	EMAIL_TYPES: realEmailLogger.EMAIL_TYPES,
	isEmailType: realEmailLogger.isEmailType
};

// NOTE: we deliberately do NOT `await import('$lib/server/hosting/notifications-helpers')`
// for capture purposes here. That module imports concrete schema symbols
// (tenantUser, user, tenant, etc.) that aren't part of the minimal db/schema
// mock above — pulling them in would force expanding the schema mock just to
// support a capture path no downstream test consumer needs. Instead the
// inline class definitions in the mock below are functionally equivalent for
// any test that imports `NoAdminRecipientError` after our mock is installed,
// and the afterAll restore relies on `mock.module()` being sticky-overlayable
// (other test files that need a real helpers module will overlay it themselves,
// same pattern hosting/__tests__/notifications.test.ts uses).
const realAdminTemplate = await import('../email-templates/admin-payment-received');
const capturedAdminTemplate = {
	render: realAdminTemplate.render
};

// Mock $lib/server/email — sendInvoicePaidEmail, getNotificationRecipients,
// sendWithPersistence (used by admin notify), fetchTenantBrand + resolveFromEmail
// (used by the admin notify buildMail closure), and renderCtaButton (transitively
// imported by the admin template). Each function is captured above and restored
// in afterAll() to avoid leaking the mock into other test files in directory mode.
const sendInvoicePaidEmailCalls: Array<{ invoiceId: string; clientEmail: string }> = [];
let sendInvoicePaidEmailImpl: (invoiceId: string, clientEmail: string) => Promise<void> = async () => {};

const getNotificationRecipientsCalls: Array<{ clientId: string; category: string }> = [];
let getNotificationRecipientsReturn: Array<{ email: string; name: string | null }> = [
	{ email: 'client@example.ro', name: 'Acme SRL' }
];

const sendWithPersistenceCalls: Array<{ ctx: Record<string, unknown> }> = [];
let sendWithPersistenceImpl: () => Promise<void> = async () => {};

mock.module('$lib/server/email', () => ({
	sendInvoicePaidEmail: async (invoiceId: string, clientEmail: string) => {
		sendInvoicePaidEmailCalls.push({ invoiceId, clientEmail });
		await sendInvoicePaidEmailImpl(invoiceId, clientEmail);
	},
	getNotificationRecipients: async (clientId: string, category: string) => {
		getNotificationRecipientsCalls.push({ clientId, category });
		return getNotificationRecipientsReturn;
	},
	sendWithPersistence: async (ctx: Record<string, unknown>, _build: () => Promise<unknown>) => {
		sendWithPersistenceCalls.push({ ctx });
		await sendWithPersistenceImpl();
	},
	fetchTenantBrand: async () => ({
		tenantName: 'OTS',
		themeColor: '#0ea5e9',
		logoAttachment: null,
		headerLogoHtml: ''
	}),
	resolveFromEmail: () => 'no-reply@onetopsolution.ro',
	renderCtaButton: (href: string, label: string, _color: string) =>
		`<a href="${href}">${label}</a>`,
	// renderBrandedEmail is pulled in transitively by the admin template's
	// branded shell helper — keep the mock minimal so admin tests render to a
	// predictable string.
	renderBrandedEmail: ({
		title,
		bodyHtml,
		previewTitle
	}: {
		title: string;
		bodyHtml: string;
		previewTitle?: string;
	}) => `<html><head><title>${previewTitle ?? title}</title></head><body>${bodyHtml}</body></html>`
}));

// Mock $lib/server/email-logger — logEmailAttempt is called by notifyAdminPaymentReceived
// to pre-create one email_log row per recipient (multi-recipient pattern from Task 8).
const logEmailAttemptCalls: Array<{
	tenantId: string | null | undefined;
	toEmail: string;
	subject: string;
	emailType: string;
}> = [];
let nextEmailLogId = 0;
mock.module('$lib/server/email-logger', () => ({
	logEmailAttempt: async (params: {
		tenantId?: string | null;
		toEmail: string;
		subject: string;
		emailType: string;
	}) => {
		logEmailAttemptCalls.push({
			tenantId: params.tenantId,
			toEmail: params.toEmail,
			subject: params.subject,
			emailType: params.emailType
		});
		nextEmailLogId += 1;
		return `email-log-${nextEmailLogId}`;
	},
	EMAIL_TYPES: [],
	isEmailType: (_v: string) => true
}));

// Mock $lib/server/hosting/notifications-helpers — only resolveAdminRecipients
// is used by notifyAdminPaymentReceived (the admin notify path). Other helpers
// are NOT used by stripe/notifications, but we provide stubs so the module
// namespace doesn't error if something transitively imports them.
//
// Inline class definitions match the live module's shape (1:1 with
// hosting/notifications-helpers.ts) so any `instanceof` check downstream still
// works. We don't restore this in afterAll — hosting/__tests__/notifications.test.ts
// installs its own overlay for the same alias path, so cross-test leakage
// would only matter if some OTHER test imports from this exact alias path
// without overlaying. None do today.
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

let resolveAdminRecipientsReturn: string[] = ['admin@example.ro'];
let resolveAdminRecipientsThrows: Error | null = null;
mock.module('$lib/server/hosting/notifications-helpers', () => ({
	resolveAdminRecipients: async (_tenantId: string) => {
		if (resolveAdminRecipientsThrows) throw resolveAdminRecipientsThrows;
		return resolveAdminRecipientsReturn;
	},
	resolveCustomerEmail: async (_acc: { id: string; tenantId: string; clientId: string | null }) => {
		return { email: 'customer@example.ro', name: 'Customer', source: 'client' as const };
	},
	dayBucketEET: () => '2026-05-23',
	NoAdminRecipientError,
	OrphanAccountError
}));

const loggerCalls = {
	info: [] as Array<{ source: string; message: string; opts?: unknown }>,
	error: [] as Array<{ source: string; message: string; opts?: unknown }>,
	warning: [] as Array<{ source: string; message: string; opts?: unknown }>
};
mock.module('$lib/server/logger', () => ({
	logInfo: (source: string, message: string, opts?: unknown) =>
		loggerCalls.info.push({ source, message, opts }),
	logError: (source: string, message: string, opts?: unknown) =>
		loggerCalls.error.push({ source, message, opts }),
	logWarning: (source: string, message: string, opts?: unknown) =>
		loggerCalls.warning.push({ source, message, opts })
}));

// Now import the functions under test
const { notifyPaymentSucceeded, notifyAdminPaymentReceived } = await import('../notifications');

function pushSelect(rows: unknown[]) {
	selectQueue.push({ rows });
}
function pushInsert(rows: unknown[]) {
	insertQueue.push({ rows });
}

beforeEach(() => {
	selectQueue = [];
	insertQueue = [];
	insertCalls.length = 0;
	updateCalls.length = 0;
	sendInvoicePaidEmailCalls.length = 0;
	sendInvoicePaidEmailImpl = async () => {};
	getNotificationRecipientsCalls.length = 0;
	getNotificationRecipientsReturn = [{ email: 'client@example.ro', name: 'Acme SRL' }];
	sendWithPersistenceCalls.length = 0;
	sendWithPersistenceImpl = async () => {};
	logEmailAttemptCalls.length = 0;
	nextEmailLogId = 0;
	resolveAdminRecipientsReturn = ['admin@example.ro'];
	resolveAdminRecipientsThrows = null;
	loggerCalls.info.length = 0;
	loggerCalls.error.length = 0;
	loggerCalls.warning.length = 0;
});

afterAll(() => {
	// Restore the captured implementations so directory-mode test runs don't
	// inherit our mocks. mock.module() is sticky in Bun 1.3.x (mock.restore()
	// does NOT undo it), so a second overlay with the original symbols is the
	// only way to undo the mock for downstream files.
	mock.module('$lib/server/email', () => capturedEmail);
	mock.module('$lib/server/email-logger', () => capturedEmailLogger);
	mock.module('../email-templates/admin-payment-received', () => capturedAdminTemplate);
	// notifications-helpers intentionally NOT restored — see capture comment above.
});

// Helper to push the per-test invoice-settings lookup that gates whether
// notifyPaymentSucceeded proceeds. Most tests want the toggles ENABLED so
// the code falls through to the dedupe insert.
function pushEnabledSettings() {
	pushSelect([
		{
			invoiceEmailsEnabled: true,
			paidConfirmationEmailEnabled: true
		}
	]);
}

describe('notifyPaymentSucceeded', () => {
	test('inserts dedupe row + calls sendInvoicePaidEmail for each resolved recipient', async () => {
		getNotificationRecipientsReturn = [
			{ email: 'primary@example.ro', name: 'Acme SRL' },
			{ email: 'secondary@example.ro', name: 'Accountant' }
		];
		// 0. Invoice-settings toggle lookup (enabled by default)
		pushEnabledSettings();
		// 1. Dedupe INSERT → returning a row (insert succeeded)
		pushInsert([{ id: 'evt-1' }]);
		// 2. Invoice lookup (tenant-scoped)
		pushSelect([{ id: 'inv-1', tenantId: 't-1', clientId: 'cli-1', invoiceNumber: 'OTS-100' }]);

		await notifyPaymentSucceeded('t-1', 'inv-1');

		// Dedupe row inserted with correct shape
		expect(insertCalls.length).toBe(1);
		const insertValues = insertCalls[0].values as Record<string, unknown>;
		expect(insertValues.tenantId).toBe('t-1');
		expect(insertValues.invoiceId).toBe('inv-1');
		expect(insertValues.eventType).toBe('payment-succeeded');
		expect(insertValues.dedupeKey).toBe('payment-succeeded:inv-1');

		// Recipient lookup uses invoices category
		expect(getNotificationRecipientsCalls.length).toBe(1);
		expect(getNotificationRecipientsCalls[0].clientId).toBe('cli-1');
		expect(getNotificationRecipientsCalls[0].category).toBe('invoices');

		// One email sent per resolved recipient
		expect(sendInvoicePaidEmailCalls.length).toBe(2);
		expect(sendInvoicePaidEmailCalls[0]).toEqual({
			invoiceId: 'inv-1',
			clientEmail: 'primary@example.ro'
		});
		expect(sendInvoicePaidEmailCalls[1]).toEqual({
			invoiceId: 'inv-1',
			clientEmail: 'secondary@example.ro'
		});

		// Success log emitted
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
		const sentLog = loggerCalls.info.find((l) => l.message.includes('sent payment-succeeded'));
		expect(sentLog).toBeDefined();
		expect(sentLog!.source).toBe('hosting-email');
	});

	test('second call for same invoice is dedupe no-op (no second sendInvoicePaidEmail)', async () => {
		// 0. Invoice-settings toggle lookup (enabled by default)
		pushEnabledSettings();
		// onConflictDoNothing returns [] → dedupe hit
		pushInsert([]);

		await notifyPaymentSucceeded('t-1', 'inv-1');

		// No invoice lookup, no recipient resolution, no send
		expect(getNotificationRecipientsCalls.length).toBe(0);
		expect(sendInvoicePaidEmailCalls.length).toBe(0);

		// Info log emitted for skip
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
		const skipLog = loggerCalls.info.find((l) => l.message.includes('dedupe skip'));
		expect(skipLog).toBeDefined();
		expect(skipLog!.source).toBe('hosting-email');
	});

	test('throws when no recipient resolvable', async () => {
		getNotificationRecipientsReturn = []; // no primary, no secondary
		// 0. Invoice-settings toggle lookup
		pushEnabledSettings();
		// 1. Dedupe insert succeeds
		pushInsert([{ id: 'evt-1' }]);
		// 2. Invoice lookup succeeds
		pushSelect([{ id: 'inv-1', tenantId: 't-1', clientId: 'cli-1', invoiceNumber: 'OTS-100' }]);

		await expect(notifyPaymentSucceeded('t-1', 'inv-1')).rejects.toThrow(/no recipient/i);

		expect(sendInvoicePaidEmailCalls.length).toBe(0);
		expect(loggerCalls.error.length).toBeGreaterThanOrEqual(1);
		expect(loggerCalls.error[0].source).toBe('hosting-email');
	});

	test('throws when invoice not found (cross-tenant or missing)', async () => {
		// 0. Invoice-settings toggle lookup
		pushEnabledSettings();
		// 1. Dedupe insert succeeds
		pushInsert([{ id: 'evt-1' }]);
		// 2. Invoice lookup returns nothing (cross-tenant or deleted)
		pushSelect([]);

		await expect(notifyPaymentSucceeded('t-attacker', 'inv-victim')).rejects.toThrow(/not found/i);

		expect(getNotificationRecipientsCalls.length).toBe(0);
		expect(sendInvoicePaidEmailCalls.length).toBe(0);
		expect(loggerCalls.error.length).toBeGreaterThanOrEqual(1);
	});

	test('respects tenant invoice email toggles — skips when paidConfirmationEmailEnabled=false', async () => {
		// Settings row with master enabled but per-event toggle DISABLED.
		// Mirrors the legacy hook's behavior so admins who opted out keep
		// their opt-out after the trigger source moved to Stripe dispatcher.
		pushSelect([
			{
				invoiceEmailsEnabled: true,
				paidConfirmationEmailEnabled: false
			}
		]);

		await notifyPaymentSucceeded('t-1', 'inv-1');

		// No dedupe insert, no invoice lookup, no recipient resolution, no send
		expect(insertCalls.length).toBe(0);
		expect(getNotificationRecipientsCalls.length).toBe(0);
		expect(sendInvoicePaidEmailCalls.length).toBe(0);

		// Info log emitted for suppression
		expect(loggerCalls.info.length).toBeGreaterThanOrEqual(1);
		const suppressLog = loggerCalls.info.find((l) => l.message.includes('suppressed by tenant settings'));
		expect(suppressLog).toBeDefined();
		expect(suppressLog!.source).toBe('hosting-email');
		const meta = (suppressLog!.opts as { metadata: Record<string, unknown> }).metadata;
		expect(meta.paidConfirmationEmailEnabled).toBe(false);
		expect(meta.invoiceEmailsEnabled).toBe(true);
	});

	test('respects tenant invoice email toggles — skips when master invoiceEmailsEnabled=false', async () => {
		// Master toggle disabled — should suppress regardless of per-event toggle.
		pushSelect([
			{
				invoiceEmailsEnabled: false,
				paidConfirmationEmailEnabled: true
			}
		]);

		await notifyPaymentSucceeded('t-1', 'inv-1');

		expect(insertCalls.length).toBe(0);
		expect(getNotificationRecipientsCalls.length).toBe(0);
		expect(sendInvoicePaidEmailCalls.length).toBe(0);

		const suppressLog = loggerCalls.info.find((l) => l.message.includes('suppressed by tenant settings'));
		expect(suppressLog).toBeDefined();
		const meta = (suppressLog!.opts as { metadata: Record<string, unknown> }).metadata;
		expect(meta.invoiceEmailsEnabled).toBe(false);
	});

	test('defaults to enabled when no invoice_settings row exists (back-compat)', async () => {
		// Tenant without an invoice_settings row → both toggles default to true,
		// matching the legacy hook's `?? true` semantics. Send should proceed.
		pushSelect([]); // settings lookup returns nothing
		pushInsert([{ id: 'evt-1' }]);
		pushSelect([{ id: 'inv-1', tenantId: 't-1', clientId: 'cli-1', invoiceNumber: 'OTS-100' }]);

		await notifyPaymentSucceeded('t-1', 'inv-1');

		// Email was sent (didn't suppress)
		expect(sendInvoicePaidEmailCalls.length).toBe(1);
		expect(insertCalls.length).toBe(1);
	});
});

describe('notifyAdminPaymentReceived', () => {
	test('sends admin-payment-received to all admin recipients with step statuses', async () => {
		// Two admin recipients (multi-recipient pattern from Task 8).
		resolveAdminRecipientsReturn = ['admin1@example.ro', 'admin2@example.ro'];

		// SELECT chain order inside notifyAdminPaymentReceived. The order tracks
		// the implementation step-by-step so a refactor that swaps two reads will
		// surface here as a clear failure. Selects in order:
		//  1. invoice lookup (tenant-scoped)
		//  2. tenant slug lookup
		//  3. invoiceLineItem descriptions
		//  4. client (name/businessName/email)
		// THEN the dedupe insert fires, followed by the per-recipient
		// logEmailAttempt + sendWithPersistence loop.
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				invoiceNumber: 'OTS-2026-0042',
				totalAmount: 12345, // 123.45
				currency: 'RON'
			}
		]);
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		pushSelect([
			{ description: 'Hosting Pro 1 an' },
			{ description: 'SSL gratuit' }
		]);
		pushSelect([{ id: 'cli-1', businessName: 'Acme SRL', name: 'Acme', email: 'acme@example.ro' }]);
		// Dedupe insert succeeds → returns one row.
		pushInsert([{ id: 'evt-admin-1' }]);

		await notifyAdminPaymentReceived('t-1', 'inv-1', {
			magic_link: 'success',
			keez_invoice: 'success',
			da_provision: 'failed'
		});

		// Dedupe row inserted with correct shape
		expect(insertCalls.length).toBe(1);
		const insertValues = insertCalls[0].values as Record<string, unknown>;
		expect(insertValues.tenantId).toBe('t-1');
		expect(insertValues.invoiceId).toBe('inv-1');
		expect(insertValues.eventType).toBe('admin-payment-received');
		expect(insertValues.dedupeKey).toBe('admin-payment-received:inv-1');

		// One logEmailAttempt per recipient — pre-create pattern (Task 8)
		expect(logEmailAttemptCalls.length).toBe(2);
		expect(logEmailAttemptCalls[0].toEmail).toBe('admin1@example.ro');
		expect(logEmailAttemptCalls[0].emailType).toBe('admin-payment-received');
		expect(logEmailAttemptCalls[1].toEmail).toBe('admin2@example.ro');

		// One sendWithPersistence per recipient
		expect(sendWithPersistenceCalls.length).toBe(2);
		// payload: null on both per the multi-recipient/dedupe convention
		expect(sendWithPersistenceCalls[0].ctx.payload).toBeNull();
		expect(sendWithPersistenceCalls[1].ctx.payload).toBeNull();
		// _retryOfLogId matches the pre-created email-log id (last-writer-wins
		// dedupe linkage is exercised below)
		expect(sendWithPersistenceCalls[0].ctx._retryOfLogId).toBe('email-log-1');
		expect(sendWithPersistenceCalls[1].ctx._retryOfLogId).toBe('email-log-2');
		// Subject includes formatted amount and tenant slug
		const subject = sendWithPersistenceCalls[0].ctx.subject as string;
		expect(subject).toContain('123.45');
		expect(subject).toContain('RON');
		expect(subject).toContain('ots');

		// Dedupe row patched with last recipient's emailLogId (last-writer-wins)
		const patchUpdate = updateCalls.find(
			(c) => (c.set as Record<string, unknown>).emailLogId === 'email-log-2'
		);
		expect(patchUpdate).toBeDefined();

		// Success log emitted
		const sentLog = loggerCalls.info.find((l) => l.message.includes('sent admin-payment-received'));
		expect(sentLog).toBeDefined();
		expect(sentLog!.source).toBe('hosting-email');
	});

	test('same-invoice second call is dedupe no-op', async () => {
		resolveAdminRecipientsReturn = ['admin@example.ro'];

		// Pre-dedupe lookups still happen (resolve-before-dedupe pattern from
		// Task 6 review fixes — transient DB errors must not leak a dedupe row).
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't-1',
				clientId: 'cli-1',
				invoiceNumber: 'OTS-2026-0042',
				totalAmount: 12345,
				currency: 'RON'
			}
		]);
		pushSelect([{ id: 't-1', slug: 'ots' }]);
		pushSelect([{ description: 'Hosting Pro' }]);
		pushSelect([{ id: 'cli-1', businessName: 'Acme SRL', name: 'Acme', email: 'acme@example.ro' }]);
		// onConflictDoNothing → empty returning → dedupe hit
		pushInsert([]);

		await notifyAdminPaymentReceived('t-1', 'inv-1', { magic_link: 'success' });

		// Dedupe insert was attempted but returned no rows → no send + no
		// per-recipient log row.
		expect(insertCalls.length).toBe(1);
		expect(logEmailAttemptCalls.length).toBe(0);
		expect(sendWithPersistenceCalls.length).toBe(0);

		// Skip log emitted
		const skipLog = loggerCalls.info.find((l) =>
			l.message.includes('dedupe skip admin-payment-received')
		);
		expect(skipLog).toBeDefined();
		expect(skipLog!.source).toBe('hosting-email');
	});
});
