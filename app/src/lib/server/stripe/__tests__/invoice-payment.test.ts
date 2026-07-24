import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock SvelteKit virtual env modules BEFORE importing the module under test
// (it transitively imports $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// --- db.select().from().where().limit() and db.update().set().where() mocks ---
interface Queued {
	rows: unknown[];
}
let selectQueue: Queued[] = [];
let updateCalls = 0;

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.where = () => chain;
	chain.limit = () => chain;
	chain.then = (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) => {
		try {
			const next = selectQueue.shift();
			if (!next) throw new Error('no queued db.select() result — test setup mismatch');
			resolve(next.rows);
		} catch (e) {
			if (reject) reject(e);
			else throw e;
		}
	};
	return chain;
}

function makeUpdateChain() {
	const chain: Record<string, unknown> = {};
	chain.set = () => chain;
	chain.where = () => {
		updateCalls++;
		return chain;
	};
	chain.then = (resolve: (v: unknown[]) => void) => resolve([]);
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		update: () => makeUpdateChain()
	}
}));

// Load the real schema so `table.invoice.*` column refs resolve.
await import('$lib/server/db/schema');

// Capture emitted hook events.
let emitted: Array<{ type: string }> = [];
mock.module('$lib/server/plugins/hooks', () => ({
	getHooksManager: () => ({
		emit: async (event: { type: string }) => {
			emitted.push(event);
		}
	})
}));

// Capture logger calls.
let errorLogs: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: (_scope: string, message: string) => {
		errorLogs.push(message);
	},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));

const { handleStripeInvoicePayment } = await import('../invoice-payment');

function pushSelect(rows: unknown[]) {
	selectQueue.push({ rows });
}

beforeEach(() => {
	selectQueue = [];
	updateCalls = 0;
	emitted = [];
	errorLogs = [];
});

describe('handleStripeInvoicePayment', () => {
	test('marks a sent invoice paid and emits the invoice.paid hook trio', async () => {
		// 1st select: existing invoice (status 'sent'). 2nd select: post-update row.
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: '8',
				hostingAccountId: 'acc-1'
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(1);
		const types = emitted.map((e) => e.type);
		expect(types).toContain('invoice.paid');
		expect(types).toContain('invoice.status.changed');
		expect(types).toContain('invoice.updated');
	});

	test('is idempotent: already-paid invoice does NOT update or emit', async () => {
		pushSelect([
			{ id: 'inv-1', tenantId: 't1', status: 'paid', invoiceNumber: '8', hostingAccountId: 'acc-1' }
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 90629,
			eventLabel: 'checkout.session.completed'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
	});

	test('invoice not found (wrong tenant): no update, no emit, logs error', async () => {
		pushSelect([]); // tenant-scoped lookup returns nothing

		await handleStripeInvoicePayment({
			tenantId: 'other-tenant',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('negăsit'))).toBe(true);
	});
});
