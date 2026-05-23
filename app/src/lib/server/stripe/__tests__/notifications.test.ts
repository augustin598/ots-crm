import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

// Mock SvelteKit virtual modules BEFORE importing the module under test
// (which transitively imports $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

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

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		insert: (t: unknown) => makeInsertChain(t)
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
		invoiceNumber: 'invoice_number'
	}
}));

// Mock $lib/server/email — both sendInvoicePaidEmail and getNotificationRecipients
const sendInvoicePaidEmailCalls: Array<{ invoiceId: string; clientEmail: string }> = [];
let sendInvoicePaidEmailImpl: (invoiceId: string, clientEmail: string) => Promise<void> = async () => {};

const getNotificationRecipientsCalls: Array<{ clientId: string; category: string }> = [];
let getNotificationRecipientsReturn: Array<{ email: string; name: string | null }> = [
	{ email: 'client@example.ro', name: 'Acme SRL' }
];

mock.module('$lib/server/email', () => ({
	sendInvoicePaidEmail: async (invoiceId: string, clientEmail: string) => {
		sendInvoicePaidEmailCalls.push({ invoiceId, clientEmail });
		await sendInvoicePaidEmailImpl(invoiceId, clientEmail);
	},
	getNotificationRecipients: async (clientId: string, category: string) => {
		getNotificationRecipientsCalls.push({ clientId, category });
		return getNotificationRecipientsReturn;
	}
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

// Capture the real email module exports so we can restore after the test file.
// Without this the mock leaks into other test files run in the same Bun process.
const realEmail = await import('../../email');
const capturedEmail = {
	sendInvoicePaidEmail: realEmail.sendInvoicePaidEmail,
	getNotificationRecipients: realEmail.getNotificationRecipients
};

// Now import the function under test
const { notifyPaymentSucceeded } = await import('../notifications');

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
	sendInvoicePaidEmailCalls.length = 0;
	sendInvoicePaidEmailImpl = async () => {};
	getNotificationRecipientsCalls.length = 0;
	getNotificationRecipientsReturn = [{ email: 'client@example.ro', name: 'Acme SRL' }];
	loggerCalls.info.length = 0;
	loggerCalls.error.length = 0;
	loggerCalls.warning.length = 0;
});

afterAll(() => {
	mock.module('$lib/server/email', () => capturedEmail);
});

describe('notifyPaymentSucceeded', () => {
	test('inserts dedupe row + calls sendInvoicePaidEmail for each resolved recipient', async () => {
		getNotificationRecipientsReturn = [
			{ email: 'primary@example.ro', name: 'Acme SRL' },
			{ email: 'secondary@example.ro', name: 'Accountant' }
		];
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
		// 1. Dedupe insert succeeds
		pushInsert([{ id: 'evt-1' }]);
		// 2. Invoice lookup returns nothing (cross-tenant or deleted)
		pushSelect([]);

		await expect(notifyPaymentSucceeded('t-attacker', 'inv-victim')).rejects.toThrow(/not found/i);

		expect(getNotificationRecipientsCalls.length).toBe(0);
		expect(sendInvoicePaidEmailCalls.length).toBe(0);
		expect(loggerCalls.error.length).toBeGreaterThanOrEqual(1);
	});
});
