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
let warningLogs: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: (_scope: string, message: string) => {
		errorLogs.push(message);
	},
	logWarning: (_scope: string, message: string) => {
		warningLogs.push(message);
	},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));

// Modul dev-test (chei Stripe de TEST pe localhost) — controlabil per test.
let devTestMode = false;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeDevTestMode: () => devTestMode
}));

// Notificările de plată (email client + alertă admin) — spioni.
let paymentSucceededCalls: Array<{ tenantId: string; invoiceId: string }> = [];
let adminReceivedCalls: Array<{ tenantId: string; invoiceId: string; steps: Record<string, string> }> = [];
let notifyShouldThrow = false;
mock.module('$lib/server/stripe/notifications', () => ({
	notifyPaymentSucceeded: async (tenantId: string, invoiceId: string) => {
		paymentSucceededCalls.push({ tenantId, invoiceId });
		if (notifyShouldThrow) throw new Error('SMTP down');
	},
	notifyAdminPaymentReceived: async (
		tenantId: string,
		invoiceId: string,
		steps: Record<string, string>
	) => {
		adminReceivedCalls.push({ tenantId, invoiceId, steps });
		if (notifyShouldThrow) throw new Error('SMTP down');
	}
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
	warningLogs = [];
	devTestMode = false;
	paymentSucceededCalls = [];
	adminReceivedCalls = [];
	notifyShouldThrow = false;
});

describe('handleStripeInvoicePayment — notificări de plată', () => {
	function sentInvoiceThenPaid() {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: null,
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);
		pushSelect([
			{ id: 'inv-1', tenantId: 't1', status: 'paid', invoiceNumber: '8', totalAmount: 90629, hostingAccountId: null }
		]);
	}

	test('tranziție sent→paid: trimite confirmarea către client ȘI alerta admin', async () => {
		sentInvoiceThenPaid();
		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});
		expect(paymentSucceededCalls).toEqual([{ tenantId: 't1', invoiceId: 'inv-1' }]);
		expect(adminReceivedCalls).toHaveLength(1);
		expect(adminReceivedCalls[0]).toMatchObject({ tenantId: 't1', invoiceId: 'inv-1' });
	});

	test('redelivery idempotent (deja paid): NU trimite notificări', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: '8',
				totalAmount: 90629,
				stripePaymentIntentId: 'pi_123'
			}
		]);
		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});
		expect(paymentSucceededCalls).toHaveLength(0);
		expect(adminReceivedCalls).toHaveLength(0);
	});

	test('sumă încasată ≠ total: NU marchează plătită și NU notifică', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				stripePaymentIntentId: null
			}
		]);
		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 50000,
			eventLabel: 'payment_intent.succeeded'
		});
		expect(updateCalls).toBe(0);
		expect(paymentSucceededCalls).toHaveLength(0);
		expect(adminReceivedCalls).toHaveLength(0);
	});

	test('notificarea eșuează: handlerul NU aruncă (webhook-ul nu intră în retry-storm)', async () => {
		notifyShouldThrow = true;
		sentInvoiceThenPaid();
		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});
		// factura A FOST marcată plătită, doar emailul a picat
		expect(updateCalls).toBe(1);
		expect(errorLogs.some((m) => m.includes('notific'))).toBe(true);
	});
});

describe('handleStripeInvoicePayment — dev-test guard (DB partajat cu producția)', () => {
	test('dev-test: refuză să marcheze plătită o factură reală (fără prefix TEST-)', async () => {
		devTestMode = true;
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: null,
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_test_1',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(warningLogs.some((m) => m.includes('DEV-TEST'))).toBe(true);
	});

	test('dev-test: factura cu numărul prefixat TEST- trece (bucla E2E locală)', async () => {
		devTestMode = true;
		pushSelect([
			{
				id: 'inv-t',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: 'TEST-E2E-PLATA',
				totalAmount: 1000,
				hostingAccountId: null,
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);
		pushSelect([
			{
				id: 'inv-t',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: 'TEST-E2E-PLATA',
				totalAmount: 1000,
				hostingAccountId: null
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-t',
			paymentIntentId: 'pi_test_2',
			paidAmountCents: 1000,
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(1);
		expect(emitted.map((e) => e.type)).toContain('invoice.paid');
	});
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
				totalAmount: 90629,
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
				totalAmount: 90629,
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
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: 'pi_123'
			}
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

	test('suma încasată diferă de totalul facturii → NU marchează plătită, loghează critic', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: 'pi_123',
				externalTransactionId: null
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: 50000, // factura a fost editată între timp
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('sumă'))).toBe(true);
	});

	test('sumă necunoscută (null) nu blochează marcarea plătită', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'sent',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: null,
				externalTransactionId: null
			}
		]);
		pushSelect([
			{ id: 'inv-1', tenantId: 't1', status: 'paid', invoiceNumber: '8', totalAmount: 90629 }
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_123',
			paidAmountCents: null,
			eventLabel: 'checkout.session.completed'
		});

		expect(updateCalls).toBe(1);
	});

	test('factură deja plătită cu ALT PaymentIntent → alertă de dublă încasare', async () => {
		pushSelect([
			{
				id: 'inv-1',
				tenantId: 't1',
				status: 'paid',
				invoiceNumber: '8',
				totalAmount: 90629,
				hostingAccountId: 'acc-1',
				stripePaymentIntentId: 'pi_PRIMUL'
			}
		]);

		await handleStripeInvoicePayment({
			tenantId: 't1',
			invoiceId: 'inv-1',
			paymentIntentId: 'pi_AL_DOILEA',
			paidAmountCents: 90629,
			eventLabel: 'payment_intent.succeeded'
		});

		expect(updateCalls).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('dublă încasare'))).toBe(true);
	});
});
